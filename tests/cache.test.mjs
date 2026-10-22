import test from 'node:test';
import assert from 'node:assert/strict';

test('cache identity separates clients, organizations, programs, and scopes', async () => {
    const {snapshotKey} = await import('../cache.js');
    const identity = {clientId:'client', orgId:'org', programId:'1', oauthScopes:'scope'};
    const keys = [snapshotKey(identity), ...Object.keys(identity).map(key => snapshotKey({...identity,[key]:'other'}))];
    assert.equal(new Set(keys).size, 5);
});
test('session snapshot includes only display data, not credentials, variables or arbitrary step options', async () => {
    const {saveSnapshot, loadSnapshot} = await import('../cache.js');
    const records = {}, storage = {get: async keys => Object.fromEntries(keys.map(k => [k,records[k]])),set: async values => Object.assign(records,structuredClone(values))};
    const identity = {clientId:'client',orgId:'org',programId:'1'};
    await saveSnapshot(identity,{updatedAt:10,environments:[{id:'1',name:'Dev',secret:'PRIVATE'}],pipelines:[{id:'2',phases:[{type:'BUILD',steps:[{options:{buildType:'frontend',secret:'PRIVATE'}}]}],variables:[{value:'PRIVATE'}]}],executions:{'2':{updatedAt:12,execution:{id:'3',status:'FINISHED',user:'PRIVATE',_embedded:{stepStates:[{action:'build',status:'FINISHED',details:{input:'PRIVATE'}}]}}}},token:'PRIVATE'},undefined,storage);
    assert.doesNotMatch(JSON.stringify(records), /PRIVATE/);
    const cached = await loadSnapshot(identity,undefined,storage);
    assert.equal(cached.pipelines[0].phases[0].steps[0].options.buildType,'frontend');
    assert.equal(cached.executions['2'].execution.id,'3');
    assert.equal(cached.updatedAt,10);
    assert.equal(await loadSnapshot({...identity,programId:'other'},undefined,storage),null);
});
test('aborted cache writes never replace a previous snapshot', async () => {
    const {saveSnapshot} = await import('../cache.js');
    let writes = 0;
    await assert.rejects(saveSnapshot({clientId:'c',orgId:'o',programId:'1'},{},AbortSignal.abort(),{set:async () => writes++}));
    assert.equal(writes,0);
});
