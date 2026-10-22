import test from 'node:test';
import assert from 'node:assert/strict';
import {buildVariablePatch} from '../variables.js';

test('builds one minimal batch for edits, additions, renames, and removals', () => {
    const existing = [
        {name:'URL',value:'old',type:'string',service:'publish'},
        {name:'TOKEN',value:'masked',type:'secretString'},
        {name:'REMOVE',value:'old',type:'string'}
    ];
    const rows = [
        {originalName:'URL',name:'URL',value:'new',type:'string',service:'publish'},
        {originalName:'TOKEN',name:'TOKEN',value:'',type:'secretString',service:''},
        {originalName:'REMOVE',name:'REMOVE',remove:true},
        {name:'NEW',value:'value',type:'string',service:''},
        {originalName:'URL',name:'RENAMED',value:'new',type:'string',service:'publish'}
    ];
    assert.deepEqual(buildVariablePatch(existing,rows),[
        {name:'REMOVE',value:''},
        {name:'URL',value:'',service:'publish'},
        {name:'URL',value:'new',type:'string',service:'publish'},
        {name:'NEW',value:'value',type:'string'},
        {name:'RENAMED',value:'new',type:'string',service:'publish'}
    ]);
});
test('does not send unchanged masked secrets or unchanged values',()=>{
    assert.deepEqual(buildVariablePatch([{name:'TOKEN',value:'secret',type:'secretString'}],[{originalName:'TOKEN',name:'TOKEN',value:'',type:'secretString',service:''}]),[]);
    assert.deepEqual(buildVariablePatch([{name:'A',value:'x',type:'string'}],[{originalName:'A',name:'A',value:'x',type:'string',service:''}]),[]);
});
test('rejects invalid and duplicate names, empty additions, and unsafe secrets',()=>{
    for(const rows of [
        [{name:'1BAD',value:'x',type:'string'}],
        [{name:'DUP',value:'x',type:'string'},{name:'DUP',value:'y',type:'string'}],
        [{name:'EMPTY',value:'',type:'string'}],
        [{name:'SECRET',value:'s'.repeat(500),type:'secretString'}]
    ]) assert.throws(()=>buildVariablePatch([],rows));
});
test('rejects adding more than Adobe environment variable limit',()=>{
    const rows=Array.from({length:201},(_,index)=>({name:`VAR_${index}`,value:'x',type:'string'}));
    assert.throws(()=>buildVariablePatch([],rows),/at most 200/);
});
test('rejects changing an existing variable type in place',()=>{
    assert.throws(()=>buildVariablePatch([{name:'A',value:'x',type:'string'}],[{originalName:'A',name:'A',value:'x',type:'secretString'}]),/cannot be changed/);
});
test('requires write-only secret again when changing its service or name',()=>{
    const saved = [{name:'TOKEN',value:'masked',type:'secretString',service:'publish'}];
    assert.throws(()=>buildVariablePatch(saved,[{originalName:'TOKEN',name:'TOKEN',value:'',type:'secretString',service:'author'}]),/replacement secret/);
});
test('prevents renaming a variable onto another existing name',()=>{
    assert.throws(()=>buildVariablePatch([{name:'A',value:'a',type:'string'},{name:'B',value:'b',type:'string'}],[{originalName:'A',name:'B',value:'a',type:'string'},{originalName:'B',name:'B',value:'b',type:'string'}]),/duplicate/i);
});
test('deletes before adding a replacement name in one batch',()=>{
    assert.deepEqual(buildVariablePatch([{name:'A',value:'a',type:'string'},{name:'B',value:'b',type:'string'}],[{originalName:'A',name:'B',value:'a',type:'string'},{originalName:'B',name:'B',remove:true}]),[
        {name:'A',value:''},{name:'B',value:''},{name:'B',value:'a',type:'string'}
    ]);
});
test('orders all deletions before updates when renaming variables',()=>{
    assert.deepEqual(buildVariablePatch([{name:'A',value:'a',type:'string'},{name:'B',value:'b',type:'string'}],[{originalName:'A',name:'B',value:'a',type:'string'},{originalName:'B',name:'A',value:'b',type:'string'}]),[
        {name:'A',value:''},{name:'B',value:''},{name:'B',value:'a',type:'string'},{name:'A',value:'b',type:'string'}
    ]);
});

test('same name in different services remains independent when editing and deleting',()=>{
    const existing=[{name:'RUNMODES',service:'author',type:'string',value:'author-mode'},{name:'RUNMODES',service:'publish',type:'secretString'}];
    assert.deepEqual(buildVariablePatch(existing,[
        {originalName:'RUNMODES',originalService:'author',name:'RUNMODES',service:'author',type:'string',value:'new-mode'},
        {originalName:'RUNMODES',originalService:'publish',name:'RUNMODES',service:'publish',type:'secretString',value:''}
    ]),[{name:'RUNMODES',service:'author',type:'string',value:'new-mode'}]);
    assert.deepEqual(buildVariablePatch(existing,[
        {originalName:'RUNMODES',originalService:'author',remove:true},
        {originalName:'RUNMODES',originalService:'publish',name:'RUNMODES',service:'publish',type:'secretString',value:''}
    ]),[{name:'RUNMODES',service:'author',value:''}]);
});
test('new variables allow the same name for different services, but reject the same pair',()=>{
    const rows=['author','publish',''].map(service=>({name:'RUNMODES',service,type:'string',value:'mode'}));
    assert.equal(buildVariablePatch([],rows).length,3);
    assert.throws(()=>buildVariablePatch([], [...rows,{name:'RUNMODES',service:'author',value:'other'}]),/Duplicate variable/);
});
test('moving a variable deletes its previous service before writing its new service',()=>{
    assert.deepEqual(buildVariablePatch([{name:'RUNMODES',service:'author',type:'string',value:'old'}],[
        {originalName:'RUNMODES',originalService:'author',name:'RUNMODES',service:'publish',type:'string',value:'new'}
    ]),[{name:'RUNMODES',service:'author',value:''},{name:'RUNMODES',service:'publish',type:'string',value:'new'}]);
});

test('variable update tracks accepted, active, completed, and failed states without retaining values',async()=>{
    const {variableUpdateState,environmentBlocksStart}=await import('../variables.js');
    const pending={status:'ready',variableUpdateStatus:'updating',variableUpdateStartedAt:1000,variableUpdateObserved:false};
    assert.equal(variableUpdateState(pending,[{status:'ready'}],2000).variableUpdateStatus,'updating');
    const active=variableUpdateState(pending,[{status:'creating',value:'never-store'}],3000);
    assert.equal(active.variableUpdateObserved,true);
    assert.equal(environmentBlocksStart({...pending,...active}),true);
    assert.equal(variableUpdateState({...pending,...active},[{status:'ready'}],4000).variableUpdateStatus,null);
    assert.equal(variableUpdateState(pending,[{status:'ready'}],17000).variableUpdateStatus,null);
    assert.equal(variableUpdateState(pending,[{}],17000).variableUpdateStatus,'updating');
    assert.equal(variableUpdateState({status:'ready'},[{status:'deleted_failed'}]).variableUpdateStatus,'failed');
    assert.equal(environmentBlocksStart({status:'updating'}),true);
    assert.equal(environmentBlocksStart({status:'ready'}),false);
    assert.doesNotMatch(JSON.stringify(active),/never-store/);
});
