import {variableDraftKey, saveVariableDraft} from './variables.js';
import {createProfileController} from './profiles.js';
import {configureWorkerAPI,invalidateWorkerReads,request,settings} from './api.js';
import {createJobManager} from './jobs.js';
import {executeOperation,variablePendingKey} from './operations.js';
import {snapshotKey,snapshotInvalidationKey} from './cache.js';

const run = createProfileController(chrome.storage);
configureWorkerAPI(run);
const jobs=createJobManager(chrome.storage.session,async job=>{
    invalidateWorkerReads();
    const current=await settings();
    if(['profileId','clientId','orgId','programId','oauthScopes'].some(key=>String(current[key] || '')!==String(job.config?.[key] || ''))){throw new Error('Connection settings changed. Refresh before running an action.');}
    await chrome.storage.session.set({[snapshotInvalidationKey(job.config)]:Date.now()});
    await chrome.storage.session.remove(snapshotKey(job.config));
    try {
        const result=await executeOperation(job);
        if(job.kind==='variables'){
            await saveVariableDraft(variableDraftKey(snapshotKey(job.config),job.payload.environmentId));
            await chrome.storage.session.set({[variablePendingKey(job.config,job.payload.environmentId)]:Date.now()});
        }
        return result;
    } finally {
        await chrome.storage.session.set({[snapshotInvalidationKey(job.config)]:Date.now()});
        await chrome.storage.session.remove(snapshotKey(job.config));
    }
});
// Extension API activity keeps accepted work alive after its sending popup
// disappears. This timer exists only while work is pending, never while idle.
let workCount=0,heartbeat,credentialChanges=0;
function keepWorking() {
    workCount++;
    if(workCount!==1){return;}
    const pulse=()=>{if(!workCount){return;}void chrome.runtime.getPlatformInfo().catch(()=>{});heartbeat=setTimeout(pulse,20000);};
    heartbeat=setTimeout(pulse,20000);
}
function finishedWorking(){if(--workCount===0){clearTimeout(heartbeat);}}
const initialize = () => { void run({action:'status'}).catch(()=>{});void jobs.list('').catch(()=>{}); };
chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(!['credentials','api','operation','operationStatus'].includes(message?.type)){return false;}
    const settingsPage=sender.url===chrome.runtime.getURL('options.html');
    const popup=sender.url===chrome.runtime.getURL('popup.html');
    const respond=result=>{try{sendResponse(result);}catch{/* The sender may have closed; worker-owned work is already complete. */}};
    if(sender.id!==chrome.runtime.id || (!settingsPage&&!popup)){
        respond({ok:false,error:'This page cannot perform the requested operation.'});return false;
    }
    keepWorking();
    (async()=>{
        if(message.type==='operationStatus'){return jobs.list((await settings()).profileId || '');}
        if(message.type==='operation'){
            if(!popup){throw new Error('Only the popup can submit pipeline or variable actions.');}
            if(credentialChanges){throw new Error('Credentials are being updated. Wait before submitting an action.');}
            return jobs.start(message.job);
        }
        if(message.type==='api'){
            if(!['GET','HEAD'].includes(message.method)){throw new Error('Use a confirmed background action for changes.');}
            return request(message.path,message.method,undefined,{expectedConfig:message.config});
        }
        const allowedPopup=['ensureToken','listProfiles','selectProfile'];
        if(!settingsPage&&!allowedPopup.includes(message.action)){throw new Error('This page cannot perform the requested credential operation.');}
        if(jobs.busy()&&!['ensureToken','listProfiles','status'].includes(message.action)){throw new Error('An action is in progress. Wait before changing program or credentials.');}
        const changesCredentials=!['ensureToken','listProfiles','status'].includes(message.action);
        if(changesCredentials){credentialChanges++;}
        try{return await run(message);}finally{if(changesCredentials){credentialChanges--;}}
    })().then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message || 'Background operation failed.'})).finally(finishedWorking);
    return true;
});
