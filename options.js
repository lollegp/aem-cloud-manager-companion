import {profileCommand, fillProfileSelect, PROFILE_KEY, profileSessionKey} from './profiles.js';
import {request, settings, pathFor} from './api.js';

const $ = id => document.getElementById(id);
let working = false, currentProfileId = '', settingsDirty = false, profileReloadNeeded = false, profileReady = false;
const feedback = (msg, good = false) => {
    $('feedback').textContent = msg;
    let className = 'muted';
    if (good !== null) { className = good ? 'success' : 'error'; }
    $('feedback').className = className;
    $('feedback').setAttribute('role',good===false?'alert':'status');
};

function values() {
    return {profileId:currentProfileId,...Object.fromEntries(['clientId', 'orgId', 'programId', 'oauthScopes'].map(key => [key, $(key).value.trim()]))};
}

function validate(config) {
    const missing=['clientId','orgId','programId'].filter(key=>!config[key]);
    missing.forEach(key=>$(key).setAttribute('aria-invalid','true'));
    if(missing.length){throw new Error('Enter Client ID, Organization ID, and Program ID.');}
}

async function showToken() {
    const s = await settings();
    if((s.profileId || '')!==currentProfileId){return;}
    $('token').value = s.token || '';
    let status = 'No token saved.';
    if (s.token) {
        status = 'Manual token saved. Expiry is managed by Adobe.';
        if (s.tokenExpiresAt) {
            const label = Date.now() >= s.tokenExpiresAt - 30000 ? 'Expired' : 'Expires';
            status = `${label}: ${new Date(s.tokenExpiresAt).toLocaleString()}.`;
        }
    }
    $('tokenStatus').textContent = status;
}

async function perform(action) {
    if (working) {return;}
    working = true;
    document.querySelectorAll('[aria-invalid="true"]').forEach(input=>input.removeAttribute('aria-invalid'));
    const controls = [...document.querySelectorAll('button, input:not([readonly]), select:not(#themePreference)')];
    controls.forEach(control => { control.disabled = true; });
    try { await action(); } catch (e) { feedback(e.message || 'Operation failed.'); }
    finally {
        controls.forEach(control => { control.disabled = false; });
        working = false;
        syncProfileControls();
        document.querySelector('[aria-invalid="true"]')?.focus();
        if(profileReloadNeeded){profileReloadNeeded=false;void perform(loadProfile);}
    }
}

async function credential(action, extra = {}) {
    return profileCommand(action,{profileId:currentProfileId,...extra});
}

async function showVault() {
    const state = await credential('status');
    let status = 'No secret saved. Automatic renewal requires a saved secret.';
    if (state.saved) {
        status = `Secret saved. Automatic token renewal is available after restart. Client: ${state.clientId}; organization: ${state.orgId}.`;
    } else if (state.passwordProtected) {
        status = 'Previous password-protected record retained. Re-enter your Adobe Client Secret and save it to enable passwordless renewal.';
    }
    $('vaultStatus').textContent = status;
    $('migrationNotice').hidden = !state.migrationPending;
}

function clearSensitiveInputs() { $('clientSecret').value = ''; }

function syncProfileControls() {
    for(const id of ['connect','saveVault','forgetSecret','generate','save','clear','test','renameProfile','deleteProfile','profileName','clientId','orgId','programId','clientSecret','oauthScopes','token','rememberSecret']){$(id).disabled=working || !currentProfileId || !profileReady;}
}
async function loadProfile() {
    profileReady=false;
    for(const key of ['clientId','orgId','programId','oauthScopes','token','profileName']){$(key).value='';}
    clearSensitiveInputs();$('rememberSecret').checked=false;
    $('vaultStatus').textContent='Loading program connection…';$('tokenStatus').textContent='';
    const state=await profileCommand('listProfiles');
    fillProfileSelect($('programProfile'),state);
    currentProfileId=state.activeProfileId;
    clearSensitiveInputs();$('token').value='';$('rememberSecret').checked=false;
    const profile=state.profiles.find(item=>item.id===currentProfileId);
    $('profileName').value=profile?.name || '';
    const s=await settings();
    if((s.profileId || '')!==currentProfileId){throw new Error('Program changed while loading. Select the program again.');}
    for(const key of ['clientId','orgId','programId','oauthScopes']){$(key).value=s[key] || '';}
    if(currentProfileId){await showVault();await showToken();}
    else {$('vaultStatus').textContent='Add a program to configure its connection.';$('tokenStatus').textContent='No program selected.';$('migrationNotice').hidden=true;}
    settingsDirty=false;profileReady=true;
}
function allowProfileChange() {
    return !settingsDirty || confirm('Discard unsaved connection fields and switch program?');
}
$('programProfile').addEventListener('change',()=>{
    const id=$('programProfile').value;
    if(!allowProfileChange()){$('programProfile').value=currentProfileId;return;}
    void perform(async()=>{try{await profileCommand('selectProfile',{profileId:id});await loadProfile();feedback('Program selected.',true);}finally{$('programProfile').value=currentProfileId;}});
});
$('addProfile').addEventListener('click',()=>{
    if(!allowProfileChange()){return;}
    void perform(async()=>{await profileCommand('addProfile',{name:'New program'});await loadProfile();feedback('Enter credentials for this program, then Connect.',true);$('profileName').focus();});
});
$('renameProfile').addEventListener('click',()=>perform(async()=>{
    const state=await credential('renameProfile',{name:$('profileName').value});fillProfileSelect($('programProfile'),state);feedback('Program renamed.',true);
}));
$('deleteProfile').addEventListener('click',()=>perform(async()=>{
    if(!confirm('Delete this program profile, its saved credential, session token and local preferences? Adobe resources will not be changed.')){return;}
    await credential('deleteProfile');await loadProfile();feedback('Program profile deleted.',true);
}));
for(const input of document.querySelectorAll('.connection-fields input, #token, #rememberSecret')){input.addEventListener('input',()=>{settingsDirty=true;input.removeAttribute('aria-invalid');});}
await perform(loadProfile);

