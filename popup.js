import {submitOperation,pendingVariableState} from './operations.js';
import {profileCommand, fillProfileSelect, PROFILE_KEY, profilePrefix, saveProfilePreference} from './profiles.js';
import {loadSnapshot, saveSnapshot, snapshotKey, projectPipeline, projectExecution} from './cache.js';
import {historyPanel} from './history.js';
import {cloudManagerLink} from './cloud-manager-links.js';
import {request, settings, abortable, pathFor, embedded, link, safeAPIPath, usesBackground} from './api.js';
import {buildVariablePatch, variableUpdateState, environmentBlocksStart, exportVariables, mergeVariableImport, variableDraftKey, loadVariableDraft, saveVariableDraft} from './variables.js';
import {aliasKey, environmentIds, groupPipelines, pipelineKind, stopAction, canStopPipeline, approvalAction, orderEnvironments, executionStatusLabel, pipelineStatusLabel} from './pipeline.js';

const $ = id => document.getElementById(id);
document.body.classList.toggle('extension-popup',location.protocol==='chrome-extension:');
let backgroundPending = false, backgroundStatusTimer, backgroundRefreshNeeded = false;
let tab = 'pipelines', environments = [], pipelines = [], selectedEnvironment = '';
let aliases = {}, connection = {}, busy = false, switchingProfile = false, initializingProfiles = true, pendingProfileNavigation = false;
let historyController = new AbortController();
let environmentOrder = [];
let hiddenEnvironments = new Set();
const expandedEnvironments = new Set();
let environmentPollTimer, environmentPollController;
let activeRead = null, navigationId = 0, environmentRead = null, environmentReadRevision = 0;
const variableDrafts = new Map();
const variableFilters = new Map();
let catalogUpdatedAt = 0, snapshotIdentity = '', viewGeneration = 0;
let executionRecords = Object.create(null), cacheWarning = false, connectionChanged = false;
const groupViews = new Map(), pipelineReads = new Map(), activePipelineActions = new Set();
const node = (tag, text = '', className = '') => {
    const n = document.createElement(tag);
    n.textContent = String(text ?? '');
    if (className) {n.className = className;}
    return n;
};

function btn(text, fn, className = '') {
    const b = node('button', text, className);
    b.addEventListener('click', () => { Promise.resolve().then(fn).catch(error); });
    return b;
}

function actionIcon(kind) {
    const shapes = {start:'m8 4 12 8-12 8Z',stop:'M6 6h12v12H6Z',approve:'m5 12 4 4L19 6',reject:'m6 6 12 12M18 6 6 18',add:'M12 5v14M5 12h14',save:'M5 3h12l4 4v14H3V3Zm2 0v7h10V3M7 21v-7h10v7',remove:'M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14M10 11v6m4-6v6',edit:'m4 16 12-12 4 4L8 20H4Zm10-10 4 4'};
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('action-icon');
    const path = document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',shapes[kind]);svg.append(path);
    return svg;
}

function actionButton(text, fn, kind, className = '') {
    const button = btn(text,fn,`${className} icon-button action-${kind}`.trim());
    button.replaceChildren(actionIcon(kind),node('span',text));
    return button;
}

function typeRibbon(kind) {
    const badge = node('span', '', `pipeline-kind ${kind.className}`);
    const shapes = {
        fullstack: 'M2 5 12 1l10 4-10 4L2 5Zm0 7 10 4 10-4M2 19l10 4 10-4',
        webtier: 'M3 3h18v7H3zM3 14h18v7H3zM6 6h1M6 17h1M11 6h7M11 17h7',
        frontend: 'm8 5-7 7 7 7m8-14 7 7-7 7m-3-17-2 20',
        cdn: 'M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-2 6 6 0 0 1 1 12H6Zm2-5h8m-4-4v8',
        unknown: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-2 5c3-2 6 2 2 4v2m0 3v1'
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', shapes[kind.className] || shapes.unknown);
    svg.append(path);
    badge.append(svg, node('span', kind.label));
    return badge;
}

function line() {
    return node('div', '', 'line');
}

function setMessage(msg, err = false) {
    $('message').textContent = msg;
    $('message').className = `section ${err ? 'error' : 'muted'}`;
    $('message').setAttribute('role',err?'alert':'status');
}

function error(e) {
    setMessage(e.message || String(e), true);
}

function restoreControl(control, disabled) {
    if (!control.isConnected) {return;}
    if (connectionChanged && $('content').contains(control)) {control.disabled = true;}
    else {
        const history = control.closest('.history-list');
        control.disabled = history ? history.getAttribute('aria-busy') === 'true' : disabled;
    }
}

function finishReadView(completed) {
    $('viewLoader').hidden=true;
    if(!completed){$('content').replaceChildren(node('p','This view could not be loaded. Click Refresh to retry, or choose another tab.','empty'));}
    $('content').hidden=false;$('content').inert=!completed;$('content').setAttribute('aria-busy','false');
}

async function run(fn, reading = false) {
    if (busy || (backgroundPending && !reading)) {return false;}
    environmentPollController?.abort();
    busy = true;
    const controls = [...document.querySelectorAll(reading ? '#content button, #content input, #content textarea, #content select, #refresh' : 'button:not(#settings), input, textarea, select')];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    let completed=false;
    if(reading){
        $('content').inert=true;$('content').hidden=true;$('content').setAttribute('aria-busy','true');
        $('viewLoaderLabel').textContent=`Loading ${tab}…`;
        $('viewLoader').hidden=false;
        $('environment').classList.toggle('hidden',tab!=='variables');
    }
    try {
        setMessage('Loading...');
        const result = await fn();
        if (result !== false) {setMessage('Updated just now');}
        completed=true;
        return true;
    } catch (e) {
        if (!reading || !historyController.signal.aborted) {error(e);}
        return false;
    } finally {
        busy = false;
        if(reading){
            finishReadView(completed);
        }
        controls.forEach((control,index) => restoreControl(control,disabled[index]));
        if (!connectionChanged) {syncEnvironmentIndicators();}
        if(usesBackground()){void refreshBackgroundStatus();}
        if(backgroundRefreshNeeded && !initializingProfiles){backgroundRefreshNeeded=false;queueMicrotask(()=>navigate(true));}
        if(pendingProfileNavigation){pendingProfileNavigation=false;queueMicrotask(()=>navigate());}
    }
}

async function navigate(force = false) {
    if (busy && !activeRead) {return;}
    const id = ++navigationId;
    if (activeRead) {
        historyController.abort();
        await activeRead;
    }
    if (id !== navigationId) {return;}
    const pending = run(() => refresh(force), true);
    activeRead = pending;
    try { await pending; }
    finally { if (activeRead === pending) {activeRead = null;} }
}

async function updateLocalPreferences() {
    await loadEnvironmentPreferences(connection.programId, historyController.signal);
    $('content').replaceChildren();
    renderEnvironments();
    setMessage('Preferences saved in this browser');
    return false;
}

function pill(s) {
    return node('span', s || 'UNKNOWN', `pill ${String(s || '').toLowerCase()}`);
}

function variableStatusRibbon(status) {
    const ribbon=pill(status);
    ribbon.textContent=String(status).replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase());
    return ribbon;
}

function executionRibbon(execution, stale = false, historical = false) {
    const label = executionStatusLabel(execution);
    const status = pill(execution.status);
    status.classList.add('execution-status');
    if (label.startsWith('Waiting')) {
        status.classList.remove('running');
        status.classList.add('waiting');
    }
    status.textContent = stale || historical ? `${stale ? 'Last observed' : 'Last execution'} · ${label}` : label;
    const approval = (execution._embedded?.stepStates || []).some(step => step.status === 'WAITING' && step.action === 'approval');
    status.title = `Adobe execution status: ${execution.status || 'UNKNOWN'}${approval && label === 'Waiting' ? ' · Approval or rejection required' : ''}`;
    return status;
}

function card(title, status) {
    const c = node('div', '', 'card'), h = line();
    h.append(node('strong', title), pill(status));
    c.append(h);
    return c;
}

function confirmAction(message) {
    return window.confirm(message);
}

function environmentLabel(env) {
    const alias = aliases[profilePrefix(connection.profileId)+aliasKey(connection.orgId, connection.programId, env.id)];
    return alias ? `${alias} · ${env.name || env.id}` : (env.name || `Environment ${env.id}`);
}

function environmentOrderKey() {
    return `${profilePrefix(connection.profileId)}environmentOrder:${JSON.stringify([String(connection.orgId), String(connection.programId)])}`;
}

function hiddenEnvironmentsKey() {
    return `${profilePrefix(connection.profileId)}hiddenPipelineEnvironments:${JSON.stringify([String(connection.orgId), String(connection.programId)])}`;
}

function environmentOrderControls(env) {
    const controls = node('div', '', 'actions environment-order');
    const index = environments.findIndex(item => String(item.id) === String(env.id));
    for (const [offset, label] of [[-1, '↑ Move up'], [1, '↓ Move down']]) {
        const button = btn(label, () => run(async () => {
            const ids = environments.map(item => String(item.id));
            const target = index + offset;
            if (index < 0 || target < 0 || target >= ids.length) {return;}
            [ids[index], ids[target]] = [ids[target], ids[index]];
            await saveProfilePreference(connection,environmentOrderKey(),ids);
            await updateLocalPreferences();
        }));
        button.setAttribute('aria-label', `${label.slice(2)} environment ${environmentLabel(env)}`);
        button.disabled = index < 0 || index + offset < 0 || index + offset >= environments.length;
        controls.append(button);
    }
    return controls;
}

