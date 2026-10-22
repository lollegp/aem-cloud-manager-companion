import test from 'node:test';
import assert from 'node:assert/strict';
import * as auth from '../auth.js';

test('generates a token using form-encoded credentials only in the POST body', async () => {
    assert.equal(typeof auth.generateAccessToken, 'function');
    const result = await auth.generateAccessToken(' client ', 'secret+&=value', 'scopeA scopeB,scopeA', {
        now: () => 1000,
        fetcher: async (url, options) => {
            assert.equal(url, 'https://ims-na1.adobelogin.com/ims/token/v3');
            assert.equal(options.method, 'POST');
            assert.equal(options.redirect, 'error');
            assert.equal(options.credentials, 'omit');
            assert.equal(options.cache, 'no-store');
            assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
            const body = new URLSearchParams(options.body);
            assert.deepEqual(Object.fromEntries(body), {grant_type: 'client_credentials', client_id: 'client', client_secret: 'secret+&=value', scope: 'scopeA,scopeB'});
            return {ok: true, json: async () => ({access_token: 'token', token_type: 'bearer', expires_in: 3600})};
        }
    });
    assert.deepEqual(result, {token: 'token', tokenClientId: 'client', tokenExpiresAt: 3601000});
});

test('missing credentials or scopes fail before any network request', async () => {
    assert.equal(typeof auth.generateAccessToken, 'function');
    let requests = 0;
    for (const values of [['', 'secret', 'scope'], ['client', ' ', 'scope'], ['client', 'secret', ', ,']]) {
        await assert.rejects(auth.generateAccessToken(...values, {fetcher: async () => { requests++; }}), /Enter/);
    }
    assert.equal(requests, 0);
});

test('Adobe failures provide useful messages without echoing secrets', async () => {
    assert.equal(typeof auth.generateAccessToken, 'function');
    for (const [code, expected] of [['invalid_client', /Client ID and Client Secret/], ['invalid_scope', /scopes/], ['unknown', /HTTP 400/]]) {
        await assert.rejects(auth.generateAccessToken('client', 'private-secret', 'scope', {
            fetcher: async () => ({ok: false, status: 400, json: async () => ({error: code, error_description: 'private-secret'})})
        }), error => expected.test(error.message) && !error.message.includes('private-secret'));
    }
});

test('network errors never expose credential-bearing exception text', async () => {
    assert.equal(typeof auth.generateAccessToken, 'function');
    await assert.rejects(auth.generateAccessToken('client', 'private-secret', 'scope', {
        fetcher: async () => { throw new Error('private-secret'); }
    }), error => /reach Adobe/.test(error.message) && !error.message.includes('private-secret'));
});

test('malformed token replies are rejected', async () => {
    assert.equal(typeof auth.generateAccessToken, 'function');
    for (const data of [null, {access_token: 'x', token_type: 'bearer'}, {access_token: '', token_type: 'bearer', expires_in: 100}, {access_token: 'x', token_type: 'other', expires_in: 100}, {access_token: 'x', token_type: 'bearer', expires_in: 1e308}]) {
        await assert.rejects(auth.generateAccessToken('client', 'secret', 'scope', {fetcher: async () => ({ok: true, json: async () => data})}), /invalid token/);
    }
});
test('API reports failed renewal and blocks mismatched tokens before fetch; manual tokens remain supported', async () => {
    const {request} = await import('../api.js');
    const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
    let session = {token: 'old', tokenExpiresAt: Date.now() - 1000}, calls = 0;
    globalThis.chrome = {storage: {local: {get: async () => ({clientId: 'client', orgId: 'org'})}, session: {get: async () => session}}, runtime: {sendMessage: async () => ({ok: false, error: 'Token expired; save a secret to renew.'})}};
    globalThis.fetch = async () => { calls++; return {ok: true, text: async () => '{}'}; };
    try {
        await assert.rejects(request('/api/program/1/environments'), /expired/);
        session = {token: 'old', tokenClientId: 'other'};
        await assert.rejects(request('/api/program/1/environments'), /Client ID changed/);
        assert.equal(calls, 0);
        session = {token: 'manual'};
        await request('/api/program/1/environments');
        assert.equal(calls, 1);
    } finally { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; }
});

test('Cloud Manager requests reject redirects and avoid cookies and response caching', async () => {
    const {request} = await import('../api.js');
    const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
    globalThis.chrome = {storage: {local: {get: async () => ({clientId: 'client', orgId: 'org'})}, session: {get: async () => ({token: 'token'})}}};
    globalThis.fetch = async (url, options) => {
        assert.equal(options.redirect, 'error');
        assert.equal(options.credentials, 'omit');
        assert.equal(options.cache, 'no-store');
        return {ok: true, text: async () => '{}'};
    };
    try { await request('/api/program/1/environments'); }
    finally { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; }
});

test('API rejects a token bound to another organization before making any network request', async () => {
    const {request} = await import('../api.js');
    const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.chrome = {storage: {local: {get: async () => ({clientId: 'client', orgId: 'other-org'})}, session: {get: async () => ({token: 'token', tokenClientId: 'client', tokenOrgId: 'org'})}}};
    globalThis.fetch = async () => { calls++; return {ok: true, text: async () => '{}'}; };
    try { await assert.rejects(request('/api/program/1/environments'), /Organization ID changed/); assert.equal(calls, 0); }
    finally { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; }
});

