import test from 'node:test';
import assert from 'node:assert/strict';
import * as variables from '../variables.js';
const saved=[{name:'URL',service:'author',type:'string',value:'saved'},{name:'TOKEN',type:'secretString',value:'hidden'}];
const rows=()=>saved.map(v=>({originalName:v.name,originalService:v.service||'',...v,service:v.service||'',value:v.type==='secretString'?'':v.value,remove:false}));
const file=entries=>JSON.stringify({version:1,variables:entries});

test('export whitelists saved fields and omits secret values',()=>{
    const exported=variables.exportVariables(saved);
    assert.deepEqual(exported,{version:1,variables:[{name:'URL',type:'string',service:'author',value:'saved'},{name:'TOKEN',type:'secretString',service:''}]});
    assert.deepEqual(variables.mergeVariableImport(JSON.stringify(exported),saved,rows()),rows());
});
test('import merges by name and service without mutating drafts or deleting unrelated rows',()=>{
    const draft=rows();draft[0].value='draft';draft[1].value='replacement';
    const result=variables.mergeVariableImport(file([{name:'URL',type:'string',service:'author',value:'imported'},{name:'URL',type:'string',service:'publish',value:'new'},{name:'TOKEN',type:'secretString'}]),saved,draft);
    assert.equal(result[0].value,'imported');assert.equal(result[1].value,'replacement');assert.equal(result[2].service,'publish');
    assert.equal(draft[0].value,'draft');assert.equal(result.some(row=>row.remove),false);
});
test('new missing secret stages an incomplete row and Save still rejects it',()=>{
    const result=variables.mergeVariableImport(file([{name:'NEW_SECRET',type:'secretString'}]),[],[]);
    assert.equal(result[0].value,'');assert.throws(()=>variables.buildVariablePatch([],result),/Enter a value/);
});
test('invalid import leaves input unchanged',()=>{
    const entry={name:'URL',type:'string',service:'author',value:'value'};
    const draft=rows(),before=structuredClone(draft);
    for(const text of ['bad', '{}', JSON.stringify({version:2,variables:[]}),file([null]),file([entry,entry]),file([{...entry,name:'1BAD'}]),file([{...entry,service:'other'}]),file([{...entry,type:'other'}]),file([{...entry,value:12}]),file([{...entry,value:''}]),file([{...entry,type:'secretString'}]),file([{name:'S',type:'secretString',value:'s'.repeat(500)}])]){
        assert.throws(()=>variables.mergeVariableImport(text,saved,draft));assert.deepEqual(draft,before);
    }
});
test('import enforces merged count and refuses ambiguous draft matches',()=>{
    const entries=Array.from({length:200},(_,i)=>({name:`V_${i}`,type:'string',value:'x'}));
    assert.throws(()=>variables.mergeVariableImport(file(entries),saved,rows()),/200/);
    const draft=rows();draft.push({...draft[0]});
    assert.throws(()=>variables.mergeVariableImport(file([{name:'URL',service:'author',type:'string',value:'x'}]),saved,draft),/Duplicate/);
});
test('import restores matching removal and rejects a renamed row type change',()=>{
    const draft=rows();draft[0].remove=true;
    assert.equal(variables.mergeVariableImport(file([{name:'URL',service:'author',type:'string',value:'x'}]),saved,draft)[0].remove,false);
    draft[0].name='RENAMED';draft[0].remove=false;
    assert.throws(()=>variables.mergeVariableImport(file([{name:'RENAMED',service:'author',type:'secretString',value:'x'}]),saved,draft),/type/);
});
