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
        request: async (...args) => { calls.push(args); return history; }
    });
    return {calls, run: () => fn('1', {id: '2'}, new AbortController().signal)};
}
test('missing current execution displays one latest history result without loading all pages', async () => {
    const f = fixture(async () => { throw new Error('404 Pipeline Execution not found'); }, {_embedded: {executions: [{id: 'last', status: 'FINISHED'}]}, _links: {next: {href: '/api/ignored'}}});
    const result = await f.run();
    assert.equal(result.historical, true);
    assert.equal(result.execution.id, 'last');
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0][0], /executions\?start=0&limit=1/);
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
