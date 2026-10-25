// Theme behavior uses mocked Chrome storage; no Adobe requests are sent.
export default async function themeBrowserSmoke(page, files) {
    const checks = [], errors = [], remoteCalls = [];
    const check = (value, message) => {if (!value) throw new Error(message); checks.push(message);};
    page.on('pageerror', error => errors.push(error.message));
    await page.context().route('https://theme-fixture.test/**', route => {
        const name = new URL(route.request().url()).pathname.slice(1);
        return route.fulfill({contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: name === 'theme-samples.html' ? '<!doctype html><html><head><script src="theme.js"></script><link rel="stylesheet" href="style.css"></head><body class="popup"><main><h1>Appearance preview</h1><div class="card"><span class="pill finished">Success</span> <span class="pill updating">Updating</span> <span class="pill failed">Failed</span><div class="actions"><button class="action-start">Start</button><button class="action-stop">Stop</button><button class="action-approve">Approve</button><button class="action-reject">Reject</button><button class="primary">Save changes</button></div><label>Value<input value="Sample value"></label></div></main></body></html>' : files[name] || ''});
    });
    await page.context().route('https://cloudmanager.adobe.io/**', route => {remoteCalls.push(route.request().url());return route.abort();});
    await page.goto('https://theme-fixture.test/reset');
    await page.evaluate(() => localStorage.clear());
    await page.context().addInitScript(() => {
        const listeners = [], read = () => JSON.parse(localStorage.getItem('themeFixture') || '{}');
        const emit = (before, after) => {
            const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
            const changes = Object.fromEntries([...keys].filter(key => before[key] !== after[key]).map(key => [key, {oldValue: before[key], newValue: after[key]}]));
            listeners.forEach(listener => listener(changes, 'local'));
        };
        window.chrome = {storage: {
            local: {get: async keys => Object.fromEntries(keys.filter(key => key in read()).map(key => [key, read()[key]])), set: async values => {const before = read(), after = {...before, ...values};localStorage.setItem('themeFixture', JSON.stringify(after));emit(before, after);}},
            session: {get: async () => ({})}, onChanged: {addListener: listener => listeners.push(listener)}
        }, runtime: {sendMessage: async () => ({ok: true, data: {saved: false}}), openOptionsPage() {}}};
        window.addEventListener('storage', event => {if (event.key === 'themeFixture') emit(JSON.parse(event.oldValue || '{}'), JSON.parse(event.newValue || '{}'));});
    });
    await page.emulateMedia({colorScheme: 'light'});
    await page.goto('https://theme-fixture.test/options.html');
    await page.waitForFunction(() => !document.getElementById('clientId').disabled);
    const appearance = page.getByLabel('Theme', {exact: true});
    const palette = () => page.evaluate(() => ({background: getComputedStyle(document.documentElement).backgroundColor, scheme: getComputedStyle(document.documentElement).colorScheme}));
    check(await appearance.inputValue() === 'system', 'new installations default to System');
    check((await palette()).background === 'rgb(246, 248, 251)', 'System uses the computer light palette');
    await appearance.selectOption('dark');
    await page.waitForFunction(() => !document.getElementById('themePreference').disabled);
    check((await palette()).background === 'rgb(20, 23, 28)', 'Dark overrides a light computer theme');
    check((await palette()).scheme === 'dark', 'native controls use the selected dark color scheme');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('themePreference').value === 'dark');
    check((await palette()).background === 'rgb(20, 23, 28)', 'explicit preference survives reopening Settings');
    await appearance.selectOption('system');
    await page.waitForFunction(() => !document.getElementById('themePreference').disabled);
    check((await palette()).background === 'rgb(246, 248, 251)', 'switching back to System restores the light OS palette');
    await page.emulateMedia({colorScheme: 'dark'});
    check((await palette()).background === 'rgb(20, 23, 28)', 'System updates live when the computer switches to dark');
    await appearance.selectOption('light');
    await page.waitForFunction(() => !document.getElementById('themePreference').disabled);
    check((await palette()).background === 'rgb(246, 248, 251)', 'Light overrides a dark computer theme');
    const other = await page.context().newPage();
    try {
        await other.emulateMedia({colorScheme: 'dark'});
        await other.goto('https://theme-fixture.test/privacy.html');
        await other.waitForFunction(() => document.documentElement.dataset.theme === 'light');
        check(await other.evaluate(() => getComputedStyle(document.documentElement).colorScheme) === 'light', 'packaged privacy page shares the saved appearance');
        await appearance.selectOption('dark');
        await other.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
        check(await other.evaluate(() => getComputedStyle(document.documentElement).backgroundColor) === 'rgb(20, 23, 28)', 'already-open extension pages update through storage events');
        await other.goto('https://theme-fixture.test/theme-samples.html');
        const contrast = () => other.evaluate(() => {
            const luminance = color => {
                const channels = color.match(/\d+/g).slice(0,3).map(value => {const n=Number(value)/255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;});
                return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
            };
            return [...document.querySelectorAll('.pill,button')].map(element => {
                const style=getComputedStyle(element), foreground=luminance(style.color), background=luminance(style.backgroundColor);
                return (Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05);
            });
        });
        await other.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
        check((await contrast()).every(ratio=>ratio>=4.5),'dark status ribbons and action buttons meet normal-text contrast');
        await appearance.selectOption('light');
        await other.waitForFunction(() => document.documentElement.dataset.theme === 'light');
        check((await contrast()).every(ratio=>ratio>=4.5),'light status ribbons and action buttons meet normal-text contrast');
        await appearance.selectOption('dark');
        await other.goto('https://theme-fixture.test/popup.html');
        await other.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
        check(await other.evaluate(() => getComputedStyle(document.documentElement).colorScheme) === 'dark', 'popup restores the same theme');
    } finally {await other.close();}
    check(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('themeFixture'))).join(',')) === 'appearanceTheme', 'appearance changes never alter connection settings');
    check(remoteCalls.length === 0, 'appearance changes make no Adobe API requests');
    check(errors.length === 0, `no browser errors: ${errors.join('; ')}`);
    return {checks};
}
