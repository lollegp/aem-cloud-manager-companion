import {request, settings, pathFor} from './api.js';

const $ = id => document.getElementById(id);
let working = false;
const feedback = (msg, good = false) => {
    $('feedback').textContent = msg;
    $('feedback').className = good ? 'success' : 'error';
};

function values() {
    return Object.fromEntries(['clientId', 'orgId', 'programId', 'oauthScopes'].map(key => [key, $(key).value.trim()]));
}

function validate(config) {
    if (!config.clientId || !config.orgId || !config.programId) throw new Error('Enter Client ID, Organization ID, and Program ID.');
}

async function showToken() {
    const s = await settings();
    $('token').value = s.token || '';
    $('tokenStatus').textContent = !s.token ? 'No token saved.' : s.tokenExpiresAt
        ? `${Date.now() >= s.tokenExpiresAt - 30000 ? 'Expired' : 'Expires'}: ${new Date(s.tokenExpiresAt).toLocaleString()}.`
        : 'Manual token saved. Expiry is managed by Adobe.';
}

async function perform(action) {
    if (working) return;
    working = true;
    const controls = [...document.querySelectorAll('button, input:not([readonly])')];
    controls.forEach(control => { control.disabled = true; });
    try { await action(); } catch (e) { feedback(e.message || 'Operation failed.'); }
    finally {
        controls.forEach(control => { control.disabled = false; });
        working = false;
    }
}

async function credential(action, extra = {}) {
    const result = await chrome.runtime.sendMessage({type: 'credentials', action, ...extra});
    if (!result?.ok) throw new Error(result?.error || 'Credential service unavailable. Reload the extension and try again.');
    return result.data;
}

async function showVault() {
    const state = await credential('status');
    $('vaultStatus').textContent = state.saved
        ? `Secret saved. Automatic token renewal is available after restart. Client: ${state.clientId}; organization: ${state.orgId}.`
        : state.passwordProtected ? 'Previous password-protected record retained. Re-enter your Adobe Client Secret and save it to enable passwordless renewal.'
        : 'No secret saved. Automatic renewal requires a saved secret.';
    $('migrationNotice').hidden = !state.migrationPending;
}

function clearSensitiveInputs() { $('clientSecret').value = ''; }

perform(async () => {
    // Initialize migration before reading connection state.
    await showVault();
    const s = await settings();
    for (const key of ['clientId', 'orgId', 'programId', 'oauthScopes']) $(key).value = s[key] || '';
    await showToken();
});

for (const key of ['clientId', 'orgId']) $(key).addEventListener('input', clearSensitiveInputs);

$('saveVault').addEventListener('click', () => perform(async () => {
    try {
        await credential('saveVault', {config: values(), secret: $('clientSecret').value,
            consent: $('rememberSecret').checked});
        $('rememberSecret').checked = false;
        await showVault();
        feedback('Secret saved. Tokens will renew automatically when needed, including after restart.', true);
    } finally { clearSensitiveInputs(); }
}));

$('forgetSecret').addEventListener('click', () => perform(async () => {
    if (!confirm('Delete the saved secret and clear the access token? Automatic renewal will stop until you save credentials again.')) return;
    await credential('forget');
    clearSensitiveInputs();
    $('rememberSecret').checked = false;
    await showVault();
    await showToken();
    feedback('Saved secret and access token removed. Automatic renewal is disabled.', true);
}));

$('generate').addEventListener('click', () => perform(async () => {
    try {
        validate(values());
        feedback('Generating an access token with Adobe...');
        await credential('generate', {config: values(), secret: $('clientSecret').value});
        await showToken();
        feedback('Access token generated. Use Test connection to verify Cloud Manager access.', true);
    } finally { clearSensitiveInputs(); }
}));

// Refresh other open Settings tabs after credential changes.
chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'local' && changes.credentialVault) || (area === 'session' && (changes.unlockedCredential || changes.legacyCredential))) clearSensitiveInputs();
    if (area === 'session' && changes.token) {
        showToken().catch(() => feedback('Could not refresh token status. Reload Settings.'));
    }
    if ((area === 'local' && changes.credentialVault) || (area === 'session' && (changes.unlockedCredential || changes.legacyCredential))) {
        showVault().catch(() => feedback('Could not refresh credential status. Reload Settings.'));
    }
});

$('save').addEventListener('click', () => perform(async () => {
    const config = values(), token = $('token').value.trim();
    validate(config);
    if (!token) throw new Error('Paste an access token, or use Generate access token.');
    await credential('saveManual', {config, token});
    await showToken();
    feedback('Connection saved for this browser session.', true);
}));

$('clear').addEventListener('click', () => perform(async () => {
    await credential('clearToken');
    await showToken();
    feedback('Token cleared. A saved secret will generate a new token on the next API request.', true);
}));

$('test').addEventListener('click', () => perform(async () => {
    const config = values(), saved = await settings();
    validate(config);
    if (['clientId', 'orgId', 'programId'].some(key => config[key] !== saved[key])) throw new Error('Save the connection or generate a token before testing changed settings.');
    feedback('Testing Cloud Manager access...');
    try { await request(pathFor(saved.programId, '/environments')); }
    catch (e) { throw new Error(`Cloud Manager connection failed: ${e.message} Check the client scopes and your program permissions.`); }
    feedback('Connection succeeded: Cloud Manager access verified.', true);
}));
