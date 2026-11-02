import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudManagerLink} from '../cloud-manager-links.js';

test('Cloud Manager links preserve organization, program and exact target IDs', () => {
    const previous = globalThis.document;
    globalThis.document = {createElement: tag => ({tagName:tag})};
    try {
        const config = {orgId:'example@AdobeOrg',programId:'123'};
        const base = 'https://experience.adobe.com/#/@example@AdobeOrg/cloud-manager';
        for (const [target, path] of [
            [{}, '/home.html/program/123'],
            [{section:'environments'}, '/environments.html/program/123'],
            [{environmentId:'456'}, '/environments.html/program/123/environment/456'],
            [{pipelineId:'789',executionId:'100'}, '/pipelineexecution.html/program/123/pipeline/789/execution/100']
        ]) {
            const anchor = cloudManagerLink(config,'Open target',target);
            assert.equal(anchor.href,base + path);
            assert.equal(anchor.textContent,'Open target');
            assert.equal(anchor.target,'_blank');
            assert.equal(anchor.rel,'noopener noreferrer');
            assert.match(anchor.title,/opens in a new tab/);
        }
        const other = cloudManagerLink({orgId:'other@AdobeOrg',programId:'999'},'Open',{environmentId:'a/b?#'});
        assert.equal(other.href,'https://experience.adobe.com/#/@other@AdobeOrg/cloud-manager/environments.html/program/999/environment/a%2Fb%3F%23');
        assert.equal(cloudManagerLink({programId:1},'Open').href,'https://experience.adobe.com/#/cloud-manager/home.html/program/1');
    } finally {
        if (previous === undefined) {delete globalThis.document;} else {globalThis.document = previous;}
    }
});