function appendUniquePage(items, page, seenIds) {
    for (const item of page) {
        const id = item.id == null ? null : String(item.id);
        if (id !== null && seenIds.has(id)) {continue;}
        if (id !== null) {seenIds.add(id);}
        items.push(item);
    }
}

async function listAll(path, key, signal, quiet = false) {
    const items = [], visited = new Set(), seenIds = new Set();
    while (path) {
        if (visited.has(path)) {throw new Error('Repeated API pagination link.');}
        visited.add(path);
        signal?.throwIfAborted();
        if(!quiet){setMessage(`Loading ${key}, page ${visited.size}...`);}
        const data = await request(path, 'GET', undefined, {signal});
        signal?.throwIfAborted();
        const page = embedded(data, key);
        // Some responses retain a next link beyond the last result page.
        if (!page.length) {break;}
        const previousCount = items.length;
        appendUniquePage(items, page, seenIds);
        const total = data._totalNumberOfItems;
        if (Number.isInteger(total) && total >= 0 && items.length >= total) {break;}
        if (items.length === previousCount) {
            throw new Error(`Invalid ${key} pagination: page ${visited.size} returned no new records. Refresh to retry.`);
        }
        path = safeAPIPath(link(data, 'next'));
    }
    return items;
}

async function loadEnvironmentPreferences(programId, signal) {
    const keys = environments.map(env => profilePrefix(connection.profileId)+aliasKey(connection.orgId, programId, env.id));
    keys.push(environmentOrderKey(), hiddenEnvironmentsKey());
    aliases = await abortable(chrome.storage.local.get(keys), signal);
    environmentOrder = Array.isArray(aliases[environmentOrderKey()]) ? aliases[environmentOrderKey()] : [];
    hiddenEnvironments = new Set((Array.isArray(aliases[hiddenEnvironmentsKey()]) ? aliases[hiddenEnvironmentsKey()] : []).map(String));
    environments = orderEnvironments(environments, environmentOrder);
    const sel = $('environment');
    sel.replaceChildren();
    for (const env of environments) {
        const option = node('option', environmentLabel(env));
        option.value = String(env.id);
        sel.append(option);
    }
    selectedEnvironment = environments.some(env => String(env.id) === selectedEnvironment)
        ? selectedEnvironment : String(environments[0]?.id || '');
    sel.value = selectedEnvironment;
    sel.classList.toggle('hidden', tab !== 'variables' || !environments.length);
}

async function parallelReads(items, read) {
    let cursor = 0;
    const results = await Promise.allSettled(Array.from({length:Math.min(4,items.length)},async () => {
        while (cursor < items.length) {await read(items[cursor++]);} // NOSONAR: Each worker must finish its item to enforce the concurrency limit.
    }));
    // Wait for every reader before callers restore previous state after failure.
    const failure = results.find(result => result.status === 'rejected');
    if (failure) {throw failure.reason;}
}

async function loadPipelines(programId, signal) {
    const fresh = await listAll(pathFor(programId, '/pipelines'), 'pipelines', signal);
    // List responses may omit phases. Resolve details before assigning a group.
    await parallelReads(fresh, async pipeline => {
        if (!Array.isArray(pipeline.phases) || pipelineKind(pipeline).className === 'unknown') {
            try {
                setMessage(`Loading details for pipeline ${pipeline.name || pipeline.id}...`);
                const details = await request(pathFor(programId, `/pipeline/${encodeURIComponent(pipeline.id)}`), 'GET', undefined, {signal});
                signal.throwIfAborted();
                Object.assign(pipeline, details);
            } catch (e) {
                if (signal?.aborted) {throw signal.reason;}
                pipeline.detailsError = e.message;
            }
        }
    });
    signal.throwIfAborted();
    pipelines = fresh;
}

function mergeEnvironmentList(fresh) {
    environments = fresh.map(environment => {
        const previous = environments.find(item => String(item.id) === String(environment.id));
        return {...environment,variableUpdateStatus:previous?.variableUpdateStatus,
            variableUpdateObserved:previous?.variableUpdateObserved,variableUpdateStartedAt:previous?.variableUpdateStartedAt};
    });
}

async function refreshEnvironmentList(signal, config = connection, share = false) {
    if(!share){
        ++environmentReadRevision;
        const fresh=await listAll(pathFor(config.programId,'/environments'),'environments',signal,true);
        signal.throwIfAborted();
        mergeEnvironmentList(fresh);
        return;
    }
    const key = snapshotKey(config), generation = viewGeneration;
    if (environmentRead?.key !== key || environmentRead.generation !== generation) {
        const sharedSignal = AbortSignal.any([historyController.signal, AbortSignal.timeout(30000)]);
        const revision=++environmentReadRevision;
        const entry = {key, generation};
        entry.promise = listAll(pathFor(config.programId,'/environments'),'environments',sharedSignal,true).then(fresh => {
            sharedSignal.throwIfAborted();
            if (generation === viewGeneration && revision===environmentReadRevision) {mergeEnvironmentList(fresh);}
        }).finally(() => { if (environmentRead === entry) {environmentRead = null;} });
        environmentRead = entry;
    }
    await abortable(environmentRead.promise,signal);
    signal.throwIfAborted();
}

async function readVariableStatus(id, signal, config = connection) {
    const data = await request(pathFor(config.programId,`/environment/${encodeURIComponent(id)}/variables`),'GET',undefined,{signal,expectedConfig:config});
    signal.throwIfAborted();
    const environment = environments.find(item => String(item.id) === String(id));
    if (!environment) {throw new Error('Environment no longer available. Refresh before continuing.');}
    const variables = embedded(data,'variables');
    if(usesBackground() && environment.variableUpdateStatus!=='updating'){Object.assign(environment,await pendingVariableState(config,id));}
    Object.assign(environment,variableUpdateState(environment,variables));
    return variables;
}

function pipelineEnvironmentBlocked(pipeline) {
    if(!pipeline){return false;}
    return environmentIds(pipeline).some(id => environmentBlocksStart(environments.find(env => String(env.id) === id)));
}

function syncEnvironmentIndicators() {
    for (const state of groupViews.values()) {
        state.group.environment = environments.find(env => String(env.id) === state.group.id);
        updateGroupActions(state);
        for (const [id,card] of state.rows || []) {
            const start = card.querySelector('.action-start');
            if (start) {start.disabled = busy || backgroundPending || !!state.loading || pipelineEnvironmentBlocked(pipelines.find(pipeline=>String(pipeline.id)===id));}
            const approve=card.querySelector('.action-approve');
            if(approve){approve.disabled=busy || backgroundPending || !!state.loading || pipelineEnvironmentBlocked(pipelines.find(pipeline=>String(pipeline.id)===id));}
        }
    }
    for (const card of $('content').querySelectorAll('[data-environment-id]')) {
        const env = environments.find(item=>String(item.id)===card.dataset.environmentId);
        if(!env){continue;}
        const status = env.variableUpdateStatus || env.status;
        const badge = card.querySelector(':scope > .line > .pill');
        badge.replaceWith(pill(status));
    }
}

function scheduleEnvironmentPoll() {
    clearTimeout(environmentPollTimer);
    if (connectionChanged || !environments.some(env => env.variableUpdateStatus === 'updating' || String(env.status).toLowerCase() === 'updating')) {return;}
    const generation = viewGeneration, config = connection;
    environmentPollTimer = setTimeout(async () => {
        if (generation !== viewGeneration || connectionChanged) {return;}
        if (busy) {scheduleEnvironmentPoll();return;}
        environmentPollController=new AbortController();
        const signal = AbortSignal.any([historyController.signal,environmentPollController.signal,AbortSignal.timeout(30000)]);
        try {
            const pending = environments.filter(env=>env.variableUpdateStatus === 'updating' || String(env.status).toLowerCase() === 'updating').map(env=>String(env.id));
            await refreshEnvironmentList(signal,config);
            const variables=new Map();
            await parallelReads(pending, async id => variables.set(id,await readVariableStatus(id,signal,config)));
            signal.throwIfAborted();
            syncEnvironmentIndicators();
            await persistSnapshot(signal);
            if (tab === 'variables' && pending.includes(selectedEnvironment)) {
                await renderVariables(config.programId,signal,variables.get(selectedEnvironment));
                setMessage(environments.find(env=>String(env.id)===selectedEnvironment)?.variableUpdateStatus === 'updating'?'Variable update in progress. Pipeline starts are blocked.':'Environment status refreshed.');
            }
        } catch (error) {
            if (!signal.aborted) {setMessage(`Environment status could not be checked: ${error.message}. Pipeline starts stay blocked until verified.`,true);}
        } finally {if (generation === viewGeneration && !connectionChanged) {scheduleEnvironmentPoll();}}
    },5000);
}

async function persistSnapshot(signal) {
    signal?.throwIfAborted();
    try {
        await saveSnapshot(connection, {updatedAt:catalogUpdatedAt,environments,pipelines,executions:executionRecords},signal);
        cacheWarning = false;
    } catch {
        if (signal?.aborted) {throw signal.reason;}
        // Cache failure must not prevent the live view from working.
        cacheWarning = true;
    }
}

async function refresh(force = false) {
    clearTimeout(environmentPollTimer);
    historyController.abort();
    historyController = new AbortController();
    viewGeneration++;
    const signal = AbortSignal.any([AbortSignal.timeout(45000),historyController.signal]);
    try { return await refreshView(signal, force); }
    catch (error) {
        if (signal.aborted && signal.reason?.name !== 'TimeoutError') {throw new Error('Connection or view changed. Click Refresh to load the current configuration.', {cause: error});}
        if (signal.aborted) {throw new Error(`Refresh stopped after 45 seconds. Last step: ${$('message').textContent} Check Settings or retry Refresh.`, {cause: error});}
        throw error;
    }
    finally {if(!connectionChanged&&!historyController.signal.aborted){scheduleEnvironmentPoll();}}
}

