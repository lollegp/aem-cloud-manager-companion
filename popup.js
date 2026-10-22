import {loadSnapshot, saveSnapshot, snapshotKey, projectPipeline, projectExecution} from './cache.js';
import {historyPanel} from './history.js';
import {request, settings, abortable, pathFor, embedded, link, safeAPIPath} from './api.js';
import {buildVariablePatch, variableDisplayValue, variableUpdateState, environmentBlocksStart} from './variables.js';
import {aliasKey, environmentIds, groupPipelines, pipelineKind, stopAction, runPipelineBatch, canStopPipeline, approvalAction, orderEnvironments, executionStatusLabel, pipelineStatusLabel} from './pipeline.js';

const $ = id => document.getElementById(id);
let tab = 'pipelines', environments = [], pipelines = [], selectedEnvironment = '';
let aliases = {}, connection = {}, busy = false;
let historyController = new AbortController();
let environmentOrder = [];
let hiddenEnvironments = new Set();
const expandedEnvironments = new Set();
let environmentPollTimer, environmentPollController;
let activeRead = null, navigationId = 0, environmentRead = null, environmentReadRevision = 0;
const variableDrafts = new Map();
let catalogUpdatedAt = 0, snapshotIdentity = '', viewGeneration = 0;
let executionRecords = Object.create(null), cacheWarning = false, connectionChanged = false;
const groupViews = new Map(), pipelineReads = new Map(), activePipelineActions = new Set();
const node = (tag, text = '', className = '') => {
    const n = document.createElement(tag);
    n.textContent = String(text ?? '');
    if (className) n.className = className;
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
}

function error(e) {
    setMessage(e.message || String(e), true);
}

function restoreControl(control, disabled) {
    if (!control.isConnected) return;
    if (connectionChanged && $('content').contains(control)) control.disabled = true;
    else {
        const history = control.closest('.history-list');
        control.disabled = history ? history.getAttribute('aria-busy') === 'true' : disabled;
    }
}

async function run(fn, reading = false) {
    if (busy) return false;
    environmentPollController?.abort();
    busy = true;
    const controls = [...document.querySelectorAll(reading ? '#content button, #content input, #content select, #refresh' : 'button:not(#settings), input, select')];
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
        if (result !== false) setMessage('Updated just now');
        completed=true;
        return true;
    } catch (e) {
        if (!reading || !historyController.signal.aborted) error(e);
        return false;
    } finally {
        busy = false;
        if(reading){
            $('viewLoader').hidden=true;
            if(!completed)$('content').replaceChildren(node('p','This view could not be loaded. Click Refresh to retry, or choose another tab.','empty'));
            $('content').hidden=false;$('content').inert=!completed;$('content').setAttribute('aria-busy','false');
        }
        controls.forEach((control,index) => restoreControl(control,disabled[index]));
        if (!connectionChanged) syncEnvironmentIndicators();
    }
}

async function navigate(force = false) {
    if (busy && !activeRead) return;
    const id = ++navigationId;
    if (activeRead) {
        historyController.abort();
        await activeRead;
    }
    if (id !== navigationId) return;
    const pending = run(() => refresh(force), true);
    activeRead = pending;
    try { await pending; }
    finally { if (activeRead === pending) activeRead = null; }
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
    ribbon.textContent=String(status).replace(/_/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase());
    return ribbon;
}

function variableTooltip(text) {
    const value = node('span', text, 'variable-preview');
    const wrapper = node('span','','variable-preview-wrap');
    wrapper.dataset.tooltip = String(text ?? '');
    wrapper.setAttribute('tabindex','0');
    wrapper.setAttribute('role','note');
    wrapper.setAttribute('aria-label',String(text ?? ''));
    wrapper.append(value);
    return wrapper;
}

