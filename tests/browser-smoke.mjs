// Run with a Playwright Page and a filename -> source map of the extension files.
// All Adobe responses and Chrome storage are fixtures; no live API is contacted.
export default async function browserSmoke(page, files) {
    const failures = [], checks = [], writes = [];
    const assert = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
    page.on('pageerror', error => failures.push(error.message));
    await page.setViewportSize({width: 440, height: 760});
    await page.unrouteAll({behavior: 'wait'});
    await page.route('http://companion.test/**', route => {
        const name = new URL(route.request().url()).pathname.slice(1);
        return route.fulfill({status: files[name] || name === 'reset' ? 200 : 404, contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html', body: files[name] || ''});
    });
    await page.goto('http://companion.test/reset');
    await page.evaluate(() => localStorage.clear());
    await page.addInitScript(() => {
        window.fixtureDialogs = [];
        window.fixtureConfirm = false;
        window.confirm = message => { window.fixtureDialogs.push(message); return window.fixtureConfirm; };
        const local = JSON.parse(localStorage.getItem('fixtureStorage') || '{"clientId":"fixture","orgId":"org","programId":"1"}');
        window.chrome = {storage: {
            local: {
                get: async keys => Object.fromEntries(keys.filter(k => k in local).map(k => [k, local[k]])),
                set: async values => { Object.assign(local, values); localStorage.setItem('fixtureStorage', JSON.stringify(local)); },
                remove: async key => { delete local[key]; localStorage.setItem('fixtureStorage', JSON.stringify(local)); }
            },
            session: {
                get: async keys => {
                    const data = JSON.parse(sessionStorage.getItem('cacheFixture') || '{"token":"fixture-token"}');
                    return Object.fromEntries(keys.filter(key => key in data).map(key => [key,data[key]]));
                },
                set: async values => sessionStorage.setItem('cacheFixture',JSON.stringify({...JSON.parse(sessionStorage.getItem('cacheFixture') || '{"token":"fixture-token"}'),...values}))
            }
        }, runtime: {openOptionsPage() {}}};
    });
    const envs = [{id: '1', name: 'Development', status: 'ready', type: 'dev'}, {id: '2', name: 'Production', status: 'ready', type: 'prod'}];
    const pipelines = [
        {id: '10', name: 'Application', status: 'IDLE', type: 'CI_CD'},
        {id: '11', name: 'Dispatcher', status: 'IDLE', type: 'WEB_TIER'},
        {id: '12', name: 'Website', status: 'BUSY', type: 'FRONT_END'},
        {id: '13', name: 'CDN shared', status: 'WAITING', type: 'CDN_CONFIG'},
        {id: '14', name: 'Quality check', status: 'IDLE'}
    ].map(p => ({...p, phases: p.id === '14' ? [{type: 'BUILD'}] : [{type: 'DEPLOY', environmentId: '1'}, ...(p.id === '13' ? [{type: 'DEPLOY', environmentId: '2'}] : [])]}));
    let historyRequests = 0, rejectNextApproval = false, executionId = '100', noCurrent = false, emptyHistory = false;
    const variables = [{name: 'API_URL', value: 'https://example.test/current', type: 'string', service: 'publish'}, {name: 'SECRET', type: 'secretString', value: 'masked'}];
    await page.route('https://cloudmanager.adobe.io/**', async route => {
        const req = route.request(), url = new URL(req.url()), path = url.pathname;
        const send = (data, status = 200) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(data)});
        if (req.method() !== 'GET') {
            writes.push({path, method: req.method(), body: req.postDataJSON()});
            if (rejectNextApproval && path.includes('/pipeline/21/')) return send({message: 'Approval permission denied'}, 403);
            const p = pipelines.find(p => path.includes(`/pipeline/${p.id}/`));
            if (path.endsWith('/execution')) {
                if (p.id === '11') return send({message: 'Permission denied'}, 403);
                p.status = 'BUSY';
            } else if (p) p.status = 'IDLE';
            return send({});
        }
        if (path.endsWith('/environments')) return send({_embedded: {environments: envs}});
        if (path.endsWith('/pipelines')) return send({_embedded: {pipelines: url.search ? pipelines.slice(2) : pipelines.slice(0, 2)}, _totalNumberOfItems: pipelines.length, _links: {next: {href: `/api/program/1/pipelines?start=${Number(url.searchParams.get('start') || 0) + 2}`}}});
        if (path.endsWith('/executions')) {
            historyRequests++;
            if (noCurrent && path.includes('/pipeline/21/')) return send({_embedded: {executions: emptyHistory ? [] : [{id: 'last-run', status: 'FINISHED', createdAt: '2026-10-21T10:00:00Z', _embedded: {stepStates: [{status: 'WAITING', action: 'approval', _links: {'http://ns.adobe.com/adobecloud/rel/pipeline/advance': {href: '/api/program/1/pipeline/21/execution/old/advance'}}}]}}]}});
            const start = Number(url.searchParams.get('start') || 0);
            return send({_totalNumberOfItems: 40, _embedded: {executions: Array.from({length: 20}, (_, i) => ({id: String(start + i), status: 'FINISHED', createdAt: '2026-10-21T10:00:00Z'}))}, _links: {next: {href: path + `?start=${start + 20}&limit=20`}}});
        }
        if (path.endsWith('/variables')) return send({_embedded: {variables}});
        const p = pipelines.find(p => path.includes(`/pipeline/${p.id}`));
        if (path.endsWith('/execution') || /\/execution\/[^/]+$/.test(path)) {
            if (path.endsWith('/execution') && noCurrent && p.id === '21') return send({message: 'Pipeline Execution not found'}, 404);
            const active = ['BUSY', 'WAITING'].includes(p.status);
            const base = `/api/program/1/pipeline/${p.id}/execution/${executionId}/phase/1/step/1`;
            return send({id: executionId, status: active ? 'RUNNING' : 'FINISHED', _embedded: {stepStates: active ? [{action: p.status === 'WAITING' ? 'approval' : 'build', status: p.status === 'WAITING' ? 'WAITING' : 'RUNNING', _links: {'http://ns.adobe.com/adobecloud/rel/pipeline/cancel': {href: base + '/cancel'}, 'http://ns.adobe.com/adobecloud/rel/pipeline/advance': {href: base + '/advance'}}}] : []}});
        }
        return p ? send(p) : send({message: 'Unexpected fixture request'}, 404);
    });
    const ready = async () => {
        await page.waitForFunction(() => !document.getElementById('refresh').disabled && !document.querySelector('[data-loading="true"]'));
        while (await page.locator('.environment-group:not([open]) > summary').count()) {
            await page.locator('.environment-group:not([open]) > summary').first().click();
            await page.waitForFunction(() => !document.querySelector('[data-loading="true"]'));
        }
    };
    const tab = async name => { await page.getByRole('button', {name, exact: true}).click(); await ready(); };
    await page.goto('http://companion.test/popup.html');
    await ready();
    assert(historyRequests === 0, 'opening popup never fetches execution history');
    assert(await page.locator('.execution-status.finished').count() > 0 && await page.locator('.execution-status.running').count() > 0, 'execution status has a dedicated ribbon for finished and running executions');
    const firstHistory = page.locator('.pipeline-history').first();
    await firstHistory.locator('summary').click();
    await page.waitForFunction(() => document.querySelector('.history-list .history-entry'));
    assert(historyRequests === 1, 'opening history loads only its first page');
    await firstHistory.locator('.history-list').evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => document.querySelectorAll('.history-list .history-entry').length === 40);
    assert(historyRequests === 2, 'scroll loads one additional history page');
    await firstHistory.locator('.history-list').evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
    assert(historyRequests === 2, 'history stops at total despite a remaining next link');
    assert(await page.locator('.environment-group').count() === 3, 'groups include both environments and unassigned pipelines');
    assert(await page.locator('.pipeline-kind').count() === 6, 'shared pipeline appears in both target groups');
    assert(await page.locator('.pipeline-kind.fullstack').count() === 1, 'full stack icon displayed');
    assert(await page.locator('.pipeline-kind.webtier').count() === 1, 'web tier icon displayed');
    assert(await page.locator('.pipeline-kind.frontend').count() === 1, 'FE icon displayed');
    assert(await page.locator('.pipeline-kind.cdn').count() === 2, 'CDN icons displayed');
    assert(await page.locator('.pipeline-kind svg').count() === 6, 'each type ribbon has a dedicated SVG icon');
    assert(await page.locator('.pipeline-kind.fullstack').innerText() === 'Full-Stack', 'ribbon displays the specific API type');
    assert(await page.getByText('Change type', {exact: true}).count() === 0, 'pipeline type has no editable control');
    await tab('Environments');
    await page.getByLabel('Alias for Development').fill('My Dev');
    await page.getByRole('button', {name: 'Save alias'}).first().click();
    await ready();
    assert(await page.locator('#content').innerText().then(t => t.includes('My Dev · Development')), 'alias displayed on environment');
    await page.reload(); await ready();
    assert(await page.locator('.environment-summary').first().innerText().then(t => t.includes('My Dev')), 'alias persists after reopening popup');
    assert(await page.locator('.pipeline-kind.frontend').count() === 1, 'pipeline type remains determined by API after reopening');
    await tab('Variables');
    assert(await page.locator('#environment option').first().innerText() === 'My Dev · Development', 'variable selector shows alias');
    await page.getByRole('button', {name: 'Edit', exact: true}).first().click();
    assert(await page.getByLabel('Variable value', {exact: true}).inputValue() === variables[0].value, 'existing plain value prefilled');
    assert(await page.getByLabel('Variable service').inputValue() === 'publish', 'existing service prefilled');
    await page.evaluate(() => { window.fixtureConfirm = false; });
    await page.getByRole('button', {name: 'Save variable'}).click();
    assert(await page.getByLabel('Variable value', {exact: true}).inputValue() === variables[0].value, 'cancelled save preserves draft');
    assert(writes.length === 0, 'cancelled save sends no mutation');
    await page.getByRole('button', {name: 'Edit', exact: true}).nth(1).click();
    assert(await page.getByLabel('Variable value', {exact: true}).inputValue() === '', 'secret value never prefilled');
    assert(await page.getByLabel('Variable value', {exact: true}).getAttribute('type') === 'password', 'secret replacement masked');
    await tab('Pipelines');
    await page.evaluate(() => { window.fixtureConfirm = false; });
    await page.locator('.environment-group').first().getByRole('button', {name: 'Start group'}).click();
    assert(writes.length === 0, 'cancelled group action sends no mutation');
    await page.evaluate(() => { window.fixtureConfirm = true; });
    await page.locator('.environment-group').first().getByRole('button', {name: 'Start group'}).click();
    await ready();
    assert(writes.length === 2 && writes.every(w => w.path.endsWith('/execution')), 'group start only starts idle pipelines once');
    assert(await page.locator('.batch-results').innerText().then(t => t.includes('Permission denied') && t.includes('Start requested')), 'partial start failure remains visible');
    await page.evaluate(() => { window.fixtureConfirm = true; });
    await page.locator('.environment-group').first().getByRole('button', {name: 'Stop group'}).click();
    await ready();
    const stops = writes.filter(w => w.path.endsWith('/cancel'));
    assert(stops.length === 3, 'group stop covers running and waiting pipelines');
    assert(stops.find(w => w.path.includes('/pipeline/13/')).body.approved === false, 'group stop rejects waiting approval correctly');
    assert(await page.evaluate(() => window.fixtureDialogs.at(-1).includes('Production')), 'shared pipeline confirmation includes other affected environment');
    assert(await page.getByRole('button', {name: 'Stop group'}).first().isDisabled(), 'stop disabled after all group pipelines stop');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'popup fits 440px viewport');
    pipelines.push({id: '21', name: 'Production FE', status: 'WAITING', buildType: 'frontend', phases: [{type: 'DEPLOY', environmentId: '2'}]});
    pipelines.find(p => p.id === '13').status = 'WAITING';
    await page.locator('#refresh').click(); await ready();
    let production = page.locator('.environment-group').filter({has: page.locator('.environment-summary').filter({hasText: 'Production'})});
    assert(await production.getByRole('button', {name: 'Promote waiting'}).isEnabled(), 'production group has waiting promotion action');
    assert(await production.getByRole('button', {name: '✓ Promote', exact: true}).count() === 2, 'each production pipeline has individual promotion');
    assert(await page.locator('.environment-group').first().getByRole('button', {name: '✓ Promote', exact: true}).count() === 0, 'shared development group does not duplicate production decisions');
    await page.evaluate(() => { window.fixtureConfirm = false; });
    const beforeCancel = writes.length;
    await production.getByRole('button', {name: 'Promote waiting'}).click();
    assert(writes.length === beforeCancel, 'cancelled production promotion sends no mutation');
    await page.evaluate(() => { window.fixtureConfirm = true; });
    rejectNextApproval = true;
    await production.getByRole('button', {name: 'Promote waiting'}).click(); await ready();
    const promotionWrites = writes.slice(beforeCancel);
    assert(promotionWrites.length === 2 && promotionWrites.every(w => w.path.endsWith('/advance') && w.body.approved === true), 'group promotion targets waiting approvals of all types');
    assert((await page.locator('.batch-results').innerText()).includes('Approval permission denied'), 'partial production decision failure remains visible');
    rejectNextApproval = false;
    await production.getByRole('button', {name: '✕ Reject', exact: true}).click(); await ready();
    assert(writes.at(-1).path.includes('/pipeline/21/') && writes.at(-1).body.approved === false, 'single rejection targets only selected pipeline');
    pipelines.find(p => p.id === '13').status = 'WAITING';
    pipelines.find(p => p.id === '21').status = 'WAITING';
    await page.locator('#refresh').click(); await ready();
    const beforeReject = writes.length;
    await production.getByRole('button', {name: 'Reject waiting'}).click(); await ready();
    assert(writes.slice(beforeReject).length === 2 && writes.slice(beforeReject).every(w => w.body.approved === false), 'group rejection rejects all waiting production approvals');
    pipelines.find(p => p.id === '21').status = 'WAITING';
    await page.locator('#refresh').click(); await ready();
    const beforeStale = writes.length;
    executionId = '999';
    await production.getByRole('button', {name: '✓ Promote', exact: true}).click(); await ready();
    assert(writes.length === beforeStale, 'changed execution is never promoted from a stale confirmation');
    assert((await page.locator('.batch-results').innerText()).includes('execution changed'), 'stale production decision explains the skip');
    await production.getByRole('button', {name: '✓ Promote', exact: true}).click(); await ready();
    assert(writes.length === beforeStale + 1 && writes.at(-1).path.includes('/pipeline/21/execution/999/') && writes.at(-1).body.approved === true, 'single promotion uses only the freshly reviewed execution');
    pipelines.find(p => p.id === '21').status = 'BUSY';
    await page.locator('#refresh').click(); await ready();
    const beforeStop = writes.length;
    executionId = '1000';
    await production.getByRole('button', {name: '■ Stop', exact: true}).click(); await ready();
    assert(writes.length === beforeStop, 'single stop cannot cancel a replacement execution');
    const summary = production.locator(':scope > summary');
    await summary.click();
    assert(await production.evaluate(el => !el.open), 'environment sections collapse');
    await summary.click();
    await ready();
    noCurrent = true;
    const historyBeforeFallback = historyRequests;
    await page.locator('#refresh').click(); await ready();
    const lastRow = production.locator('.pipeline-row[data-pipeline-id="21"]');
    assert(!(await lastRow.innerText()).includes('Execution details unavailable'), '404 does not display an execution error');
    assert(historyRequests === historyBeforeFallback + 1, 'production 404 fetches one latest summary without opening history');
    await lastRow.locator('.pipeline-history > summary').click();
    await page.waitForFunction(() => document.querySelector('.pipeline-row[data-pipeline-id="21"] .history-entry'));
    assert((await lastRow.innerText()).includes('Last execution last-run'), 'explicit history expansion supplies last execution summary');
    assert(await lastRow.locator('p[title="2026-10-21T10:00:00Z"]').count() === 1 && (await lastRow.innerText()).includes('(local time)'), 'last execution displays localized date and time with original timestamp tooltip');
    assert(await lastRow.getByRole('button', {name: '✓ Promote', exact: true}).count() === 0 && await lastRow.getByRole('button', {name: '■ Stop', exact: true}).count() === 0, 'historical steps never expose live mutation controls');
    emptyHistory = true;
    await page.locator('#refresh').click(); await ready();
    await lastRow.locator('.pipeline-history > summary').click();
    await page.waitForFunction(() => document.querySelector('.pipeline-row[data-pipeline-id="21"] .history-list').textContent.includes('No executions found.'));
    assert((await lastRow.innerText()).includes('No previous executions found.'), 'pipeline without history shows empty state');
    await tab('Environments');
    assert(await page.getByRole('button', {name: 'Move up environment My Dev · Development', exact: true}).isDisabled(), 'first environment cannot move above the top');
    await page.getByRole('button', {name: 'Move up environment Production', exact: true}).click(); await ready();
    await tab('Pipelines');
    assert((await page.locator('.environment-summary').first().innerText()).includes('Production'), 'saved environment order applies to pipeline accordions');
    assert(await page.locator('.environment-order').count() === 0, 'pipeline accordions have no ordering controls');
    await page.reload(); await ready();
    assert((await page.locator('.environment-summary').first().innerText()).includes('Production'), 'environment order persists after reopening');
    await tab('Variables');
    assert((await page.locator('#environment option').first().innerText()) === 'Production', 'variable selector follows saved environment order');
    await tab('Environments');
    assert(await page.getByRole('button', {name: 'Reset environment order', exact: true}).count() === 0, 'environment ordering has no reset control');
    await page.getByRole('button', {name: 'Move down environment Production', exact: true}).click(); await ready();
    await tab('Pipelines');
    assert((await page.locator('.environment-summary').first().innerText()).includes('My Dev'), 'environment move down updates saved order');
    await tab('Environments');
    const visibility = page.getByRole('checkbox', {name: 'Hide Production from Pipelines', exact: true});
    await visibility.check(); await ready();
    await tab('Pipelines');
    assert(await page.locator('.environment-summary').filter({hasText: 'Production'}).count() === 0, 'hidden environment is omitted from pipelines');
    assert(await page.getByRole('checkbox').count() === 0, 'visibility checkbox appears only in environment configuration');
    assert(await page.locator('.pipeline-row[data-pipeline-id="13"]').count() === 1, 'shared pipeline remains visible in another environment');
    await page.reload(); await ready();
    assert(await page.locator('.environment-summary').filter({hasText: 'Production'}).count() === 0, 'environment visibility persists after reopening');
    await tab('Variables');
    assert((await page.locator('#environment option').allTextContents()).includes('Production'), 'hidden pipeline environment stays available in Variables');
    await tab('Environments');
    assert(await visibility.isChecked(), 'environment configuration retains hidden setting');
    await visibility.uncheck(); await ready();
    await tab('Pipelines');
    assert(await page.locator('.environment-summary').filter({hasText: 'Production'}).count() === 1, 'unchecking visibility restores the environment');
    pipelines.splice(pipelines.findIndex(p => p.id === '14'), 1);
    await page.locator('#refresh').click(); await ready();
    await tab('Environments');
    await visibility.check(); await ready();
    await page.getByRole('checkbox', {name: 'Hide My Dev · Development from Pipelines', exact: true}).check(); await ready();
    await tab('Pipelines');
    assert((await page.locator('#content').innerText()).includes('All pipeline environments are hidden'), 'all-hidden state explains how to restore visibility');
    await tab('Environments');
    assert(await visibility.isChecked(), 'configuration remains accessible when all pipeline environments are hidden');
    assert(failures.length === 0, 'no browser runtime errors');
    return {checks, writes, browser: page.context().browser().version()};
}
