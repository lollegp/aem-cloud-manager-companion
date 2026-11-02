// Use an isolated persistent Chromium context with the unpacked extension loaded.
// The worker fetch stub never contacts Adobe; do not use a personal profile.
import assert from 'node:assert/strict';
export default async function backgroundWorkerSmoke(context) {
 await context.setOffline(true);
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const waitWorker=async predicate=>{for(let i=0;i<200;i++){if(await worker.evaluate(predicate)){return;}await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Worker condition timed out: '+predicate);};const origin=worker.url().replace(/\/background\.js$/,''); // NOSONAR: These steps share mutable browser state and must run in order.
 await worker.evaluate(()=>{
  globalThis.fixture={reads:[],writes:[],completedWrites:0,active:0,max:0,gate:false,releases:[],pipelineGate:false};
  const pipelines=['1','2'].map(id=>({id,name:'Pipeline '+id,status:'BUSY',type:'CI_CD',phases:[{type:'DEPLOY',environmentId:'prod'}]}));
  globalThis.fetch=async(url,options={})=>{
   const p=new URL(url).pathname,method=options.method||'GET',f=globalThis.fixture;
   f.active++;f.max=Math.max(f.max,f.active);
   try{
    if(method!=='GET'){
     f.writes.push({path:p,method,body:options.body,time:Date.now()});
     await new Promise(resolve=>setTimeout(resolve,400));f.completedWrites++;
     return new globalThis.Response(JSON.stringify(p.endsWith('/variables')?[{name:'PRIVATE',value:'never-store-this'}]:{}),{status:200});
    }
    f.reads.push(p);
    if((f.gate&&p.endsWith('/variables'))||(f.pipelineGate&&/\/pipeline\/[12]$/.test(p))){await new Promise(resolve=>f.releases.push(resolve));}
    await new Promise(resolve=>setTimeout(resolve,40));
    let data={};
    if(p.endsWith('/environments')){data={_embedded:{environments:[{id:'prod',name:'Production',type:'prod',status:'ready'}]}};}
    else if(p.endsWith('/pipelines')){data={_embedded:{pipelines}};}
    else if(p.endsWith('/variables')){data={_embedded:{variables:[{name:'MODE',value:'old',type:'string',status:'ready'}]}};}
    else if(/\/pipeline\/[12]$/.test(p)){data=pipelines.find(item=>p.endsWith('/'+item.id));}
    else if(p.endsWith('/execution')||p.endsWith('/execution/run')){const id=p.split('/pipeline/')[1].split('/')[0];data={id:'run',status:'WAITING',_embedded:{stepStates:[{action:'approval',status:'WAITING',_links:{'http://ns.adobe.com/adobecloud/rel/pipeline/cancel':{href:`/api/program/1/pipeline/${id}/execution/run/cancel`}}}]}};}
    else if(p.endsWith('/executions')){data={_embedded:{executions:[]}};}
    return new globalThis.Response(JSON.stringify(data),{status:200});
   }finally{f.active--;}
  };
 });
 const settings=await context.newPage();await settings.goto(origin+'/options.html');await settings.waitForFunction(()=>!document.querySelector('#connect').disabled);
 await settings.evaluate(async()=>{
  const call=async(action,extra={})=>{const r=await chrome.runtime.sendMessage({type:'credentials',action,...extra});if(!r.ok){throw new Error(r.error);}return r.data;};
  const profileId=(await call('listProfiles')).activeProfileId;
  await call('saveManual',{profileId,config:{profileId,clientId:'fixture',orgId:'org',programId:'1',oauthScopes:''},token:'fixture-token'});
 });
 let popup=await context.newPage();popup.on('dialog',dialog=>dialog.accept());await popup.goto(origin+'/popup.html');
 await popup.locator('.environment-summary').waitFor();await popup.locator('.environment-summary').click();
 await popup.waitForFunction(()=>document.querySelector('.group-heading .action-reject')&&!document.querySelector('.group-heading .action-reject').disabled);
 assert.ok(await worker.evaluate(()=>globalThis.fixture.max>=2),'independent reads overlap');
 await worker.evaluate(()=>{globalThis.fixture.pipelineGate=true;});
 await popup.locator('.group-heading .action-reject').click();
 await waitWorker(()=>globalThis.fixture.releases.length===2);
 const blocked=await settings.evaluate(()=>chrome.runtime.sendMessage({type:'credentials',action:'addProfile',name:'Must be blocked'}));assert.equal(blocked.ok,false);
 await popup.close();
 await worker.evaluate(()=>{globalThis.fixture.pipelineGate=false;globalThis.fixture.releases.splice(0).forEach(resolve=>resolve());});
 await waitWorker(()=>globalThis.fixture.completedWrites===2);
 const writes=await worker.evaluate(()=>globalThis.fixture.writes);assert.equal(writes.length,2);assert.ok(Math.abs(writes[0].time-writes[1].time)<250,'rejections sent concurrently');
 popup=await context.newPage();await popup.goto(origin+'/popup.html');await popup.locator('#backgroundActions').waitFor();await popup.waitForFunction(()=>document.querySelector('#backgroundActions').textContent.includes('Completed'));
 assert.equal(await worker.evaluate(()=>globalThis.fixture.writes.length),2,'reopening does not replay');
 console.log('PASS actual MV3 parallel reads, parallel rejection, close during preflight, continued mutations, profile lock, reopen result and no replay');
 // A read whose caller disappears still finishes inside the worker.
 await worker.evaluate(()=>{globalThis.fixture.gate=true;});
 await popup.evaluate(()=>{void chrome.runtime.sendMessage({type:'api',path:'/api/program/1/environment/prod/variables',method:'GET'});});
 await waitWorker(()=>globalThis.fixture.releases.length===1);await popup.close();
 await worker.evaluate(()=>{globalThis.fixture.gate=false;globalThis.fixture.releases.splice(0).forEach(resolve=>resolve());});
 await waitWorker(()=>globalThis.fixture.active===0);console.log('PASS accepted read finishes after popup closure');
 // Variable response arrays must finish; values must not enter the job journal.
 popup=await context.newPage();await popup.goto(origin+'/popup.html');await popup.locator('[data-tab="variables"]').click();
 await popup.locator('.variable-row input').first().waitFor();
 const variableStart=await popup.evaluate(async()=>{
  const {settings}=await import('./api.js');const config=await settings();delete config.token;
  void chrome.runtime.sendMessage({type:'operation',job:{id:'fixture-variable-job',kind:'variables',config,payload:{environmentId:'prod',patch:[{name:'PRIVATE',type:'secretString',value:'never-store-this'}]}}});
  return true;
 });assert.equal(variableStart,true);
 await waitWorker(()=>globalThis.fixture.writes.length===3);await popup.close();
 await waitWorker(async()=>((await chrome.storage.session.get('backgroundJob:fixture-variable-job'))['backgroundJob:fixture-variable-job'])?.status==='completed');
 const session=await worker.evaluate(()=>chrome.storage.session.get(null));assert.ok(!JSON.stringify(session).includes('never-store-this'));
 assert.ok(Object.keys(session).some(key=>key.includes('variablePending:')));
 console.log('PASS variable save completes after close, array response accepted, secret values never persisted');

}