async function refreshCatalog(s, signal) {
    // Keep the last known catalog if either list request fails.
    const previousEnvironments = environments, previousPipelines = pipelines, previousUpdatedAt = catalogUpdatedAt;
    const catalogStartedAt=Date.now();
    try {
        await parallelReads([
            () => refreshEnvironmentList(signal,s),
            () => loadPipelines(s.programId,signal)
        ], read => read());
        catalogUpdatedAt = catalogStartedAt;
        const liveIds = new Set(pipelines.map(p => String(p.id)));
        executionRecords = Object.fromEntries(Object.entries(executionRecords).filter(([id]) => liveIds.has(id)));
        await persistSnapshot(signal);
    } catch (error) {
        environments = previousEnvironments; pipelines = previousPipelines; catalogUpdatedAt = previousUpdatedAt;
        throw error;
    }
}

async function refreshView(signal, force) {
    pipelineReads.clear();
    groupViews.clear();
    setMessage('Loading connection settings...');
    const s = await abortable(settings(), signal);
    signal.throwIfAborted();
    const identity = snapshotKey(s);
    if (identity !== snapshotIdentity) {
        environments = []; pipelines = []; executionRecords = Object.create(null);
        expandedEnvironments.clear(); selectedEnvironment = ''; aliases = {}; catalogUpdatedAt = 0;
        $('environment').replaceChildren();
    }
    snapshotIdentity = identity;
    connection = s;
    $('cloudManagerLinks').replaceChildren();
    if (s.programId) {$('cloudManagerLinks').append(cloudManagerLink(s,'Open Cloud Manager'),cloudManagerLink(s,'Open environments',{section:'environments'}));}
    if(s.profileId){$('programProfile').value=s.profileId;}
    connectionChanged = false;
    $('environment').classList.toggle('hidden', tab !== 'variables' || !environments.length);
    $('programLabel').textContent=s.profileName || (s.programId ? `Program ${s.programId}` : 'Configure connection to begin');
    if (!s.programId) {
        $('content').replaceChildren(node('h2','Connect your first program'),node('p', 'Add your Adobe credentials and program ID to get started.'),btn('Open Settings',()=>chrome.runtime.openOptionsPage(),'primary'));
        return;
    }
    $('programLabel').textContent = (s.profileName ? s.profileName + ' · ' : '') + `Program ${s.programId}`;
    if (!catalogUpdatedAt && !force) {
        const cached = await loadSnapshot(s, signal);
        if (cached?.updatedAt) {
            environments = cached.environments; pipelines = cached.pipelines;
            executionRecords = Object.assign(Object.create(null),cached.executions);
            catalogUpdatedAt = cached.updatedAt;
        }
    }
    const reloadCatalog = force || !catalogUpdatedAt;
    if (reloadCatalog) {
        await refreshCatalog(s, signal);
    }
    if (!reloadCatalog && ['environments','variables'].includes(tab)) {
        await refreshEnvironmentList(signal,s);
        await persistSnapshot(signal);
    }
    return renderCurrentView(s, signal, force, reloadCatalog);
}

async function renderCurrentView(s, signal, force, reloadCatalog) {
    if(tab==='environments') {
        await parallelReads(environments.filter(env=>env.variableUpdateStatus), environment => readVariableStatus(environment.id,signal,s));
        await persistSnapshot(signal);
    }
    await loadEnvironmentPreferences(s.programId, signal);
    signal.throwIfAborted();
    if (tab !== 'variables') {$('content').replaceChildren();}
    if (tab === 'pipelines') {
        renderPipelines(s.programId);
        if (force) {
            await parallelReads([...groupViews.values()].filter(state=>state.section.open), state => refreshGroup(state,signal));
        }
    }
    if (tab === 'environments') {renderEnvironments();}
    if (tab === 'variables') {await renderVariables(s.programId,signal);}
    setMessage(`${force || reloadCatalog ? 'Catalog updated just now' : 'Cached catalog · expand an environment to refresh'}${cacheWarning ? ' · Session cache unavailable' : ''}`);
    if(tab==='variables'){setMessage('Variables checked just now');}
    if(tab==='environments'){setMessage('Environments updated just now');}
    $('message').title = `Catalog checked: ${new Date(catalogUpdatedAt).toLocaleString()}`;
    if (tab === 'variables' && environments.find(env=>String(env.id)===selectedEnvironment)?.variableUpdateStatus === 'updating') {setMessage('Variable update in progress. Pipeline starts are blocked until the environment is ready.');}
    scheduleEnvironmentPoll();
    return false;
}

function executionStepStates(ex) {
    return ex?._embedded?.stepStates || [];
}

async function currentExecution(pid, pipeline, signal, expectedConfig, forceDetails = false) {
    const base = pathFor(pid, `/pipeline/${encodeURIComponent(pipeline.id)}`);
    const current = await request(base + '/execution', 'GET', undefined, {signal,expectedConfig});
    const execution = current?.id ? current : embedded(current, 'executions')[0];
    if (!execution?.id) {return null;}
    if (forceDetails || !execution._embedded?.stepStates) {
        const details = await request(base + `/execution/${encodeURIComponent(execution.id)}`, 'GET', undefined, {signal,expectedConfig});
        if (String(details?.id) !== String(execution.id)) {throw new Error('Unexpected execution details returned.');}
        return details;
    }
    return execution;
}

async function readLatestExecution(pid, pipeline, signal, execution) {
    try {
        const latest = await request(pathFor(pid, `/pipeline/${encodeURIComponent(pipeline.id)}/executions?start=0&limit=1`), 'GET', undefined, {signal});
        const latestExecution = latest?.id ? latest : embedded(latest, 'executions')[0] || null;
        return {execution:latestExecution || execution || null, historical:true, missing:true, historyChecked:!latestExecution && !execution, stale:false};
    } catch (error) {
        if (signal?.aborted) { throw signal.reason; }
        return {execution:execution || null, historical:true, missing:true, stale:true, error:`Last execution status could not be refreshed: ${error.message}`};
    }
}

async function resolveFinalExecution(pid, pipeline, signal, execution, missing) {
    try {
        const final = await request(pathFor(pid, `/pipeline/${encodeURIComponent(pipeline.id)}/execution/${encodeURIComponent(execution.id)}`), 'GET', undefined, {signal});
        if (String(final?.id) !== String(execution.id)) { throw new Error('Unexpected execution details returned.'); }
        return {execution:final, historical:missing, missing, stale:false};
    } catch (error) {
        if (signal?.aborted) { throw signal.reason; }
        return {execution, historical:true, missing, stale:true, error:`Last execution status could not be refreshed: ${error.message}`};
    }
}

async function displayedExecution(pid, pipeline, signal, previous, forceDetails = false) {
    let current = null, missing;
    try {
        current = await currentExecution(pid, pipeline, signal, undefined, forceDetails);
        missing = !current;
    } catch (error) {
        if (signal?.aborted || !/^404\b/.test(error.message || '')) { throw error; }
        missing = true;
    }
    const execution = current || previous?.execution || null;
    const active = execution && ['NOT_STARTED','RUNNING','WAITING','CANCELLING'].includes(execution.status);
    // Resolve an observed active run before reading history when Adobe removes /execution.
    if (execution?.id && active && (missing || pipeline.status === 'IDLE')) {
        const final = await resolveFinalExecution(pid, pipeline, signal, execution, missing);
        if (final.stale || !missing) { return final; }
    }
    if (missing) { return readLatestExecution(pid, pipeline, signal, execution); }
    return {execution, historical:missing, missing, stale:false};
}

function targetLabels(pipeline) {
    return environmentIds(pipeline).map(id => environmentLabel(environments.find(env => String(env.id) === id) || {id}));
}

function eligiblePipeline(pipeline, action) {
    return action === 'start' ? pipeline.status === 'IDLE' : canStopPipeline(pipeline);
}

