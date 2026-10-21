import test from 'node:test';
import assert from 'node:assert/strict';
import * as pipeline from '../pipeline.js';

const rel = 'http://ns.adobe.com/adobecloud/rel/pipeline/';
const step = {action: 'approval', status: 'WAITING', _links: {
    [rel + 'advance']: {href: '/api/program/1/pipeline/2/execution/3/phase/4/step/5/advance'},
    [rel + 'cancel']: {href: '/api/program/1/pipeline/2/execution/3/phase/4/step/5/cancel'}
}};
test('approval decisions require a waiting approval and an advertised trusted action', () => {
    assert.equal(typeof pipeline.approvalAction, 'function');
    assert.deepEqual(pipeline.approvalAction(step, true).body, {approved: true});
    assert.deepEqual(pipeline.approvalAction(step, false).body, {approved: false});
    assert.equal(pipeline.approvalAction({...step, status: 'RUNNING'}, true), null);
    assert.equal(pipeline.approvalAction({...step, action: 'codeQuality'}, true), null);
    assert.equal(pipeline.approvalAction({...step, _links: {}}, true), null);
    assert.throws(() => pipeline.approvalAction({...step, _links: {[rel + 'advance']: {href: 'https://untrusted.test/api/x'}}}, true), /Untrusted/);
});
test('history pager requests one page per call, deduplicates, and stops at total', async () => {
    const {createHistoryPager} = await import('../history.js');
    let calls = 0;
    const pager = createHistoryPager('/api/program/1/pipeline/2/executions?start=0&limit=20', async () => {
        calls++;
        return {_totalNumberOfItems: 3, _embedded: {executions: calls === 1 ? [{id: '1'}, {id: '2'}] : [{id:'2'},{id:'3'}]}, _links: {next: {href: `/api/program/1/pipeline/2/executions?start=${calls * 2}&limit=20`}}};
    });
    assert.equal(calls, 0);
    assert.equal((await pager.load()).length, 2);
    assert.equal(calls, 1);
    assert.equal((await pager.load()).length, 1);
    assert.equal(pager.done, true);
    await pager.load();
    assert.equal(calls, 2);
});
test('history pager blocks concurrent loads and retries a failed page', async () => {
    const {createHistoryPager} = await import('../history.js');
    let calls = 0, finish;
    const pager = createHistoryPager('/api/program/1/pipeline/2/executions', async () => {
        calls++;
        if (calls === 1) return new Promise((resolve, reject) => { finish = () => reject(new Error('offline')); });
        return {_embedded: {executions: []}, _links: {next: {href: '/api/program/1/pipeline/2/executions?start=20'}}};
    });
    const first = pager.load();
    assert.deepEqual(await pager.load(), []);
    finish(); await assert.rejects(first, /offline/);
    assert.equal(pager.done, false);
    await pager.load();
    assert.equal(pager.done, true);
    assert.equal(calls, 2);
});
