import {PROFILE_KEY, profilePrefix} from './profiles.js';
import {abortable, safeAPIPath} from './api.js';

const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined && (value[key] === null || ['string','number','boolean'].includes(typeof value[key]))).map(key => [key, value[key]]));
export function snapshotKey(config) {
    return `${profilePrefix(config.profileId)}pipelineSnapshot:v1:${JSON.stringify(['clientId','orgId','programId','oauthScopes'].map(key => String(config[key] || '')))}`;
}
export const snapshotInvalidationKey = config => `${profilePrefix(config.profileId)}pipelineInvalidated:${config.programId}`;
export function projectPipeline(pipeline) {
    return {...pick(pipeline, ['id','name','status','type','buildType','buildEnvironment','pipelineType','lastStartedAt','lastFinishedAt']),
        ...(Array.isArray(pipeline.phases) ? {phases: pipeline.phases.map(phase => ({
            ...pick(phase, ['type','name','environmentId','environmentType','buildType','buildEnvironment']),
            steps: (phase.steps || []).map(step => ({...pick(step, ['type','name','action']),
                options: pick(step.options, ['type','buildType','buildEnvironment','pipelineType'])}))
        }))} : {})};
}
export function projectExecution(execution) {
    if (!execution) {return null;}
    return {...pick(execution, ['id','status','pipelineId','createdAt','startedAt','finishedAt']),
        _embedded: {stepStates: (execution._embedded?.stepStates || []).map(step => ({
            ...pick(step, ['id','phaseId','stepId','name','action','status','environmentId','environmentType']),
            _links: Object.fromEntries(['http://ns.adobe.com/adobecloud/rel/pipeline/advance','http://ns.adobe.com/adobecloud/rel/pipeline/cancel'].flatMap(key => {
                const value = step._links?.[key];
                try {
                    const path = safeAPIPath(typeof value === 'string' ? value : value?.href);
                    return path ? [[key,{href:path.split('?')[0]}]] : [];
                } catch { return []; }
            }))
        }))}};
}
function projectSnapshot(snapshot) {
    return {version:1,updatedAt:snapshot.updatedAt || 0,
        environments:(snapshot.environments || []).map(env => pick(env, ['id','name','type','status','region','variableUpdateStatus','variableUpdateObserved','variableUpdateStartedAt'])),
        pipelines:(snapshot.pipelines || []).map(projectPipeline),
        executions:Object.fromEntries(Object.entries(snapshot.executions || {}).map(([id, record]) => [id, {
            updatedAt:record.updatedAt || 0, historical:!!record.historical, missing:!!record.missing, historyChecked:!!record.historyChecked, stale:!!record.stale,
            execution:projectExecution(record.execution)
        }]))};
}
export async function loadSnapshot(config, signal, storage = chrome.storage.session) {
    const deadline = signal ? AbortSignal.any([signal,AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000);
    try {
        const key = snapshotKey(config);
        const invalidationKey=snapshotInvalidationKey(config);
        const values=await abortable(storage.get([key,invalidationKey]),deadline),value=values[key];
        if(values[invalidationKey] && (!value?.updatedAt || value.updatedAt<=values[invalidationKey])){return null;}
        if (value?.version !== 1 || !Array.isArray(value.environments) || !Array.isArray(value.pipelines)) {return null;}
        return projectSnapshot(value);
    } catch {
        if (signal?.aborted) {throw signal.reason;}
        // An unavailable session cache falls back to fresh API data.
        return null;
    }
}
export async function saveSnapshot(config, snapshot, signal, storage = chrome.storage.session) {
    signal?.throwIfAborted();
    const value = projectSnapshot(snapshot);
    if (JSON.stringify(value).length > 2000000) {throw new Error('Pipeline cache exceeds its size limit.');}
    const deadline = signal ? AbortSignal.any([signal,AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000);
    const key=snapshotKey(config);
    const write=storage.set({[key]:value}).then(async()=>{
        const invalidationKey=snapshotInvalidationKey(config);
        const invalidated=(await storage.get([invalidationKey]))[invalidationKey];
        if(invalidated && value.updatedAt<=invalidated){await storage.remove(key);return;}
        // Chrome storage writes cannot be cancelled. Remove a delayed write if
        // profile deletion finished while that write was in flight.
        if(config.profileId){
            const state=(await chrome.storage.local.get([PROFILE_KEY]))[PROFILE_KEY];
            if(!state?.profiles.some(profile=>profile.id===config.profileId)){await storage.remove(key);}
        }
    });
    await abortable(write,deadline);
}