for (const key of ['clientId', 'orgId']) {$(key).addEventListener('input', clearSensitiveInputs);}

// Capture the entered secret before storage events clear sensitive inputs.
$('connect').addEventListener('click', () => perform(async () => {
    const config = values(), secret = $('clientSecret').value;
    let saved = false;
    try {
        validate(config);
        feedback('Connecting to Adobe...',null);
        if ($('rememberSecret').checked) {
            const existing = secret ? null : await credential('status');
            const reuse = existing?.saved && existing.clientId === config.clientId && existing.orgId === config.orgId;
            if (!reuse) {
                await credential('saveVault', {config, secret, consent: true});
                saved = true;
            }
            $('rememberSecret').checked = false;
            await showVault();
        }
        await credential('generate', {config, secret: saved ? '' : secret});
        await showToken();
        feedback('Verifying Cloud Manager access...',null);
        await request(pathFor(config.programId, '/environments'), 'GET', undefined, {expectedConfig: config});
        settingsDirty=false;
        feedback(`Connected to program ${config.programId}. Cloud Manager access verified.`, true);
    } catch (error) {
        throw new Error(`${saved ? 'Credential saved. ' : ''}Connection failed: ${error.message}`, {cause: error});
    } finally { clearSensitiveInputs(); }
}));

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
    if (!confirm('Delete the saved secret and clear the access token? Automatic renewal will stop until you save credentials again.')) {return;}
    await credential('forget');
    clearSensitiveInputs();
    $('rememberSecret').checked = false;
    await showVault();
    await showToken();
    settingsDirty=false;
    feedback('Saved secret and access token removed. Automatic renewal is disabled.', true);
}));

$('generate').addEventListener('click', () => perform(async () => {
    try {
        validate(values());
        feedback('Generating an access token with Adobe...',null);
        await credential('generate', {config: values(), secret: $('clientSecret').value});
        await showToken();
        feedback('Access token generated. Use Test connection to verify Cloud Manager access.', true);
    } finally { clearSensitiveInputs(); }
}));

// Refresh when another extension page changes the selected profile.
chrome.storage.onChanged.addListener((changes, area) => {
    if(area==='local' && changes[PROFILE_KEY]){
        const state=changes[PROFILE_KEY].newValue;
        const previous=changes[PROFILE_KEY].oldValue;
        const profile=state?.profiles.find(item=>item.id===state.activeProfileId);
        const before=previous?.profiles.find(item=>item.id===previous.activeProfileId);
        const changed=state?.activeProfileId!==currentProfileId || ['clientId','orgId','programId','oauthScopes'].some(key=>profile?.[key]!==before?.[key]);
        if(!changed){
            fillProfileSelect($('programProfile'),{profiles:state?.profiles || [],activeProfileId:state?.activeProfileId || ''});
            if(!working && currentProfileId){showVault().catch(()=>feedback('Could not refresh credential status. Reload Settings.'));}
            return;
        }
        if(working){if(state?.activeProfileId!==currentProfileId){profileReloadNeeded=true;}return;}
        clearSensitiveInputs();$('token').value='';
        void perform(async()=>{await loadProfile();feedback('Program connection changed in another extension page. Fields refreshed.',null);});
    }
    if(area==='session' && changes[profileSessionKey(currentProfileId)] && !working){showToken().catch(()=>feedback('Could not refresh token status. Reload Settings.'));}
});

$('save').addEventListener('click', () => perform(async () => {
    const config = values(), token = $('token').value.trim();
    validate(config);
    if (!token) {throw new Error('Paste an access token, or use Generate access token.');}
    await credential('saveManual', {config, token});
    await showToken();
    settingsDirty=false;
    feedback('Connection saved for this browser session.', true);
}));

$('clear').addEventListener('click', () => perform(async () => {
    await credential('clearToken');
    await showToken();
    settingsDirty=false;
    feedback('Token cleared. A saved secret will generate a new token on the next API request.', true);
}));

$('test').addEventListener('click', () => perform(async () => {
    const config = values(), saved = await settings();
    validate(config);
    if (['profileId', 'clientId', 'orgId', 'programId'].some(key => config[key] !== saved[key])) {throw new Error('Save the connection or generate a token before testing changed settings.');}
    feedback('Testing Cloud Manager access...',null);
    try { await request(pathFor(saved.programId, '/environments'),'GET',undefined,{expectedConfig:saved}); }
    catch (e) { throw new Error(`Cloud Manager connection failed: ${e.message} Check the client scopes and your program permissions.`, {cause: e}); }
    finally {await showToken();}
    feedback('Connection succeeded: Cloud Manager access verified.', true);
}));
