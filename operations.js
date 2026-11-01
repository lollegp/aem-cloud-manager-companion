import {request,usesBackground,pathFor,embedded,link,safeAPIPath} from './api.js';
import {environmentIds,runPipelineBatch,canStopPipeline,approvalAction,stopAction} from './pipeline.js';
import {environmentBlocksStart,variableUpdateState} from './variables.js';
import {profilePrefix} from './profiles.js';

export const variablePendingKey = (config,id) => `${profilePrefix(config.profileId)}variablePending:${config.programId}:${id}`;
export async function pendingVariableState(config,id) {
    const key=variablePendingKey(config,id);
    const value=(await chrome.storage.session.get([key]))[key];
    return value ? {variableUpdateStatus:'updating',variableUpdateStartedAt:value,variableUpdateObserved:false} : {};
}
export async function submitOperation(kind,payload,config) {
    const safeConfig=Object.fromEntries(['profileId','clientId','orgId','programId','oauthScopes'].map(key=>[key,config[key] || '']));
    const job={kind,payload,config:safeConfig};
    if(!usesBackground())return executeOperation(job);
    job.id=crypto.randomUUID();
    const response=await chrome.runtime.sendMessage({type:'operation',job});
    if(!response?.ok)throw new Error(response?.error || 'Action result unavailable. Refresh its state before retrying.');
    return response.data;
}

export async function executeOperation(job,send=request) {
    const {kind,payload,config}=job;
    const api=(path,method='GET',body)=>send(path,method,body,{expectedConfig:config});
    if(kind==='variables') {
        if(!payload.environmentId || !Array.isArray(payload.patch) || !payload.patch.length)throw new Error('Invalid variable changes.');
        return api(pathFor(config.programId,`/environment/${encodeURIComponent(payload.environmentId)}/variables`),'PATCH',payload.patch);
    }
    if(kind!=='pipelines' || !['start','stop','promote','reject'].includes(payload.action) || !Array.isArray(payload.pipelines) || !payload.pipelines.length)throw new Error('Invalid pipeline action.');
    const {action}=payload,decision=['promote','reject'].includes(action);
    let environmentsPromise;
    const environments=()=>environmentsPromise ||= (async()=>{
        const result=[],seen=new Set(),ids=new Set();let next=pathFor(config.programId,'/environments');
        while(next){
            if(seen.has(next) || seen.size>=100)throw new Error('Environment pagination repeated or exceeded its limit.');
            seen.add(next);const page=await api(next),items=embedded(page,'environments');
            if(!items.length)break;
            const before=result.length;
            for(const item of items)if(!ids.has(String(item.id))){ids.add(String(item.id));result.push(item);}
            if(Number.isInteger(page._totalNumberOfItems) && result.length>=page._totalNumberOfItems)break;
            if(result.length===before)throw new Error('Environment pagination returned no new records.');
            next=safeAPIPath(link(page,'next'));
        }
        return result;
    })();
    if(decision){
        const environment=(await environments()).find(env=>String(env.id)===String(payload.environmentId));
        if(!['prod','production'].includes(String(environment?.type).toLowerCase()))throw new Error('Approval decisions require a production environment.');
    }
    const environmentChecks=new Map();
    const checkEnvironment=id=>{
        if(!environmentChecks.has(id))environmentChecks.set(id,(async()=>{
            const [list,data]=await Promise.all([environments(),api(pathFor(config.programId,`/environment/${encodeURIComponent(id)}/variables`))]);
            const environment=list.find(env=>String(env.id)===id);
            if(!environment)return {blocked:true,name:`Environment ${id}`};
            // The worker records accepted variable writes independently of popup caches.
            const pending=send===request?await pendingVariableState(config,id):{};
            const current={...environment,...pending};
            Object.assign(current,variableUpdateState(current,embedded(data,'variables')));
            return {blocked:environmentBlocksStart(current),name:environment.name || `Environment ${id}`};
        })());
        return environmentChecks.get(id);
    };
    return runPipelineBatch(payload.pipelines,async pipeline=>{
        const base=pathFor(config.programId,`/pipeline/${encodeURIComponent(pipeline.id)}`);
        const fresh=await api(base);
        const targets=environmentIds(fresh);
        if(JSON.stringify([...targets].sort())!==JSON.stringify(environmentIds(pipeline).sort()))return 'Skipped: deployment targets changed; refresh and review';
        if(decision && !targets.includes(String(payload.environmentId)))return 'Skipped: pipeline no longer targets this environment';
        if(['start','promote'].includes(action)){
            const blocked=(await Promise.all(targets.map(checkEnvironment))).find(environment=>environment.blocked);
            if(blocked)return `Skipped: ${blocked.name} is updating or unavailable`;
        }
        if(action==='start'){
            if(fresh.status!=='IDLE')return 'Skipped: no longer idle';
            await api(base+'/execution','PUT');return 'Start requested';
        }
        if(!decision && !canStopPipeline(fresh))return 'Skipped: no longer running';
        const current=await api(base+'/execution');
        let execution=current?.id?current:embedded(current,'executions')[0];
        const expected=payload.executions?.[String(pipeline.id)];
        if(!expected || String(execution?.id)!==String(expected))return 'Skipped: execution changed; refresh and review';
        // Always re-read the exact execution before a decision or cancellation.
        execution=await api(base+`/execution/${encodeURIComponent(expected)}`);
        if(String(execution?.id)!==String(expected))return 'Skipped: execution changed; refresh and review';
        const steps=execution?._embedded?.stepStates || [];
        const perform=async operation=>{
            const path=safeAPIPath(operation.path);
            const expectedPath=base+`/execution/${encodeURIComponent(expected)}/`;
            if(!path?.startsWith(expectedPath))throw new Error('Unexpected pipeline execution action URL.');
            await api(path,'PUT',operation.body);
        };
        if(decision){
            const waiting=steps.filter(step=>step.status==='WAITING'&&step.action==='approval');
            if(waiting.length!==1)return 'Skipped: no single waiting production approval';
            const operation=approvalAction(waiting[0],action==='promote');
            if(!operation)return 'Skipped: approval action unavailable';
            await perform(operation);return action==='promote'?'Approve requested':'Reject requested';
        }
        const stops=steps.map(stopAction).filter(Boolean);
        if(!stops.length)return 'Skipped: no cancellable step available';
        const outcomes=await Promise.allSettled(stops.map(perform));
        const failures=outcomes.filter(result=>result.status==='rejected');
        if(failures.length)throw new Error(`Stop incomplete: ${failures.map(result=>result.reason.message).join('; ')}`);
        return 'Stop requested';
    });
}
