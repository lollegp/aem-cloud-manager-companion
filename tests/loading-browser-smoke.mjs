// Reproduce a Cloud Manager request that never responds; no real API calls.
export default async function loadingBrowserSmoke(page, files) {
    const checks = [], errors = [];
    const check = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://loading-companion.test/**', route => {
        const name = new URL(route.request().url()).pathname.slice(1);
        return route.fulfill({contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: files[name] || ''});
    });
    await page.addInitScript(() => {
        const timeout = AbortSignal.timeout.bind(AbortSignal);
        // Exercise the production abort path without waiting 30 seconds.
        AbortSignal.timeout = ms => timeout(ms / 60);
        window.settingsOpened = 0;
        window.chrome = {
            storage: {
                local: {get: async () => ({clientId: 'client', orgId: 'org', programId: '1', oauthScopes: 'scope'})},
                session: {get: async () => ({token: 'manual-token'})},
                onChanged: {addListener() {}}
            },
            runtime: {openOptionsPage() { window.settingsOpened++; }, sendMessage: async () => ({ok: true, data: {saved: true, clientId: 'client', orgId: 'org'}})}
        };
    });
    let stalled = true;
    await page.route('https://cloudmanager.adobe.io/**', route => {
        if (stalled) return; // Deliberately leave the network request pending.
        return route.fulfill({contentType: 'application/json', body: '{"_embedded":{"environments":[],"pipelines":[]}}'});
    });
    await page.goto('https://loading-companion.test/popup.html');
    await page.waitForFunction(() => document.getElementById('message').textContent.startsWith('Loading'));
    check(await page.locator('#settings').isEnabled(), 'Settings stays accessible during loading');
    await page.locator('#settings').click();
    check(await page.evaluate(() => settingsOpened === 1), 'Settings opens while API is stalled');
    await page.waitForFunction(() => !document.getElementById('refresh').disabled, {timeout: 5000});
    check((await page.locator('#message').innerText()).includes('timed out'), 'stalled API shows actionable timeout');
    check(await page.locator('[data-tab]').first().isEnabled(), 'tabs restored after timeout');
    stalled = false;
    await page.locator('#refresh').click();
    await page.waitForFunction(() => !document.getElementById('refresh').disabled);
    check((await page.locator('#message').innerText()) === 'Updated just now', 'retry recovers after network resumes');
    stalled = true;
    await page.goto('https://loading-companion.test/options.html');
    await page.waitForFunction(() => !document.getElementById('test').disabled);
    await page.locator('#test').click();
    await page.waitForFunction(() => !document.getElementById('test').disabled, {timeout: 5000});
    check((await page.locator('#feedback').innerText()).includes('timed out'), 'Settings connection test times out');
    check(await page.locator('#clientId').isEnabled(), 'Settings editable after stalled connection test');
    // Test connection can succeed while many sequential execution reads stall the popup.
    await page.unroute('https://cloudmanager.adobe.io/**');
    let executionRequests = 0;
    await page.route('https://cloudmanager.adobe.io/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/environments')) return route.fulfill({contentType: 'application/json', body: '{"_embedded":{"environments":[]}}'});
        if (path.endsWith('/pipelines')) return route.fulfill({contentType: 'application/json', body: JSON.stringify({_embedded: {pipelines: Array.from({length: 10}, (_, i) => ({id: String(i), name: `Pipeline ${i}`, status: 'IDLE', buildType: 'fullstack', phases: []}))}})});
        executionRequests++;
        await new Promise(resolve => setTimeout(resolve, 150));
        await route.fulfill({contentType: 'application/json', body: '{}'}).catch(() => {});
    });
    await page.goto('https://loading-companion.test/popup.html');
    await page.waitForFunction(() => !document.getElementById('refresh').disabled, null, {timeout: 5000});
    check((await page.locator('#message').innerText()).includes('Refresh stopped'), 'whole refresh deadline covers sequential requests');
    check((await page.locator('#message').innerText()).includes('execution'), 'timeout identifies the blocked loading step');
    const completedCount = executionRequests;
    const completedContent = await page.locator('#content').innerHTML();
    const completedMessage = await page.locator('#message').innerText();
    await page.waitForTimeout(400);
    check(executionRequests === completedCount && executionRequests < 10, 'timeout stops remaining requests and late UI updates');
    check(await page.locator('#content').innerHTML() === completedContent && await page.locator('#message').innerText() === completedMessage, 'late responses cannot change the timed-out view');
    check(await page.locator('#settings').isEnabled(), 'Settings remains available after refresh deadline');
    await page.evaluate(() => {
        chrome.storage.session.get = async () => ({});
        chrome.runtime.sendMessage = () => new Promise(() => {});
    });
    await page.locator('#refresh').click();
    await page.waitForFunction(() => !document.getElementById('refresh').disabled, null, {timeout: 5000});
    check(/Refresh stopped|timed out/.test(await page.locator('#message').innerText()), 'silent background worker cannot hold refresh indefinitely');
    check(await page.locator('#settings').isEnabled(), 'Settings available after stalled token renewal');
    await page.evaluate(() => { chrome.storage.local.get = () => new Promise(() => {}); });
    await page.locator('#refresh').click();
    await page.waitForFunction(() => !document.getElementById('refresh').disabled, null, {timeout: 5000});
    check((await page.locator('#message').innerText()) !== 'Updated just now', 'stalled storage fails instead of reporting success');
    check(await page.locator('[data-tab]').first().isEnabled(), 'tabs restored after stalled storage');
    check(errors.length === 0, 'no browser runtime errors');
    return {checks};
}
