// All traffic is mocked. Exercise async variable updates and the execution guard.
export default async function usabilitySmoke(page,files) {
    const checks=[],errors=[],calls=[];
    const check=(ok,message)=>{if(!ok){throw new Error(message);}checks.push(message);};
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://environment-update.test/**',route=>{
        const name=new URL(route.request().url()).pathname.slice(1);
        let contentType = 'text/html';
        if (name.endsWith('.js')) { contentType = 'text/javascript'; }
        else if (name.endsWith('.css')) { contentType = 'text/css'; }
        return route.fulfill({contentType,body:files[name]||''});
    });
    await page.goto('https://environment-update.test/reset');
    await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});
    await page.addInitScript(()=>{
        const local={clientId:'client',orgId:'org',programId:'1'},session=JSON.parse(sessionStorage.getItem('fixture')||'{"token":"token"}');
        const storage=data=>({get:async keys=>Object.fromEntries(keys.filter(key=>key in data).map(key=>[key,data[key]])),set:async values=>{Object.assign(data,values);sessionStorage.setItem('fixture',JSON.stringify(session));},remove:async key=>{delete data[key];sessionStorage.setItem('fixture',JSON.stringify(session));}});
        window.chrome={storage:{local:storage(local),session:storage(session)},runtime:{openOptionsPage(){}}};window.confirm=()=>true;
    });
    const environments=[{id:'1',name:'Development',type:'dev',status:'ready'},{id:'2',name:'Production',type:'prod',status:'ready'}];
    const variables={1:[{name:'RUNMODES',service:'author',type:'string',value:'initial',status:'ready'}],2:[]};
    const pipeline={id:'10',name:'Shared pipeline',type:'CI_CD',status:'IDLE',phases:[{type:'DEPLOY',environmentId:'1'},{type:'DEPLOY',environmentId:'2'}]};
    let failStatus=false,heldEnvironmentRead=null,variableWrites=0;
    await page.route('https://cloudmanager.adobe.io/**',async route=>{
        const request=route.request(),url=new URL(request.url()),path=url.pathname;calls.push(path);
        const send=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
        if(path.endsWith('/environments')){if(heldEnvironmentRead){await heldEnvironmentRead;}return send({_embedded:{environments}});}
        if(path.endsWith('/pipelines')){return send({_embedded:{pipelines:[pipeline]}});}
        if(path.endsWith('/variables')){
            const id=/environment\/(\d+)/.exec(path)[1];
            if(request.method()==='PATCH'){
                variableWrites++;
                variables[id]=request.postDataJSON().map(item=>({...item,status:'updating'}));
                return send({_embedded:{variables:variables[id]}});
            }
            return failStatus?send({message:'Status unavailable'},503):send({_embedded:{variables:variables[id]}});
        }
        if(path.endsWith('/pipeline/10')){return send(pipeline);}
        if(path.endsWith('/execution')){
            if(request.method()==='PUT'){return send({});}
            return send({message:'No execution'},404);
        }
        if(path.endsWith('/executions')){return send({_embedded:{executions:[]}});}
        return send({message:`Unexpected request ${path}`},404);
    });
    const ready=()=>page.waitForFunction(()=>!document.querySelector('#refresh').disabled&&!document.querySelector('[data-loading="true"]'));
    const tab=async name=>{await page.getByRole('button',{name,exact:true}).click();await ready();};
    const group=name=>page.locator('.environment-group').filter({has:page.locator('.environment-summary').filter({hasText:name})});
    await page.goto('https://environment-update.test/popup.html');await ready();
    check(!await page.locator('#cloudManagerLinks').isVisible(),'external links do not consume a header row');
    await page.getByText('Adobe links',{exact:true}).focus();await page.keyboard.press('Enter');
    check(await page.getByRole('link',{name:'Open Cloud Manager',exact:true}).isVisible(),'Adobe links open with the keyboard');
    await page.keyboard.press('Enter');
    await tab('Variables');
    check(await page.locator('.variable-columns').isVisible(),'wide editor shares column headings');
    check(await page.getByLabel('Value for RUNMODES').isVisible(),'existing variable value is visible without expansion');
    const variableRow=page.locator('.variable-row').first();
    check(await variableRow.locator('.variable-fields').evaluate(fields=>{const boxes=[...fields.children].map(field=>field.getBoundingClientRect());return boxes.every(box=>Math.abs(box.top-boxes[0].top)<1);}), 'name value and service share one row');
    await page.getByLabel('Value for RUNMODES').fill('not-exported');
    await page.getByRole('searchbox',{name:'Search variables'}).fill('no-match');
    const downloadReady=page.waitForEvent('download');
    await page.getByRole('button',{name:'Export JSON',exact:true}).click();
    const download=await downloadReady,stream=await download.createReadStream(),chunks=[];
    for await(const chunk of stream){chunks.push(chunk);}
    const exported=JSON.parse(Buffer.concat(chunks).toString());
    check(exported.variables[0].value==='initial'&&exported.variables.length===1,'download exports saved values despite drafts and filters');
    check(download.suggestedFilename()==='variables-1-1.json','download identifies program and environment');
    const upload=entries=>page.getByLabel('Import variable JSON file').setInputFiles({name:'variables.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,variables:entries}))});
    await upload([{name:'RUNMODES',type:'string',service:'author',value:'imported'}]);
    await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('Imported into draft'));
    await page.getByRole('searchbox',{name:'Search variables'}).fill('');
    check(await page.getByLabel('Value for RUNMODES').inputValue()==='imported'&&variableWrites===0,'import changes draft without saving');
    await upload([{name:'INVALID',type:'string',value:4}]);
    await page.waitForFunction(()=>document.querySelector('#message').classList.contains('error'));
    check(await page.getByLabel('Value for RUNMODES').inputValue()==='imported','invalid import preserves draft');
    await page.getByRole('button',{name:'Discard changes'}).click();await ready();
    check(await page.getByLabel('Value for RUNMODES').inputValue()==='initial','Discard restores imported edits');
    await page.evaluate(()=>{window.originalFileText=window.File.prototype.text;window.File.prototype.text=()=>new Promise(resolve=>{window.finishImport=resolve;});});
    await upload([{name:'LATE',type:'string',value:'late'}]);
    await page.waitForFunction(()=>!!window.finishImport);
    await page.locator('#environment').selectOption('2');await ready();
    await page.evaluate(()=>{window.finishImport(JSON.stringify({version:1,variables:[{name:'LATE',type:'string',value:'late'}]}));window.File.prototype.text=window.originalFileText;});
    check(await page.locator('.variable-row').count()===0,'late file read cannot import into another environment');
    await page.locator('#environment').selectOption('1');await ready();
    check(await page.locator('.variable-row').count()===1&&variableWrites===0,'cancelled import leaves original environment untouched');
    await page.getByLabel('Value for RUNMODES').fill('temporary');
    check(await variableRow.getByText('Modified',{exact:true}).isVisible(),'modified row has an explicit label');
    await variableRow.getByRole('button',{name:'Undo',exact:true}).click();
    check(await page.getByLabel('Value for RUNMODES').inputValue()==='initial','row Undo restores original value');
    await variableRow.getByRole('button',{name:'Remove RUNMODES'}).click();
    check(await variableRow.getByText('Marked for deletion').isVisible()&&await page.getByLabel('Value for RUNMODES').isDisabled(),'removal is staged visibly and disables editing');
    await variableRow.getByRole('button',{name:'Undo',exact:true}).click();
    check(await page.getByLabel('Value for RUNMODES').isEnabled()&&await page.locator('.action-save').isDisabled(),'Undo cancels staged removal');
    await page.getByLabel('Value for RUNMODES').evaluate(e=>{e.value='draft-value';e.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.getByRole('searchbox',{name:'Search variables'}).fill('no-match');
    check((await page.locator('.variable-result-status').innerText()).includes('1 pending change hidden'),'filtered pending changes remain counted');
    check(await page.getByRole('button',{name:'Save 1 change',exact:true}).isEnabled(),'hidden pending changes remain savable');
    await page.getByLabel('Filter variables by service').selectOption('author');
    await tab('Pipelines');await tab('Variables');
    check(await page.getByRole('searchbox',{name:'Search variables'}).inputValue()==='no-match'&&await page.getByLabel('Filter variables by service').inputValue()==='author','filters survive tab navigation');
    await page.getByRole('searchbox',{name:'Search variables'}).fill('');
    await tab('Pipelines');await tab('Variables');
    check(await page.getByLabel('Value for RUNMODES').inputValue()==='draft-value','unsaved values survive tab navigation');
    check((await page.locator('.variable-draft-status').innerText()).includes('1 unsaved'),'unsaved change count is visible');
    check((await page.evaluate(()=>JSON.stringify(sessionStorage))).includes('draft-value'),'draft values retained in session storage');
    await page.reload();await ready();await tab('Variables');
    check(await page.getByLabel('Value for RUNMODES').inputValue()==='draft-value','draft survives a fresh popup document');
    await page.locator('#environment').selectOption('2');await ready();
    check(await page.getByRole('searchbox',{name:'Search variables'}).inputValue()===''&&await page.getByLabel('Filter variables by service').inputValue()==='*','filters are isolated by environment');
    check(await page.locator('.variable-row').count()===0,'another environment never receives the first environment draft');
    await page.locator('#environment').selectOption('1');await ready();
    check(await page.getByLabel('Value for RUNMODES').inputValue()==='draft-value','draft survives environment selection changes');
    await page.locator('#refresh').click();await ready();
    check(await page.getByLabel('Value for RUNMODES').inputValue()==='draft-value','explicit refresh preserves unsaved changes');
    await page.getByRole('button',{name:'Discard changes'}).click();
    await ready();
    check(await page.getByLabel('Value for RUNMODES').inputValue()==='initial','explicit discard restores server value');
    await page.reload();await ready();await tab('Variables');
    check(await page.getByLabel('Value for RUNMODES').inputValue()==='initial','discard remains effective after reopening');
    check(await page.locator('.variable-row').evaluate(e=>e.getBoundingClientRect().height)<160,'inline variable row is compact');
    await page.getByRole('searchbox',{name:'Search variables'}).fill('no-match');
    check(await page.locator('.variable-row:visible').count()===0,'search filters variable rows');
    await page.getByRole('button',{name:'Add variable'}).click();
    check(await page.locator('.variable-row').first().getByLabel('Name',{exact:true}).evaluate(input=>document.activeElement===input),'new rows stay visible through filters and focus name');
    await page.locator('.variable-row').first().getByRole('button',{name:'Remove draft'}).click();
    await page.getByRole('searchbox',{name:'Search variables'}).fill('');
    for(const width of [600,380]){
        await page.setViewportSize({width,height:720}); // NOSONAR: Each assertion must use its own viewport.
        check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`inline editor fits ${width}px without horizontal overflow`);
        check(await page.locator('.variable-columns').isVisible()===(width>420),`variable headings adapt at ${width}px`); // NOSONAR: Check the viewport before changing it.
    }
    await page.setViewportSize({width:800,height:900});
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
    const environmentLink=page.locator('.card[data-environment-id="1"] > .line > strong > a');
    check(await environmentLink.innerText()==='Development'&&(await environmentLink.getAttribute('href')).endsWith('/environment/1'),'environment name links directly to its Adobe page');
    check(await page.getByRole('link',{name:'Environment details',exact:true}).count()===0,'environment cards omit the separate details link');
    await page.getByLabel('Alias for Development').fill('DEV');
    await page.getByRole('button',{name:'Save alias'}).first().click();await ready();
    check(calls.length===afterRead,'saving alias makes no API requests');
    check(await environmentLink.innerText()==='DEV · Development','clickable environment name reflects saved alias');
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
    variables[1].push(...Array.from({length:199},(_,i)=>({name:`EXTRA_${i}`,service:'author',type:'string',value:'initial',status:'ready'})));
    await tab('Variables');
    await page.locator('#content').evaluate(content=>{content.scrollTop=content.scrollHeight;});
    check(await page.locator('.variable-actions').evaluate(actions=>{const a=actions.getBoundingClientRect(),c=document.querySelector('#content').getBoundingClientRect();return a.top>=c.top&&a.bottom<=c.bottom;}),'Save and Discard remain visible at the bottom of a long list');
    await page.locator('#content').evaluate(content=>{content.scrollTop=0;});
    const typing=await page.evaluate(()=>{
        const input=document.querySelector('textarea');
        const descriptor=Object.getOwnPropertyDescriptor(window.Element.prototype,'scrollHeight');
        let measurements=0;
        Object.defineProperty(window.Element.prototype,'scrollHeight',{configurable:true,get(){measurements++;return descriptor.get.call(this);}});
        try{
            input.value='fast draft';input.dispatchEvent(new Event('input',{bubbles:true}));
            return {measurements,rows:document.querySelectorAll('.variable-row').length,modified:document.querySelectorAll('.has-changes').length};
        }finally{Object.defineProperty(window.Element.prototype,'scrollHeight',descriptor);}
    });
    check(typing.rows===200&&typing.measurements===1&&typing.modified===1,'typing with 200 variables measures only the edited textarea');
    await page.reload();await ready();await tab('Variables');
    check(await page.getByLabel('Value for RUNMODES').inputValue()==='fast draft','optimized typing still retains draft immediately across reopening');
    check(errors.length===0,`no runtime errors: ${errors.join('; ')}`);return {checks};
}
