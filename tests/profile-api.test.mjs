import test from 'node:test';
import assert from 'node:assert/strict';
import {settings,request} from '../api.js';
import {snapshotKey} from '../cache.js';
const profiles=[{id:'a',clientId:'client',orgId:'org',programId:'1',oauthScopes:'scope'},{id:'b',clientId:'client',orgId:'org',programId:'1',oauthScopes:'scope'}];
function fixture(){
    const local={connectionProfiles:{version:1,activeProfileId:'a',profiles}},session={'profileSession:a':{token:'token-a'},'profileSession:b':{token:'token-b'}};
    globalThis.chrome={storage:{local:{get:async()=>structuredClone(local)},session:{get:async keys=>structuredClone(Object.fromEntries(keys.filter(k=>session[k]).map(k=>[k,session[k]])))}}};
    return {local,session};
}
test('settings selects only the active profile token',async()=>{
    const f=fixture();assert.equal((await settings()).token,'token-a');assert.equal((await settings()).profileId,'a');
    f.local.connectionProfiles.activeProfileId='b';assert.equal((await settings()).token,'token-b');
});
test('profile identity isolates caches for identical connection identifiers',()=>{
    assert.notEqual(snapshotKey({...profiles[0],profileId:'a'}),snapshotKey({...profiles[1],profileId:'b'}));
});
test('stale profile guard prevents a request even when connection fields match',async()=>{
    const f=fixture(),config=await settings();f.local.connectionProfiles.activeProfileId='b';
    globalThis.fetch=()=>{throw Error('must not send');};
    await assert.rejects(request('/api/program/1/environments','GET',undefined,{expectedConfig:config}),/changed/i);
});
test('a stale program URL cannot use the newly active profile credentials',async()=>{
    fixture();globalThis.fetch=()=>{throw Error('must not send');};
    await assert.rejects(request('/api/program/2/environments'),/program|changed/i);
});

test('late cache writes are removed when their profile has been deleted',async()=>{
    const {saveSnapshot}=await import('../cache.js');
    const f=fixture(),config={...await settings()};
    const data={};let release,started;const began=new Promise(resolve=>{started=resolve;});
    const storage={get:async()=>({...data}),set:async value=>{started();await new Promise(resolve=>{release=resolve;});Object.assign(data,value);},remove:async key=>{delete data[key];}};
    const pending=saveSnapshot(config,{updatedAt:1,environments:[],pipelines:[],executions:{}},undefined,storage);
    await began;f.local.connectionProfiles.profiles=f.local.connectionProfiles.profiles.filter(p=>p.id!=='a');release();await pending;
    assert.deepEqual(data,{});
});

test('late pre-action snapshots cannot repopulate an invalidated cache',async()=>{
    const {saveSnapshot,loadSnapshot,snapshotInvalidationKey}=await import('../cache.js');
    fixture();const config=await settings(),data={};
    let release,started;const began=new Promise(resolve=>{started=resolve;});
    const storage={get:async()=>structuredClone(data),set:async value=>{started();await new Promise(resolve=>{release=resolve;});Object.assign(data,value);},remove:async key=>{delete data[key];}};
    const pending=saveSnapshot(config,{updatedAt:10,environments:[],pipelines:[],executions:{}},undefined,storage);
    await began;data[snapshotInvalidationKey(config)]=20;release();await pending;
    assert.equal(await loadSnapshot(config,undefined,storage),null);
    assert.equal(data[snapshotKey(config)],undefined);
});

test('post-mutation reads do not join a pre-mutation in-flight response',async()=>{
    const {configureWorkerAPI}=await import('../api.js');
    fixture();configureWorkerAPI(async()=>({token:'token'}));
    let release,started,reads=0;
    const began=new Promise(resolve=>{started=resolve;});
    globalThis.fetch=async(_url,options)=>{
        if(options.method==='PUT')return new globalThis.Response('{}',{status:200});
        const version=++reads;
        if(version===1){started();await new Promise(resolve=>{release=resolve;});}
        return new globalThis.Response(JSON.stringify({version}),{status:200});
    };
    const before=request('/api/program/1/pipeline/2');await began;
    await request('/api/program/1/pipeline/2/execution','PUT');
    const after=request('/api/program/1/pipeline/2');
    await new Promise(resolve=>setImmediate(resolve));
    release();
    const [old,fresh]=await Promise.all([before,after]);
    configureWorkerAPI(undefined);
    assert.equal(old.version,1);assert.equal(fresh.version,2);
});
