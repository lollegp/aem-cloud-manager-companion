import {loadSnapshot, saveSnapshot, snapshotKey, projectPipeline, projectExecution} from './cache.js';
import {historyPanel} from './history.js';
import {request, settings, abortable, pathFor, embedded, link, safeAPIPath} from './api.js';
import {aliasKey, environmentIds, groupPipelines, pipelineKind, variableEditValue, stopAction, runPipelineBatch, canStopPipeline, approvalAction, orderEnvironments, executionStatusLabel, pipelineStatusLabel} from './pipeline.js';

const $ = id => document.getElementById(id);
let tab = 'pipelines', environments = [], pipelines = [], selectedEnvironment = '';
let aliases = {}, connection = {}, busy = false;
let historyController = new AbortController();
let environmentOrder = [];
let hiddenEnvironments = new Set();
const expandedEnvironments = new Set();
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

async function run(fn) {
    if (busy) return false;
    busy = true;
    const controls = [...document.querySelectorAll('button:not(#settings), input, select')];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try {
        setMessage('Loading...');
        const result = await fn();
        if (result !== false) setMessage('Updated just now');
        return true;
    } catch (e) {
        error(e);
        return false;
    } finally {
        busy = false;
        controls.forEach((control,index) => restoreControl(control,disabled[index]));
        if (!connectionChanged) for (const state of groupViews.values()) updateGroupActions(state);
    }
}

function pill(s) {
    return node('span', s || 'UNKNOWN', `pill ${String(s || '').toLowerCase()}`);
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
            await refresh();
        }));
        button.setAttribute('aria-label', `${label.slice(2)} environment ${environmentLabel(env)}`);
        button.disabled = index < 0 || index + offset < 0 || index + offset >= environments.length;
        controls.append(button);
    }
    return controls;
}

