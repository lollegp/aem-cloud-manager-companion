// Deferred mocked responses verify per-card progress and independent rendering.
export default async function cardLoadingBrowserSmoke(page, files) {
    const checks = [], errors = [];
    const check = (ok,name) => { if(!ok) throw new Error(name); checks.push(name); };
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://card-loading.test/**',route=>{
        const name = new URL(route.request().url()).pathname.slice(1);
        return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:files[name]||''});
    });
    await page.addInitScript(()=>{
        const session = {token:'token'};
        window.chrome = {storage:{
            local:{get:async()=>({clientId:'client',orgId:'org',programId:'1'})},
            session:{get:async keys=>Object.fromEntries(keys.filter(key=>key in session).map(key=>[key,session[key]])),set:async values=>Object.assign(session,values)}
        },runtime:{openOptionsPage(){}}};
    });
    let finishFast, finishSlow, finishHistory, finishSecondHistory, finishMutation, historyCalls = 0;
    const fast = new Promise(resolve=>{finishFast=resolve;});
    const slow = new Promise(resolve=>{finishSlow=resolve;});
    const history = new Promise(resolve=>{finishHistory=resolve;});
    const secondHistory = new Promise(resolve=>{finishSecondHistory=resolve;});
    const mutation = new Promise(resolve=>{finishMutation=resolve;});
    const pipeline = id=>({id,name:`Pipeline ${id}`,type:'CI_CD',status:'IDLE',phases:[{type:'DEPLOY',environmentId:id === '3' ? '2' : '1'}]});
    await page.route('https://cloudmanager.adobe.io/**',async route=>{
        const path = new URL(route.request().url()).pathname;
        const send = (data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
        if(route.request().method() !== 'GET') {await mutation;return send({});}
        if(path.endsWith('/environments')) return send({_embedded:{environments:[{id:'1',name:'Development',type:'dev'},{id:'2',name:'Other',type:'dev'}]}});
        if(path.endsWith('/pipelines')) return send({_embedded:{pipelines:[pipeline('1'),pipeline('2'),pipeline('3')]}});
        if(path.endsWith('/pipeline/1/execution')) {await fast;return send({id:'run1',status:'FINISHED',_embedded:{stepStates:[]}});}
        if(path.endsWith('/pipeline/2/execution')) {await slow;return send({message:'Temporarily unavailable'},503);}
        if(path.endsWith('/pipeline/3/execution')) return send({id:'run3',status:'FINISHED',_embedded:{stepStates:[]}});
        if(path.endsWith('/executions')) {
            historyCalls++;
            if(historyCalls === 1) {await history;return send({_totalNumberOfItems:2,_embedded:{executions:[{id:'old',status:'FINISHED'}]},_links:{next:{href:path+'?start=1&limit=20'}}});}
            await secondHistory;return send({message:'History temporarily unavailable'},503);
        }
        return send(pipeline(path.split('/').at(-1)));
    });
    try {
        await page.goto('https://card-loading.test/popup.html');
        await page.waitForFunction(()=>!document.getElementById('refresh').disabled);
        await page.locator('.environment-summary').first().click();
        const first = page.locator('.pipeline-row[data-pipeline-id="1"]');
        const second = page.locator('.pipeline-row[data-pipeline-id="2"]');
        check(await first.getAttribute('aria-busy') === 'true' && await second.getAttribute('aria-busy') === 'true','each in-flight pipeline card is marked busy');
        check(await first.locator('.card-loader').isVisible() && await second.locator('.card-loader').isVisible(),'each in-flight pipeline card has a visible loader');
        await second.evaluate(el=>{window.slowCard=el;});
        finishFast();
        await page.waitForFunction(()=>document.querySelector('.pipeline-row[data-pipeline-id="1"]').getAttribute('aria-busy') === 'false');
        check((await first.locator('.execution-status').innerText()).includes('Success'),'completed card updates its status immediately');
        check(await second.getAttribute('aria-busy') === 'true','slow card keeps loading after another card completes');
        check(await second.evaluate(el=>el === window.slowCard),'another card response does not rebuild the pending card');
        finishSlow();
        await page.waitForFunction(()=>!document.querySelector('[data-loading="true"]'));
        check(await second.getAttribute('aria-busy') === 'false' && !(await second.locator('.card-loader').isVisible()),'failed API request clears its card loader');
        check((await second.innerText()).includes('Execution refresh failed'),'failed card retains an actionable error');
        await first.locator('.pipeline-history > summary').click();
        await page.waitForFunction(()=>document.querySelector('.pipeline-row[data-pipeline-id="1"]').getAttribute('aria-busy') === 'true');
        check(await first.getAttribute('aria-busy') === 'true' && await first.locator('.card-loader').isVisible(),'explicit history read also marks only its own card busy');
        check(await second.getAttribute('aria-busy') === 'false','history read does not mark another card busy');
        finishHistory();
        await page.waitForFunction(()=>document.querySelector('.pipeline-row[data-pipeline-id="1"]').getAttribute('aria-busy') === 'false');
        check(await first.locator('.history-entry').count() === 1,'history renders before its card loader clears');
        const panel = first.locator('.pipeline-history');
        await panel.getByRole('button',{name:'Load more',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('.pipeline-row[data-pipeline-id="1"] .history-list').getAttribute('aria-busy') === 'true');
        await page.locator('.environment-summary').filter({hasText:'Other'}).click();
        await page.waitForFunction(()=>!document.querySelector('[data-loading="true"]'));
        await page.evaluate(()=>{window.confirm=()=>true;});
        await page.locator('.pipeline-row[data-pipeline-id="3"]').getByRole('button',{name:'▶ Start',exact:true}).click();
        await page.waitForFunction(()=>document.getElementById('refresh').disabled);
        check(await page.locator('.pipeline-row[data-pipeline-id="3"]').getAttribute('aria-busy') === 'true','pipeline mutation and revalidation also show a card loader');
        finishSecondHistory();
        await page.waitForFunction(()=>document.querySelector('.pipeline-row[data-pipeline-id="1"] .history-list').textContent.includes('Retry history'));
        finishMutation();
        await page.waitForFunction(()=>!document.getElementById('refresh').disabled && !document.querySelector('[data-loading="true"]'));
        check(await panel.getByRole('button',{name:'Retry history',exact:true}).isEnabled(),'history finishing during another card action does not leave retry disabled');
        check(await first.getAttribute('aria-busy') === 'false','history error clears its card loader independently of another action');
        check(errors.length === 0,'no browser runtime errors');
        return {checks};
    } finally {finishFast();finishSlow();finishHistory();finishSecondHistory();finishMutation();}
}
