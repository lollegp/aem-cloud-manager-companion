import test from 'node:test';
import assert from 'node:assert/strict';
const model = await import('../pipeline.js').catch(() => ({}));
const cancel = 'http://ns.adobe.com/adobecloud/rel/pipeline/cancel';
const advance = 'http://ns.adobe.com/adobecloud/rel/pipeline/advance';
const step = (action, status = 'RUNNING') => ({action, status, _links: {[cancel]: {href: '/api/program/1/pipeline/2/execution/3/cancel'}, [advance]: {href: '/api/program/1/pipeline/2/execution/3/advance'}}});

test('groups deployment targets once each, normalizes IDs, retains pipelines without targets', () => {
    assert.equal(typeof model.groupPipelines, 'function');
    const shared = {id: 'p', phases: [{type: 'DEPLOY', environmentId: 1}, {type: 'DEPLOY', environmentId: '1'}, {type: 'DEPLOY', environmentId: '2'}]};
    const groups = model.groupPipelines([shared, {id: 'quality', phases: [{type: 'BUILD'}]}], [{id: '1', name: 'Dev'}, {id: '2', name: 'Prod'}]);
    assert.deepEqual(groups.map(g => [g.id, g.pipelines.map(p => p.id)]), [['1', ['p']], ['2', ['p']], ['', ['quality']]]);
});
test('retains unknown environment IDs without inventing a target', () => {
    assert.equal(typeof model.groupPipelines, 'function');
    assert.equal(model.groupPipelines([{id: 'p', phases: [{type: 'DEPLOY', environmentId: '99'}]}], [])[0].name, 'Environment 99');
});
test('aliases have separate keys for organization, program and environment', () => {
    assert.equal(typeof model.aliasKey, 'function');
    const keys = [model.aliasKey('a', '1', '2'), model.aliasKey('b', '1', '2'), model.aliasKey('a', '2', '2')];
    assert.equal(new Set(keys).size, 3);
});
test('pipeline icons distinguish all four types; unknown types remain unknown', () => {
    assert.equal(typeof model.pipelineKind, 'function');
    const kinds = ['fullstack', 'dispatcher', 'frontend', 'config'].map(buildType => model.pipelineKind({buildType}));
    assert.deepEqual(kinds.map(k => k.label), ['Full-Stack', 'WebTier', 'FE', 'CDN Config']);
    assert.equal(new Set(kinds.map(k => k.icon)).size, 4);
    assert.equal(model.pipelineKind({type: 'CI_CD'}).label, 'Full-Stack');
    assert.equal(model.pipelineKind({phases: [{type: 'BUILD', name: 'build', steps: [{action: 'build', type: 'frontend'}]}]}).label, 'FE');
});
test('prefills plain variable values, including zero; never prefills secrets', () => {
    assert.equal(typeof model.variableEditValue, 'function');
    assert.equal(model.variableEditValue({type: 'string', value: 'existing'}), 'existing');
    assert.equal(model.variableEditValue({value: 0}), '0');
    assert.equal(model.variableEditValue({type: 'secretString', value: 'masked'}), '');
});
for (const [action, status, body, suffix] of [
    ['build', 'RUNNING', {cancel: true}, 'cancel'],
    ['approval', 'WAITING', {approved: false}, 'cancel'],
    ['codeQuality', 'WAITING', {override: false}, 'cancel'],
    ['schedule', 'WAITING', {cancel: true}, 'cancel'],
    ['managed', 'WAITING', {start: false}, 'cancel'],
    ['deploy', 'WAITING', {resume: false}, 'advance']
]) test(`stop payload for ${status} ${action}`, () => {
    assert.equal(typeof model.stopAction, 'function');
    const result = model.stopAction(step(action, status));
    assert.deepEqual(result.body, body);
    assert.ok(result.path.endsWith('/' + suffix));
});
test('only active, advertised, trusted step actions can be stopped', () => {
    assert.equal(typeof model.stopAction, 'function');
    assert.equal(model.stopAction({action: 'build', status: 'RUNNING'}), null);
    assert.equal(model.stopAction(step('build', 'FINISHED')), null);
    assert.throws(() => model.stopAction({...step('build'), _links: {[cancel]: {href: 'https://evil.example/api/cancel'}}}), /Untrusted/);
});
test('batch deduplicates pipelines, continues after failure and reports each outcome', async () => {
    assert.equal(typeof model.runPipelineBatch, 'function');
    const calls = [];
    const results = await model.runPipelineBatch([{id: 1}, {id: '1'}, {id: 2}, {id: 3}], async p => {
        calls.push(p.id);
        if (p.id === 2) throw new Error('Denied');
        return p.id === 3 ? 'Skipped: already running' : 'Started';
    });
    assert.deepEqual(calls, [1, 2, 3]);
    assert.deepEqual(results.map(r => [r.ok, r.message]), [[true, 'Started'], [false, 'Denied'], [true, 'Skipped: already running']]);
});
test('waiting pipelines remain eligible for group stop', () => {
    assert.equal(typeof model.canStopPipeline, 'function');
    assert.equal(model.canStopPipeline({status: 'BUSY'}), true);
    assert.equal(model.canStopPipeline({status: 'WAITING'}), true);
    assert.equal(model.canStopPipeline({status: 'IDLE'}), false);
});
test('recognizes API step options and ignores former manual type overrides', () => {
    assert.equal(model.pipelineKind({phases: [{steps: [{name: 'build', options: {buildType: 'frontend'}}]}]}).label, 'FE');
    assert.equal(model.pipelineKind({buildType: 'frontend'}, 'config').label, 'FE');
    assert.equal(model.pipelineKind({}, 'dispatcher').label, 'Type unavailable');
});