function executionRibbon(execution, stale = false) {
    const label = executionStatusLabel(execution);
    const status = pill(execution.status);
    status.classList.add('execution-status');
    if (label.startsWith('Waiting')) {
        status.classList.remove('running');
        status.classList.add('waiting');
    }
    status.textContent = `${stale ? 'Last observed' : 'Last execution'} · ${label}`;
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

async function perform(path, method, payload, message) {
    if (busy || connectionChanged || !confirmAction(message)) return false;
    const actionConfig = connection, signal = historyController.signal;
    return run(async () => {
        await request(path,method,payload,{signal,expectedConfig:actionConfig});
        await refresh(true);
    });
}

function environmentLabel(env) {
    const alias = aliases[aliasKey(connection.orgId, connection.programId, env.id)];
    return alias ? `${alias} · ${env.name || env.id}` : (env.name || `Environment ${env.id}`);
}

function environmentOrderKey() {
    return `environmentOrder:${JSON.stringify([String(connection.orgId), String(connection.programId)])}`;
}

function hiddenEnvironmentsKey() {
    return `hiddenPipelineEnvironments:${JSON.stringify([String(connection.orgId), String(connection.programId)])}`;
}

function environmentOrderControls(env) {
    const controls = node('div', '', 'actions environment-order');
    const index = environments.findIndex(item => String(item.id) === String(env.id));
    for (const [offset, label] of [[-1, '↑ Move up'], [1, '↓ Move down']]) {
        const button = btn(label, () => run(async () => {
            const ids = environments.map(item => String(item.id));
            const target = index + offset;
            if (index < 0 || target < 0 || target >= ids.length) return;
            [ids[index], ids[target]] = [ids[target], ids[index]];
            await chrome.storage.local.set({[environmentOrderKey()]: ids});
            await updateLocalPreferences();
        }));
        button.setAttribute('aria-label', `${label.slice(2)} environment ${environmentLabel(env)}`);
        button.disabled = index < 0 || index + offset < 0 || index + offset >= environments.length;
        controls.append(button);
    }
    return controls;
}

async function listAll(path, key, signal, quiet = false) {
    const items = [], visited = new Set(), seenIds = new Set();
    while (path) {
        if (visited.has(path)) throw new Error('Repeated API pagination link.');
        visited.add(path);
        signal?.throwIfAborted();
        if(!quiet)setMessage(`Loading ${key}, page ${visited.size}...`);
        const data = await request(path, 'GET', undefined, {signal});
        signal?.throwIfAborted();
        const page = embedded(data, key);
        // Some responses retain a next link beyond the last result page.
        if (!page.length) break;
        const previousCount = items.length;
        for (const item of page) {
            const id = item.id == null ? null : String(item.id);
            if (id !== null && seenIds.has(id)) continue;
            if (id !== null) seenIds.add(id);
            items.push(item);
        }
        const total = data._totalNumberOfItems;
        if (Number.isInteger(total) && total >= 0 && items.length >= total) break;
        if (items.length === previousCount) {
            throw new Error(`Invalid ${key} pagination: page ${visited.size} returned no new records. Refresh to retry.`);
        }
        path = safeAPIPath(link(data, 'next'));
    }
    return items;
}

async function loadEnvironmentPreferences(programId, signal) {
    const keys = environments.map(env => aliasKey(connection.orgId, programId, env.id));
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
    sel.classList.toggle('hidden', tab !== 'variables');
}

async function loadPipelines(programId, signal) {
    pipelines = await listAll(pathFor(programId, '/pipelines'), 'pipelines', signal);
    // List responses may omit phases. Resolve details before assigning a group.
    for (const pipeline of pipelines) {
        if (!Array.isArray(pipeline.phases) || pipelineKind(pipeline).className === 'unknown') {
            try {
                setMessage(`Loading details for pipeline ${pipeline.name || pipeline.id}...`);
                Object.assign(pipeline, await request(pathFor(programId, `/pipeline/${encodeURIComponent(pipeline.id)}`), 'GET', undefined, {signal}));
            } catch (e) {
                if (signal?.aborted) throw signal.reason;
                pipeline.detailsError = e.message;
            }
        }
    }
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
    if (!environmentRead || environmentRead.key !== key || environmentRead.generation !== generation) {
        const sharedSignal = AbortSignal.any([historyController.signal, AbortSignal.timeout(30000)]);
        const revision=++environmentReadRevision;
        const entry = {key, generation};
        entry.promise = listAll(pathFor(config.programId,'/environments'),'environments',sharedSignal,true).then(fresh => {
            sharedSignal.throwIfAborted();
            if (generation === viewGeneration && revision===environmentReadRevision) mergeEnvironmentList(fresh);
        }).finally(() => { if (environmentRead === entry) environmentRead = null; });
        environmentRead = entry;
    }
    await abortable(environmentRead.promise,signal);
    signal.throwIfAborted();
}

async function readVariableStatus(id, signal, config = connection) {
    const data = await request(pathFor(config.programId,`/environment/${encodeURIComponent(id)}/variables`),'GET',undefined,{signal,expectedConfig:config});
    signal.throwIfAborted();
    const environment = environments.find(item => String(item.id) === String(id));
    if (!environment) throw new Error('Environment no longer available. Refresh before continuing.');
    const variables = embedded(data,'variables');
    Object.assign(environment,variableUpdateState(environment,variables));
    return variables;
}

function pipelineEnvironmentBlocked(pipeline) {
    if(!pipeline)return false;
    return environmentIds(pipeline).some(id => environmentBlocksStart(environments.find(env => String(env.id) === id)));
}

function syncEnvironmentIndicators() {
    for (const state of groupViews.values()) {
        state.group.environment = environments.find(env => String(env.id) === state.group.id);
        updateGroupActions(state);
        for (const [id,card] of state.rows || []) {
            const start = card.querySelector('.action-start');
            if (start) start.disabled = busy || !!state.loading || pipelineEnvironmentBlocked(pipelines.find(pipeline=>String(pipeline.id)===id));
            const approve=card.querySelector('.action-approve');
            if(approve)approve.disabled=busy || !!state.loading || pipelineEnvironmentBlocked(pipelines.find(pipeline=>String(pipeline.id)===id));
        }
    }
    for (const card of $('content').querySelectorAll('[data-environment-id]')) {
        const env = environments.find(item=>String(item.id)===card.dataset.environmentId);
        if(!env)continue;
        const status = env.variableUpdateStatus || env.status;
        const badge = card.querySelector(':scope > .line > .pill');
        badge.replaceWith(pill(status));
    }
}

function scheduleEnvironmentPoll() {
    clearTimeout(environmentPollTimer);
    if (connectionChanged || !environments.some(env => env.variableUpdateStatus === 'updating' || String(env.status).toLowerCase() === 'updating')) return;
    const generation = viewGeneration, config = connection;
    environmentPollTimer = setTimeout(async () => {
        if (generation !== viewGeneration || connectionChanged) return;
        if (busy) {scheduleEnvironmentPoll();return;}
        environmentPollController=new AbortController();
        const signal = AbortSignal.any([historyController.signal,environmentPollController.signal,AbortSignal.timeout(30000)]);
        try {
            const pending = environments.filter(env=>env.variableUpdateStatus === 'updating' || String(env.status).toLowerCase() === 'updating').map(env=>String(env.id));
            await refreshEnvironmentList(signal,config);
            const variables=new Map();
            for (const id of pending) variables.set(id,await readVariableStatus(id,signal,config));
            signal.throwIfAborted();
            syncEnvironmentIndicators();
            await persistSnapshot(signal);
            if (tab === 'variables' && pending.includes(selectedEnvironment)) {
                await renderVariables(config.programId,signal,variables.get(selectedEnvironment));
                setMessage(environments.find(env=>String(env.id)===selectedEnvironment)?.variableUpdateStatus === 'updating'?'Variable update in progress. Pipeline starts are blocked.':'Environment status refreshed.');
            }
        } catch (error) {
            if (!signal.aborted) setMessage(`Environment status could not be checked: ${error.message}. Pipeline starts stay blocked until verified.`,true);
        } finally {if (generation === viewGeneration && !connectionChanged) scheduleEnvironmentPoll();}
    },5000);
}

async function persistSnapshot(signal) {
    signal?.throwIfAborted();
    try {
        await saveSnapshot(connection, {updatedAt:catalogUpdatedAt,environments,pipelines,executions:executionRecords},signal);
        cacheWarning = false;
    } catch (error) {
        if (signal?.aborted) throw signal.reason;
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
        if (signal.aborted && signal.reason?.name !== 'TimeoutError') throw new Error('Connection or view changed. Click Refresh to load the current configuration.');
        if (signal.aborted) throw new Error(`Refresh stopped after 45 seconds. Last step: ${$('message').textContent} Check Settings or retry Refresh.`);
        throw error;
    }
    finally {if(!connectionChanged&&!historyController.signal.aborted)scheduleEnvironmentPoll();}
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
        expandedEnvironments.clear(); variableDrafts.clear(); catalogUpdatedAt = 0;
    }
    snapshotIdentity = identity;
    connection = s;
    connectionChanged = false;
    $('environment').classList.toggle('hidden', tab !== 'variables');
    if (!s.programId) {
        $('content').replaceChildren(node('p', 'Configure your Adobe credentials and program ID in Settings.'));
        return;
    }
    $('programLabel').textContent = `Program ${s.programId}`;
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
        // Keep the last known catalog if either list request fails.
        const previousEnvironments = environments, previousPipelines = pipelines, previousUpdatedAt = catalogUpdatedAt;
        try {
            await refreshEnvironmentList(signal,s);
            await loadPipelines(s.programId, signal);
            catalogUpdatedAt = Date.now();
            const liveIds = new Set(pipelines.map(p => String(p.id)));
            executionRecords = Object.fromEntries(Object.entries(executionRecords).filter(([id]) => liveIds.has(id)));
            await persistSnapshot(signal);
        } catch (error) {
            environments = previousEnvironments; pipelines = previousPipelines; catalogUpdatedAt = previousUpdatedAt;
            throw error;
        }
    }
    if (!reloadCatalog && ['environments','variables'].includes(tab)) {
        await refreshEnvironmentList(signal,s);
        await persistSnapshot(signal);
    }
    if(tab==='environments') {
        for(const environment of environments.filter(env=>env.variableUpdateStatus))await readVariableStatus(environment.id,signal,s);
        await persistSnapshot(signal);
    }
    await loadEnvironmentPreferences(s.programId, signal);
    signal.throwIfAborted();
    if (tab !== 'variables') $('content').replaceChildren();
    if (tab === 'pipelines') {
        renderPipelines(s.programId);
        if (force) {
            for (const state of groupViews.values()) if (state.section.open) await refreshGroup(state,signal);
        }
    }
    if (tab === 'environments') renderEnvironments();
    if (tab === 'variables') await renderVariables(s.programId,signal);
    setMessage(`${force || reloadCatalog ? 'Catalog updated just now' : 'Cached catalog · expand an environment to refresh'}${cacheWarning ? ' · Session cache unavailable' : ''}`);
    if(tab==='variables')setMessage('Variables checked just now');
    if(tab==='environments')setMessage('Environments updated just now');
    $('message').title = `Catalog checked: ${new Date(catalogUpdatedAt).toLocaleString()}`;
    if (tab === 'variables' && environments.find(env=>String(env.id)===selectedEnvironment)?.variableUpdateStatus === 'updating') setMessage('Variable update in progress. Pipeline starts are blocked until the environment is ready.');
    scheduleEnvironmentPoll();
    return false;
}

