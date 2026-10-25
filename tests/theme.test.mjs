import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../theme.js', import.meta.url), 'utf8');
function fixture(saved, {failSave = false, failLoad = false} = {}) {
    const listeners = {}, changes = [], root = {dataset: {}}, feedback = {textContent: ''};
    const select = {value: '', disabled: false, addEventListener: (name, listener) => {listeners[name] = listener;}};
    let storageChanged;
    const context = {
        document: {documentElement: root, readyState: 'complete', getElementById: id => id === 'themePreference' ? select : id === 'themeFeedback' ? feedback : null},
        chrome: {storage: {
            local: {get: async () => {if(failLoad)throw new Error('Unavailable');return {appearanceTheme: saved};}, set: async value => {if(failSave)throw new Error('Unavailable');changes.push(value);}},
            onChanged: {addListener: listener => {storageChanged = listener;}}
        }}
    };
    vm.runInNewContext(source, context);
    return {root, select, feedback, changes, settle: async () => {await Promise.resolve();await Promise.resolve();},
        change: value => {select.value = value;return listeners.change();},
        external: value => storageChanged({appearanceTheme: {newValue: value}}, 'local')};
}

test('new profiles and invalid settings inherit the computer theme', async () => {
    for(const value of [undefined, 'invalid', null]){
        const f = fixture(value);await f.settle();
        assert.equal(f.root.dataset.theme, 'system');assert.equal(f.select.value, 'system');
    }
});
test('explicit modes restore without changing any connection settings', async () => {
    for(const value of ['light', 'dark']){
        const f = fixture(value);await f.settle();
        assert.equal(f.root.dataset.theme, value);assert.equal(f.select.value, value);assert.equal(f.changes.length, 0);
    }
});
test('changing the selection applies immediately and stores only appearance', async () => {
    const f = fixture('system');await f.settle();
    await f.change('light');assert.equal(f.root.dataset.theme, 'light');
    assert.equal(JSON.stringify(f.changes), '[{"appearanceTheme":"light"}]');
    await f.change('system');assert.equal(f.root.dataset.theme, 'system');
});
test('other open extension pages follow storage changes and reset', async () => {
    const f = fixture('dark');await f.settle();
    f.external('light');assert.equal(f.root.dataset.theme, 'light');
    f.external(undefined);assert.equal(f.root.dataset.theme, 'system');
});
test('failed writes restore the previous selection and show an error', async () => {
    const f = fixture('dark', {failSave: true});await f.settle();await f.change('light');
    assert.equal(f.root.dataset.theme, 'dark');assert.equal(f.select.value, 'dark');
    assert.equal(f.select.disabled, false);assert.match(f.feedback.textContent, /could not be saved/i);
});
test('failed storage reads keep the system fallback usable', async () => {
    const f = fixture(undefined, {failLoad: true});await f.settle();
    assert.equal(f.root.dataset.theme, 'system');assert.equal(f.select.disabled, false);
});
