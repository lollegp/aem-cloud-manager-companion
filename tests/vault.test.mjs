import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptSecret, decryptSecret} from '../vault.js';
const identity = {clientId: 'client', orgId: 'org'};

test('fixed-key records decrypt in a fresh module with no password; nonce changes per save', async () => {
    const first = await encryptSecret('private-secret', identity);
    const second = await encryptSecret('private-secret', identity);
    assert.equal(first.version, 2);
    const fresh = await import('../vault.js?copied-profile');
    assert.equal(await fresh.decryptSecret(structuredClone(first)), 'private-secret');
    assert.notEqual(first.iv, second.iv);
    assert.notEqual(first.ciphertext, second.ciphertext);
    assert.ok(!JSON.stringify(first).includes('private-secret'));
});

test('modified identity, ciphertext, nonce and unsupported versions fail closed', async () => {
    const record = await encryptSecret('private-secret', identity);
    for (const change of [{clientId: 'other'}, {orgId: 'other'}, {id: 'other'}, {ciphertext: record.ciphertext.slice(0, -4) + 'AAAA'}, {version: 1}, {iv: ''}]) {
        await assert.rejects(decryptSecret({...record, ...change}), /damaged|unsupported|password/i);
    }
});

test('rejects invalid secrets and incomplete identity', async () => {
    await assert.rejects(encryptSecret(' ', identity), /secret/i);
    await assert.rejects(encryptSecret('secret', {clientId: 'client'}), /Organization/);
});