async function groupAction(pid, group, action, singlePipeline, expectedExecutionId) {
    if (busy || backgroundPending || connectionChanged || groupViews.get(group.id)?.loading) {return;}
    const actionConfig = connection, signal = historyController.signal, generation = viewGeneration;
    const latestSettings = await abortable(settings(),signal);
    if (generation !== viewGeneration || snapshotKey(latestSettings) !== snapshotIdentity) {
        error(new Error('Connection settings changed. Refresh before running an action.'));
        return;
    }
    const decision = ['promote', 'reject'].includes(action);
    if (decision && !isProduction(group.environment)) {return;}
    const candidates = (singlePipeline ? [singlePipeline] : group.pipelines).filter(p =>
        decision ? group.approvals?.has(String(p.id)) : eligiblePipeline(p, action));
    if (!candidates.length) {return;}
    const title = group.environment ? environmentLabel(group.environment) : group.name;
    const details = candidates.map(p => `${p.name || p.id} → ${targetLabels(p).join(', ') || 'No deployment target'}`).join('\n');
    const actionLabel = {start: 'Start', stop: 'Stop', promote: 'Approve', reject: 'Reject'}[action];
    if (!confirmAction(`${actionLabel.toUpperCase()} ${candidates.length} pipeline${candidates.length === 1 ? '' : 's'} in ${title}?\n\n${details}\n\nActions affect each entire pipeline, including all listed environments. You can close the popup; this action continues in the background.`)) {return;}
    await run(async () => {
        for(const pipeline of candidates){activePipelineActions.add(String(pipeline.id));syncPipelineLoading(String(pipeline.id));}
        let results;
        try {results = await submitOperation('pipelines',{
            action,environmentId:group.id,pipelines:candidates,
            executions:Object.fromEntries(candidates.map(pipeline=>[String(pipeline.id),expectedExecutionId || (decision?group.approvals:group.executions)?.get(String(pipeline.id))]))
        },actionConfig);}finally{
            for(const pipeline of candidates){activePipelineActions.delete(String(pipeline.id));syncPipelineLoading(String(pipeline.id));}
        }
        if (signal.aborted || generation !== viewGeneration) {throw new Error('View changed while the background action completed. Refresh to check its result.');}
        let refreshError = '';
        try {
            await parallelReads([...groupViews.values()].filter(state=>state.section.open && state.group.pipelines.some(p=>candidates.some(candidate=>String(candidate.id)===String(p.id)))),state=>refreshGroup(state));
        } catch (e) { refreshError = ` Refresh failed: ${e.message}`; }
        const summary = node('div', '', 'batch-results');
        summary.setAttribute('role', 'status');
        summary.append(node('strong', `${actionLabel} results · ${title}`));
        for (const result of results) {summary.append(node('p', `${result.pipeline.name || result.pipeline.id}: ${result.message}`, result.ok ? 'muted' : 'error'));}
        $('content').prepend(summary);
        setMessage(`Group action finished.${refreshError}`, !!refreshError || results.some(result => !result.ok));
        return false;
    });
}

function isProduction(environment) {
    return ['prod', 'production'].includes(String(environment?.type || '').toLowerCase());
}

function renderPipelines(pid) {
    const content = $('content');
    if (!pipelines.length) { content.append(node('div','No pipelines found.','empty')); return; }
    const groups = groupPipelines(pipelines,environments,environmentOrder).filter(group => !hiddenEnvironments.has(group.id));
    if (!groups.length) { content.append(node('div','All pipeline environments are hidden. Change visibility in Environments.','empty')); return; }
    for (const group of groups) {
        const section = node('section','','environment-group');
        const summary = node('button','','environment-summary');
        summary.type='button';
        summary.append(node('strong',group.environment ? environmentLabel(group.environment) : group.name),node('span',`${group.pipelines.length} pipeline${group.pipelines.length === 1 ? '' : 's'}`,'muted'));
        const state = {group,section,notice:node('p','Cached data. Expand to refresh.','muted environment-sync'),body:node('div','','environment-body'),generation:viewGeneration,loading:null};
        state.body.id=`environment-body-${group.id || 'unassigned'}`;
        summary.setAttribute('aria-controls',state.body.id);
        Object.defineProperty(section,'open',{get:()=>!state.body.hidden,set:open=>{state.body.hidden=!open;state.notice.hidden=!open;section.toggleAttribute('open',open);summary.setAttribute('aria-expanded',String(open));}});
        section.append(summary,state.notice,state.body);
        section.open=expandedEnvironments.has(group.id);
        groupViews.set(group.id,state);
        // Native buttons support keyboard activation; rendering cached rows makes no requests.
        summary.addEventListener('click', () => {
            if (state.generation !== viewGeneration) {return;}
            if (!section.open) {
                expandedEnvironments.add(group.id);
                if (!state.rendered) {renderGroupBody(state,pid);}
                if (!busy) {refreshGroup(state).catch(error);}
            } else {expandedEnvironments.delete(group.id);}
            section.open=!section.open;
        });
        content.append(section);
        renderGroupBody(state,pid,section.open);
    }
}

function setCardBusy(card, source, loading) {
    card.dataset[source + 'Loading'] = String(loading);
    const pending = card.dataset.pipelineLoading === 'true' || card.dataset.historyLoading === 'true';
    card.setAttribute('aria-busy',String(pending));
    let loader = card.querySelector(':scope > .card-loader');
    if (!loader) {
        loader = node('div','','card-loader');
        loader.setAttribute('role','status');
        loader.setAttribute('aria-live','polite');
        card.querySelector('.line').after(loader);
    }
    loader.hidden = !pending;
    loader.textContent = card.dataset.pipelineLoading === 'true' ? 'Updating pipeline...' : 'Loading history...';
}

function syncPipelineLoading(id) {
    const loading = pipelineReads.has(id) || activePipelineActions.has(id);
    for (const state of groupViews.values()) {
        const card = state.rows?.get(id);
        if (card) {setCardBusy(card,'pipeline',loading);}
    }
}

function updatePipelineCards(id) {
    const pipeline = pipelines.find(p => String(p.id) === id);
    if (!pipeline) {return;}
    for (const state of groupViews.values()) {
        const index = state.group.pipelines.findIndex(p => String(p.id) === id);
        if (index < 0) {continue;}
        state.group.pipelines[index] = pipeline;
        const previous = state.rows?.get(id);
        if (previous?.isConnected) {
            const card = renderPipelineCard(state,connection.programId,pipeline);
            card.querySelector('.pipeline-details').open = !!previous.querySelector('.pipeline-details')?.open;
            // Keep an explicitly opened/paged history panel while status data updates.
            const history = previous.querySelector('.pipeline-history');
            if (history) {
                card.querySelector('.pipeline-history').replaceWith(history);
                setCardBusy(card,'history',previous.dataset.historyLoading === 'true');
            }
            previous.replaceWith(card);
            state.rows.set(id,card);
        }
        if (!connectionChanged) {updateGroupActions(state);}
    }
}

function waitingApproval(pipeline, group) {
    const record = executionRecords[String(pipeline.id)];
    if (!isProduction(group.environment) || !record?.execution?.id || record.historical || record.stale) { return null; }
    return executionStepStates(record.execution).some(step => step.status === 'WAITING' && step.action === 'approval') ? record.execution.id : null;
}

function updateGroupActions(state) {
    const {group,buttons} = state;
    if (!buttons) {return;}
    group.approvals.clear();
    for(const pipeline of group.pipelines){
        const approval = waitingApproval(pipeline, group);
        if (approval) { group.approvals.set(String(pipeline.id), approval); }
    }
    buttons.start.disabled = busy || backgroundPending || !!state.loading || !group.pipelines.some(p => p.status === 'IDLE' && !pipelineEnvironmentBlocked(p));
    let notice=state.heading.querySelector('.environment-update-notice');
    if (!notice) {notice=node('div','','muted environment-update-notice');state.heading.append(notice);}
    const blocked=group.pipelines.some(pipelineEnvironmentBlocked);
    notice.replaceChildren();
    if(blocked){
        const targets=group.pipelines.flatMap(pipeline=>environmentIds(pipeline)).map(id=>environments.find(env=>String(env.id)===id));
        const updating=targets.some(env=>env?.variableUpdateStatus==='updating'||String(env?.status).toLowerCase()==='updating');
        const ribbon=pill(updating?'updating':'unavailable');ribbon.classList.add('environment-update-ribbon');
        ribbon.textContent=updating?'Environment updating':'Environment unavailable';
        notice.append(ribbon,node('p','Environment updating or unavailable. Pipeline starts are blocked.'));
    }
    notice.hidden=!blocked;
    let summaryStatus=state.section.querySelector('.environment-overview-status');
    if(!summaryStatus){summaryStatus=node('span','','pill environment-overview-status');state.section.querySelector('.environment-summary').append(summaryStatus);}
    const waiting=group.pipelines.filter(p=>pipelineStatusLabel(p,executionRecords[String(p.id)]?.execution,isProduction(group.environment))==='Waiting').length;
    summaryStatus.textContent = waiting ? `${waiting} waiting` : '';
    if (blocked) { summaryStatus.textContent = 'Blocked'; }summaryStatus.hidden=!summaryStatus.textContent;
    buttons.stop.disabled = busy || backgroundPending || !!state.loading || !group.pipelines.some(canStopPipeline);
    if (buttons.promote) {
        buttons.promote.disabled = busy || backgroundPending || !!state.loading || !group.pipelines.some(p=>group.approvals.has(String(p.id))&&!pipelineEnvironmentBlocked(p));
        buttons.reject.disabled = busy || backgroundPending || !!state.loading || !group.approvals.size;
    }
}

function removeObsoleteGroupRows(state, ids) {
    for (const [id,card] of state.rows) {if (!ids.has(id)) {
        card.remove(); state.rows.delete(id);
        state.group.approvals.delete(id); state.group.executions.delete(id);
    }}
}

function syncGroupRows(state,pid) {
    if(!state.rendered){updateGroupActions(state);return;}
    const ids = new Set(state.group.pipelines.map(p => String(p.id)));
    removeObsoleteGroupRows(state, ids);
    let preceding = null;
    for (const pipeline of state.group.pipelines) {
        const id = String(pipeline.id);
        let card = state.rows.get(id);
        if (!card) { card = renderPipelineCard(state,pid,pipeline); state.rows.set(id,card); }
        if (preceding ? preceding.nextElementSibling !== card : state.body.firstElementChild !== card) {if(preceding){preceding.after(card);}else {state.body.prepend(card);}}
        preceding = card;
    }
    state.section.querySelector('.environment-summary .muted').textContent = `${state.group.pipelines.length} pipeline${state.group.pipelines.length === 1 ? '' : 's'}`;
}

function isProductionTarget(id) {
    return isProduction(environments.find(env => String(env.id) === id));
}

