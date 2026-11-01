import test from 'node:test';
import assert from 'node:assert/strict';
const implementation = await import('../profiles.js').catch(() => ({}));
const config = {clientId:'client',orgId:'org',programId:'1',oauthScopes:'scope'};
function fixture(initial = {}, initialSession = {}) {
    const local = structuredClone(initial), session = structuredClone(initialSession);
    let fail = false;
    const area = (data, persistent) => ({
        get: async keys => structuredClone(keys == null ? data : Object.fromEntries(keys.filter(key => key in data).map(key => [key,data[key]]))),
        set: async values => {if(persistent && fail)throw Error('storage unavailable');Object.assign(data,structuredClone(values));},
        remove: async keys => {for(const key of Array.isArray(keys)?keys:[keys])delete data[key];},
        setAccessLevel: async () => {}
    });
    return {local,session,storage:{local:area(local,true),session:area(session,false)},fail: value => {fail=value;}};
}
function controller(f, generate = async (clientId,secret) => ({token:`${clientId}:${secret}`,tokenExpiresAt:Date.now()+3600000})) {
    assert.equal(typeof implementation.createProfileController,'function','profile controller exists');
    return implementation.createProfileController(f.storage,generate);
}
async function list(run) { return run({action:'listProfiles'}); }
async function add(run,name='Second') { return (await run({action:'addProfile',name})).activeProfileId; }
const bound = (id,extra={}) => ({profileId:id,...config,...extra});

test('legacy connection and token migrate once without re-entry or exposing secrets in profile lists',async()=>{
    const f=fixture({...config,credentialVault:{version:1,id:'old',ciphertext:'encrypted'}},{token:'manual',tokenOrgId:'org'}),run=controller(f);
    const state=await list(run),id=state.activeProfileId;
    assert.equal(state.profiles.length,1);assert.equal(state.profiles[0].programId,'1');
    assert.ok(!JSON.stringify(state).includes('encrypted'));assert.equal(f.session[`profileSession:${id}`].token,'manual');
    assert.equal(f.local.connectionProfiles.profiles[0].credentialVault.version,1);
    assert.ok(!f.local.credentialVault);assert.ok(!f.session.token);
    assert.deepEqual(await list(controller(f)),state);
});
test('profiles with identical program IDs keep independent secrets, tokens and restart renewal',async()=>{
    const f=fixture(config),run=controller(f);const first=(await list(run)).activeProfileId;
    await run({action:'saveVault',config:bound(first),secret:'first-secret',consent:true});
    await run({action:'ensureToken',config:bound(first)});
    const second=await add(run);
    await run({action:'saveVault',config:bound(second),secret:'second-secret',consent:true});
    await run({action:'ensureToken',config:bound(second)});
    assert.equal(f.session[`profileSession:${first}`].token,'client:first-secret');
    assert.equal(f.session[`profileSession:${second}`].token,'client:second-secret');
    assert.ok(!JSON.stringify(f.local).includes('first-secret'));assert.ok(!JSON.stringify(f.local).includes('second-secret'));
    delete f.session[`profileSession:${first}`];
    const restart=controller(f);await restart({action:'selectProfile',profileId:first});
    assert.equal((await restart({action:'ensureToken',config:bound(first)})).token,'client:first-secret');
    assert.equal(f.session[`profileSession:${second}`].token,'client:second-secret');
});
test('switching rejects stale operations even if credentials and program IDs match',async()=>{
    const f=fixture(config),run=controller(f),first=(await list(run)).activeProfileId;
    await add(run);
    for(const action of ['saveVault','generate','ensureToken','forget','clearToken'])
        await assert.rejects(run({action,profileId:first,config:bound(first),secret:'secret',consent:true}),/changed|active/i);
});
test('new profiles are empty and rename never changes their identity',async()=>{
    const f=fixture(config),run=controller(f);await list(run);const id=await add(run,'Production');
    let state=await list(run);assert.equal(state.profiles.find(p=>p.id===id).programId,'');
    await run({action:'renameProfile',profileId:id,name:'Renamed'});state=await list(run);
    assert.equal(state.profiles.find(p=>p.id===id).name,'Renamed');
    await assert.rejects(run({action:'renameProfile',profileId:id,name:'   '}),/name/i);
});
test('delete removes only selected profile credentials, cache and preferences',async()=>{
    const f=fixture(config),run=controller(f),first=(await list(run)).activeProfileId;
    const second=await add(run);await run({action:'saveManual',config:bound(second),token:'second-token'});
    f.session[`profile:${second}:snapshot`]={value:1};f.local[`profile:${second}:order`]=['1'];
    f.local[`profile:${first}:order`]=['2'];
    await run({action:'deleteProfile',profileId:second});
    assert.equal((await list(run)).activeProfileId,first);
    assert.ok(!f.session[`profileSession:${second}`]);assert.ok(!f.session[`profile:${second}:snapshot`]);
    assert.ok(!f.local[`profile:${second}:order`]);assert.deepEqual(f.local[`profile:${first}:order`],['2']);
    await assert.rejects(run({action:'selectProfile',profileId:second}),/exist|found/i);
});
test('failed migration preserves the legacy connection and can be retried',async()=>{
    const f=fixture(config,{token:'original'}),run=controller(f);f.fail(true);
    await assert.rejects(list(run),/storage unavailable/);assert.equal(f.local.clientId,'client');assert.equal(f.session.token,'original');
    f.fail(false);const id=(await list(run)).activeProfileId;assert.equal(f.session[`profileSession:${id}`].token,'original');
});
test('profile switch waits for renewal and never writes its result into another profile',async()=>{
    let release,started;const begun=new Promise(resolve=>{started=resolve;});
    const f=fixture(config),run=controller(f,async()=>{started();await new Promise(resolve=>{release=resolve;});return {token:'first-token'};});
    const first=(await list(run)).activeProfileId;await run({action:'saveVault',config:bound(first),secret:'secret',consent:true});
    const pending=run({action:'ensureToken',config:bound(first)});await begun;
    const adding=add(run);release();await pending;const second=await adding;
    assert.equal(f.session[`profileSession:${first}`].token,'first-token');assert.ok(!f.session[`profileSession:${second}`]?.token);
});

