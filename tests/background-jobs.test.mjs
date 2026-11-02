import test from 'node:test';
import assert from 'node:assert/strict';
const jobs = await import('../jobs.js').catch(() => ({}));
const queue = await import('../request-queue.js').catch(() => ({}));
const storage = () => {
    const data = {};
    return {data, get:async()=>structuredClone(data),set:async values=>Object.assign(data,structuredClone(values)),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys]){delete data[key];}}};
};
const tick = () => new Promise(resolve=>setImmediate(resolve));
test('read queue runs concurrently, limits work, and shares duplicate reads', async () => {
    assert.equal(typeof queue.createReadQueue,'function');
    const enqueue=queue.createReadQueue(2),started=[],releases=[];
    const work=id=>()=>{started.push(id);return new Promise(resolve=>releases.push(()=>resolve(id)));};
    const a=enqueue('a',work('a')),duplicate=enqueue('a',work('duplicate')),b=enqueue('b',work('b')),c=enqueue('c',work('c'));
    await tick();assert.deepEqual(started,['a','b']);
    releases.shift()();await tick();assert.deepEqual(started,['a','b','c']);
    releases.forEach(done=>done());assert.deepEqual(await Promise.all([a,duplicate,b,c]),['a','a','b','c']);
});
test('accepted job completes without a connected caller and stores no payload', async () => {
    assert.equal(typeof jobs.createJobManager,'function');
    const store=storage();let finish;
    const manager=jobs.createJobManager(store,async()=>new Promise(resolve=>{finish=resolve;}));
    const pending=manager.start({id:'job1',kind:'variables',config:{profileId:'p'},payload:{value:'private-secret'}});
    await tick();assert.equal(manager.busy(),true);
    await assert.rejects(manager.start({id:'job2',kind:'variables',config:{profileId:'p'}}),/progress/);
    finish({value:'private-secret'});await pending;
    assert.equal(manager.busy(),false);
    const records=await manager.list('p');assert.equal(records[0].status,'completed');
    assert.equal(JSON.stringify(store.data).includes('private-secret'),false);
});
test('worker recovery marks interrupted jobs uncertain without replay', async () => {
    assert.equal(typeof jobs.createJobManager,'function');
    const store=storage();let release;
    const first=jobs.createJobManager(store,async()=>new Promise(resolve=>{release=resolve;}));
    const pending=first.start({id:'interrupted',kind:'pipelines',config:{profileId:'p'}});await tick();
    let calls=0;const recovered=jobs.createJobManager(store,async()=>{calls++;});
    assert.equal((await recovered.list('p'))[0].status,'unknown');assert.equal(calls,0);
    release({});await pending;
});

test('variable array responses complete without storing returned secret values',async()=>{
    const store=storage(),manager=jobs.createJobManager(store,async()=>[{name:'SECRET',value:'private-secret'}]);
    await manager.start({id:'array-response',kind:'variables',config:{profileId:'p'}});
    assert.equal((await manager.list('p'))[0].status,'completed');
    assert.equal(JSON.stringify(store.data).includes('private-secret'),false);
});