async function refreshGroup(state, parentSignal) {
    if (state.loading) {return state.loading;}
    const generation = viewGeneration, config = connection;
    const signal = AbortSignal.any([historyController.signal,AbortSignal.timeout(45000),...(parentSignal ? [parentSignal] : [])]);
    state.notice.textContent = 'Refreshing pipeline status...';
    state.section.dataset.loading = 'true';
    state.refreshControls = [...state.section.querySelectorAll('.group-heading button, .environment-body button, .environment-body input, .environment-body select')].map(control => [control,control.disabled]);
    state.refreshControls.forEach(([control]) => { control.disabled = true; });
    state.section.setAttribute('aria-busy','true');
    for(const card of state.rows?.values() || []){setCardBusy(card,'pipeline',true);}
    state.loading = (async () => {
        const environmentStatus = refreshEnvironmentList(signal,config,true).then(async () => {
            if (state.group.id) {await readVariableStatus(state.group.id,signal,config);}
            syncEnvironmentIndicators();scheduleEnvironmentPoll();
        });
        const groupPipelinesBefore = state.group.pipelines;
        const readPipeline = pipeline => {
            const id = String(pipeline.id);
            if (!pipelineReads.has(id)) {
                const pending = (async () => {
                    const fresh = projectPipeline(await request(pathFor(config.programId,`/pipeline/${encodeURIComponent(id)}`),'GET',undefined,{signal}));
                    const production = environmentIds(fresh).some(isProductionTarget);
                    const record = await displayedExecution(config.programId,fresh,signal,executionRecords[id],production);
                    signal.throwIfAborted();
                    if (generation !== viewGeneration) {return;}
                    const index = pipelines.findIndex(item => String(item.id) === id);
                    if (index >= 0) {pipelines[index] = fresh;}
                    executionRecords[id] = {...record,execution:projectExecution(record.execution),updatedAt:record.stale ? executionRecords[id]?.updatedAt || 0 : Date.now()};
                    updatePipelineCards(id);
                })().catch(error => {
                    if (signal.aborted) {throw signal.reason;}
                    if (generation === viewGeneration) {
                        executionRecords[id] = {...executionRecords[id],error:error.message};
                        updatePipelineCards(id);
                    }
                }).finally(() => { if (pipelineReads.get(id) === pending) { pipelineReads.delete(id); syncPipelineLoading(id); } });
                pipelineReads.set(id,pending);
                syncPipelineLoading(id);
            }
            return pipelineReads.get(id);
        };
        await Promise.all([environmentStatus, parallelReads(groupPipelinesBefore, readPipeline)]);
        signal.throwIfAborted();
        if (generation !== viewGeneration) {return;}
        const updated = groupPipelines(pipelines,environments,environmentOrder).find(group => group.id === state.group.id);
        state.group.pipelines = updated?.pipelines || [];
        syncGroupRows(state,config.programId);
        state.notice.textContent = state.group.pipelines.some(p => executionRecords[String(p.id)]?.error)
            ? 'Refresh completed with errors. Last known data remains visible.' : '';
        state.section.querySelector('.environment-summary').title = `Status checked: ${new Date().toLocaleString()}`;
        await persistSnapshot(signal);
    })().catch(error => {
        if (generation === viewGeneration && !historyController.signal.aborted) {
            state.notice.textContent = 'Refresh failed. Last known data remains visible.';
            state.body.prepend(node('p',`Environment refresh failed: ${error.message}. Cached data remains visible; collapse and expand to retry.`,'error'));
        }
        if (parentSignal?.aborted) {throw error;}
    }).finally(() => {
        for(const [id,card] of state.rows || []){setCardBusy(card,'pipeline',pipelineReads.has(id)||activePipelineActions.has(id));}
        state.refreshControls.forEach(([control,disabled]) => restoreControl(control,disabled));
        state.section.dataset.loading = 'false'; state.section.setAttribute('aria-busy','false'); state.loading = null;
        if (!connectionChanged && generation === viewGeneration) {syncEnvironmentIndicators();scheduleEnvironmentPoll();}
    });
    return state.loading;
}

function renderGroupBody(state,pid,renderRows = true) {
    state.rendered = renderRows;
    const group = state.group;
    state.body.replaceChildren();
    group.approvals = new Map(); group.executions = new Map();
    const heading = node('div','','group-heading');
    if (group.environment) {heading.append(cloudManagerLink(connection,'Environment details',{environmentId:group.environment.id}));}
    heading.append(node('small','Bulk actions · this environment'));
    const controls = node('div','','actions environment-actions');
    const start = actionButton('Start',() => groupAction(pid,group,'start'),'start');
    start.setAttribute('aria-label','Start eligible pipelines');start.title='Start eligible pipelines in this environment';
    const stop = actionButton('Stop',() => groupAction(pid,group,'stop'),'stop');
    stop.setAttribute('aria-label','Stop running pipelines');stop.title='Stop running pipelines in this environment';
    start.disabled = !group.pipelines.some(p => p.status === 'IDLE' && !pipelineEnvironmentBlocked(p));
    stop.disabled = !group.pipelines.some(canStopPipeline);
    controls.append(start,stop);
    let promote,reject;
    if (isProduction(group.environment)) {
        promote = actionButton('Approve',() => groupAction(pid,group,'promote'),'approve');
        promote.setAttribute('aria-label','Approve waiting deployments');promote.title='Approve waiting deployments in this environment';
        reject = actionButton('Reject',() => groupAction(pid,group,'reject'),'reject','danger');
        reject.setAttribute('aria-label','Reject waiting deployments');reject.title='Reject waiting deployments in this environment';
        controls.append(promote,reject);
    }
    heading.append(controls); state.heading?.remove();state.heading=heading;state.section.querySelector('.environment-summary').after(heading);
    state.rows = new Map();
    state.buttons = {start,stop,promote,reject};
    for (const pipeline of renderRows ? group.pipelines : []) {
        const card = renderPipelineCard(state,pid,pipeline);
        state.rows.set(String(pipeline.id),card);
        state.body.append(card);
    }

    if (promote) {
        promote.disabled = !group.approvals.size;
        reject.disabled = !group.approvals.size;
    }
    updateGroupActions(state);
}

function renderExecutionStep(step, execution, pid, group, p) {
    const stateCard = node('div','','execution-step');
    stateCard.append(node('strong',step.action === 'approval' ? 'Approval required' : step.action || step.name || 'Active step'));
    const stop = stopAction(step);
    const approval = step.status === 'WAITING' && step.action === 'approval';
    if (approval && isProduction(group.environment)) {
        group.approvals.set(String(p.id), execution.id);
        if (approvalAction(step, true)) {
            const approve=actionButton('Approve deployment', () => groupAction(pid, group, 'promote', p, execution.id), 'approve');
            approve.disabled=pipelineEnvironmentBlocked(p);stateCard.append(approve);
        }
        if (approvalAction(step, false)) {stateCard.append(actionButton('Reject deployment', () => groupAction(pid, group, 'reject', p, execution.id), 'reject'));}
    }
    if (stop && !approval) {stateCard.append(actionButton('Stop', () => groupAction(pid, group, 'stop', p, execution.id), 'stop'));}
    if (approval && !isProduction(group.environment)) {stateCard.append(node('p', 'Awaiting production approval. Open the Production environment to promote or reject.', 'muted'));}
    return stateCard;
}

function appendExecutionSteps(execution, pid, group, p, executionInfo) {
    for (const step of executionStepStates(execution).filter(st => ['RUNNING', 'WAITING'].includes(st.status))) {
        executionInfo.append(renderExecutionStep(step, execution, pid, group, p));
    }
}

function executionTimestamp(value) {
    const date = value ? new Date(value) : null;
    const valid = date && !Number.isNaN(date.getTime());
    const timestamp = node('p', valid ? `Started: ${date.toLocaleString()} (local time)` : 'Execution date unavailable', 'muted');
    if (valid) { timestamp.title = value; }
    return timestamp;
}

function unavailableExecutionStatus(record) {
    let label = 'Checking status';
    if (record?.historyChecked) { label = 'No executions'; }
    if (record?.error || (!record?.historyChecked && record?.missing)) { label = 'Status unavailable'; }
    const status = node('span',label,`pill execution-status ${record?.error ? 'unavailable' : 'no-executions'}`);
    status.title = record?.error || (record?.historyChecked ? 'No pipeline executions found.' : 'Latest execution status is loading.');
    return status;
}

function renderExecutionInfo(pid, group, p, metadata) {
    const executionInfo = node('div', '', 'execution-info');
    try {
        const record = executionRecords[String(p.id)];
        const {execution, historical} = record || {};
        if (execution?.id) {
            if (!historical) {group.executions.set(String(p.id), execution.id);}
            executionInfo.append(executionRibbon(execution,record?.stale,historical));
            executionInfo.append(cloudManagerLink(connection,'Open execution',{pipelineId:p.id,executionId:execution.id}));
            metadata.append(node('p', `${historical ? 'Last execution' : 'Execution'} ${execution.id}`, 'muted execution-reference'));
            executionInfo.append(executionTimestamp(execution.startedAt || execution.createdAt));
            if (!historical) { appendExecutionSteps(execution, pid, group, p, executionInfo); }
        } else {
            executionInfo.append(unavailableExecutionStatus(record));
        }

        if (record?.error) {executionInfo.append(node('p', `Execution refresh failed: ${record.error}. Showing cached data.`, 'error'));}
        if (record?.updatedAt) {metadata.append(node('small', `Execution checked: ${new Date(record.updatedAt).toLocaleString()}`, 'muted execution-checked'));}
    } catch (e) {
        executionInfo.append(node('p', `Execution details unavailable: ${e.message}`, 'muted'));
    }
    return executionInfo;
}