test('migration removes original preference copies so profile deletion fulfills retention rules',async()=>{
    const key='environmentOrder:["org","1"]';
    const f=fixture({...config,[key]:['1']},{'pipelineSnapshot:v1:old':{version:1}}),run=controller(f);
    const id=(await list(run)).activeProfileId;
    assert.deepEqual(f.local[`profile:${id}:${key}`],['1']);
    assert.ok(!(key in f.local),'unscoped preference copy removed after durable migration');
    assert.ok(!f.session['pipelineSnapshot:v1:old'],'unscoped legacy display cache removed');
    await run({action:'deleteProfile',profileId:id});
    assert.ok(!Object.keys(f.local).some(key=>key.includes('environmentOrder')));
});

test('late preference writes cannot recreate a deleted profile metadata',async()=>{
    assert.equal(typeof implementation.saveProfilePreference,'function');
    const f=fixture(config),run=controller(f),id=(await list(run)).activeProfileId;
    let release,started;const began=new Promise(resolve=>{started=resolve;});
    const set=f.storage.local.set;
    f.storage.local.set=async values=>{
        if(Object.keys(values).some(key=>key.startsWith(`profile:${id}:`))){started();await new Promise(resolve=>{release=resolve;});}
        await set(values);
    };
    const pending=implementation.saveProfilePreference({profileId:id},`profile:${id}:environmentOrder:old`,['1'],f.storage.local);
    await began;await run({action:'deleteProfile',profileId:id});release();await pending;
    assert.ok(!Object.keys(f.local).some(key=>key.startsWith(`profile:${id}:`)));
});

test('interrupted deletion leaves profile inaccessible and cleanup retries after restart',async()=>{
    const f=fixture(config),run=controller(f),id=(await list(run)).activeProfileId;
    await run({action:'saveManual',config:bound(id),token:'original-token'});
    const remove=f.storage.session.remove;let fail=true;
    f.storage.session.remove=async keys=>{if(fail && (Array.isArray(keys)?keys:[keys]).includes(`profileSession:${id}`)){fail=false;throw Error('temporary storage failure');}return remove(keys);};
    await assert.rejects(run({action:'deleteProfile',profileId:id}),/temporary storage failure/);
    assert.equal(f.local.connectionProfiles.profiles.length,0,'deleted credential no longer selectable');
    await list(controller(f));assert.ok(!f.session[`profileSession:${id}`]);
});

test('profile commands time out without replay when worker does not answer',async()=>{
    const timer=globalThis.setTimeout,clear=globalThis.clearTimeout;let expire,calls=0;
    globalThis.chrome={runtime:{sendMessage:()=>{calls++;return new Promise(()=>{});}}};
    globalThis.setTimeout=fn=>{expire=fn;return 1;};globalThis.clearTimeout=()=>{};
    try{
        const pending=implementation.profileCommand('selectProfile',{profileId:'missing'});
        assert.equal(typeof expire,'function','worker operation has a deadline');
        const rejected=assert.rejects(pending,/45 seconds/);expire();await rejected;assert.equal(calls,1);
    }finally{globalThis.setTimeout=timer;globalThis.clearTimeout=clear;}
});
