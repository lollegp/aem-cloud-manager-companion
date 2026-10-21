import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {embedded, link, safeAPIPath} from '../api.js';

// Exercise the popup's actual loader without requiring a DOM or real credentials.
const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
const loader = source.slice(source.indexOf('async function listAll('), source.indexOf('async function loadEnvironments('));
function fixture(responses) {
    const paths = [];
    const context = {embedded, link, safeAPIPath, URL, setMessage() {}, request: async path => {
        paths.push(path);
        if (paths.length > responses.length) throw new Error('Unexpected extra page request');
        return responses[paths.length - 1];
    }};
    const list = vm.runInNewContext(`(${loader.trim()})`, context);
    return {paths, run: () => list('/api/program/1/pipelines', 'pipelines')};
}
const page = (ids, next, total) => ({_embedded: {pipelines: ids.map(id => ({id}))},
    _links: next ? {next: {href: next}} : {}, ...(total === undefined ? {} : {_totalNumberOfItems: total})});
const next = n => `/api/program/1/pipelines?start=${n}`;

test('stops at the reported total even when next remains present', async () => {
    const f = fixture([page(['1','2'], next(2), 2)]);
    assert.equal((await f.run()).length, 2);
    assert.equal(f.paths.length, 1);
});
test('empty page terminates despite an advancing next link', async () => {
    const f = fixture([page(['1'], next(1)), page([], next(2))]);
    assert.equal((await f.run()).length, 1);
    assert.equal(f.paths.length, 2);
});
test('zero total and empty first page terminate', async () => {
    const f = fixture([page([], next(1), 0)]);
    assert.equal((await f.run()).length, 0);
});
test('deduplicates overlapping pages without skipping new pipelines', async () => {
    const f = fixture([page(['1','2'], next(2), 3), page(['2','3'], next(4), 3)]);
    assert.deepEqual(Array.from(await f.run(), p => p.id), ['1','2','3']);
});
test('repeated records with advancing URLs fail promptly instead of looping', async () => {
    const f = fixture([page(['1'], next(1), 3), page(['1'], next(2), 3)]);
    await assert.rejects(f.run(), /pagination.*no new/i);
    assert.equal(f.paths.length, 2);
});
test('legitimate multiple pages without totals remain supported', async () => {
    const f = fixture([page(['1'], next(1)), page(['2'], next(2)), page(['3'])]);
    assert.deepEqual(Array.from(await f.run(), p => p.id), ['1','2','3']);
});
test('untrusted pagination links remain rejected', async () => {
    const f = fixture([page(['1'], 'https://example.com/api/pipelines')]);
    await assert.rejects(f.run(), /Untrusted API link/);
});