test('API obtains missing or expired tokens automatically before sending requests', async () => {
    const {request} = await import('../api.js');
    const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
    const config = {clientId: 'client', orgId: 'org', programId: '1', oauthScopes: 'scope'};
    let session = {}, renewals = 0, requests = 0;
    globalThis.chrome = {storage: {local: {get: async () => config}, session: {get: async () => session}}, runtime: {sendMessage: async msg => {
        assert.equal(msg.action, 'ensureToken'); assert.equal(msg.config.programId, '1'); renewals++;
        return {ok: true, data: {token: 'renewed', tokenClientId: 'client', tokenOrgId: 'org', tokenExpiresAt: Date.now() + 100000}};
    }}};
    globalThis.fetch = async (url, options) => { requests++; assert.equal(options.headers.Authorization, 'Bearer renewed'); return {ok: true, text: async () => '{}'}; };
    try {
        await request('/api/program/1/environments');
        session = {token: 'expired', tokenExpiresAt: 1};
        await request('/api/program/1/environments');
        assert.equal(renewals, 2); assert.equal(requests, 2);
        await assert.rejects(request('https://untrusted.test/api/'), /Unexpected/);
        assert.equal(renewals, 2);
    } finally { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; }
});

test('API retries a rejected read once with a new token, but never replays a mutation', async () => {
    const {request} = await import('../api.js');
    const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
    let requests = 0, renewals = 0;
    globalThis.chrome = {storage: {local: {get: async () => ({clientId: 'client', orgId: 'org'})}, session: {get: async () => ({token: 'rejected'})}}, runtime: {sendMessage: async msg => {
        assert.equal(msg.rejectedToken, 'rejected'); renewals++;
        return {ok: true, data: {token: 'fresh'}};
    }}};
    globalThis.fetch = async () => { requests++; return {status: 401, ok: false, text: async () => '{"message":"Unauthorized"}'}; };
    try {
        await assert.rejects(request('/api/program/1/environments'), /401/);
        assert.equal(requests, 2); assert.equal(renewals, 1);
        requests = 0; renewals = 0;
        await assert.rejects(request('/api/program/1/pipeline/1/execution', 'PUT'), /retry/i);
        assert.equal(requests, 1); assert.equal(renewals, 1);
        globalThis.fetch = async () => { requests++; return {status: 403, ok: false, text: async () => '{}'}; };
        await assert.rejects(request('/api/program/1/environments'), /403/);
        assert.equal(renewals, 1);
    } finally { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; }
});

test('request timeout covers headers and response body without replaying mutations', async () => {
    const {request} = await import('../api.js');
    const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
    globalThis.chrome = {storage: {local: {get: async () => ({clientId: 'client', orgId: 'org'})}, session: {get: async () => ({token: 'token'})}}};
    try {
        for (const stage of ['headers', 'body']) {
            let calls = 0;
            globalThis.fetch = async (url, options) => {
                calls++;
                assert.ok(options.signal instanceof AbortSignal);
                const timeout = () => { throw new DOMException('Timed out', 'TimeoutError'); };
                if (stage === 'headers') timeout();
                return {ok: true, status: 200, text: async () => timeout()};
            };
            await assert.rejects(request('/api/program/1/pipeline/1/execution', 'PUT'), /timed out.*check its state/);
            assert.equal(calls, 1);
        }
    } finally { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; }
});

test('caller cancellation signal does not disable the token renewal deadline', async () => {
    const {request} = await import('../api.js');
    const originalChrome = globalThis.chrome, originalTimeout = AbortSignal.timeout;
    globalThis.chrome = {storage: {local: {get: async () => ({clientId: 'client', orgId: 'org'})}, session: {get: async () => ({})}}, runtime: {sendMessage: () => new Promise(() => {})}};
    AbortSignal.timeout = ms => ms === 35000 ? AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')) : originalTimeout(ms);
    try {
        await assert.rejects(request('/api/program/1/pipelines', 'GET', undefined, {signal: new AbortController().signal}), /timed out/);
    } finally { globalThis.chrome = originalChrome; AbortSignal.timeout = originalTimeout; }
});

test('mutation with an expected configuration rejects identity changes before fetch', async () => {
    const {request} = await import('../api.js');
    const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
    const expected = {clientId:'client',orgId:'org',programId:'1',oauthScopes:'scope'};
    let reads = 0, writes = 0;
    globalThis.chrome = {storage:{local:{get:async () => (++reads === 1 ? expected : {...expected,programId:'other'})},session:{get:async () => ({token:'token'})}}};
    globalThis.fetch = async () => { writes++; return {ok:true,text:async ()=>'{}'}; };
    try {
        await assert.rejects(request('/api/program/1/pipeline/2/execution','PUT',undefined,{expectedConfig:expected}), /Connection settings changed/);
        assert.equal(writes,0);
    } finally { globalThis.chrome=originalChrome; globalThis.fetch=originalFetch; }
});