function executionStepStates(ex) {
    return ex?._embedded?.stepStates || ex?._embedded?.['stepStates'] || [];
}

async function currentExecution(pid, pipeline, signal, expectedConfig, forceDetails = false) {
    const base = pathFor(pid, `/pipeline/${encodeURIComponent(pipeline.id)}`);
    const current = await request(base + '/execution', 'GET', undefined, {signal,expectedConfig});
    const execution = current?.id ? current : embedded(current, 'executions')[0];
    if (!execution?.id) return null;
    if (forceDetails || !execution._embedded?.stepStates) {
        const details = await request(base + `/execution/${encodeURIComponent(execution.id)}`, 'GET', undefined, {signal,expectedConfig});
        if (String(details?.id) !== String(execution.id)) throw new Error('Unexpected execution details returned.');
        return details;
    }
    return execution;
}

async function displayedExecution(pid, pipeline, signal, previous, forceDetails = false) {
    let current = null, missing = false;
    try {
        current = await currentExecution(pid,pipeline,signal,undefined,forceDetails);
        missing = !current;
    } catch (error) {
        if (signal?.aborted || !/^404\b/.test(error.message || '')) throw error;
        missing = true;
    }
    const execution = current || previous?.execution || null;
    const active = execution && ['NOT_STARTED','RUNNING','WAITING','CANCELLING'].includes(execution.status);
    // Adobe may remove /execution as soon as the pipeline becomes idle. Resolve
    // the observed run directly rather than retaining a cached active status.
    if (execution?.id && active && (missing || pipeline.status === 'IDLE')) {
        try {
            const final = await request(pathFor(pid,`/pipeline/${encodeURIComponent(pipeline.id)}/execution/${encodeURIComponent(execution.id)}`),'GET',undefined,{signal});
            if (String(final?.id) !== String(execution.id)) throw new Error('Unexpected execution details returned.');
            if (!missing) return {execution:final,historical:false,missing:false,stale:false};
            current = final;
        } catch (error) {
            if (signal?.aborted) throw signal.reason;
            return {execution,historical:true,missing,stale:true,error:`Last execution status could not be refreshed: ${error.message}`};
        }
    }
    // If current run is missing, first resolve a cached active run above.
    // Then read one latest summary so every environment shows the last outcome.
    if (missing) {
        try {
            const latest = await request(pathFor(pid,`/pipeline/${encodeURIComponent(pipeline.id)}/executions?start=0&limit=1`),'GET',undefined,{signal});
            const latestExecution = latest?.id ? latest : embedded(latest,'executions')[0] || null;
            return {execution:latestExecution || execution || null,historical:true,missing:true,historyChecked:!latestExecution&&!execution,stale:false};
        } catch (error) {
            if (signal?.aborted) throw signal.reason;
            return {execution:execution || null,historical:true,missing:true,stale:true,error:`Last execution status could not be refreshed: ${error.message}`};
        }
    }
    return {execution,historical:missing,missing,stale:false};
}

