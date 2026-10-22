const BASE='https://cloudmanager.adobe.io';
// Temporary, opt-in diagnostics. Never log headers, bodies, or provider error text.
let debugSequence = 0;
function debugEnabled() {
    try { return globalThis.sessionStorage?.getItem('cmApiDebug') === '1'; }
    catch { return false; }
}
function debugURL(value) {
    if (!value) return undefined;
    try {
        const url = new URL(value, BASE);
        if (url.origin !== BASE) return '[external URL omitted]';
        for (const key of [...url.searchParams.keys()]) {
            if (!['start', 'limit', 'page', 'size'].includes(key) || !/^\d+$/.test(url.searchParams.get(key))) {
                url.searchParams.set(key, '[redacted]');
            }
        }
        return url.pathname + url.search;
    } catch { return '[invalid URL omitted]'; }
}
function debugResponse(data) {
    const collections = {};
    for (const key of ['pipelines', 'environments', 'executions', 'variables']) {
        const values = data?._embedded?.[key];
        if (Array.isArray(values)) collections[key] = {count: values.length,
            ...(key === 'variables' ? {} : {ids: values.map(item => item.id)})};
    }
    return {
        _totalNumberOfItems: Number.isInteger(data?._totalNumberOfItems) ? data._totalNumberOfItems : undefined,
        _page: Object.fromEntries(['start', 'limit', 'next', 'prev'].filter(key => Number.isInteger(data?._page?.[key])).map(key => [key, data._page[key]])),
        _links: {self: debugURL(link(data, 'self')), next: debugURL(link(data, 'next'))},
        collections
    };
}
export function abortable(promise, signal) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, {once: true});
        Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}
export async function settings(signal = AbortSignal.timeout(10000)) {
    const local = await abortable(chrome.storage.local.get(['clientId','orgId','programId','oauthScopes']), signal);
    const session = await abortable(chrome.storage.session.get(['token','tokenClientId','tokenOrgId','tokenExpiresAt']), signal);
    return {...local, ...session};
}
export function pathFor(programId,rest=''){return `/api/program/${encodeURIComponent(programId)}${rest}`;}
async function renewToken(config, rejectedToken, signal) {
    const response = await abortable(chrome.runtime.sendMessage({type: 'credentials', action: 'ensureToken',
        config: Object.fromEntries(['clientId', 'orgId', 'programId', 'oauthScopes'].map(key => [key, config[key] || ''])), rejectedToken}), signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000));
    if (!response?.ok || !response.data?.token) throw new Error(response?.error || 'Automatic token renewal failed. Check Settings.');
    return response.data.token;
}

export async function request(path, method = 'GET', data, {signal,expectedConfig} = {}) {
    try {
        return await performRequest(path,method,data,signal,expectedConfig);
    } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
            throw new Error('Cloud Manager request timed out after 30 seconds. Check your connection and refresh. If you submitted a change, check its state before retrying.');
        }
        throw error;
    }
}

async function performRequest(path,method,data,signal,expectedConfig) {
    signal?.throwIfAborted();
    const url = new URL(path, BASE);
    if (url.origin !== BASE || !url.pathname.startsWith('/api/')) throw new Error('Unexpected API URL.');
    const config = await abortable(settings(), signal);
    const assertConfig = current => {
        if (expectedConfig && ['clientId','orgId','programId','oauthScopes'].some(key => String(current[key] || '') !== String(expectedConfig[key] || ''))) {
            throw new Error('Connection settings changed. Refresh before running an action.');
        }
    };
    assertConfig(config);
    const {clientId, orgId, tokenClientId, tokenOrgId, tokenExpiresAt} = config;
    if (tokenClientId && tokenClientId !== clientId) throw new Error('Client ID changed. Generate a new access token in Settings.');
    if (tokenOrgId && tokenOrgId !== orgId) throw new Error('Organization ID changed. Generate a new access token in Settings.');
    if (!clientId || !orgId) throw new Error('Configure Client ID and Organization ID in Settings.');
    let token = config.token;
    if (!token || (tokenExpiresAt && Date.now() >= tokenExpiresAt - 30000)) token = await renewToken(config, undefined, signal);
    const send = async () => {
        signal?.throwIfAborted();
        if (expectedConfig) assertConfig(await abortable(settings(),signal));
        signal?.throwIfAborted();
        const headers = {'Authorization': `Bearer ${token}`, 'x-api-key': clientId, 'x-gw-ims-org-id': orgId, 'Accept': 'application/json'};
        if (data !== undefined) headers['Content-Type'] = 'application/json';
        const debug = debugEnabled(), requestId = ++debugSequence, started = Date.now();
        if (debug) console.info('[CM API] request', {requestId, method, url: debugURL(url), body: data === undefined ? undefined : '[omitted]'});
        try {
            const response = await fetch(url, {method, headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000), redirect: 'error', credentials: 'omit', cache: 'no-store', body: data === undefined ? undefined : JSON.stringify(data)});
            const raw = await response.text();
            let result;
            try { result = raw ? JSON.parse(raw) : {}; } catch { result = {message: raw}; }
            if (debug) console.info('[CM API] response', {requestId, status: response.status, elapsedMs: Date.now() - started, ...debugResponse(result)});
            return {response, result};
        } catch (error) {
            if (debug) console.info('[CM API] failed', {requestId, elapsedMs: Date.now() - started, reason: signal?.aborted ? 'refresh aborted' : 'network, timeout, or response read failure'});
            throw error;
        }
    };
    let {response, result} = await send();
    if (response.status === 401) {
        token = await renewToken(config, token, signal);
        // Reads can be replayed once. Mutations need another explicit action so
        // renewal cannot accidentally duplicate a deployment or variable update.
        if (!['GET', 'HEAD'].includes(method.toUpperCase())) throw new Error('Access token renewed. Please retry the action. It was not automatically replayed.');
        ({response, result} = await send());
    }
    if (!response.ok) throw new Error(`${response.status} ${result?.detail || result?.message || result?.title || response.statusText}`);
    return result;
}

export function embedded(o,k){return o?._embedded?.[k]||[];}
export function link(o,rel){const v=o?._links?.[rel];return typeof v==='string'?v:v?.href;}
export const rel=(name)=>`http://ns.adobe.com/adobecloud/rel/${name}`;
export function safeAPIPath(url){if(!url)return null;const p=new URL(url,BASE);if(p.origin!==BASE||!p.pathname.startsWith('/api/'))throw new Error('Untrusted API link.');return p.pathname+p.search;}
