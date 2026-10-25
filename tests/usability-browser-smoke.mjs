// All traffic is mocked. Exercise async variable updates and the execution guard.
export default async function usabilitySmoke(page,files) {
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
    let failStatus=false,heldEnvironmentRead=null;
    await page.route('https://cloudmanager.adobe.io/**',async route=>{
        const request=route.request(),url=new URL(request.url()),path=url.pathname;calls.push(path);
        const send=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
        if(path.endsWith('/environments')){if(heldEnvironmentRead)await heldEnvironmentRead;return send({_embedded:{environments}});}
        if(path.endsWith('/pipelines'))return send({_embedded:{pipelines:[pipeline]}});
        if(path.endsWith('/variables')){
            const id=path.match(/environment\/(\d+)/)[1];
            if(request.method()==='PATCH'){
                variables[id]=request.postDataJSON().map(item=>({...item,status:'updating'}));
                return send({_embedded:{variables:variables[id]}});
            }
            return failStatus?send({message:'Status unavailable'},503):send({_embedded:{variables:variables[id]}});
        }
        if(path.endsWith('/pipeline/10'))return send(pipeline);
        if(path.endsWith('/execution')){
            if(request.method()==='PUT'){return send({});}
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
    await page.getByLabel('Value for RUNMODES').evaluate(e=>{e.value='draft-value';e.dispatchEvent(new Event('input',{bubbles:true}));});
    await tab('Pipelines');await tab('Variables');
    check(await page.getByLabel('Value for RUNMODES').inputValue()==='draft-value','unsaved values survive tab navigation');
    check((await page.locator('.variable-draft-status').innerText()).includes('1 unsaved'),'unsaved change count is visible');
    check(!(await page.evaluate(()=>JSON.stringify(sessionStorage))).includes('draft-value'),'draft values never enter session storage');
    await page.locator('#environment').selectOption('2');await ready();
    check(await page.locator('.variable-row').count()===0,'another environment never receives the first environment draft');
    await page.locator('#environment').selectOption('1');await ready();
    check(await page.getByLabel('Value for RUNMODES').inputValue()==='draft-value','draft survives environment selection changes');
    await page.locator('#refresh').click();await ready();
    check(await page.getByLabel('Value for RUNMODES').inputValue()==='draft-value','explicit refresh preserves unsaved changes');
    await page.getByRole('button',{name:'Discard changes'}).click();
    check(await page.getByLabel('Value for RUNMODES').inputValue()==='initial','explicit discard restores server value');
    check(await page.locator('.variable-row').evaluate(e=>e.getBoundingClientRect().height)<160,'closed variable row is compact');
    await page.getByRole('searchbox',{name:'Search variables'}).fill('no-match');
    check(await page.locator('.variable-row:visible').count()===0,'search filters variable rows');
    await tab('Pipelines');
    check(await group('Development').getByRole('button',{name:'Start eligible pipelines'}).isVisible(),'environment actions remain visible when collapsed');
    let release;heldEnvironmentRead=new Promise(resolve=>release=resolve);
    const beforeExpansion=calls.filter(path=>path.endsWith('/environments')).length;
    await page.locator('.environment-summary').evaluateAll(headers=>headers.forEach(header=>header.click()));
    await page.waitForFunction(()=>document.querySelectorAll('[data-loading="true"]').length===2);
    await page.waitForTimeout(100);
    check(calls.filter(path=>path.endsWith('/environments')).length===beforeExpansion+1,'overlapping expansions share one environment list request');
    release();heldEnvironmentRead=null;await ready();
    const before=calls.length;await tab('Environments');const afterRead=calls.length;
    await page.getByLabel('Alias for Development').fill('DEV');
    await page.getByRole('button',{name:'Save alias'}).first().click();await ready();
    check(calls.length===afterRead,'saving alias makes no API requests');
    check(afterRead>before,'environment tab still refreshes status');
    heldEnvironmentRead=new Promise(resolve=>release=resolve);
    await page.getByRole('button',{name:'Variables',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#refresh').disabled);
    check(await page.getByRole('button',{name:'Pipelines',exact:true}).isEnabled(),'tabs remain available during a slow API read');
    check(await page.locator('#viewLoader').isVisible()&&(await page.locator('#viewLoader').innerText()).includes('variables'),'environment-to-variables transition shows its loader');
    check(!await page.locator('#content').isVisible(),'previous environment screen is hidden while loading variables');
    await page.getByRole('button',{name:'Pipelines',exact:true}).click();
    release();heldEnvironmentRead=null;await ready();
    check(await page.locator('.environment-group').count()===2&&await page.locator('.variable-row').count()===0,'navigation cancels obsolete reads without painting the wrong view');
    await tab('Variables');
    heldEnvironmentRead=new Promise(resolve=>release=resolve);
    await page.getByRole('button',{name:'Environments',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#refresh').disabled);
    check(await page.locator('#viewLoader').isVisible()&&(await page.locator('#viewLoader').innerText()).includes('environments'),'variables-to-environments transition shows its loader');
    check(!await page.locator('#content').isVisible(),'previous variable screen is hidden while loading environments');
    release();heldEnvironmentRead=null;await ready();
    check(!await page.locator('#viewLoader').isVisible()&&await page.locator('#content').isVisible(),'successful read replaces loader with the new screen');
    failStatus=true;await tab('Variables');
    check(!await page.locator('#viewLoader').isVisible(),'failed read clears the loader');
    check(await page.locator('#content').evaluate(e=>e.inert),'failed view read keeps retained content noninteractive');
    failStatus=false;await tab('Environments');
    check(!await page.locator('#content').evaluate(e=>e.inert),'successful navigation restores interaction after read failure');
    check(errors.length===0,`no runtime errors: ${errors.join('; ')}`);return {checks};
}