async function listAll(path, key, signal) {
    const items = [], visited = new Set(), seenIds = new Set();
    while (path) {
        if (visited.has(path)) throw new Error('Repeated API pagination link.');
        visited.add(path);
        signal?.throwIfAborted();
        setMessage(`Loading ${key}, page ${visited.size}...`);
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
        expandedEnvironments.clear(); catalogUpdatedAt = 0;
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
    if (force || !catalogUpdatedAt) {
        // Keep the last known catalog if either list request fails.
        const previousEnvironments = environments, previousPipelines = pipelines, previousUpdatedAt = catalogUpdatedAt;
        try {
            environments = await listAll(pathFor(s.programId, '/environments'), 'environments', signal);
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
    await loadEnvironmentPreferences(s.programId, signal);
    signal.throwIfAborted();
    $('content').replaceChildren();
    if (tab === 'pipelines') {
        renderPipelines(s.programId);
        if (force) {
            for (const state of groupViews.values()) if (state.section.open) await refreshGroup(state,signal);
        }
    }
    if (tab === 'environments') renderEnvironments();
    if (tab === 'variables') await renderVariables(s.programId,signal);
    setMessage(`${force ? 'Updated' : 'Cached catalog'}: ${new Date(catalogUpdatedAt).toLocaleString()}${cacheWarning ? ' · Session cache unavailable' : ''}`);
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
    // Production accordions need the latest completed run even when /execution
    // is absent and the cached summary belongs to an older run. Read one item only.
    if (missing && forceDetails) {
        try {
            const latest = await request(pathFor(pid,`/pipeline/${encodeURIComponent(pipeline.id)}/executions?start=0&limit=1`),'GET',undefined,{signal});
            return {execution:embedded(latest,'executions')[0] || null,historical:true,missing:true,stale:false};
        } catch (error) {
            if (signal?.aborted) throw signal.reason;
            return {execution:previous?.execution || null,historical:true,missing:true,stale:true,error:`Last execution status could not be refreshed: ${error.message}`};
        }
    }
    const execution = current || previous?.execution || null;
    const active = execution && ['NOT_STARTED','RUNNING','WAITING','CANCELLING'].includes(execution.status);
    // Adobe may remove /execution as soon as the pipeline becomes idle. Resolve
    // the observed run directly rather than retaining a cached active status.
    if (execution?.id && active && (missing || pipeline.status === 'IDLE')) {
        try {
            const final = await request(pathFor(pid,`/pipeline/${encodeURIComponent(pipeline.id)}/execution/${encodeURIComponent(execution.id)}`),'GET',undefined,{signal});
            if (String(final?.id) !== String(execution.id)) throw new Error('Unexpected execution details returned.');
            return {execution:final,historical:missing || pipeline.status === 'IDLE',missing,stale:false};
        } catch (error) {
            if (signal?.aborted) throw signal.reason;
            return {execution,historical:true,missing,stale:true,error:`Last execution status could not be refreshed: ${error.message}`};
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
    const actionLabel = {start: 'Start', stop: 'Stop', promote: 'Promote', reject: 'Reject'}[action];
    if (!confirmAction(`${actionLabel.toUpperCase()} ${candidates.length} pipelines in ${title}?\n\n${details}\n\nActions affect each entire pipeline, including all listed environments. Keep the popup open until results appear.`)) return;
    await run(async () => {
        const results = await runPipelineBatch(candidates, async pipeline => {
            const loadingId = String(pipeline.id);
            activePipelineActions.add(loadingId); syncPipelineLoading(loadingId);
            try {
            const base = pathFor(pid, `/pipeline/${encodeURIComponent(pipeline.id)}`);
            signal.throwIfAborted();
            const fresh = await request(base,'GET',undefined,{signal,expectedConfig:actionConfig});
            if (JSON.stringify(environmentIds(fresh).sort()) !== JSON.stringify(environmentIds(pipeline).sort())) return 'Skipped: deployment targets changed; refresh and review';
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
        const section = node('details','','environment-group');
        section.open = expandedEnvironments.has(group.id);
        const summary = node('summary','','environment-summary');
        summary.append(node('strong',group.environment ? environmentLabel(group.environment) : group.name),node('span',`${group.pipelines.length} pipelines`,'muted'));
        const state = {group,section,notice:node('p','Cached data. Expand to refresh.','muted environment-sync'),body:node('div','','environment-body'),generation:viewGeneration,loading:null};
        section.append(summary,state.notice,state.body);
        groupViews.set(group.id,state);
        // Click includes keyboard activation; construction of an open details
        // element does not trigger network traffic.
        summary.addEventListener('click', () => {
            if (state.generation !== viewGeneration) return;
            // The native details toggle follows the click's default action.
            if (!section.open) {
                expandedEnvironments.add(group.id);
                if (!state.rendered) renderGroupBody(state,pid);
                if (!busy) refreshGroup(state).catch(error);
            } else expandedEnvironments.delete(group.id);
        });
        content.append(section);
        if (section.open) renderGroupBody(state,pid);
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
            // Keep an explicitly opened/paged history panel while status data updates.
            const history = previous.querySelector('.pipeline-history');
            if (history) {
                card.querySelector('.pipeline-history').replaceWith(history);
                setCardBusy(card,'history',previous.dataset.historyLoading === 'true');
            }
            previous.replaceWith(card);
            state.rows.set(id,card);
            if (!connectionChanged) updateGroupActions(state);
        }
    }
}

function updateGroupActions(state) {
    const {group,buttons} = state;
    if (!buttons) return;
    buttons.start.disabled = busy || !!state.loading || !group.pipelines.some(p => p.status === 'IDLE');
    buttons.stop.disabled = busy || !!state.loading || !group.pipelines.some(canStopPipeline);
    if (buttons.promote) {
        buttons.promote.disabled = busy || !!state.loading || !group.approvals.size;
        buttons.reject.disabled = busy || !!state.loading || !group.approvals.size;
    }
}

function syncGroupRows(state,pid) {
    const ids = new Set(state.group.pipelines.map(p => String(p.id)));
    for (const [id,card] of state.rows) if (!ids.has(id)) {
        card.remove(); state.rows.delete(id);
        state.group.approvals.delete(id); state.group.executions.delete(id);
    }
    let preceding = state.body.querySelector(':scope > .group-heading');
    for (const pipeline of state.group.pipelines) {
        const id = String(pipeline.id);
        let card = state.rows.get(id);
        if (!card) { card = renderPipelineCard(state,pid,pipeline); state.rows.set(id,card); }
        if (preceding.nextElementSibling !== card) preceding.after(card);
        preceding = card;
    }
    state.section.querySelector('.environment-summary .muted').textContent = `${state.group.pipelines.length} pipelines`;
}

async function refreshGroup(state, parentSignal) {
    if (state.loading) return state.loading;
    const generation = viewGeneration, config = connection;
    const signal = AbortSignal.any([historyController.signal,AbortSignal.timeout(45000),...(parentSignal ? [parentSignal] : [])]);
    state.notice.textContent = 'Refreshing pipeline status...';
    state.section.dataset.loading = 'true';
    state.refreshControls = [...state.body.querySelectorAll('button,input,select')].map(control => [control,control.disabled]);
    state.refreshControls.forEach(([control]) => { control.disabled = true; });
    state.section.setAttribute('aria-busy','true');
    state.loading = (async () => {
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
        await Promise.all(Array.from({length:Math.min(4,groupPipelinesBefore.length)},async () => {
            while (cursor < groupPipelinesBefore.length) await readPipeline(groupPipelinesBefore[cursor++]);
        }));
        signal.throwIfAborted();
        if (generation !== viewGeneration) return;
        const updated = groupPipelines(pipelines,environments,environmentOrder).find(group => group.id === state.group.id);
        state.group.pipelines = updated?.pipelines || [];
        syncGroupRows(state,config.programId);
        state.notice.textContent = state.group.pipelines.some(p => executionRecords[String(p.id)]?.error)
            ? 'Refresh completed with errors. Last known data remains visible.' : `Updated: ${new Date().toLocaleString()}`;
        await persistSnapshot(signal);
    })().catch(error => {
        if (generation === viewGeneration && !historyController.signal.aborted) {
            state.notice.textContent = 'Refresh failed. Last known data remains visible.';
            state.body.prepend(node('p',`Environment refresh failed: ${error.message}. Cached data remains visible; collapse and expand to retry.`,'error'));
        }
        if (parentSignal?.aborted) throw error;
    }).finally(() => {
        state.refreshControls.forEach(([control,disabled]) => restoreControl(control,disabled));
        state.section.dataset.loading = 'false'; state.section.setAttribute('aria-busy','false'); state.loading = null;
        if (!connectionChanged) updateGroupActions(state);
    });
    return state.loading;
}

function renderGroupBody(state,pid) {
    state.rendered = true;
    const group = state.group;
    state.body.replaceChildren();
    group.approvals = new Map(); group.executions = new Map();
    const heading = node('div','','group-heading');
    heading.append(node('small','Actions apply to eligible pipelines in this environment.'));
    const controls = node('div','','actions');
    const start = btn('▶ Start group',() => groupAction(pid,group,'start'),'primary');
    const stop = btn('■ Stop group',() => groupAction(pid,group,'stop'),'danger');
    start.disabled = !group.pipelines.some(p => p.status === 'IDLE');
    stop.disabled = !group.pipelines.some(canStopPipeline);
    controls.append(start,stop);
    let promote,reject;
    if (isProduction(group.environment)) {
        promote = btn('✓ Promote waiting',() => groupAction(pid,group,'promote'),'good');
        reject = btn('✕ Reject waiting',() => groupAction(pid,group,'reject'),'danger');
        controls.append(promote,reject);
    }
    heading.append(controls); state.body.append(heading);
    state.rows = new Map();
    state.buttons = {start,stop,promote,reject};
    for (const pipeline of group.pipelines) {
        const card = renderPipelineCard(state,pid,pipeline);
        state.rows.set(String(pipeline.id),card);
        state.body.append(card);
    }

    if (promote) {
        promote.disabled = !group.approvals.size;
        reject.disabled = !group.approvals.size;
    }
}

function renderPipelineCard(state,pid,p) {
    const group = state.group;
    group.approvals.delete(String(p.id));
    group.executions.delete(String(p.id));
    const c = card(p.name || `Pipeline ${p.id}`, p.status);
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
    c.append(node('p', `ID ${p.id}`, 'muted'));
    if (environmentIds(p).length > 1) c.append(node('p', `Shared pipeline · ${targetLabels(p).join(', ')}`, 'muted'));
    if (p.detailsError) c.append(node('p', `Environment details unavailable: ${p.detailsError}`, 'error'));
    const actions = node('div', '', 'actions');
    const base = pathFor(pid, `/pipeline/${encodeURIComponent(p.id)}`);
    if (p.status === 'IDLE') actions.append(btn('▶ Start', () => groupAction(pid, group, 'start', p), 'primary'));
    const executionInfo = node('div', '', 'execution-info');
    try {
        const record = executionRecords[String(p.id)];
        const {execution, historical} = record || {};
        if (execution?.id) {
            if (!historical) group.executions.set(String(p.id), execution.id);
            executionInfo.append(executionRibbon(execution,record?.stale));
            executionInfo.append(node('p', `${historical ? 'Last execution' : 'Execution'} ${execution.id}`, 'muted'));
            const executedAt = execution.startedAt || execution.createdAt;
            const executedDate = executedAt ? new Date(executedAt) : null;
            const timestamp = node('p', executedDate && !Number.isNaN(executedDate.getTime())
                ? `Started: ${executedDate.toLocaleString()} (local time)` : 'Execution date unavailable', 'muted');
            if (executedDate && !Number.isNaN(executedDate.getTime())) timestamp.title = executedAt;
            executionInfo.append(timestamp);
            for (const step of (historical ? [] : executionStepStates(execution)).filter(st => ['RUNNING', 'WAITING'].includes(st.status))) {
                const stateCard = card(step.action || step.name || 'Active step', step.status);
                const stop = stopAction(step);
                const approval = step.status === 'WAITING' && step.action === 'approval';
                if (approval && isProduction(group.environment)) {
                    group.approvals.set(String(p.id), execution.id);
                    if (approvalAction(step, true)) stateCard.append(btn('✓ Promote', () => groupAction(pid, group, 'promote', p, execution.id), 'good'));
                    if (approvalAction(step, false)) stateCard.append(btn('✕ Reject', () => groupAction(pid, group, 'reject', p, execution.id), 'danger'));
                }
                if (stop && !approval) stateCard.append(btn('■ Stop', () => groupAction(pid, group, 'stop', p, execution.id), 'danger'));
                if (approval && !isProduction(group.environment)) stateCard.append(node('p', 'Awaiting production approval. Open the Production environment to promote or reject.', 'muted'));
                executionInfo.append(stateCard);
            }
        } else {
            executionInfo.append(node('p', record?.missing ? 'No current execution. Open Execution history to view previous runs.' : 'Expand this environment to refresh execution details.', 'muted'));
        }
        if (record?.missing && record.execution) executionInfo.append(node('p','No current execution. Showing last observed data; open Execution history for previous runs.','muted'));
        if (record?.error) executionInfo.append(node('p', `Execution refresh failed: ${record.error}. Showing cached data.`, 'error'));
        if (record?.updatedAt) executionInfo.append(node('small', `Execution checked: ${new Date(record.updatedAt).toLocaleString()}`, 'muted'));
    } catch (e) {
        executionInfo.append(node('p', `Execution details unavailable: ${e.message}`, 'muted'));
    }
    c.append(executionInfo, actions, historyPanel(base + '/executions?start=0&limit=20', historyController.signal, async latest => {
        const previous = executionRecords[String(p.id)];
        if (!previous?.missing || state.generation !== viewGeneration) return;
        const record = {execution:projectExecution(latest),historical:true,missing:true,updatedAt:Date.now()};
        executionRecords[String(p.id)] = record;
        const info = state.rows?.get(String(p.id))?.querySelector('.execution-info') || executionInfo;
        info.replaceChildren();
        if (latest) {
            const status = executionRibbon(latest);
            const date = latest.startedAt || latest.createdAt;
            const parsed = date ? new Date(date) : null;
            const timestamp = node('p',parsed && !Number.isNaN(parsed.getTime()) ? `Started: ${parsed.toLocaleString()} (local time)` : 'Execution date unavailable','muted');
            if (parsed && !Number.isNaN(parsed.getTime())) timestamp.title = date;
            info.append(status,node('p',`Last execution ${latest.id}`,'muted'),timestamp);
        } else info.append(node('p','No previous executions found.','muted'));
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
        const c = card(environmentLabel(env), env.status);
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
            await refresh();
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
                await refresh();
            });
            if (!saved) visibility.checked = hiddenEnvironments.has(String(env.id));
        });
        visibilityLabel.append(visibility, node('span', 'Hide from Pipelines'));
        c.append(visibilityLabel);

        content.append(c);
    }
}

async function renderVariables(pid, signal) {
    const content = $('content');
    if (!selectedEnvironment) {
        content.append(node('p', 'No environments found.'));
        return;
    }
    const ep = pathFor(pid, `/environment/${encodeURIComponent(selectedEnvironment)}/variables`);
    setMessage('Loading environment variables...');
    const data = await request(ep, 'GET', undefined, {signal});
    const vars = embedded(data, 'variables');
    const form = node('div', '', 'card');
    form.append(node('h2', 'Add or update variable'));
    const name = node('input');
    name.placeholder = 'VARIABLE_NAME';
    name.setAttribute('aria-label', 'Variable name');
    const value = node('input');
    value.placeholder = 'Variable value';
    value.setAttribute('aria-label', 'Variable value');
    const type = node('select');
    for (const t of ['string', 'secretString']) {
        const o = node('option', t);
        o.value = t;
        type.append(o);
    }
    type.setAttribute('aria-label', 'Variable type');
    type.addEventListener('change', () => { value.type = type.value === 'secretString' ? 'password' : 'text'; });
    const service = node('select');
    service.setAttribute('aria-label', 'Variable service');
    for (const [v, t] of [['', 'All services'], ['author', 'Author'], ['publish', 'Publish'], ['preview', 'Preview']]) {
        const o = node('option', t);
        o.value = v;
        service.append(o);
    }
    form.append(name, value, type, service, btn('Save variable', async () => {
        const n = name.value.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) || !value.value) {
            error(new Error('Use a valid name and a nonempty value.'));
            return;
        }
        const v = {name: n, value: value.value, type: type.value};
        if (service.value) v.service = service.value;
        const saved = await perform(ep, 'PATCH', {variables: [v]}, `Save ${n} in environment ${selectedEnvironment}?`);
        if (saved) value.value = '';
    }, 'primary'));
    content.append(form);
    if (!vars.length) {
        content.append(node('div', 'No variables found.', 'empty'));
        return;
    }
    for (const v of vars) {
        const c = card(v.name, v.status || v.type);
        c.append(node('p', v.type === 'secretString' ? '••••••••' : String(v.value ?? ''), 'muted'));
        c.append(node('p', `Service: ${v.service || 'All'}`, 'muted'));
        const actions = node('div', '', 'actions');
        actions.append(btn('Edit', () => {
            name.value = v.name;
            value.value = variableEditValue(v);
            value.type = v.type === 'secretString' ? 'password' : 'text';
            value.placeholder = v.type === 'secretString' ? 'Enter a replacement secret (current value is hidden)' : 'Variable value';
            type.value = v.type || 'string';
            service.value = v.service || '';
            form.scrollIntoView({block: 'start'});
            value.focus();
        }));
        actions.append(btn('Delete', () => perform(ep, 'PATCH', {variables: [{name: v.name, value: ''}]}, `DELETE
        ${v.name} from environment
        ${selectedEnvironment}
        ?`), 'danger'));
        c.append(actions);
        content.append(c);
    }
}

for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => {
    if (busy) return;
    tab = b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach(t => t.classList.toggle('active', t === b));
    run(refresh);
});
$('environment').addEventListener('change', () => {
    if (busy) return;
    selectedEnvironment = $('environment').value;
    run(refresh);
});
$('refresh').addEventListener('click', () => run(() => refresh(true)));
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
run(refresh);

chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !['clientId','orgId','programId','oauthScopes'].some(key => key in changes)) return;
    connectionChanged = true;
    historyController.abort();
    viewGeneration++;
    setMessage('Connection settings changed. Click Refresh to load the new configuration.');
    for (const control of $('content').querySelectorAll('button,input,select')) control.disabled = true;
});