function targetLabels(pipeline) {
    return environmentIds(pipeline).map(id => environmentLabel(environments.find(env => String(env.id) === id) || {id}));
}

async function groupAction(pid, group, action, singlePipeline, expectedExecutionId) {
    if (busy || connectionChanged || groupViews.get(group.id)?.loading) return;
    const actionConfig = connection, signal = historyController.signal, generation = viewGeneration;
    const latestSettings = await abortable(settings(),signal);
    if (generation !== viewGeneration || snapshotKey(latestSettings) !== snapshotIdentity) {
        error(new Error('Connection settings changed. Refresh before running an action.'));
        return;
    }
    const decision = ['promote', 'reject'].includes(action);
    if (decision && !isProduction(group.environment)) return;
    const candidates = (singlePipeline ? [singlePipeline] : group.pipelines).filter(p =>
        decision ? group.approvals?.has(String(p.id)) : action === 'start' ? p.status === 'IDLE' : canStopPipeline(p));
    if (!candidates.length) return;
    const title = group.environment ? environmentLabel(group.environment) : group.name;
    const details = candidates.map(p => `${p.name || p.id} → ${targetLabels(p).join(', ') || 'No deployment target'}`).join('\n');
    const actionLabel = {start: 'Start', stop: 'Stop', promote: 'Approve', reject: 'Reject'}[action];
    if (!confirmAction(`${actionLabel.toUpperCase()} ${candidates.length} pipeline${candidates.length === 1 ? '' : 's'} in ${title}?\n\n${details}\n\nActions affect each entire pipeline, including all listed environments. Keep the popup open until results appear.`)) return;
    await run(async () => {
        const results = await runPipelineBatch(candidates, async pipeline => {
            const loadingId = String(pipeline.id);
            activePipelineActions.add(loadingId); syncPipelineLoading(loadingId);
            try {
            const base = pathFor(pid, `/pipeline/${encodeURIComponent(pipeline.id)}`);
            signal.throwIfAborted();
            const fresh = await request(base,'GET',undefined,{signal,expectedConfig:actionConfig});
            if (JSON.stringify(environmentIds(fresh).sort()) !== JSON.stringify(environmentIds(pipeline).sort())) return 'Skipped: deployment targets changed; refresh and review';
            if (['start','promote'].includes(action)) {
                await refreshEnvironmentList(signal,actionConfig);
                for (const id of environmentIds(fresh)) {
                    await readVariableStatus(id,signal,actionConfig);
                    const environment=environments.find(env=>String(env.id)===id);
                    if (environmentBlocksStart(environment)) {
                        await persistSnapshot(signal);syncEnvironmentIndicators();scheduleEnvironmentPoll();
                        return `Skipped: ${environmentLabel(environment)} is updating or unavailable`;
                    }
                }
            }
            if (decision) {
                const execution = await currentExecution(pid,fresh,signal,actionConfig,isProduction(group.environment));
                const expected = expectedExecutionId || group.approvals.get(String(pipeline.id));
                if (String(execution?.id) !== String(expected)) return 'Skipped: execution changed; refresh and review';
                const steps = executionStepStates(execution).filter(step => step.status === 'WAITING' && step.action === 'approval');
                if (steps.length !== 1) return 'Skipped: no single waiting production approval';
                const operation = approvalAction(steps[0], action === 'promote');
                if (!operation) return 'Skipped: approval action unavailable';
                await request(operation.path,'PUT',operation.body,{signal,expectedConfig:actionConfig});
                return `${actionLabel} requested`;
            }
            if (action === 'start') {
                if (fresh.status !== 'IDLE') return 'Skipped: no longer idle';
                await request(base + '/execution','PUT',undefined,{signal,expectedConfig:actionConfig});
                return 'Start requested';
            }
            if (!canStopPipeline(fresh)) return 'Skipped: no longer running';
            const execution = await currentExecution(pid,pipeline,signal,actionConfig,isProduction(group.environment));
            const expected = expectedExecutionId || group.executions?.get(String(pipeline.id));
            if (!expected || String(execution?.id) !== String(expected)) return 'Skipped: execution changed; refresh and review';
            const stops = executionStepStates(execution).map(stopAction).filter(Boolean);
            if (!stops.length) return 'Skipped: no cancellable step available';
            const failures = [];
            for (const stop of stops) {
                try { await request(stop.path,'PUT',stop.body,{signal,expectedConfig:actionConfig}); }
                catch (e) { failures.push(e.message); }
            }
            if (failures.length) throw new Error(`Stop incomplete: ${failures.join('; ')}`);
            return 'Stop requested';
            } finally { activePipelineActions.delete(loadingId); syncPipelineLoading(loadingId); }
        });
        if (signal.aborted || generation !== viewGeneration) throw new Error('Connection settings changed. No further pipeline actions were sent. Refresh before continuing.');
        let refreshError = '';
        try {
            for (const state of groupViews.values()) {
                if (state.section.open && state.group.pipelines.some(p => candidates.some(candidate => String(candidate.id) === String(p.id)))) {
                    await refreshGroup(state);
                }
            }
        } catch (e) { refreshError = ` Refresh failed: ${e.message}`; }
        const summary = node('div', '', 'batch-results');
        summary.setAttribute('role', 'status');
        summary.append(node('strong', `${actionLabel} results · ${title}`));
        for (const result of results) summary.append(node('p', `${result.pipeline.name || result.pipeline.id}: ${result.message}`, result.ok ? 'muted' : 'error'));
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
            if (state.generation !== viewGeneration) return;
            if (!section.open) {
                expandedEnvironments.add(group.id);
                if (!state.rendered) renderGroupBody(state,pid);
                if (!busy) refreshGroup(state).catch(error);
            } else expandedEnvironments.delete(group.id);
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
        if (card) setCardBusy(card,'pipeline',loading);
    }
}

function updatePipelineCards(id) {
    const pipeline = pipelines.find(p => String(p.id) === id);
    if (!pipeline) return;
    for (const state of groupViews.values()) {
        const index = state.group.pipelines.findIndex(p => String(p.id) === id);
        if (index < 0) continue;
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
        if (!connectionChanged) updateGroupActions(state);
    }
}

function updateGroupActions(state) {
    const {group,buttons} = state;
    if (!buttons) return;
    group.approvals.clear();
    for(const pipeline of group.pipelines){
        const record=executionRecords[String(pipeline.id)];
        if(isProduction(group.environment)&&record?.execution?.id&&!record.historical&&!record.stale&&executionStepStates(record.execution).some(step=>step.status==='WAITING'&&step.action==='approval'))group.approvals.set(String(pipeline.id),record.execution.id);
    }
    buttons.start.disabled = busy || !!state.loading || !group.pipelines.some(p => p.status === 'IDLE' && !pipelineEnvironmentBlocked(p));
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
    summaryStatus.textContent=blocked?'Blocked':waiting?`${waiting} waiting`:'';summaryStatus.hidden=!summaryStatus.textContent;
    buttons.stop.disabled = busy || !!state.loading || !group.pipelines.some(canStopPipeline);
    if (buttons.promote) {
        buttons.promote.disabled = busy || !!state.loading || !group.pipelines.some(p=>group.approvals.has(String(p.id))&&!pipelineEnvironmentBlocked(p));
        buttons.reject.disabled = busy || !!state.loading || !group.approvals.size;
    }
}

function syncGroupRows(state,pid) {
    if(!state.rendered){updateGroupActions(state);return;}
    const ids = new Set(state.group.pipelines.map(p => String(p.id)));
    for (const [id,card] of state.rows) if (!ids.has(id)) {
        card.remove(); state.rows.delete(id);
        state.group.approvals.delete(id); state.group.executions.delete(id);
    }
    let preceding = null;
    for (const pipeline of state.group.pipelines) {
        const id = String(pipeline.id);
        let card = state.rows.get(id);
        if (!card) { card = renderPipelineCard(state,pid,pipeline); state.rows.set(id,card); }
        if (preceding ? preceding.nextElementSibling !== card : state.body.firstElementChild !== card) {if(preceding)preceding.after(card);else state.body.prepend(card);}
        preceding = card;
    }
    state.section.querySelector('.environment-summary .muted').textContent = `${state.group.pipelines.length} pipeline${state.group.pipelines.length === 1 ? '' : 's'}`;
}

async function refreshGroup(state, parentSignal) {
    if (state.loading) return state.loading;
    const generation = viewGeneration, config = connection;
    const signal = AbortSignal.any([historyController.signal,AbortSignal.timeout(45000),...(parentSignal ? [parentSignal] : [])]);
    state.notice.textContent = 'Refreshing pipeline status...';
    state.section.dataset.loading = 'true';
    state.refreshControls = [...state.section.querySelectorAll('.group-heading button, .environment-body button, .environment-body input, .environment-body select')].map(control => [control,control.disabled]);
    state.refreshControls.forEach(([control]) => { control.disabled = true; });
    state.section.setAttribute('aria-busy','true');
    for(const card of state.rows?.values() || [])setCardBusy(card,'pipeline',true);
    state.loading = (async () => {
        const environmentStatus = refreshEnvironmentList(signal,config,true).then(async () => {
            if (state.group.id) await readVariableStatus(state.group.id,signal,config);
            syncEnvironmentIndicators();scheduleEnvironmentPoll();
        });
        const groupPipelinesBefore = state.group.pipelines;
        const readPipeline = pipeline => {
            const id = String(pipeline.id);
            if (!pipelineReads.has(id)) {
                const pending = (async () => {
                    const fresh = projectPipeline(await request(pathFor(config.programId,`/pipeline/${encodeURIComponent(id)}`),'GET',undefined,{signal}));
                    const production = environmentIds(fresh).some(id => isProduction(environments.find(env => String(env.id) === id)));
                    const record = await displayedExecution(config.programId,fresh,signal,executionRecords[id],production);
                    signal.throwIfAborted();
                    if (generation !== viewGeneration) return;
                    const index = pipelines.findIndex(item => String(item.id) === id);
                    if (index >= 0) pipelines[index] = fresh;
                    executionRecords[id] = {...record,execution:projectExecution(record.execution),updatedAt:record.stale ? executionRecords[id]?.updatedAt || 0 : Date.now()};
                    updatePipelineCards(id);
                })().catch(error => {
                    if (signal.aborted) throw signal.reason;
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
        // A small pool avoids sequential latency without flooding Adobe.
        let cursor = 0;
        await Promise.all([environmentStatus,...Array.from({length:Math.min(4,groupPipelinesBefore.length)},async () => {
            while (cursor < groupPipelinesBefore.length) await readPipeline(groupPipelinesBefore[cursor++]);
        })]);
        signal.throwIfAborted();
        if (generation !== viewGeneration) return;
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
        if (parentSignal?.aborted) throw error;
    }).finally(() => {
        for(const [id,card] of state.rows || [])setCardBusy(card,'pipeline',pipelineReads.has(id)||activePipelineActions.has(id));
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
    heading.append(node('small','Environment actions'));
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
    pipelinePill.textContent = `Current: ${pipelineLabel}`;
    pipelinePill.title = `Adobe pipeline status: ${p.status || 'UNKNOWN'}${pipelineLabel === 'Waiting' ? ' · Check execution details for the pending decision' : ''}`;
    if (pipelineLabel === 'Waiting') { pipelinePill.classList.remove('busy'); pipelinePill.classList.add('waiting'); }
    const kind = pipelineKind(p);
    const typeRow = node('div', '', 'pipeline-type-row');
    typeRow.append(typeRibbon(kind));
    c.append(typeRow);
    pipelinePill.hidden = false;
    metadata.append(node('p', `Pipeline availability: ${pipelineLabel}`, 'muted'));
    if (environmentIds(p).length > 1) c.append(node('p', `Shared pipeline · ${targetLabels(p).join(', ')}`, 'muted'));
    if (p.detailsError) c.append(node('p', `Environment details unavailable: ${p.detailsError}`, 'error'));
    const actions = node('div', '', 'actions');
    const base = pathFor(pid, `/pipeline/${encodeURIComponent(p.id)}`);
    if (p.status === 'IDLE') {
        const start=actionButton('Start', () => groupAction(pid, group, 'start', p), 'start');
        start.disabled=pipelineEnvironmentBlocked(p);
        if(start.disabled)start.title='A target environment is updating or unavailable';
        actions.append(start);
    }
    const executionInfo = node('div', '', 'execution-info');
    try {
        const record = executionRecords[String(p.id)];
        const {execution, historical} = record || {};
        if (execution?.id) {
            if (!historical) group.executions.set(String(p.id), execution.id);
            executionInfo.append(executionRibbon(execution,record?.stale));
            metadata.append(node('p', `${historical ? 'Last execution' : 'Execution'} ${execution.id}`, 'muted execution-reference'));
            const executedAt = execution.startedAt || execution.createdAt;
            const executedDate = executedAt ? new Date(executedAt) : null;
            const timestamp = node('p', executedDate && !Number.isNaN(executedDate.getTime())
                ? `Started: ${executedDate.toLocaleString()} (local time)` : 'Execution date unavailable', 'muted');
            if (executedDate && !Number.isNaN(executedDate.getTime())) timestamp.title = executedAt;
            executionInfo.append(timestamp);
            for (const step of (historical ? [] : executionStepStates(execution)).filter(st => ['RUNNING', 'WAITING'].includes(st.status))) {
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
                    if (approvalAction(step, false)) stateCard.append(actionButton('Reject deployment', () => groupAction(pid, group, 'reject', p, execution.id), 'reject'));
                }
                if (stop && !approval) stateCard.append(actionButton('Stop', () => groupAction(pid, group, 'stop', p, execution.id), 'stop'));
                if (approval && !isProduction(group.environment)) stateCard.append(node('p', 'Awaiting production approval. Open the Production environment to promote or reject.', 'muted'));
                executionInfo.append(stateCard);
            }
        } else {
            const label = record?.error ? 'Status unavailable' : record?.historyChecked ? 'No executions' : record?.missing ? 'Status unavailable' : 'Checking status';
            const status = node('span',label,`pill execution-status ${record?.error ? 'unavailable' : 'no-executions'}`);
            status.title = record?.error || (record?.historyChecked ? 'No pipeline executions found.' : 'Latest execution status is loading.');
            executionInfo.append(status);
        }

        if (record?.error) executionInfo.append(node('p', `Execution refresh failed: ${record.error}. Showing cached data.`, 'error'));
        if (record?.updatedAt) metadata.append(node('small', `Execution checked: ${new Date(record.updatedAt).toLocaleString()}`, 'muted execution-checked'));
    } catch (e) {
        executionInfo.append(node('p', `Execution details unavailable: ${e.message}`, 'muted'));
    }
    c.append(executionInfo, actions, metadata, historyPanel(base + '/executions?start=0&limit=20', historyController.signal, async latest => {
        const previous = executionRecords[String(p.id)];
        if (!previous?.missing || state.generation !== viewGeneration) return;
        const record = {execution:projectExecution(latest),historical:true,missing:true,historyChecked:true,updatedAt:Date.now()};
        executionRecords[String(p.id)] = record;
        const info = state.rows?.get(String(p.id))?.querySelector('.execution-info') || executionInfo;
        info.replaceChildren();
        if (latest) {
            const status = executionRibbon(latest);
            const date = latest.startedAt || latest.createdAt;
            const parsed = date ? new Date(date) : null;
            const timestamp = node('p',parsed && !Number.isNaN(parsed.getTime()) ? `Started: ${parsed.toLocaleString()} (local time)` : 'Execution date unavailable','muted');
            if (parsed && !Number.isNaN(parsed.getTime())) timestamp.title = date;
            info.append(status,timestamp);
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
    }, loading => setCardBusy(state.rows?.get(String(p.id)) || c,'history',loading)));
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
        c.append(node('p', `Type: ${env.type || 'N/A'} · Region: ${env.region || 'N/A'} · ID: ${env.id}`, 'muted'));
        const key = aliasKey(connection.orgId, connection.programId, env.id);
        const alias = node('input');
        alias.value = aliases[key] || '';
        alias.placeholder = 'Local environment alias';
        alias.maxLength = 80;
        alias.setAttribute('aria-label', `Alias for ${env.name || env.id}`);
        const row = node('div', '', 'alias-row');
        row.append(alias, btn('Save alias', () => run(async () => {
            const value = alias.value.trim();
            if (value) await chrome.storage.local.set({[key]: value});
            else await chrome.storage.local.remove(key);
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
                if (hidden) next.add(String(env.id));
                else next.delete(String(env.id));
                await chrome.storage.local.set({[hiddenEnvironmentsKey()]: [...next]});
                await updateLocalPreferences();
            });
            if (!saved) visibility.checked = hiddenEnvironments.has(String(env.id));
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
    const ep = pathFor(pid, `/environment/${encodeURIComponent(selectedEnvironment)}/variables`);
    setMessage('Loading environment variables...');
    const freshVariables = loadedVariables || await readVariableStatus(selectedEnvironment,signal);
    signal.throwIfAborted();
    const draftKey=JSON.stringify([snapshotIdentity,selectedEnvironment]);
    const draft=variableDrafts.get(draftKey);
    const vars=draft?.original || freshVariables;
    content.replaceChildren();
    const environment=environments.find(env=>String(env.id)===selectedEnvironment);
    const updating=environment.variableUpdateStatus === 'updating' || String(environment.status).toLowerCase()==='updating';
    const failed=environment.variableUpdateStatus === 'failed';
    const notice=node('div','','variable-update-notice');notice.setAttribute('role','status');
    if(updating){notice.append(variableStatusRibbon('updating'),node('p','Variable update in progress. Pipeline starts are blocked. Status refreshes automatically.'));}
    else if(failed){notice.append(variableStatusRibbon('failed'),node('p','Variable update failed. Review the variable statuses and retry your changes.','error'));}
    else notice.append(variableStatusRibbon('ready'));
    content.append(notice);
    const editor = node('section','','variable-editor');
    editor.setAttribute('aria-label','Environment variables');
    const rows = [];
    const draftStatus=node('span','','muted variable-draft-status');
    const serialize=()=>rows.map(item=>({originalName:item.originalName,originalService:item.originalService,name:item.name.value,value:item.value.value,type:item.type.value,service:item.service.value,remove:item.remove.checked,open:item.row.open}));
    const baseline=variable=>({originalName:variable.name,originalService:variable.service||'',name:variable.name,value:variable.type==='secretString'?'':String(variable.value??''),type:variable.type||'string',service:variable.service||'',remove:false});
    const changed=edit=>{const original=vars.find(v=>v.name===edit.originalName&&(v.service||'')===edit.originalService);return !original||Object.entries(baseline(original)).some(([key,value])=>edit[key]!==value);};
    const remember=()=>{
        const edits=serialize(), count=edits.filter(changed).length;
        draftStatus.textContent=`${count} unsaved change${count===1?'':'s'}`;
        draftStatus.hidden=!count;
        draftStatus.title='Drafts remain in memory while this popup stays open.';
        const discard=editor.querySelector('.variable-discard');if(discard)discard.hidden=!count;
        const save=editor.querySelector('.action-save');if(save)save.disabled=updating||!count;
        rows.forEach((item,index)=>{
            item.row.classList.toggle('has-changes',changed(edits[index]));
            const preview=item.row.querySelector('.variable-preview-wrap');
            if(preview){const text=item.type.value==='secretString'?'••••••••':item.value.value;preview.dataset.tooltip=text;preview.setAttribute('aria-label',text);preview.querySelector('.variable-preview').textContent=text;}
        });
        if(count)variableDrafts.set(draftKey,{original:vars,edits});else variableDrafts.delete(draftKey);
    };
    const makeSelect = (label, choices, selected) => {
        const select = node('select');
        select.setAttribute('aria-label',label);
        for(const [value,text] of choices){const option=node('option',text);option.value=value;select.append(option);}
        select.value=selected || '';
        return select;
    };
    const field = (label, control) => {
        const wrapper=node('label','', 'variable-field');
        if(control.tagName==='SELECT'){const box=node('span','','select-control');box.append(control);wrapper.append(node('span',label),box);}
        else wrapper.append(node('span',label),control);
        return wrapper;
    };
    const addRow = (variable, saved) => {
        editor.querySelector('.variable-empty')?.remove();
        const existing = !!variable;
        const originalName = variable?.name || '';
        const originalService = variable?.service || '';
        const secret = variable?.type === 'secretString';
        const row = node('details','','variable-row');row.open=saved?.open ?? !existing;
        row.dataset.originalName = originalName;
        row.dataset.originalService = originalService;
        const name=node('input');name.value=originalName;name.placeholder='VARIABLE_NAME';name.autocomplete='off';name.setAttribute('aria-label',`Name${originalName?` for ${originalName}`:''}`);
        const value=node('input');value.type=secret?'password':'text';value.value=variable ? (secret?'':String(variable.value??'')) : '';value.placeholder=secret?'Enter a replacement secret':'Variable value';value.autocomplete='off';value.setAttribute('aria-label',`Value${originalName?` for ${originalName}`:''}`);
        const type=makeSelect(`Type${originalName?` for ${originalName}`:''}`,[['string','String'],['secretString','Secret']],variable?.type||'string');type.disabled=existing;type.title=existing?'Adobe does not allow changing a variable type. Delete and add it again.':'';
        type.addEventListener('change',()=>{if(!existing)value.type=type.value==='secretString'?'password':'text';});
        value.maxLength=type.value==='secretString'?499:2147483647;
        type.addEventListener('change',()=>{value.maxLength=type.value==='secretString'?499:2147483647;});
        const service=makeSelect(`Service${originalName?` for ${originalName}`:''}`,[['','All services'],['author','Author'],['publish','Publish'],['preview','Preview']],variable?.service||'');
        const removeLabel=node('label','','variable-remove');const remove=node('input');remove.type='checkbox';remove.setAttribute('aria-label',`Remove ${originalName||'new variable'}`);removeLabel.append(remove,actionIcon('remove'),node('span','Remove'));
        remove.disabled=!existing;remove.addEventListener('change',()=>row.classList.toggle('marked-for-removal',remove.checked));
        const top=node('summary','','variable-row-heading');const title=node('strong',originalName ? `${originalName} · ${originalService || 'All services'}` : 'New variable');title.prepend(actionIcon(existing?'edit':'add'));top.append(title);
        if(variable?.status)top.append(variableStatusRibbon(variable.status));
        if(existing)top.append(removeLabel);
        else top.append(actionButton('Remove draft',()=>{rows.splice(rows.findIndex(item=>item.row===row),1);row.remove();remember();if(!rows.length)editor.append(node('p','No variables yet. Use Add variable to create one.','muted variable-empty'));},'remove','ghost'));
        const fields=node('div','','variable-fields');fields.append(field('Name',name),field(secret?'Replacement secret':'Value',value),field('Type',type),field('Service',service));
        const valuePreview=variableTooltip(variableDisplayValue(variable));
        if(existing){const preview=node('div','','variable-value');preview.append(valuePreview);top.append(preview);row.append(top,fields);}else row.append(top,fields);
        if(existing || saved)editor.append(row);
        else {editor.querySelector('.variable-actions').after(row);content.scrollTop=0;name.focus();}
        rows.push({row,name,value,type,service,originalName,originalService,remove});
        if(saved){name.value=saved.name;value.value=saved.value;type.value=saved.type;service.value=saved.service;remove.checked=saved.remove;row.classList.toggle('marked-for-removal',saved.remove);value.type=type.value==='secretString'?'password':'text';}
        row.addEventListener('input',remember);row.addEventListener('change',remember);row.addEventListener('toggle',()=>{if(variableDrafts.has(draftKey))remember();});
        if(!existing&&!saved)remember();
    };
    if(draft)for(const saved of draft.edits)addRow(vars.find(v=>v.name===saved.originalName&&(v.service||'')===saved.originalService),saved);
    else vars.forEach(variable=>addRow(variable));
    if(!rows.length)editor.append(node('p','No variables yet. Use Add variable to create one.','muted variable-empty'));
    const actions=node('div','','actions variable-actions');
    actions.append(actionButton('Add variable',()=>addRow(null),'add'));
    actions.append(actionButton('Save changes',async()=>{
        try{
            if(updating)throw new Error('Wait for the current variable update to complete before saving more changes.');
            const edits=rows.map(item=>({originalName:item.originalName,originalService:item.originalService,name:item.name.value,value:item.value.value,type:item.type.value,service:item.service.value,remove:item.remove.checked}));
            const patch=buildVariablePatch(vars,edits);
            if(!patch.length){setMessage('No variable changes to save.');return;}
            const describe=change=>`${change.name} (${change.service || 'all services'})`;
            const changedNames=[...new Set(patch.map(describe))];
            const removals=patch.filter(change=>change.value==='').map(describe);
            const target=environmentLabel(environments.find(env=>String(env.id)===String(selectedEnvironment))||{id:selectedEnvironment});
            const summary=removals.length?`\n\nVariables removed: ${[...new Set(removals)].join(', ')}`:'';
            if(!confirmAction(`Apply ${patch.length} variable change${patch.length===1?'':'s'} to ${target}?\n\nAffected variables: ${changedNames.join(', ')}${summary}\n\nKeep the popup open until the save completes.`))return;
            await run(async()=>{
                const mutationSignal=historyController.signal;
                try{
                    const result=await request(ep,'PATCH',patch,{signal:mutationSignal,expectedConfig:connection});
                    variableDrafts.delete(draftKey);
                    Object.assign(environment,{variableUpdateStatus:'updating',variableUpdateObserved:false,variableUpdateStartedAt:Date.now()});
                    const returned=Array.isArray(result)?result:embedded(result,'variables');
                    if(returned.some(variable=>['creating','updating','deleting'].includes(variable.status)))environment.variableUpdateObserved=true;
                    await persistSnapshot(mutationSignal);
                }
                catch(error){
                    if(/^500\b/.test(error.message||''))throw new Error(`Cloud Manager returned ${error.message}. Check variable names, service values, unchanged types, the 200-variable limit, and secret values under 500 characters. Environment updates can fail while a pipeline or AEM update is running. Refresh before retrying to see which changes applied.`);
                    throw error;
                }
                setMessage('Variable changes submitted. Environment update in progress; pipeline starts are blocked.');
                await renderVariables(pid,mutationSignal);
                if(environment.variableUpdateStatus !== 'updating')setMessage(environment.variableUpdateStatus === 'failed'?'Variable update failed. Review the variable statuses.':'Variable changes saved. Environment is ready.',environment.variableUpdateStatus === 'failed');
                scheduleEnvironmentPoll();
                return false;
            });
        }catch(error){error.message?setMessage(error.message,true):setMessage(String(error),true);}
    },'save','primary'));
    actions.append(btn('Discard changes',async()=>{if(!variableDrafts.has(draftKey))return;if(!confirmAction('Discard unsaved changes for this environment?'))return;variableDrafts.delete(draftKey);await renderVariables(pid,historyController.signal,freshVariables);},'ghost variable-discard'));
    const filters=node('div','','variable-filters');
    const search=node('input');search.type='search';search.placeholder='Search variables';search.setAttribute('aria-label','Search variables');
    const serviceFilter=makeSelect('Filter variables by service',[['*','All services'],['','Global'],['author','Author'],['publish','Publish'],['preview','Preview']],'*');
    const filterRows=()=>{const term=search.value.trim().toLowerCase();for(const item of rows)item.row.hidden=!!item.originalName&&(!`${item.name.value} ${item.service.value}`.toLowerCase().includes(term)||(serviceFilter.value!=='*'&&item.service.value!==serviceFilter.value));};
    search.addEventListener('input',filterRows);serviceFilter.addEventListener('change',filterRows);
    filters.append(search,field('Service filter',serviceFilter));
    editor.prepend(actions,draftStatus,filters);remember();
    if(updating)for(const control of editor.querySelectorAll('button,input,select'))control.disabled=true;
    content.append(editor);
    await persistSnapshot(signal);
    scheduleEnvironmentPoll();
}

for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => {
    if (busy && !activeRead) return;
    if(tab===b.dataset.tab)return;
    tab = b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach(t => {t.classList.toggle('active',t===b);if(t===b)t.setAttribute('aria-current','page');else t.removeAttribute('aria-current');});
    navigate();
});
$('environment').addEventListener('change', () => {
    if (busy && !activeRead) return;
    selectedEnvironment = $('environment').value;
    navigate();
});
$('refresh').addEventListener('click', () => navigate(true));
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
navigate();

chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !['clientId','orgId','programId','oauthScopes'].some(key => key in changes)) return;
    connectionChanged = true;
    variableDrafts.clear();
    clearTimeout(environmentPollTimer);
    historyController.abort();
    viewGeneration++;
    setMessage('Connection settings changed. Click Refresh to load the new configuration.');
    for (const control of $('content').querySelectorAll('button,input,select')) control.disabled = true;
});