async function showLatestExecution(state, p, executionInfo, latest) {
    const previous = executionRecords[String(p.id)];
    if (!previous?.missing || state.generation !== viewGeneration) {return;}
    const record = {execution:projectExecution(latest),historical:true,missing:true,historyChecked:true,updatedAt:Date.now()};
    executionRecords[String(p.id)] = record;
    const info = state.rows?.get(String(p.id))?.querySelector('.execution-info') || executionInfo;
    info.replaceChildren();
    if (latest) {
        const status = executionRibbon(latest,false,true);
        info.append(status, executionTimestamp(latest.startedAt || latest.createdAt));
        info.append(cloudManagerLink(connection,'Open execution',{pipelineId:p.id,executionId:latest.id}));
        const currentCard = info.closest('.pipeline-row');
        if (currentCard) {
            currentCard.querySelector(':scope > .line > .pill').hidden = false;
            const details = currentCard.querySelector('.pipeline-details');
            details.querySelector('.execution-reference')?.remove();
            details.querySelector('.execution-checked')?.remove();
            details.append(node('p',`Last execution ${latest.id}`,'muted execution-reference'),node('small',`Execution checked: ${new Date(record.updatedAt).toLocaleString()}`,'muted execution-checked'));
        }
    } else {
        info.append(node('p','No previous executions found.','muted'));
        const currentCard = info.closest('.pipeline-row');
        if (currentCard) {
            currentCard.querySelector(':scope > .line > .pill').hidden = false;
            currentCard.querySelector('.execution-reference')?.remove();
        }
    }
    await persistSnapshot(historyController.signal);

}

function renderPipelineCard(state,pid,p) {
    const group = state.group;
    group.approvals.delete(String(p.id));
    group.executions.delete(String(p.id));
    const c = card(p.name || `Pipeline ${p.id}`, p.status);
    const metadata = node('details','','pipeline-details');
    metadata.append(node('summary','Details'));
    metadata.append(node('p', `Pipeline ID ${p.id}`, 'muted'));
    c.classList.add('pipeline-row');
    c.dataset.pipelineId = String(p.id);
    const record = executionRecords[String(p.id)];
    const liveExecution = record?.historical || record?.stale ? null : record?.execution;
    const pipelineLabel = pipelineStatusLabel(p,liveExecution,isProduction(group.environment));
    const pipelinePill = c.querySelector(':scope > .line > .pill');
    pipelinePill.textContent = pipelineLabel;
    pipelinePill.title = `Adobe pipeline status: ${p.status || 'UNKNOWN'}${pipelineLabel === 'Waiting' ? ' · Check execution details for the pending decision' : ''}`;
    if (pipelineLabel === 'Waiting') { pipelinePill.classList.remove('busy'); pipelinePill.classList.add('waiting'); }
    const kind = pipelineKind(p);
    const typeRow = node('div', '', 'pipeline-type-row');
    typeRow.append(typeRibbon(kind));
    c.append(typeRow);
    pipelinePill.hidden = !!liveExecution && executionStatusLabel(liveExecution) === pipelineLabel;
    metadata.append(node('p', `Pipeline availability: ${pipelineLabel}`, 'muted'));
    if (environmentIds(p).length > 1) {c.append(node('p', `Shared pipeline · ${targetLabels(p).join(', ')}`, 'muted'));}
    if (p.detailsError) {c.append(node('p', `Environment details unavailable: ${p.detailsError}`, 'error'));}
    const actions = node('div', '', 'actions');
    const base = pathFor(pid, `/pipeline/${encodeURIComponent(p.id)}`);
    if (p.status === 'IDLE') {
        const start=actionButton('Start', () => groupAction(pid, group, 'start', p), 'start');
        start.disabled=pipelineEnvironmentBlocked(p);
        if(start.disabled){start.title='A target environment is updating or unavailable';}
        actions.append(start);
    }
    const executionInfo = renderExecutionInfo(pid, group, p, metadata);
    const linkConfig = connection;
    c.append(executionInfo, actions, metadata, historyPanel(base + '/executions?start=0&limit=20', historyController.signal, latest => showLatestExecution(state, p, executionInfo, latest), loading => setCardBusy(state.rows?.get(String(p.id)) || c,'history',loading), entry => cloudManagerLink(linkConfig,'Open execution',{pipelineId:p.id,executionId:entry.id})));
    setCardBusy(c,'pipeline',pipelineReads.has(String(p.id)) || activePipelineActions.has(String(p.id)));
    if (state.loading) {
        for (const control of c.querySelectorAll('button,input,select')) {
            state.refreshControls.push([control,control.disabled]);
            control.disabled = true;
        }
    }
    return c;
}

function renderEnvironments() {
    const content = $('content');
    if (!environments.length) {
        content.append(node('div', 'No environments found.', 'empty'));
        return;
    }
    for (const env of environments) {
        const c = card(environmentLabel(env), env.variableUpdateStatus || env.status);
        c.dataset.environmentId=String(env.id);
        c.append(environmentOrderControls(env));
        c.querySelector(':scope > .line > strong').replaceChildren(cloudManagerLink(connection,environmentLabel(env),{environmentId:env.id}));
        c.append(node('p', `Type: ${env.type || 'N/A'} · Region: ${env.region || 'N/A'} · ID: ${env.id}`, 'muted'));
        const key = profilePrefix(connection.profileId)+aliasKey(connection.orgId, connection.programId, env.id);
        const alias = node('input');
        alias.value = aliases[key] || '';
        alias.placeholder = 'Local environment alias';
        alias.maxLength = 80;
        alias.setAttribute('aria-label', `Alias for ${env.name || env.id}`);
        const row = node('div', '', 'alias-row');
        row.append(alias, btn('Save alias', () => run(async () => {
            const value = alias.value.trim();
            if (value) {await saveProfilePreference(connection,key,value);}
            else {await chrome.storage.local.remove(key);}
            await updateLocalPreferences();
        })));
        c.append(row, node('small', 'Saved in this browser. Clear the alias and save to restore the original name.', 'muted'));
        const visibilityLabel = node('label', '', 'environment-visibility');
        const visibility = node('input');
        visibility.type = 'checkbox';
        visibility.checked = hiddenEnvironments.has(String(env.id));
        visibility.setAttribute('aria-label', `Hide ${environmentLabel(env)} from Pipelines`);
        visibility.addEventListener('change', async () => {
            const hidden = visibility.checked;
            const saved = await run(async () => {
                const next = new Set(hiddenEnvironments);
                if (hidden) {next.add(String(env.id));}
                else {next.delete(String(env.id));}
                await saveProfilePreference(connection,hiddenEnvironmentsKey(),[...next]);
                await updateLocalPreferences();
            });
            if (!saved) {visibility.checked = hiddenEnvironments.has(String(env.id));}
        });
        visibilityLabel.append(visibility, node('span', 'Hide from Pipelines'));
        c.append(visibilityLabel);

        content.append(c);
    }
}

