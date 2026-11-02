// Uses real browser Web Crypto, the actual worker handler, and mock Chrome/Adobe APIs.
export default async function profileBrowserSmoke(page, files) {
    const checks = [], errors = [];
    const check = (ok, name) => { if (!ok) {throw new Error(name);} checks.push(name); };
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://auth-companion.test/**', route => {
        const name = new URL(route.request().url()).pathname.slice(1);
        let contentType = 'text/html';
        if (name.endsWith('.js')) { contentType = 'text/javascript'; }
        else if (name.endsWith('.css')) { contentType = 'text/css'; }
        return route.fulfill({headers: name.endsWith('.html') && files['manifest.json'] ? {'Content-Security-Policy': JSON.parse(files['manifest.json']).content_security_policy.extension_pages} : {}, contentType, body: files[name] || ''});
    });
    await page.addInitScript(() => {
        const local = JSON.parse(localStorage.getItem('fixtureLocal') || 'null') || {
            clientId: 'fixture-client', orgId: 'org', programId: '1', oauthScopes: 'fixture-scope',
            rememberedSecret: {clientId: 'fixture-client', orgId: 'org', secret: 'fixture-secret'}, rememberSecret: true
        };
        const session = JSON.parse(sessionStorage.getItem('fixtureSession') || '{}'), listeners = [];
        window.fixtureLocal = local; window.fixtureSession = session;
        window.fixtureProfile = () => local.connectionProfiles.profiles.find(p=>p.id===local.connectionProfiles.activeProfileId);
        window.fixtureProfileSession = () => session[`profileSession:${local.connectionProfiles.activeProfileId}`] || {};
        window.fixtureStorageWrites = []; window.fixtureAccess = [];
        const persist = () => { localStorage.setItem('fixtureLocal', JSON.stringify(local)); sessionStorage.setItem('fixtureSession', JSON.stringify(session)); };
        const emit = (changes, name) => { if (Object.keys(changes).length) {queueMicrotask(() => listeners.forEach(fn => fn(changes, name)));} };
        const storage = (data, name) => ({
            get: async keys => structuredClone(keys == null ? data : Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]]))),
            set: async values => {
                window.fixtureStorageWrites.push({name, values: structuredClone(values)});
                const changes = {};
                for (const [key, value] of Object.entries(values)) {
                    if (JSON.stringify(data[key]) !== JSON.stringify(value)) {changes[key] = {oldValue: data[key], newValue: value};}
                    data[key] = structuredClone(value);
                }
                persist(); emit(changes, name);
            },
            remove: async keys => {
                const changes = {};
                for (const key of Array.isArray(keys) ? keys : [keys]) {
                    if (key in data) {changes[key] = {oldValue: data[key]};}
                    delete data[key];
                }
                persist(); emit(changes, name);
            },
            setAccessLevel: async access => { window.fixtureAccess.push({name, ...access}); }
        });
        let handler, background;
        window.chrome = {
            storage: {local: storage(local, 'local'), session: storage(session, 'session'), onChanged: {addListener: fn => listeners.push(fn)}},
            runtime: {id: 'fixture-extension', getURL: name => `https://auth-companion.test/${name}`,
                onInstalled: {addListener() {}}, onStartup: {addListener() {}}, onMessage: {addListener: fn => { handler = fn; }},
                sendMessage: async message => {
                    background ||= import('./background.js'); await background;
                    return new Promise(resolve => handler(message, {id: 'fixture-extension', url: location.href}, resolve));
                }
            }
        };
        window.sendFrom = async (sender, message) => {
            message ??= {type: 'credentials', action: 'status'};
            background ||= import('./background.js'); await background;
            return new Promise(resolve => handler(message, sender, resolve));
        };
    });
    let tokenRequests=0,heldRead,releaseRead,heldMutation,releaseMutation;
    const calls=[];
    await page.route('https://ims-na1.adobelogin.com/**',route=>{
        const body=new URLSearchParams(route.request().postData());
        check(body.get('client_secret')==='fixture-secret','credential exchange uses explicitly supplied secret');
        return route.fulfill({contentType:'application/json',body:JSON.stringify({access_token:`token-${body.get('client_id')}-${++tokenRequests}`,token_type:'bearer',expires_in:3600})});
    });
    await page.route('https://cloudmanager.adobe.io/**',async route=>{
        const request=route.request(),path=new URL(request.url()).pathname,client=request.headers()['x-api-key'];
        calls.push({path,client,token:request.headers().authorization,method:request.method()});
        const send=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
        if(path.endsWith('/environments')){return send({_embedded:{environments:[{id:'1',name:client,type:'dev',status:'ready'}]}});}
        if(path.endsWith('/pipelines')){return send({_embedded:{pipelines:[{id:'10',name:`pipeline-${client}`,type:'CI_CD',status:'IDLE',phases:[{type:'DEPLOY',environmentId:'1'}]}]}});}
        if(path.endsWith('/variables')){
            if(request.method()==='PATCH'){if(heldMutation){await heldMutation;}return send({_embedded:{variables:[]}});}
            if(heldRead && client==='fixture-client'){await heldRead;}
            return send({_embedded:{variables:[{name:'EXAMPLE',value:`server-${client}`,service:'author',type:'string',status:'ready'}]}});
        }
        return send({});
    });
    const ready=()=>page.waitForFunction(()=>!document.querySelector('#addProfile')?.disabled && !document.querySelector('#refresh')?.disabled && !document.querySelector('#viewLoader:not([hidden])'));
    const click=async id=>{await page.locator(`#${id}`).click();await ready();};
    await page.goto('https://auth-companion.test/reset');await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});
    await page.goto('https://auth-companion.test/options.html');await ready();
    check(!await page.locator('#profileName').isVisible(),'profile maintenance is collapsed during connection setup');
    const first=await page.locator('#programProfile').inputValue();
    await page.locator('#rememberSecret').check();await click('connect');
    check((await page.locator('#feedback').innerText()).includes('Connected'),'migrated first program connects');
    await page.getByText('Manage programs',{exact:true}).click();
    await click('addProfile');const second=await page.locator('#programProfile').inputValue();
    check(first!==second,'new program gets a stable distinct identity');
    for(const id of ['clientId','orgId','programId','clientSecret','oauthScopes','token']){check(await page.locator(`#${id}`).inputValue()==='',`new profile ${id} starts empty`);} // NOSONAR: Reading and editing this shared form must remain sequential.
    check((await page.locator('#vaultStatus').innerText()).includes('No secret'),'new profile does not inherit saved credentials');
    await page.locator('#profileName').fill('Production');await click('renameProfile');
    for(const [id,value] of Object.entries({clientId:'second-client',orgId:'second-org',programId:'1',oauthScopes:'fixture-scope',clientSecret:'fixture-secret'})){await page.locator(`#${id}`).fill(value);} // NOSONAR: Reading and editing this shared form must remain sequential.
    await page.locator('#rememberSecret').check();await click('connect');
    check((await page.locator('#feedback').innerText()).includes('Connected'),'second program connects with independent credentials');
    check(await page.evaluate(()=>fixtureLocal.connectionProfiles.profiles.every(p=>p.credentialVault?.version===2)),'both saved credentials remain present');
    check(await page.evaluate(()=>Object.values(fixtureSession).filter(p=>p?.token).length===2),'session stores a token for each profile');
    const rejected=await page.evaluate(async id=>sendFrom({id:chrome.runtime.id,url:location.href},{type:'credentials',action:'ensureToken',config:{profileId:id,clientId:'fixture-client',orgId:'org',programId:'1',oauthScopes:'fixture-scope'}}),first);
    check(!rejected.ok,'stale profile operation is rejected by worker');
    await page.evaluate(()=>{window.profileOriginalSend=chrome.runtime.sendMessage;chrome.runtime.sendMessage=async message=>message.action==='selectProfile'?{ok:false,error:'Temporary storage failure'}:window.profileOriginalSend(message);});
    await page.locator('#programProfile').selectOption(first);await ready();
    check(await page.locator('#programProfile').inputValue()===second && await page.locator('#clientId').inputValue()==='second-client','failed selection restores selector to the profile shown by credential fields');
    await page.evaluate(()=>{chrome.runtime.sendMessage=window.profileOriginalSend;});
    await page.goto('https://auth-companion.test/popup.html');await ready();
    check(await page.locator('#programProfile').inputValue()===second,'popup inherits selected profile');
    await page.locator('#programProfile').selectOption(first);await ready();
    check((await page.locator('#content').innerText()).includes('fixture-client'),'switch loads first profile environment');
    await page.getByRole('button',{name:'Variables',exact:true}).click();await ready();
    const value=()=>page.getByLabel('Value for EXAMPLE');
    await page.getByLabel('Import variable JSON file').setInputFiles({name:'variables.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,variables:[{name:'EXAMPLE',type:'string',service:'author',value:'draft-first'}]}))});
    await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('Imported into draft'));

    await page.locator('#programProfile').selectOption(second);await ready();
    check(await value().inputValue()==='server-second-client','same environment and program IDs do not share drafts');
    const empty=await page.evaluate(()=>sendFrom({id:chrome.runtime.id,url:chrome.runtime.getURL('options.html')},{type:'credentials',action:'addProfile',name:'Empty program'}));
    await ready();
    check(await page.locator('#environment option').count()===0 && !(await page.locator('#environment').isVisible()),'empty program never displays previous environment options');
    check(!(await page.locator('#content').innerText()).includes('EXAMPLE'),'empty program clears previous variable cards');
    await page.evaluate(id=>sendFrom({id:chrome.runtime.id,url:chrome.runtime.getURL('options.html')},{type:'credentials',action:'deleteProfile',profileId:id}),empty.data.activeProfileId);
    await ready();await page.locator('#programProfile').selectOption(second);await ready();
    await value().evaluate(input=>{input.value='draft-second';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.locator('#programProfile').selectOption(first);await ready();
    check(await value().inputValue()==='draft-first','first draft survives switching programs');
    check(calls.filter(call=>call.path.endsWith('/pipelines')).length===2,'profile switches reuse independent cached pipeline catalogs');
    check(await page.evaluate(()=>JSON.stringify(sessionStorage).includes('draft-first')&&!JSON.stringify(localStorage).includes('draft-first')),'drafts survive in session storage without local persistence');
    heldRead=new Promise(resolve=>{releaseRead=resolve;});
    await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#viewLoader').hidden);
    await page.locator('#programProfile').selectOption(second);releaseRead();heldRead=null;await ready();
    check(await value().inputValue()==='draft-second','late response cannot overwrite newly selected profile');
    heldMutation=new Promise(resolve=>{releaseMutation=resolve;});
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:/Save.*change/}).click();
    await page.waitForFunction(()=>document.querySelector('#programProfile').disabled);
    check(await page.locator('#programProfile').isDisabled(),'switching is disabled while a variable mutation is pending');
    releaseMutation();heldMutation=null;await ready();
    await page.waitForFunction(()=>!document.querySelector('.variable-value-field textarea').disabled);
    heldMutation=new Promise(resolve=>{releaseMutation=resolve;});
    await value().evaluate(input=>{input.value='second-write';input.dispatchEvent(new Event('input',{bubbles:true}));});
    const mutationCount=calls.filter(call=>call.method==='PATCH').length;
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:/Save.*change/}).click();
    while(calls.filter(call=>call.method==='PATCH').length===mutationCount){await page.waitForTimeout(10);} // NOSONAR: These steps share mutable browser state and must run in order.
    await page.evaluate(id=>chrome.runtime.sendMessage({type:'credentials',action:'selectProfile',profileId:id}),first);
    releaseMutation();heldMutation=null;await ready();
    await page.waitForFunction(id=>document.querySelector('#programProfile').value===id && !document.querySelector('#refresh').disabled,first);
    check(await value().inputValue()==='draft-first','external profile switch reloads after an in-flight mutation finishes');
    check(calls.findLast(call=>call.method==='PATCH').client==='second-client','in-flight mutation stays bound to its original profile');
    await page.locator('#programProfile').selectOption(second);await ready();
    check(calls.every(call=>call.token?.includes(call.client)),'every Adobe request uses the intended profile token');
    await page.goto('https://auth-companion.test/options.html');await ready();
    await page.locator('#clientId').fill('unsaved-client');
    page.once('dialog',dialog=>dialog.dismiss());await page.locator('#programProfile').selectOption(first);
    check(await page.locator('#programProfile').inputValue()===second && await page.locator('#clientId').inputValue()==='unsaved-client','canceling settings switch preserves unsaved fields');
    await page.getByText('Manage programs',{exact:true}).click();
    await page.locator('#profileName').fill('Renamed production');await click('renameProfile');
    check(await page.locator('#clientId').inputValue()==='unsaved-client','renaming never discards unsaved credentials');
    page.once('dialog',dialog=>dialog.accept());await click('deleteProfile');
    check(await page.locator('#programProfile').inputValue()===first,'deleting selected profile chooses remaining program');
    check(await page.evaluate(id=>!fixtureLocal.connectionProfiles.profiles.some(p=>p.id===id) && !fixtureSession[`profileSession:${id}`] && !Object.keys(fixtureSession).some(key=>key.startsWith(`profile:${id}:`)),second),'deletion removes only deleted profile credential, token and cache');
    check(await page.evaluate(id=>fixtureLocal.connectionProfiles.profiles.some(p=>p.id===id && p.credentialVault),first), 'remaining profile credential is preserved');
    page.once('dialog',dialog=>dialog.accept());await click('deleteProfile');
    check(await page.locator('#connect').isDisabled() && await page.locator('#addProfile').isEnabled(),'deleting final profile leaves usable empty Settings');
    await click('addProfile');
    check(await page.locator('#clientId').inputValue()==='' && await page.locator('#clientSecret').inputValue()==='','adding after deleting final profile never restores deleted credentials');
    check(errors.length===0,`no browser errors: ${errors.join(', ')}`);
    return {checks};
}
