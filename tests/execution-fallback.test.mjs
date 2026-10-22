import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {embedded, pathFor} from '../api.js';
const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
const start = source.indexOf('async function displayedExecution(');
const end = source.indexOf('function targetLabels(', start);
function fixture(current, history) {
    const calls = [];
    assert.ok(start >= 0, 'display fallback helper exists');
    const fn = vm.runInNewContext(`(${source.slice(start, end).trim()})`, {
        currentExecution: current, pathFor, embedded,
        request: async (...args) => { calls.push(args); return typeof history === 'function' ? history() : history; }
    });
    return {calls, run: (previous, pipeline = {}, production = false) => fn('1', {id:'2',...pipeline}, new AbortController().signal, previous, production)};
}
test('missing current execution refreshes the cached summary from latest execution', async () => {
    const f = fixture(async () => { throw new Error('404 Pipeline Execution not found'); }, {_embedded: {executions: [{id: 'last', status: 'FINISHED'}]}, _links: {next: {href: '/api/ignored'}}});
    const result = await f.run({execution:{id:'last',status:'FINISHED'}});
    assert.equal(result.historical, true);
    assert.equal(result.execution.id, 'last');
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][0],'/api/program/1/pipeline/2/executions?start=0&limit=1');
});
test('current execution remains current and errors other than 404 do not fetch history', async () => {
    const f = fixture(async () => ({id: 'current'}));
    assert.equal((await f.run()).historical, false);
    assert.equal(f.calls.length, 0);
    const failure = fixture(async () => { throw new Error('403 Forbidden'); });
    await assert.rejects(failure.run(), /403/);
    assert.equal(failure.calls.length, 0);
});
test('empty history has no execution and historical waiting data stays marked historical', async () => {
    const empty = fixture(async () => { throw new Error('404 missing'); }, {_embedded: {executions: []}});
    assert.equal((await empty.run()).execution, null);
    const waiting = fixture(async () => { throw new Error('404 missing'); }, {_embedded: {executions: [{id: 'old', status: 'WAITING'}]}});
    assert.equal((await waiting.run()).historical, true);
});

test('a completed pipeline refreshes its previously running execution by ID after current execution disappears', async () => {
    const f = fixture(async () => { throw new Error('404 Pipeline Execution not found'); }, {id:'last',status:'FINISHED',finishedAt:'2026-10-22T11:00:00Z'});
    const result = await f.run({execution:{id:'last',status:'RUNNING'}});
    assert.equal(result.execution.status,'FINISHED');
    assert.equal(result.historical,true);
    assert.equal(f.calls.length,2);
    assert.equal(f.calls[0][0],'/api/program/1/pipeline/2/execution/last');
    assert.equal(f.calls[1][0],'/api/program/1/pipeline/2/executions?start=0&limit=1');
});


test('idle pipeline rechecks an active current execution to resolve its final status', async () => {
    const f = fixture(async () => ({id:'last',status:'RUNNING'}), {id:'last',status:'FINISHED'});
    const result = await f.run(undefined,{status:'IDLE'});
    assert.equal(result.execution.status,'FINISHED');
    assert.equal(f.calls.length,1);
});
test('failed final-status lookup marks the cached status stale without fetching history', async () => {
    const f = fixture(async () => { throw new Error('404 missing current'); }, async () => { throw new Error('404 missing run'); });
    const result = await f.run({execution:{id:'last',status:'RUNNING'}},{status:'IDLE'});
    assert.equal(result.execution.status,'RUNNING');
    assert.equal(result.stale,true);
    assert.equal(result.historical,true);
    assert.match(result.error,/could not be refreshed/);
    assert.equal(f.calls.length,1);
    assert.equal(f.calls[0][0],'/api/program/1/pipeline/2/execution/last');
});

for (const previous of [undefined, {execution:{id:'old',status:'FINISHED'}}]) {
    test(`production discovers latest execution without opening history (${previous ? 'cached terminal' : 'no cached run'})`, async () => {
        const f = fixture(async () => { throw new Error('404 missing'); }, {_embedded:{executions:[{id:'new',status:'FAILED'}]},_links:{next:{href:'/ignored'}}});
        const result = await f.run(previous,{status:'IDLE'},true);
        assert.equal(result.execution.id,'new');
        assert.equal(result.execution.status,'FAILED');
        assert.equal(result.historical,true);
        assert.equal(f.calls.length,1);
        assert.equal(f.calls[0][0],'/api/program/1/pipeline/2/executions?start=0&limit=1');
    });
}
test('production latest lookup failure preserves stale summary', async () => {
    const f = fixture(async () => null, async () => { throw new Error('503 unavailable'); });
    const result = await f.run({execution:{id:'old',status:'FINISHED'}},{},true);
    assert.equal(result.stale,true);
    assert.equal(result.execution.id,'old');
    assert.match(result.error,/503/);
});
test('production latest lookup accepts an empty execution list', async () => {
    const f = fixture(async () => null,{_embedded:{executions:[]}});
    assert.equal((await f.run(undefined,{},true)).execution,null);
    assert.equal(f.calls.length,1);
});
test('nonproduction expansion also discovers latest execution without opening history', async () => {
    const f = fixture(async () => { throw new Error('404 Pipeline Execution not found'); }, {_embedded:{executions:[{id:'last-dev',status:'FINISHED'}]}});
    const result = await f.run(undefined,{},false);
    assert.equal(result.execution.id,'last-dev');
    assert.equal(result.historical,true);
    assert.equal(f.calls[0][0],'/api/program/1/pipeline/2/executions?start=0&limit=1');
});
