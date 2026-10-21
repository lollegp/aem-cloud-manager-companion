import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../credentials.js').catch(() => ({}));
const config = {clientId: 'client', orgId: 'org', programId: '1', oauthScopes: 'scope'};
function fixture(initial = {}) {
    const local = structuredClone(initial), session = {}, access = [], writes = [];
    let failLocal = false;
    const area = (data, name) => ({
        get: async keys => structuredClone(Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]]))),
        set: async values => {
            if (name === 'local' && failLocal) throw Error('storage unavailable');
            writes.push({name, values: structuredClone(values)});
            Object.assign(data, structuredClone(values));
        },
        remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
        setAccessLevel: async value => access.push({name, ...value})
    });
    const storage = {local: area(local, 'local'), session: area(session, 'session')};
    return {local, session, storage, access, writes, fail: () => { failLocal = true; }};
}
function controller(f, generate = async (clientId, secret) => {
    assert.equal(secret, 'private-secret');
    return {token: 'token', tokenClientId: clientId, tokenExpiresAt: Date.now() + 3600000};
}) {
    assert.equal(typeof module.createCredentialController, 'function');
    return module.createCredentialController(f.storage, generate);
}
const save = {action: 'saveVault', config, secret: 'private-secret', consent: true};

test('saving requires consent and keeps no plaintext credential in persistent storage', async () => {
    const f = fixture(), run = controller(f);
    await assert.rejects(run({...save, consent: false}), /consent/);
    await run(save);
    assert.equal(f.local.credentialVault.version, 2);
    assert.ok(!JSON.stringify(f.local).includes('private-secret'));
    assert.ok(!JSON.stringify(f.session).includes('private-secret'));
    assert.ok(f.access.every(a => a.accessLevel === 'TRUSTED_CONTEXTS'));
});

test('a saved credential renews automatically after restart and concurrent callers share a token', async () => {
    const f = fixture(); let calls = 0;
    const generate = async clientId => ({token: `token-${++calls}`, tokenClientId: clientId, tokenExpiresAt: Date.now() + 3600000});
    await controller(f, generate)(save);
    const afterRestart = controller(f, generate);
    const results = await Promise.all(Array.from({length: 5}, () => afterRestart({action: 'ensureToken', config})));
    assert.equal(calls, 1);
    assert.ok(results.every(r => r.token === 'token-1'));
    f.session.tokenExpiresAt = Date.now() + 10000;
    await afterRestart({action: 'ensureToken', config});
    assert.equal(calls, 2);
    assert.ok(!JSON.stringify(f.session).includes('private-secret'));
});

test('401 renewals reuse another callers fresh token and failures are briefly throttled', async () => {
    const f = fixture(); let calls = 0;
    const run = controller(f, async clientId => ({token: `token-${++calls}`, tokenClientId: clientId, tokenExpiresAt: Date.now() + 3600000}));
    await run(save); await run({action: 'ensureToken', config});
    await Promise.all([1, 2, 3].map(() => run({action: 'ensureToken', config, rejectedToken: 'token-1'})));
    assert.equal(calls, 2);
    const fail = controller(f, async () => { calls++; throw Error('Adobe rejected credentials'); });
    f.session.tokenExpiresAt = 1;
    const results = await Promise.allSettled([1, 2, 3].map(() => fail({action: 'ensureToken', config})));
    assert.ok(results.every(r => r.status === 'rejected'));
    assert.equal(calls, 3);
    assert.equal(f.session.token, 'token-2');
});

test('wrong or changed identity fails before token generation', async () => {
    const f = fixture(), run = controller(f);
    await run(save);
    await assert.rejects(run({action: 'ensureToken', config: {...config, orgId: 'other'}}), /changed/);
    await assert.rejects(run({action: 'generate', config: {...config, clientId: 'other'}}), /matching|Enter/);
    await run({action: 'saveManual', config, token: 'manual'});
    assert.equal(f.session.tokenClientId, config.clientId);
    assert.equal(f.session.tokenOrgId, config.orgId);
    await assert.rejects(run({action: 'saveManual', config: {...config, orgId: 'other'}, token: 'manual'}), /Organization ID changed/);
    await run({...save, config: {...config, clientId: 'other'}});
    assert.ok(!f.session.token);
});

