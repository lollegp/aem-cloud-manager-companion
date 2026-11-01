import test from 'node:test';
import assert from 'node:assert/strict';
import {variableDraftKey,loadVariableDraft,saveVariableDraft} from '../variables.js';
import {snapshotKey} from '../cache.js';

test('session drafts survive reopening, preserve secrets and removals, and clear on discard',async()=>{
    const data={};
    const storage={get:async keys=>Object.fromEntries(keys.map(key=>[key,structuredClone(data[key])])),set:async values=>Object.assign(data,structuredClone(values)),remove:async key=>{delete data[key];}};
    const config={profileId:'one',clientId:'client',orgId:'org',programId:'1'};
    const key=variableDraftKey(snapshotKey(config),'1');
    const draft={original:[{name:'OLD',type:'string',value:'old'}],edits:[{name:'SECRET',type:'secretString',value:'replacement'},{name:'OLD',remove:true}]};
    await saveVariableDraft(key,draft,storage);
    assert.deepEqual(await loadVariableDraft(key,storage),draft);
    for(const other of [variableDraftKey(snapshotKey(config),'2'),variableDraftKey(snapshotKey({...config,profileId:'two'}),'1'),variableDraftKey(snapshotKey({...config,orgId:'other'}),'1')])assert.equal(await loadVariableDraft(other,storage),undefined);
    assert.ok(key.startsWith('profile:one:'));
    await saveVariableDraft(key,undefined,storage);
    assert.equal(await loadVariableDraft(key,storage),undefined);
});

test('storage errors propagate instead of reporting retained drafts',async()=>{
    await assert.rejects(saveVariableDraft('key',{edits:[]},{set:async()=>{throw new Error('quota');}}),/quota/);
});
