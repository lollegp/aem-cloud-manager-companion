// Uses real browser Web Crypto, the actual worker handler, and mock Chrome/Adobe APIs.
export default async function authBrowserSmoke(page, files) {
    const checks = [], errors = [];
    const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://auth-companion.test/**', route => {
        const name = new URL(route.request().url()).pathname.slice(1);
        return route.fulfill({headers: name.endsWith('.html') && files['manifest.json'] ? {'Content-Security-Policy': JSON.parse(files['manifest.json']).content_security_policy.extension_pages} : {}, contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: files[name] || ''});
    });
    await page.addInitScript(() => {
        const local = JSON.parse(localStorage.getItem('fixtureLocal') || 'null') || {
            clientId: 'fixture-client', orgId: 'org', programId: '1', oauthScopes: 'fixture-scope',
            rememberedSecret: {clientId: 'fixture-client', orgId: 'org', secret: 'fixture-secret'}, rememberSecret: true
        };
        const session = JSON.parse(sessionStorage.getItem('fixtureSession') || '{}'), listeners = [];
        window.fixtureLocal = local; window.fixtureSession = session;
        window.fixtureStorageWrites = []; window.fixtureAccess = [];
        const persist = () => { localStorage.setItem('fixtureLocal', JSON.stringify(local)); sessionStorage.setItem('fixtureSession', JSON.stringify(session)); };
        const emit = (changes, name) => { if (Object.keys(changes).length) queueMicrotask(() => listeners.forEach(fn => fn(changes, name))); };
        const storage = (data, name) => ({
            get: async keys => structuredClone(Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]]))),
            set: async values => {
                window.fixtureStorageWrites.push({name, values: structuredClone(values)});
                const changes = {};
                for (const [key, value] of Object.entries(values)) {
                    if (JSON.stringify(data[key]) !== JSON.stringify(value)) changes[key] = {oldValue: data[key], newValue: value};
                    data[key] = structuredClone(value);
                }
                persist(); emit(changes, name);
            },
            remove: async keys => {
                const changes = {};
                for (const key of Array.isArray(keys) ? keys : [keys]) {
                    if (key in data) changes[key] = {oldValue: data[key]};
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
                    background ||= import('/background.js'); await background;
                    return new Promise(resolve => handler(message, {id: 'fixture-extension', url: location.href}, resolve));
                }
            }
        };
        window.sendFrom = async (sender, message = {type: 'credentials', action: 'status'}) => {
            background ||= import('/background.js'); await background;
            return new Promise(resolve => handler(message, sender, resolve));
        };
    });
    let tokenRequests = 0, apiRequests = 0, fail = false;
    await page.route('https://ims-na1.adobelogin.com/**', route => {
        tokenRequests++;
        const body = new URLSearchParams(route.request().postData());
        check(body.get('client_secret') === 'fixture-secret' && body.get('grant_type') === 'client_credentials', 'expected credential exchange');
        check(!route.request().url().includes('fixture-secret'), 'secret absent from URL');
        return route.fulfill({status: fail ? 400 : 200, contentType: 'application/json', body: JSON.stringify(fail ? {error: 'invalid_client', error_description: 'fixture-secret'} : {access_token: `fixture-token-${tokenRequests}`, token_type: 'bearer', expires_in: 3600})});
    });
    await page.route('https://cloudmanager.adobe.io/**', route => { apiRequests++; return route.fulfill({contentType: 'application/json', body: '{"_embedded":{"environments":[]}}'}); });
    const ready = () => page.waitForFunction(() => !document.getElementById('generate').disabled);
    const click = async id => { await page.locator(`#${id}`).click(); await ready(); };
    await page.goto('https://auth-companion.test/options.html'); await ready();
    check(await page.locator('#vaultPassword, #confirmPassword, #unlockVault, #lockVault').count() === 0, 'password and lock controls removed');
    check(!await page.locator('#rememberSecret').isChecked(), 'saving requires explicit opt-in');
    check((await page.locator('body').innerText()).includes('Anyone with the extension code and your saved data can decrypt it'), 'fixed-key limitation disclosed');
    check(await page.locator('#migrationNotice').isVisible(), 'legacy migration prompt shown');
    check(await page.evaluate(() => !fixtureLocal.rememberedSecret && fixtureSession.legacyCredential.secret === 'fixture-secret'), 'legacy plaintext removed from disk');
    check(await page.locator('#clientSecret').inputValue() === '', 'legacy secret never restored to form');
    check(await page.evaluate(() => fixtureAccess.every(a => a.accessLevel === 'TRUSTED_CONTEXTS')), 'storage restricted to trusted contexts');
    check(!(await page.evaluate(() => sendFrom({id: 'foreign', url: location.href}))).ok, 'foreign extension rejected');
    check(!(await page.evaluate(() => sendFrom({id: chrome.runtime.id, url: 'https://untrusted.test/'}))).ok, 'untrusted page rejected');
    check(!(await page.evaluate(() => sendFrom({id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html')}, {type: 'credentials', action: 'forget'}))).ok, 'popup cannot delete credentials through worker');
    await click('saveVault');
    check((await page.locator('#feedback').innerText()).includes('consent'), 'save blocked without consent');
    await page.locator('#rememberSecret').check(); await click('saveVault');
    check((await page.locator('#vaultStatus').innerText()).includes('Secret saved'), 'saved without password');
    check(await page.evaluate(() => fixtureLocal.credentialVault.version === 2 && !fixtureSession.legacyCredential && !JSON.stringify(fixtureLocal).includes('fixture-secret')), 'version 2 ciphertext saved; temporary copy removed');
    check(await page.evaluate(() => !JSON.stringify(fixtureStorageWrites.filter(w => w.name === 'local')).includes('fixture-secret')), 'no plaintext persistent write');
    await click('test');
    check(tokenRequests === 1 && apiRequests === 1, 'test connection automatically obtains first token');
    check(await page.evaluate(() => fixtureSession.token === 'fixture-token-1' && !fixtureLocal.token && !JSON.stringify(fixtureSession).includes('fixture-secret')), 'only token retained in session');
    await page.waitForFunction(() => document.getElementById('tokenStatus').textContent.includes('Expires'));
    check(true, 'token status updates after automatic renewal');
    const beforeFailure = await page.evaluate(() => fixtureSession.token);
    fail = true; await click('generate');
    check((await page.locator('#feedback').innerText()).includes('rejected'), 'provider errors reported');
    check(!(await page.locator('body').innerText()).includes('fixture-secret'), 'provider error sanitized');
    check(await page.evaluate(() => fixtureSession.token) === beforeFailure, 'failed generation preserves token');
    fail = false;
    // Browser restart clears session storage. Open popup directly, without Settings.
    await page.evaluate(() => sessionStorage.clear());
    const beforeRestart = tokenRequests;
    await page.goto('https://auth-companion.test/popup.html');
    await page.waitForFunction(() => !document.getElementById('refresh').disabled);
    check(tokenRequests === beforeRestart + 1, 'popup renews silently after simulated browser restart');
    check(await page.evaluate(() => !!fixtureSession.token), 'popup receives renewed token');
    await page.goto('https://auth-companion.test/options.html'); await ready();
    await page.evaluate(() => chrome.storage.session.set({tokenExpiresAt: 1}));
    const beforeConcurrent = tokenRequests;
    await page.evaluate(async () => {
        const api = await import('/api.js');
        await Promise.all(Array.from({length: 5}, () => api.request('/api/program/1/environments')));
    });
    check(tokenRequests === beforeConcurrent + 1, 'concurrent expired-token requests share one renewal');
    await click('clear');
    check(await page.evaluate(() => !fixtureSession.token && !!fixtureLocal.credentialVault), 'clear token preserves saved credential');
    await click('test');
    check(await page.evaluate(() => !!fixtureSession.token), 'next API request renews after clear');
    await page.locator('#clientId').fill('other-client'); await click('generate');
    check((await page.locator('#feedback').innerText()).includes('matching'), 'credential bound to client identity');
    await page.reload(); await ready();
    page.once('dialog', dialog => dialog.accept()); await click('forgetSecret');
    check(await page.evaluate(() => !fixtureLocal.credentialVault && !fixtureSession.token), 'forget clears credential and token');
    const beforeForget = tokenRequests; await click('test');
    check(tokenRequests === beforeForget, 'forget prevents automatic renewal');
    await page.locator('#clientSecret').fill('fixture-secret'); await click('generate');
    check(await page.locator('#clientSecret').inputValue() === '', 'one-time input cleared');
    check(await page.evaluate(() => !JSON.stringify(fixtureLocal).includes('fixture-secret') && !JSON.stringify(fixtureSession).includes('fixture-secret')), 'one-time secret not retained');
    await click('clear'); await page.locator('summary').click();
    await page.locator('#token').fill('manual-token'); await click('save');
    check(await page.evaluate(() => fixtureSession.token === 'manual-token' && !fixtureSession.tokenExpiresAt), 'manual token supported');
    await page.evaluate(() => chrome.storage.local.set({credentialVault: {version: 1, id: 'old', clientId: 'fixture-client', orgId: 'org', ciphertext: 'legacy-encrypted'}}));
    await page.reload(); await ready();
    check((await page.locator('#vaultStatus').innerText()).includes('Re-enter your Adobe Client Secret'), 'locked old vault gets one-time replacement instructions');
    check(await page.evaluate(() => fixtureLocal.credentialVault.version === 1), 'old vault remains until replaced');
    await page.locator('#clientSecret').fill('fixture-secret'); await page.locator('#rememberSecret').check(); await click('saveVault');
    check(await page.evaluate(() => fixtureLocal.credentialVault.version === 2), 'old vault replaced after explicit save');
    check(errors.length === 0, `no browser runtime errors: ${errors.join(', ')}`);
    return {checks, tokenRequests, apiRequests};
}