test('legacy plaintext moves to temporary memory, then migrates only after consent', async () => {
    const f = fixture({rememberedSecret: {...config, secret: 'private-secret'}}), run = controller(f);
    assert.equal((await run({action: 'status'})).migrationPending, true);
    assert.ok(!f.local.rememberedSecret);
    await run({...save, secret: ''});
    assert.equal(f.local.credentialVault.version, 2);
    assert.ok(!f.session.legacyCredential);
});

test('locked password records are preserved until explicit replacement', async () => {
    const old = {version: 1, id: 'old', ...config, ciphertext: 'old-encrypted-record'};
    const f = fixture({...config, credentialVault: old}), run = controller(f);
    assert.equal((await run({action: 'status'})).passwordProtected, true);
    await assert.rejects(run({action: 'ensureToken', config}), /re-enter/i);
    assert.deepEqual(f.local.credentialVault, old);
    await run(save);
    assert.equal(f.local.credentialVault.version, 2);
});

test('previously unlocked password record can migrate with consent but never silently', async () => {
    const f = fixture({...config, credentialVault: {version: 1, id: 'old', ...config}}), run = controller(f);
    f.session.unlockedCredential = {id: 'old', ...config, secret: 'private-secret'};
    await run({action: 'status'});
    assert.equal(f.local.credentialVault.version, 1);
    await run({...save, secret: ''});
    assert.equal(f.local.credentialVault.version, 2);
    assert.ok(!f.session.unlockedCredential);
});

test('failed save preserves previous record and temporary secret', async () => {
    const old = {version: 1, id: 'old', ...config};
    const f = fixture({...config, credentialVault: old}), run = controller(f);
    f.session.unlockedCredential = {...config, id: 'old', secret: 'private-secret'};
    f.fail();
    await assert.rejects(run({...save, secret: ''}), /storage unavailable/);
    assert.deepEqual(f.local.credentialVault, old);
    assert.equal(f.session.unlockedCredential.secret, 'private-secret');
});

test('forget queues after active generation and prevents any later automatic renewal', async () => {
    const f = fixture(); let started, release;
    const begin = new Promise(resolve => { started = resolve; });
    const run = controller(f, async () => { started(); await new Promise(resolve => { release = resolve; }); return {token: 'token'}; });
    await run(save);
    const pending = run({action: 'ensureToken', config}); await begin;
    const forgetting = run({action: 'forget'}); release(); await pending; await forgetting;
    assert.deepEqual(f.session, {});
    assert.ok(!f.local.credentialVault);
    await assert.rejects(run({action: 'ensureToken', config}), /save|secret/i);
});

test('clear token retains automatic renewal; one-time secret and manual token never persist', async () => {
    const f = fixture(), run = controller(f);
    await run({action: 'generate', config, secret: 'private-secret'});
    assert.ok(!JSON.stringify(f.local).includes('private-secret'));
    const expiry = f.session.tokenExpiresAt;
    await run({action: 'saveManual', config, token: 'token'});
    assert.equal(f.session.tokenExpiresAt, expiry);
    await run({action: 'saveManual', config, token: 'manual'});
    assert.ok(!f.session.tokenExpiresAt);
    await run({action: 'clearToken'});
    await assert.rejects(run({action: 'ensureToken', config}), /save|secret/i);
    await run(save); await run({action: 'clearToken'});
    await run({action: 'ensureToken', config});
    assert.equal(f.session.token, 'token');
});

test('saving for renewal rejects empty scopes without replacing the existing credential', async () => {
    const f = fixture(), run = controller(f);
    await run(save);
    const old = structuredClone(f.local.credentialVault);
    for (const oauthScopes of ['', '  , ,  ']) {
        await assert.rejects(run({...save, config: {...config, oauthScopes}}), /scopes/i);
        assert.deepEqual(f.local.credentialVault, old);
    }
    await run({action: 'saveManual', config: {...config, oauthScopes: ''}, token: 'manual'});
    assert.equal(f.session.token, 'manual');
});
