import {createCredentialController} from './credentials.js';

const run = createCredentialController(chrome.storage);
const initialize = () => { void run({action: 'status'}).catch(() => {}); };
chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'credentials') return false;
    const settingsPage = sender.url === chrome.runtime.getURL('options.html');
    const popupRenewal = sender.url === chrome.runtime.getURL('popup.html') && message.action === 'ensureToken';
    if (sender.id !== chrome.runtime.id || (!settingsPage && !popupRenewal)) {
        sendResponse({ok: false, error: 'This page cannot perform the requested credential operation.'});
        return false;
    }
    run(message).then(data => sendResponse({ok: true, data}), error => sendResponse({ok: false, error: error.message || 'Credential operation failed.'}));
    return true;
});
