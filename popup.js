import {historyPanel} from './history.js';
import {request, settings, abortable, pathFor, embedded, link, safeAPIPath} from './api.js';
import {aliasKey, environmentIds, groupPipelines, pipelineKind, variableEditValue, stepActionPath, stopAction, runPipelineBatch, canStopPipeline, approvalAction, orderEnvironments} from './pipeline.js';

const $ = id => document.getElementById(id);
let tab = 'pipelines', environments = [], pipelines = [], selectedEnvironment = '';
let aliases = {}, connection = {}, busy = false;
let historyController = new AbortController();
let environmentOrder = [];
let hiddenEnvironments = new Set();
const collapsedEnvironments = new Set();
const node = (tag, text = '', className = '') => {
    const n = document.createElement(tag);
    n.textContent = String(text ?? '');
    if (className) n.className = className;
    return n;
};

function btn(text, fn, className = '') {
    const b = node('button', text, className);
    b.addEventListener('click', fn);
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
        controls.forEach((control, index) => { control.disabled = disabled[index]; });
    }
}

function pill(s) {
    return node('span', s || 'UNKNOWN', `pill ${String(s || '').toLowerCase()}`);
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
    if (busy || !confirmAction(message)) return false;
    return run(async () => {
        await request(path, method, payload);
        await refresh();
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

async function loadEnvironments(programId, signal) {
    environments = await listAll(pathFor(programId, '/environments'), 'environments', signal);
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

async function refresh() {
    const signal = AbortSignal.timeout(45000);
    try { await refreshView(signal); }
    catch (error) {
        if (signal.aborted) throw new Error(`Refresh stopped after 45 seconds. Last step: ${$('message').textContent} Check Settings or retry Refresh.`);
        throw error;
    }
}

async function refreshView(signal) {
    historyController.abort();
    historyController = new AbortController();
    setMessage('Loading connection settings...');
    const s = await abortable(settings(), signal);
    connection = s;
    $('environment').classList.toggle('hidden', tab !== 'variables');
    $('content').replaceChildren();
    if (!s.programId) {
        $('content').append(node('p', 'Configure your Adobe credentials and program ID in Settings.'));
        return;
    }
    $('programLabel').textContent = `Program ${s.programId}`;
    if (tab === 'pipelines') {
        await loadEnvironments(s.programId, signal);
        await loadPipelines(s.programId, signal);
        await renderPipelines(s.programId, signal);
    }
    if (tab === 'environments') {
        await loadEnvironments(s.programId, signal);
        renderEnvironments();
    }
    if (tab === 'variables') {
        await loadEnvironments(s.programId, signal);
        await renderVariables(s.programId, signal);
    }
}

function executionStepStates(ex) {
    return ex?._embedded?.stepStates || ex?._embedded?.['stepStates'] || [];
}

async function currentExecution(pid, pipeline, signal) {
    const base = pathFor(pid, `/pipeline/${encodeURIComponent(pipeline.id)}`);
    const current = await request(base + '/execution', 'GET', undefined, {signal});
    const execution = current?.id ? current : embedded(current, 'executions')[0];
    if (!execution?.id) return null;
    if (!execution._embedded?.stepStates) {
        return request(base + `/execution/${encodeURIComponent(execution.id)}`, 'GET', undefined, {signal});
    }
    return execution;
}

async function displayedExecution(pid, pipeline, signal) {
    try {
        return {execution: await currentExecution(pid, pipeline, signal), historical: false};
    } catch (error) {
        if (signal?.aborted || !/^404\b/.test(error.message || '')) throw error;
        const history = await request(pathFor(pid, `/pipeline/${encodeURIComponent(pipeline.id)}/executions?start=0&limit=1`), 'GET', undefined, {signal});
        return {execution: embedded(history, 'executions')[0] || null, historical: true};
    }
}

function targetLabels(pipeline) {
    return environmentIds(pipeline).map(id => environmentLabel(environments.find(env => String(env.id) === id) || {id}));
}

async function groupAction(pid, group, action, singlePipeline, expectedExecutionId) {
    if (busy) return;
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
            const base = pathFor(pid, `/pipeline/${encodeURIComponent(pipeline.id)}`);
            const fresh = await request(base);
            if (JSON.stringify(environmentIds(fresh).sort()) !== JSON.stringify(environmentIds(pipeline).sort())) return 'Skipped: deployment targets changed; refresh and review';
            if (decision) {
                const execution = await currentExecution(pid, fresh);
                const expected = expectedExecutionId || group.approvals.get(String(pipeline.id));
                if (String(execution?.id) !== String(expected)) return 'Skipped: execution changed; refresh and review';
                const steps = executionStepStates(execution).filter(step => step.status === 'WAITING' && step.action === 'approval');
                if (steps.length !== 1) return 'Skipped: no single waiting production approval';
                const operation = approvalAction(steps[0], action === 'promote');
                if (!operation) return 'Skipped: approval action unavailable';
                await request(operation.path, 'PUT', operation.body);
                return `${actionLabel} requested`;
            }
            if (action === 'start') {
                if (fresh.status !== 'IDLE') return 'Skipped: no longer idle';
                await request(base + '/execution', 'PUT');
                return 'Start requested';
            }
            if (!canStopPipeline(fresh)) return 'Skipped: no longer running';
            const execution = await currentExecution(pid, pipeline);
            const expected = expectedExecutionId || group.executions?.get(String(pipeline.id));
            if (!expected || String(execution?.id) !== String(expected)) return 'Skipped: execution changed; refresh and review';
            const stops = executionStepStates(execution).map(stopAction).filter(Boolean);
            if (!stops.length) return 'Skipped: no cancellable step available';
            const failures = [];
            for (const stop of stops) {
                try { await request(stop.path, 'PUT', stop.body); }
                catch (e) { failures.push(e.message); }
            }
            if (failures.length) throw new Error(`Stop incomplete: ${failures.join('; ')}`);
            return 'Stop requested';
        });
        let refreshError = '';
        try { await refresh(); } catch (e) { refreshError = ` Refresh failed: ${e.message}`; }
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

async function renderPipelines(pid, signal) {
    const content = $('content');
    if (!pipelines.length) {
        content.append(node('div', 'No pipelines found.', 'empty'));
        return;
    }
    const executions = new Map();
    const groups = groupPipelines(pipelines, environments, environmentOrder).filter(group => !hiddenEnvironments.has(group.id));
    if (!groups.length) {
        content.append(node('div', 'All pipeline environments are hidden. Change visibility in Environments.', 'empty'));
        return;
    }
    for (const group of groups) {
        const section = node('details', '', 'environment-group');
        section.open = !collapsedEnvironments.has(group.id);
        section.addEventListener('toggle', () => {
            if (section.open) collapsedEnvironments.delete(group.id);
            else collapsedEnvironments.add(group.id);
        });
        const summary = node('summary', '', 'environment-summary');
        summary.append(node('strong', group.environment ? environmentLabel(group.environment) : group.name), node('span', `${group.pipelines.length} pipelines`, 'muted'));
        section.append(summary);
        group.approvals = new Map();
        group.executions = new Map();
        const heading = node('div', '', 'group-heading');
        heading.append(node('small', 'Actions apply to eligible pipelines in this environment.'));
        const actions = node('div', '', 'actions');
        const start = btn('▶ Start group', () => groupAction(pid, group, 'start'), 'primary');
        const stop = btn('■ Stop group', () => groupAction(pid, group, 'stop'), 'danger');
        start.disabled = !group.pipelines.some(p => p.status === 'IDLE');
        stop.disabled = !group.pipelines.some(canStopPipeline);
        actions.append(start, stop);
        let promote, reject;
        if (isProduction(group.environment)) {
            promote = btn('✓ Promote waiting', () => groupAction(pid, group, 'promote'), 'good');
            reject = btn('✕ Reject waiting', () => groupAction(pid, group, 'reject'), 'danger');
            promote.disabled = reject.disabled = true;
            actions.append(promote, reject);
        }
        heading.append(actions);
        section.append(heading);
        content.append(section);
        for (const p of group.pipelines) {
            const c = card(p.name || `Pipeline ${p.id}`, p.status);
            c.classList.add('pipeline-row');
            c.dataset.pipelineId = String(p.id);
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
            try {
                signal?.throwIfAborted();
                setMessage(`Loading execution for pipeline ${p.name || p.id}...`);
                if (!executions.has(String(p.id))) executions.set(String(p.id), displayedExecution(pid, p, signal));
                const {execution, historical} = await executions.get(String(p.id));
                if (execution?.id) {
                    if (!historical) group.executions.set(String(p.id), execution.id);
                    const executionStatus = pill(execution.status);
                    executionStatus.classList.add('execution-status');
                    executionStatus.textContent = `Last execution · ${execution.status || 'UNKNOWN'}`;
                    c.append(executionStatus);
                    c.append(node('p', `${historical ? 'Last execution' : 'Execution'} ${execution.id}: ${execution.status || 'Unknown'}`, 'muted'));
                    const executedAt = execution.startedAt || execution.createdAt;
                    const executedDate = executedAt ? new Date(executedAt) : null;
                    const timestamp = node('p', executedDate && !Number.isNaN(executedDate.getTime())
                        ? `Started: ${executedDate.toLocaleString()} (local time)` : 'Execution date unavailable', 'muted');
                    if (executedDate && !Number.isNaN(executedDate.getTime())) timestamp.title = executedAt;
                    c.append(timestamp);
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
                        c.append(stateCard);
                    }
                } else if (historical) {
                    c.append(node('p', 'No previous executions found.', 'muted'));
                }
            } catch (e) {
                if (signal?.aborted) throw signal.reason;
                c.append(node('p', `Execution details unavailable: ${e.message}`, 'muted'));
            }
            c.append(actions, historyPanel(base + '/executions?start=0&limit=20', historyController.signal));
            section.append(c);
        }
        if (promote) {
            promote.disabled = !group.approvals.size;
            reject.disabled = !group.approvals.size;
        }
    }
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
$('refresh').addEventListener('click', () => run(refresh));
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
run(refresh);
