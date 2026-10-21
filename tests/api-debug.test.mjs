import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from '../api.js';

test('optional API diagnostics pair requests and responses without logging secrets', async () => {
    const originals = {chrome: globalThis.chrome, fetch: globalThis.fetch, sessionStorage: globalThis.sessionStorage, info: console.info};
    const logs = [];
    let enabled = false;
    globalThis.sessionStorage = {getItem: () => enabled ? '1' : null};
    console.info = (...args) => logs.push(args);
    globalThis.chrome = {storage: {local: {get: async () => ({clientId: 'PRIVATE_CLIENT', orgId: 'PRIVATE_ORG'})}, session: {get: async () => ({token: 'PRIVATE_TOKEN'})}}};
    globalThis.fetch = async () => ({status: 200, ok: true, text: async () => JSON.stringify({
        _totalNumberOfItems: 2, _page: {start: 0, limit: 2, next: 2},
        _links: {next: {href: '/api/program/1/pipelines?start=2&token=PRIVATE_QUERY'}},
        _embedded: {pipelines: [{id: '10', secret: 'PRIVATE_SECRET', value: 'PRIVATE_VALUE'}]},
        message: 'PRIVATE_ERROR'
    })});
    try {
        await request('/api/program/1/pipelines');
        assert.equal(logs.length, 0);
        enabled = true;
        await request('/api/program/1/pipelines?start=0&token=PRIVATE_QUERY', 'PATCH', {value: 'PRIVATE_BODY'});
        assert.equal(logs.length, 2);
        const serialized = JSON.stringify(logs);
        assert.doesNotMatch(serialized, /PRIVATE_/);
        assert.match(serialized, /_totalNumberOfItems/);
        assert.match(serialized, /start=2/);
        assert.match(serialized, /"10"/);
        assert.equal(logs[0][1].requestId, logs[1][1].requestId);
        assert.equal(logs[1][1].status, 200);
    } finally {
        Object.assign(globalThis, {chrome: originals.chrome, fetch: originals.fetch, sessionStorage: originals.sessionStorage});
        console.info = originals.info;
    }
});