test('type ribbons recognize API type fields and specialized build options', () => {
    for (const [type, label] of [['FULL_STACK', 'Full-Stack'], ['FRONT_END', 'FE'], ['WEB_TIER', 'WebTier'], ['CDN_CONFIG', 'CDN Config']]) {
        assert.equal(model.pipelineKind({type}).label, label);
        assert.equal(model.pipelineKind({type: 'CI_CD', phases: [{type: 'BUILD', steps: [{options: {type}}]}]}).label, label);
    }
    assert.equal(model.pipelineKind({phases: [{buildEnvironment: 'java', steps: [{options: {type: 'WEB_TIER'}}]}]}).label, 'WebTier');
});


test('environment accordions sort pipelines by type, then name', () => {
    const pipelines = [
        {id: '1', name: 'CDN', buildType: 'config'},
        {id: '2', name: 'Web', buildType: 'dispatcher'},
        {id: '3', name: 'Zeta FE', buildType: 'frontend'},
        {id: '4', name: 'Application', type: 'CI_CD'},
        {id: '5', name: 'Alpha FE', buildType: 'frontend'},
        {id: '6', name: 'Unknown'}
    ].map(p => ({...p, phases: [{type: 'DEPLOY', environmentId: '1'}]}));
    const group = model.groupPipelines(pipelines, [{id: '1', name: 'Dev'}])[0];
    assert.deepEqual(group.pipelines.map(p => p.id), ['4','5','3','2','1','6']);
    assert.deepEqual(pipelines.map(p => p.id), ['1','2','3','4','5','6']);
});

test('custom environment order precedes new environments and keeps unassigned group last', () => {
    const envs = [{id:'1', name:'Alpha'}, {id:'2', name:'Beta'}, {id:'3', name:'Gamma'}];
    const pipelines = envs.map(env => ({id: env.id, phases:[{type:'DEPLOY', environmentId:env.id}]}));
    pipelines.push({id:'none'});
    assert.deepEqual(model.groupPipelines(pipelines, envs, ['2','1']).map(g => g.id), ['2','1','3','']);
    assert.deepEqual(model.orderEnvironments(envs, ['2','missing','1']).map(e => e.id), ['2','1','3']);
    assert.deepEqual(envs.map(e => e.id), ['1','2','3']);
});

test('execution pill labels distinguish actual run outcomes from pipeline idle/busy states', () => {
    const labels = {FINISHED:'Success',ERROR:'Failed',FAILED:'Failed',RUNNING:'Running',CANCELLED:'Cancelled',CANCELLING:'Cancelling',NOT_STARTED:'Pending',WAITING:'Waiting'};
    for (const [status,label] of Object.entries(labels)) assert.equal(model.executionStatusLabel({status}),label);
    assert.equal(model.executionStatusLabel({status:'IDLE'}),'Unknown');
    assert.equal(model.executionStatusLabel({status:'BUSY'}),'Unknown');
});
test('only active executions derive waiting labels from their waiting steps', () => {
    const execution = {status:'RUNNING',_embedded:{stepStates:[{status:'WAITING',action:'approval'}]}};
    assert.equal(model.executionStatusLabel(execution),'Waiting');
    assert.equal(model.executionStatusLabel({...execution,status:'FINISHED'}),'Success');
    assert.equal(model.executionStatusLabel({...execution,_embedded:{stepStates:[{status:'WAITING',action:'schedule'}]}}),'Waiting');
});

test('production pipeline header shows Waiting for a live approval even while API says BUSY', () => {
    const execution = {status:'RUNNING',_embedded:{stepStates:[{action:'approval',status:'WAITING'}]}};
    assert.equal(model.pipelineStatusLabel({status:'BUSY'},execution,true),'Waiting');
    assert.equal(model.pipelineStatusLabel({status:'BUSY'},execution,false),'Running');
    assert.equal(model.pipelineStatusLabel({status:'BUSY'},{status:'FINISHED',_embedded:execution._embedded},true),'Running');
    assert.equal(model.pipelineStatusLabel({status:'IDLE'},null,true),'Idle');
});
