// All traffic is mocked. Exercise async variable updates and the execution guard.
export default async function environmentUpdateSmoke(page,files) {
    const checks=[],errors=[],calls=[];
    const check=(ok,message)=>{if(!ok)throw new Error(message);checks.push(message);};
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://environment-update.test/**',route=>{
        const name=new URL(route.request().url()).pathname.slice(1);
        return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:files[name]||''});
    });
    await page.goto('https://environment-update.test/reset');
    await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});
    await page.addInitScript(()=>{
        const local={clientId:'client',orgId:'org',programId:'1'},session=JSON.parse(sessionStorage.getItem('fixture')||'{"token":"token"}');
        const storage=data=>({get:async keys=>Object.fromEntries(keys.filter(key=>key in data).map(key=>[key,data[key]])),set:async values=>{Object.assign(data,values);sessionStorage.setItem('fixture',JSON.stringify(session));},remove:async key=>delete data[key]});
        window.chrome={storage:{local:storage(local),session:storage(session)},runtime:{openOptionsPage(){}}};window.confirm=()=>true;
    });
    const environments=[{id:'1',name:'Development',type:'dev',status:'ready'},{id:'2',name:'Production',type:'prod',status:'ready'}];
    const variables={1:[{name:'RUNMODES',service:'author',type:'string',value:'initial',status:'ready'}],2:[]};
    const pipeline={id:'10',name:'Shared pipeline',type:'CI_CD',status:'IDLE',phases:[{type:'DEPLOY',environmentId:'1'},{type:'DEPLOY',environmentId:'2'}]};
    let starts=0,patches=0,failStatus=false;
    await page.route('https://cloudmanager.adobe.io/**',async route=>{
        const request=route.request(),url=new URL(request.url()),path=url.pathname;calls.push(path);
        const send=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
        if(path.endsWith('/environments'))return send({_embedded:{environments}});
        if(path.endsWith('/pipelines'))return send({_embedded:{pipelines:[pipeline]}});
        if(path.endsWith('/variables')){
            const id=path.match(/environment\/(\d+)/)[1];
            if(request.method()==='PATCH'){
                patches++;variables[id]=request.postDataJSON().map(item=>({...item,status:'updating'}));
                return send({_embedded:{variables:variables[id]}});
            }
            return failStatus?send({message:'Status unavailable'},503):send({_embedded:{variables:variables[id]}});
        }
        if(path.endsWith('/pipeline/10'))return send(pipeline);
        if(path.endsWith('/execution')){
            if(request.method()==='PUT'){starts++;return send({});}
            return send({message:'No execution'},404);
        }
        if(path.endsWith('/executions'))return send({_embedded:{executions:[]}});
        return send({message:`Unexpected request ${path}`},404);
    });
    const ready=()=>page.waitForFunction(()=>!document.querySelector('#refresh').disabled&&!document.querySelector('[data-loading="true"]'));
    const tab=async name=>{await page.getByRole('button',{name,exact:true}).click();await ready();};
    const group=name=>page.locator('.environment-group').filter({has:page.locator('.environment-summary').filter({hasText:name})});
    await page.goto('https://environment-update.test/popup.html');await ready();
    await tab('Variables');
    check(await page.locator('.select-control > select').evaluateAll(selects=>selects.every(select=>getComputedStyle(select).appearance==='none'&&parseFloat(getComputedStyle(select).paddingRight)>=34)),'all dropdowns reserve padding for their chevrons');
    await page.locator('.variable-row > summary').first().click();
    await page.getByLabel('Value for RUNMODES').fill('new-value');
    await page.getByRole('button',{name:'Save changes'}).click();await ready();
    check(patches===1&&(await page.locator('.variable-update-notice').innerText()).includes('update in progress'),'accepted save shows variable update progress');
    check(await page.locator('.variable-update-notice > .pill').innerText()==='Updating','Variables update ribbon is capitalized');
    check(await page.locator('.variable-update-notice').evaluate(element=>parseFloat(getComputedStyle(element).marginTop)>=12),'Variables status ribbon has top spacing');
    check(await page.getByRole('button',{name:'Save changes'}).isDisabled(),'another save is blocked during environment update');
    check(await page.locator('.variable-row .pill.updating').isVisible(),'individual variable updating status is visible');
    check(!(await page.evaluate(()=>JSON.stringify(sessionStorage))).includes('new-value'),'pending update cache stores no variable values');
    await page.reload();await ready();
    await group('Development').locator(':scope > .environment-summary').click();await ready();
    check(await group('Development').getByRole('button',{name:'Start eligible pipelines'}).isDisabled(),'environment group start remains blocked after popup reopen');
    check(await group('Development').locator('.pipeline-row .action-start').isDisabled(),'single pipeline start is blocked during variable update');
    check(await group('Development').locator('.environment-update-ribbon.updating').isVisible(),'pipeline environment update includes a dedicated ribbon');
    await group('Production').locator(':scope > .environment-summary').click();await ready();
    check(await group('Production').locator('.pipeline-row .action-start').isDisabled(),'shared pipeline is blocked from its other target environment');
    failStatus=true;
    await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('could not be checked'));
    check(await group('Development').locator('.pipeline-row .action-start').isDisabled(),'failed progress polling preserves the execution block');
    failStatus=false;
    variables[1].forEach(variable=>variable.status='ready');
    await page.waitForFunction(()=>[...document.querySelectorAll('.pipeline-row .action-start')].every(button=>!button.disabled),{timeout:12000});
    check(starts===0,'polling completion never starts pipelines automatically');
    await tab('Variables');
    check((await page.locator('.variable-update-notice').innerText()).includes('Ready'),'completed variable update displays ready state');
    await tab('Pipelines');await group('Development').locator(':scope > .environment-summary').click();await ready();
    // If already open after a tab switch, leave it open.
    if(!await group('Development').evaluate(element=>element.open)){await group('Development').locator(':scope > .environment-summary').click();await ready();}
    environments[2-1].status='updating';
    await group('Development').locator('.pipeline-row .action-start').click();await ready();
    check(starts===0&&(await page.locator('.batch-results').innerText()).includes('Production'),'preflight checks every target and skips a newly updating shared environment');
    failStatus=true;
    await tab('Variables');
    check((await page.locator('#message').innerText()).includes('503'),'failed status read is reported');
    failStatus=false;
    const pipelineReads=calls.filter(path=>path.endsWith('/pipelines')).length;
    await tab('Environments');
    check(await page.locator('[data-environment-id="2"] .pill.updating').isVisible(),'opening Environments fetches latest API status');
    environments[1].status='ready';
    await tab('Pipelines');await tab('Environments');
    check(await page.locator('[data-environment-id="2"] .pill.ready').isVisible(),'reopening Environments reflects subsequent API changes');
    check(calls.filter(path=>path.endsWith('/pipelines')).length===pipelineReads,'environment tab refresh does not reload pipeline catalog');
    check(errors.length===0,`no runtime errors: ${errors.join('; ')}`);
    return {checks};
}