async function renderVariables(pid, signal, loadedVariables) {
    signal.throwIfAborted();
    const content = $('content');
    if (!selectedEnvironment) {
        content.replaceChildren();
        content.append(node('p', 'No environments found.'));
        return;
    }
    setMessage('Loading environment variables...');
    const freshVariables = loadedVariables || await readVariableStatus(selectedEnvironment,signal);
    signal.throwIfAborted();
    const draftKey=variableDraftKey(snapshotIdentity,selectedEnvironment);
    const draft=await loadVariableDraft(draftKey);
    signal.throwIfAborted();
    if(draft){variableDrafts.set(draftKey,draft);}else {variableDrafts.delete(draftKey);}
    const vars=draft?.original || freshVariables;
    content.replaceChildren();
    const environment=environments.find(env=>String(env.id)===selectedEnvironment);
    content.append(cloudManagerLink(connection,'Environment details',{environmentId:selectedEnvironment}));
    const updating=environment.variableUpdateStatus === 'updating' || String(environment.status).toLowerCase()==='updating';
    const failed=environment.variableUpdateStatus === 'failed';
    const notice=node('div','','variable-update-notice');notice.setAttribute('role','status');
    if(updating){notice.append(variableStatusRibbon('updating'),node('p','Variable update in progress. Pipeline starts are blocked. Status refreshes automatically.'));}
    else if(failed){notice.append(variableStatusRibbon('failed'),node('p','Variable update failed. Review the variable statuses and retry your changes.','error'));}
    if(updating||failed){content.append(notice);}
    const editor = node('section','','variable-editor');
    editor.setAttribute('aria-label','Environment variables');
    const rows = [];
    const draftStatus=node('span','','muted variable-draft-status');
    const resultStatus=node('span','','muted variable-result-status');resultStatus.setAttribute('role','status');
    const empty=node('p','','muted variable-empty');
    const list=node('div','','variable-list');
    const serialize=()=>rows.map(item=>({originalName:item.originalName,originalService:item.originalService,name:item.name.value,value:item.value.value,type:item.type.value,service:item.service.value,remove:item.remove.checked}));
    const baseline=variable=>({originalName:variable.name,originalService:variable.service||'',name:variable.name,value:variable.type==='secretString'?'':String(variable.value??''),type:variable.type||'string',service:variable.service||'',remove:false});
    const originals=new Map(vars.map(variable=>[JSON.stringify([variable.name,variable.service||'']),baseline(variable)]));
    const changed=edit=>{const original=originals.get(JSON.stringify([edit.originalName,edit.originalService]));return !original||Object.entries(original).some(([key,value])=>edit[key]!==value);};
    const makeSelect = (label, choices, selected) => {
        const select = node('select');select.setAttribute('aria-label',label);
        for(const [value,text] of choices){const option=node('option',text);option.value=value;select.append(option);}
        select.value=selected || '';return select;
    };
    const field = (label, control) => {
        const wrapper=node('label','', 'variable-field');
        if(control.tagName==='SELECT'){const box=node('span','','select-control');box.append(control);wrapper.append(node('span',label),box);}
        else {wrapper.append(node('span',label),control);}
        return wrapper;
    };
    const filters=node('div','','variable-filters');
    const search=node('input');search.type='search';search.placeholder='Search variables';search.setAttribute('aria-label','Search variables');
    const savedFilter=variableFilters.get(draftKey);
    search.value=savedFilter?.search || '';
    const serviceFilter=makeSelect('Filter variables by service',[['*','All services'],['','Global'],['author','Author'],['publish','Publish'],['preview','Preview']],savedFilter?.service ?? '*');
    const resize=items=>{
        const values=items.filter(item=>!item.row.hidden&&item.value.tagName==='TEXTAREA').map(item=>item.value);
        // Batch layout writes and reads so filtering does not force one layout per row.
        values.forEach(value=>{value.style.height='auto';});
        const heights=values.map(value=>Math.min(120,Math.max(36,value.scrollHeight+2)));
        values.forEach((value,index)=>{value.style.height=`${heights[index]}px`;});
    };
    const filterRows=(resizeAll=true)=>{
        const term=search.value.trim().toLowerCase(),edits=serialize();let visible=0,hiddenPending=0;
        rows.forEach((item,index)=>{
            item.row.hidden=!!item.originalName&&(!`${item.name.value} ${item.service.value}`.toLowerCase().includes(term)||(serviceFilter.value!=='*'&&item.service.value!==serviceFilter.value));
            if(!item.row.hidden){visible++;}else if(changed(edits[index])){hiddenPending++;}
        });
        const suffix = hiddenPending === 1 ? '' : 's';
        const hiddenLabel = hiddenPending ? ` · ${hiddenPending} pending change${suffix} hidden by filters` : '';
        resultStatus.textContent = `${visible} of ${rows.length} variables` + hiddenLabel;
        empty.hidden=visible>0;empty.textContent=rows.length?'No variables match these filters.':'No variables yet. Use Add variable to create one.';
        variableFilters.set(draftKey,{search:search.value,service:serviceFilter.value});
        if(resizeAll){resize(rows);}
    };
    const remember=(persist=true,editedItem=null)=>{
        const edits=serialize(), count=edits.filter(changed).length;
        draftStatus.textContent = `${count} unsaved change${count===1?'':'s'}`;
        if (updating) { draftStatus.textContent = 'Update in progress'; }
        draftStatus.title='Drafts survive popup closure until Save or Discard. Chrome restart or extension reload clears drafts.';
        const discard=editor.querySelector('.variable-discard');if(discard){discard.disabled=updating||!count;}
        const save=editor.querySelector('.action-save');if(save){save.disabled=updating||!count;const label = `Save ${count} change${count===1?'':'s'}`;
            save.querySelector('span').textContent = count ? label : 'Save changes';}
        rows.forEach((item,index)=>{
            if(editedItem&&item!==editedItem){return;}
            const dirty=changed(edits[index]);
            item.row.classList.toggle('has-changes',dirty);item.row.classList.toggle('marked-for-removal',item.remove.checked);
            item.status.textContent = dirty ? 'Modified' : '';
            if (!item.originalName) { item.status.textContent = 'New'; }
            if (item.remove.checked) { item.status.textContent = 'Marked for deletion'; }
            item.status.hidden=!item.status.textContent;item.undo.hidden=!dirty;
            item.removeButton.hidden=item.remove.checked;
            for(const control of item.fields.querySelectorAll('input,textarea,select')){control.disabled=updating||item.remove.checked;}
            item.undo.disabled=updating;item.removeButton.disabled=updating;
            if(item.type.tagName){item.type.disabled=updating;}
        });
        if(count){variableDrafts.set(draftKey,{original:vars,edits});}else {variableDrafts.delete(draftKey);}
        if(persist){void saveVariableDraft(draftKey,variableDrafts.get(draftKey)).catch(()=>setMessage('Draft could not be retained. Keep this popup open and retry your edit.',true));}
        filterRows(false);
        resize(editedItem?[editedItem]:rows);
    };
    const addRow = (variable, saved) => {
        const existing=!!variable,originalName=variable?.name || '',originalService=variable?.service || '';
        const fieldSuffix = originalName ? ' for ' + originalName : '';
        const row=node('div','','variable-row');row.dataset.originalName=originalName;row.dataset.originalService=originalService;
        const name=node('input');name.value=saved?.name ?? originalName;name.placeholder='VARIABLE_NAME';name.autocomplete='off';name.setAttribute('aria-label','Name' + fieldSuffix);
        const type=existing?{value:variable.type||'string'}:makeSelect('Type',[['string','String'],['secretString','Secret']],saved?.type||'string');
        const service=makeSelect('Service' + fieldSuffix,[['','All services'],['author','Author'],['publish','Publish'],['preview','Preview']],saved?.service ?? originalService);
        const remove={checked:saved?.remove || false};
        const fields=node('div','','variable-fields');
        const status=node('span','','variable-change-status');
        const top=node('div','','variable-row-heading');
        const typeLabel=node('span',type.value==='secretString'?'Secret':'String','pill variable-type');
        typeLabel.title='Existing variable types cannot be changed.';
        const valueField=node('label','','variable-field variable-value-field');
        const item={row,name,type,service,originalName,originalService,remove,fields,status};
        const setValue=(text)=>{
            const secret=type.value==='secretString',value=node(secret?'input':'textarea');
            if(secret){value.type='password';value.maxLength=499;}else {value.rows=1;}
            value.value=text;value.placeholder=secret?'Enter a replacement secret':'Variable value';value.autocomplete='off';value.spellcheck=false;
            value.setAttribute('aria-label','Value' + fieldSuffix);
            valueField.replaceChildren(node('span',secret?'Replacement secret':'Value'),value);
            item.value=value;
            row.querySelector('.variable-secret-hint')?.remove();
            if(secret&&existing){row.append(node('small','Leave blank to keep the existing secret.','variable-secret-hint'));}
        };
        const discardRow=()=>{rows.splice(rows.indexOf(item),1);row.remove();remember();};
        const undo=btn('Undo',()=>{
            if(!existing){discardRow();return;}
            if(remove.checked){remove.checked=false;}else{
                const original=baseline(variable);name.value=original.name;service.value=original.service;setValue(original.value);
            }
            remember();
        },'ghost variable-undo');item.undo=undo;
        const removeButton=actionButton(existing?'Remove':'Remove draft',()=>{if(!existing){discardRow();return;}remove.checked=true;remember();},'remove','ghost');
        removeButton.setAttribute('aria-label',existing?`Remove ${originalName}`:'Remove draft');item.removeButton=removeButton;
        top.append(existing?typeLabel:field('Type',type),status);
        if(variable?.status){top.append(variableStatusRibbon(variable.status));}
        const rowActions=node('div','','variable-row-actions');rowActions.append(undo,removeButton);top.append(rowActions);
        fields.append(field('Name',name),valueField,field('Service',service));row.append(top,fields);
        setValue(saved?.value ?? (existing?baseline(variable).value:''));
        if(!existing){type.addEventListener('change',()=>{setValue(item.value.value);remember();});}
        if(existing){rows.push(item);list.append(row);}else{rows.unshift(item);list.prepend(row);}
        row.addEventListener('input',()=>remember(true,item));row.addEventListener('change',()=>remember(true,item));
        if(!existing&&!saved){remember();content.scrollTop=0;name.focus();}
    };
    if(draft){for(const saved of draft.edits){addRow(vars.find(v=>v.name===saved.originalName&&(v.service||'')===saved.originalService),saved);}}
    else {vars.forEach(variable=>addRow(variable));}
    const add=actionButton('Add variable',()=>addRow(null),'add');add.disabled=updating;
    search.addEventListener('input',filterRows);serviceFilter.addEventListener('change',filterRows);
    filters.append(field('Search',search),field('Service filter',serviceFilter),add);
    const actions=node('div','','actions variable-actions');
    actions.append(actionButton('Save changes',async()=>{
        try{
            if(updating){throw new Error('Wait for the current variable update to complete before saving more changes.');}
            const edits=rows.map(item=>({originalName:item.originalName,originalService:item.originalService,name:item.name.value,value:item.value.value,type:item.type.value,service:item.service.value,remove:item.remove.checked}));
            const patch=buildVariablePatch(vars,edits);
            if(!patch.length){setMessage('No variable changes to save.');return;}
            const describe=change=>`${change.name} (${change.service || 'all services'})`;
            const changedNames=[...new Set(patch.map(describe))];
            const removals=patch.filter(change=>change.value==='').map(describe);
            const target=environmentLabel(environments.find(env=>String(env.id)===String(selectedEnvironment))||{id:selectedEnvironment});
            const summary=removals.length?`\n\nVariables removed: ${[...new Set(removals)].join(', ')}`:'';
            if(!confirmAction(`Apply ${patch.length} variable change${patch.length===1?'':'s'} to ${target}?\n\nAffected variables: ${changedNames.join(', ')}${summary}\n\nYou can close the popup; saving continues in the background.`)){return;}
            await run(async()=>{
                const mutationSignal=historyController.signal;
                try{
                    const result=await submitOperation('variables',{environmentId:selectedEnvironment,patch},connection);
                    await saveVariableDraft(draftKey);
                    variableDrafts.delete(draftKey);
                    Object.assign(environment,{variableUpdateStatus:'updating',variableUpdateObserved:false,variableUpdateStartedAt:Date.now()});
                    const returned=Array.isArray(result)?result:embedded(result,'variables');
                    if(returned.some(variable=>['creating','updating','deleting'].includes(variable.status))){environment.variableUpdateObserved=true;}
                    await persistSnapshot(mutationSignal);
                }
                catch(error){
                    if(/^500\b/.test(error.message||'')){throw new Error(`Cloud Manager returned ${error.message}. Check variable names, service values, unchanged types, the 200-variable limit, and secret values under 500 characters. Environment updates can fail while a pipeline or AEM update is running. Refresh before retrying to see which changes applied.`, {cause: error});}
                    throw error;
                }
                setMessage('Variable changes submitted. Environment update in progress; pipeline starts are blocked.');
                await renderVariables(pid,mutationSignal);
                if(environment.variableUpdateStatus !== 'updating'){setMessage(environment.variableUpdateStatus === 'failed'?'Variable update failed. Review the variable statuses.':'Variable changes saved. Environment is ready.',environment.variableUpdateStatus === 'failed');}
                scheduleEnvironmentPoll();
                return false;
            });
        }catch(error){error.message?setMessage(error.message,true):setMessage(String(error),true);}
    },'save','primary'));
    actions.append(btn('Discard changes',async()=>{if(!variableDrafts.has(draftKey)){return;}if(!confirmAction('Discard unsaved changes for this environment?')){return;}await saveVariableDraft(draftKey);variableDrafts.delete(draftKey);await renderVariables(pid,historyController.signal,freshVariables);},'ghost variable-discard'));
    const exportButton=btn('Export JSON',()=>{
        const url=URL.createObjectURL(new Blob([JSON.stringify(exportVariables(freshVariables),null,2)],{type:'application/json'}));
        const link=node('a');link.href=url;link.download=`variables-${pid}-${selectedEnvironment}.json`;
        document.body.append(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        setMessage('Exported loaded saved variables. Secret values and unsaved edits are excluded.');
    },'ghost');
    const fileInput=node('input');fileInput.type='file';fileInput.accept='.json,application/json';fileInput.hidden=true;fileInput.setAttribute('aria-label','Import variable JSON file');
    const importButton=btn('Import JSON',()=>fileInput.click(),'ghost');importButton.disabled=updating;
    fileInput.addEventListener('change',async()=>{
        const file=fileInput.files[0];fileInput.value='';if(!file){return;}
        importButton.disabled=true;
        try{
            const text=await file.text();
            if(signal.aborted || !editor.isConnected || busy || switchingProfile || connectionChanged){return;}
            const edits=mergeVariableImport(text,vars,serialize());
            list.replaceChildren();rows.length=0;
            for(const saved of edits){addRow(vars.find(variable=>variable.name===saved.originalName&&(variable.service||'')===saved.originalService),saved);}
            remember();
            setMessage('Imported into draft. Review changes and click Save to apply. New secrets without values must be filled in.');
        }catch(error){if(editor.isConnected&&!signal.aborted){setMessage(error.message || String(error),true);}}
        finally{importButton.disabled=updating;}
    });
    importButton.title='Merge JSON into this draft by name and service. Save is always manual.';
    exportButton.title='Export loaded saved variables without secret values or unsaved edits.';
    actions.append(importButton,exportButton,draftStatus,fileInput);
    const columns=node('div','','variable-columns');columns.setAttribute('aria-hidden','true');
    columns.append(node('span','Name'),node('span','Value'),node('span','Service'));
    editor.append(actions,filters,resultStatus,columns,list,empty);
    content.append(editor);remember(false);
    await persistSnapshot(signal);
    scheduleEnvironmentPoll();
}

function sizeVariablesView() {
    const available=location.protocol==='chrome-extension:'?window.screen.availWidth:window.innerWidth;
    document.body.style.setProperty('--variables-width',`${Math.min(780,Math.max(360,available-32))}px`);
}
window.addEventListener('resize',sizeVariablesView);

for (const b of document.querySelectorAll('[data-tab]')) {b.addEventListener('click', () => {
    if (busy && !activeRead) {return;}
    if(tab===b.dataset.tab){return;}
    tab = b.dataset.tab;
    document.body.classList.toggle('variables-view',tab==='variables');
    sizeVariablesView();
    document.querySelectorAll('[data-tab]').forEach(t => {t.classList.toggle('active',t===b);if(t===b){t.setAttribute('aria-current','page');}else {t.removeAttribute('aria-current');}});
    void navigate();
});}
$('environment').addEventListener('change', () => {
    if (busy && !activeRead) {return;}
    selectedEnvironment = $('environment').value;
    void navigate();
});
$('refresh').addEventListener('click', () => navigate(true));
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
function profileIdentity(state) {
    const profile=state?.profiles.find(item=>item.id===state.activeProfileId);
    return JSON.stringify([state?.activeProfileId,...['clientId','orgId','programId','oauthScopes'].map(key=>profile?.[key] || '')]);
}
$('programProfile').addEventListener('change',async()=>{
    const id=$('programProfile').value;
    if(switchingProfile || (busy && !activeRead)){$('programProfile').value=connection.profileId || '';return;}
    switchingProfile=true;$('programProfile').disabled=true;
    historyController.abort();environmentPollController?.abort();clearTimeout(environmentPollTimer);
    try{
        if(activeRead){await activeRead;}
        $('content').hidden=true;$('content').inert=true;
        $('viewLoaderLabel').textContent='Switching program…';$('viewLoader').hidden=false;
        await profileCommand('selectProfile',{profileId:id});
        await navigate();
    }catch(e){$('programProfile').value=connection.profileId || '';error(e);$('content').replaceChildren();}
    finally{switchingProfile=false;$('programProfile').disabled=false;$('viewLoader').hidden=true;$('content').hidden=false;}
});
function renderBackgroundActions(jobs) {
    let panel=$('backgroundActions');
    if(!panel){panel=node('div','','background-actions');panel.id='backgroundActions';panel.setAttribute('role','status');$('content').before(panel);}
    panel.replaceChildren();panel.hidden=!jobs.length;
    for(const job of jobs.slice(0,3)){
        const labels={running:'In progress · you can close this popup',completed:'Completed',partial:'Completed with skipped or failed pipelines',failed:'Failed · refresh state before retrying',unknown:'Interrupted · result unknown; refresh state before retrying'};
        panel.append(node('p',`${job.kind==='variables'?'Variable save':'Pipeline action'} · ${labels[job.status]} · ${new Date(job.startedAt).toLocaleTimeString()}`));
        for(const outcome of job.outcomes || []){panel.append(node('p',`Pipeline ${outcome.id}: ${outcome.message}`,'muted'));}
    }
}

async function refreshBackgroundStatus() {
    if(!usesBackground()){return;}
    clearTimeout(backgroundStatusTimer);
    try {
        const response=await chrome.runtime.sendMessage({type:'operationStatus'});
        if(!response?.ok){throw new Error(response?.error || 'Background status unavailable.');}
        const previous=backgroundPending;
        backgroundPending=response.data.some(job=>job.status==='running');
        $('programProfile').disabled=backgroundPending || busy || initializingProfiles || switchingProfile;
        renderBackgroundActions(response.data);
        if(backgroundPending){
            for(const control of $('content').querySelectorAll('.action-start,.action-stop,.action-approve,.action-reject,.action-save')){control.disabled=true;}
            backgroundStatusTimer=setTimeout(()=>void refreshBackgroundStatus(),2000);
        }else if(previous){
            backgroundRefreshNeeded=true;
            if(!busy && !initializingProfiles){backgroundRefreshNeeded=false;await navigate(true);}
        }
        if(!busy){syncEnvironmentIndicators();}
    }catch(error){setMessage(`Cannot check background actions: ${error.message}`,true);}
}

function connectionDidChange(profiles) {
    connectionChanged=true;
    clearTimeout(environmentPollTimer);environmentPollController?.abort();
    historyController.abort();viewGeneration++;
    setMessage('Program connection changed. Loading selected program…');
    for(const control of $('content').querySelectorAll('button,input,textarea,select')){control.disabled=true;}
    if(!initializingProfiles && !switchingProfile && profiles){if(busy && !activeRead){pendingProfileNavigation=true;}else {void navigate();}}
}

chrome.storage.onChanged?.addListener((changes, area) => {
    if(area==='session' && Object.keys(changes).some(key=>key.startsWith('backgroundJob:'))){void refreshBackgroundStatus();return;}
    if(area!=='local'){return;}
    const profiles=changes[PROFILE_KEY];
    if(profiles?.newValue){
        fillProfileSelect($('programProfile'),{profiles:profiles.newValue.profiles,activeProfileId:profiles.newValue.activeProfileId});
        if(profileIdentity(profiles.oldValue)===profileIdentity(profiles.newValue)){
            const selected=profiles.newValue.profiles.find(item=>item.id===profiles.newValue.activeProfileId);
            if(selected?.id===connection.profileId){$('programLabel').textContent=`${selected.name} · Program ${selected.programId || 'not configured'}`;}
            return;
        }
    }else if(!['clientId','orgId','programId','oauthScopes'].some(key=>key in changes)){return;}
    connectionDidChange(profiles);
});
try{
    if(chrome.runtime.sendMessage){const state=await profileCommand('listProfiles');fillProfileSelect($('programProfile'),state);}
    else {$('programProfile').closest('.program-switcher').hidden=true;}
    initializingProfiles=false;
    await refreshBackgroundStatus();
    await navigate();
    await refreshBackgroundStatus();
}catch(e){initializingProfiles=false;error(e);}
