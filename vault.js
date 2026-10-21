// This bundled key is PUBLIC. Fixed-key encryption is obfuscation, not a secure
// vault: anyone with the extension and saved data can recover the Adobe secret.
// Keep this key stable for version 2 records, including copies across profiles.
const FIXED_KEY_HEX = '3726a14fca8e933cd412ab07e9d0f55c6c7ed624831fb17ad9b408ea62f3c105';
const encoder = new TextEncoder();
const encode = bytes => btoa(String.fromCharCode(...bytes));
const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
const metadata = record => encoder.encode(JSON.stringify([record.version, record.id, record.clientId, record.orgId]));
const key = () => crypto.subtle.importKey('raw', Uint8Array.from(FIXED_KEY_HEX.match(/../g), byte => parseInt(byte, 16)), 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function encryptSecret(secret, {clientId, orgId} = {}) {
    if (typeof secret !== 'string' || !secret.trim() || secret.length > 16384) throw new Error('Enter a valid Client Secret.');
    if (!clientId || !orgId) throw new Error('Enter Client ID and Organization ID.');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const record = {version: 2, id: crypto.randomUUID(), clientId, orgId, iv: encode(iv)};
    const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: metadata(record), tagLength: 128}, await key(), encoder.encode(secret));
    return {...record, ciphertext: encode(new Uint8Array(ciphertext))};
}

export async function decryptSecret(record) {
    if (record?.version === 1) throw new Error('This record is password-protected. Re-enter your Adobe Client Secret in Settings and save it again.');
    try {
        if (record?.version !== 2 || typeof record.id !== 'string' ||
            typeof record.clientId !== 'string' || typeof record.orgId !== 'string' ||
            typeof record.ciphertext !== 'string' || record.ciphertext.length > 24000) throw new Error();
        const iv = decode(record.iv);
        if (iv.length !== 12) throw new Error();
        const clear = await crypto.subtle.decrypt({name: 'AES-GCM', iv, additionalData: metadata(record), tagLength: 128}, await key(), decode(record.ciphertext));
        return new TextDecoder('utf-8', {fatal: true}).decode(clear);
    } catch {
        throw new Error('Saved credential is damaged or unsupported. Re-enter your Adobe Client Secret in Settings.');
    }
}
