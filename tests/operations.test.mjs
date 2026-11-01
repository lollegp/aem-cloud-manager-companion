import test from 'node:test';
import assert from 'node:assert/strict';
const operations = await import('../operations.js').catch(()=>({}));
const pipeline=id=>({id,status:'BUSY',phases:[{type:'DEPLOY',environmentId:'prod'}]});
const job={kind:'pipelines',config:{programId:'1'},payload:{action:'reject',environmentId:'prod',pipelines:[pipeline('1'),pipeline('2')],executions:{1:'run',2:'run'}}};
function fixture({changed=false}={}) {
    const puts=[],reads=[];
    const request=async(path,method='GET')=>{
        reads.push(path);
        if(method==='PUT'){puts.push(path);return {};}
        if(path.endsWith('/environments'))return {_embedded:{environments:[{id:'prod',type:'prod',status:'ready'}]}};
        const id=path.split('/pipeline/')[1]?.split('/')[0];
        if(path.endsWith('/execution'))return {id:'run'};
        if(path.endsWith('/execution/run'))return {id:changed?'changed':'run',_embedded:{stepStates:[{status:'WAITING',action:'approval',_links:{'http://ns.adobe.com/adobecloud/rel/pipeline/cancel':{href:`/api/program/1/pipeline/${id}/execution/run/cancel`}}}]}};
        return pipeline(id);
    };
    return {request,puts,reads};
}
test('worker rejects all candidates and shares environment validation', async()=>{
    assert.equal(typeof operations.executeOperation,'function');
    const f=fixture();const results=await operations.executeOperation(job,f.request);
    assert.equal(results.length,2);assert.equal(f.puts.length,2);
    assert.equal(f.reads.filter(path=>path.endsWith('/environments')).length,1);
});
test('changed execution never receives an approval mutation',async()=>{
    assert.equal(typeof operations.executeOperation,'function');
    const f=fixture({changed:true});await operations.executeOperation(job,f.request);assert.equal(f.puts.length,0);
});
test('nonproduction group cannot reject deployments',async()=>{
    assert.equal(typeof operations.executeOperation,'function');
    const f=fixture();await assert.rejects(operations.executeOperation({...job,payload:{...job.payload,environmentId:'dev'}},f.request),/production/i);assert.equal(f.puts.length,0);
});

test('preflight stops at declared total despite a stale next link',async()=>{
    const f=fixture();let pages=0;
    const send=async(path,...args)=>{
        if(path.endsWith('/environments')){pages++;return {_totalNumberOfItems:1,_embedded:{environments:[{id:'prod',type:'prod',status:'ready'}]},_links:{next:{href:'/api/program/1/environments?start=1'}}};}
        if(path.includes('?start='))throw Error('must not fetch stale next page');
        return f.request(path,...args);
    };
    await operations.executeOperation(job,send);assert.equal(pages,1);assert.equal(f.puts.length,2);
});
