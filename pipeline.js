import {link, rel, safeAPIPath} from './api.js';

export function aliasKey(orgId, programId, environmentId) {
    return `environmentAlias:${JSON.stringify([String(orgId), String(programId), String(environmentId)])}`;
}

export function environmentIds(pipeline) {
    return [...new Set((pipeline.phases || [])
        .filter(phase => phase.type === 'DEPLOY' && phase.environmentId != null && phase.environmentId !== '')
        .map(phase => String(phase.environmentId)))];
}

export function groupPipelines(pipelines, environments, order = []) {
    const groups = new Map();
    for (const pipeline of pipelines) {
        const ids = environmentIds(pipeline);
        for (const id of ids.length ? ids : ['']) {
            if (!groups.has(id)) {
                const environment = environments.find(env => String(env.id) === id);
                groups.set(id, {id, name: environment?.name || (id ? `Environment ${id}` : 'No deployment environment'), environment, pipelines: []});
            }
            const group = groups.get(id);
            if (!group.pipelines.some(p => String(p.id) === String(pipeline.id))) group.pipelines.push(pipeline);
        }
    }
    const typeOrder = ['fullstack', 'frontend', 'webtier', 'cdn', 'unknown'];
    for (const group of groups.values()) {
        group.pipelines.sort((a, b) => {
            const rank = pipeline => typeOrder.indexOf(pipelineKind(pipeline).className);
            return rank(a) - rank(b) || String(a.name || a.id).localeCompare(String(b.name || b.id));
        });
    }
    return orderEnvironments([...groups.values()].filter(g => g.id), order).concat([...groups.values()].filter(g => !g.id));
}

const kinds = {
    fullstack: {label: 'Full-Stack', icon: '▤', className: 'fullstack'},
    dispatcher: {label: 'WebTier', icon: '⇄', className: 'webtier'},
    frontend: {label: 'Front End', icon: '◈', className: 'frontend'},
    config: {label: 'CDN Config', icon: '☁', className: 'cdn'}
};

export function pipelineKind(pipeline) {
    const phases = pipeline.phases || [];
    const values = [pipeline.buildType, pipeline.pipelineType, pipeline.type,
        ...phases.flatMap(phase => [phase.buildType, phase.type,
            ...(phase.steps || []).flatMap(step => [step.options?.buildType, step.options?.type,
                step.options?.pipelineType, step.type, step.action])])];
    const normalize = value => String(value || '').toLowerCase().replace(/[\s_-]/g, '');
    for (const value of values) {
        const key = normalize(value);
        if (key === 'fullstack') return kinds.fullstack;
        if (['dispatcher', 'webtier'].includes(key)) return kinds.dispatcher;
        if (['frontend', 'fe'].includes(key)) return kinds.frontend;
        if (['config', 'configuration', 'cdn', 'cdnconfig'].includes(key)) return kinds.config;
    }
    const buildEnvironments = [pipeline.buildEnvironment,
        ...phases.flatMap(phase => [phase.buildEnvironment, ...(phase.steps || []).map(step => step.options?.buildEnvironment)])];
    for (const value of [...values, ...buildEnvironments]) {
        const key = normalize(value);
        if (['java', 'maven', 'fullstack'].includes(key)) return kinds.fullstack;
        if (['dispatcher', 'webtier'].includes(key)) return kinds.dispatcher;
        if (['frontend', 'fe'].includes(key)) return kinds.frontend;
        if (['config', 'configuration', 'cdn', 'cdnconfig'].includes(key)) return kinds.config;
    }
    if (values.some(value => normalize(value) === 'cicd')) return kinds.fullstack;
    return {label: 'Type unavailable', icon: '◇', className: 'unknown'};
}

export function variableEditValue(variable) {
    return variable.type === 'secretString' ? '' : String(variable.value ?? '');
}

export function stepActionPath(step, action) {
    return safeAPIPath(link(step, rel(`pipeline/${action}`)));
}

export function stopAction(step) {
    if (!['RUNNING', 'WAITING'].includes(step.status)) return null;
    const action = String(step.action || '').toLowerCase();
    let body, path;
    if (action === 'deploy' && step.status === 'WAITING') {
        path = stepActionPath(step, 'advance');
        body = {resume: false};
    } else {
        path = stepActionPath(step, 'cancel');
        if (action === 'approval') body = {approved: false};
        else if (action === 'managed') body = {start: false};
        else if (step.status === 'WAITING' && action !== 'schedule') body = {override: false};
        else body = {cancel: true};
    }
    return path ? {path, body} : null;
}

export async function runPipelineBatch(pipelines, action) {
    const results = [], seen = new Set();
    for (const pipeline of pipelines) {
        if (seen.has(String(pipeline.id))) continue;
        seen.add(String(pipeline.id));
        try {
            results.push({pipeline, ok: true, message: await action(pipeline)});
        } catch (error) {
            results.push({pipeline, ok: false, message: error.message || String(error)});
        }
    }
    return results;
}

export function canStopPipeline(pipeline) {
    return ['BUSY', 'WAITING'].includes(pipeline.status);
}

export function approvalAction(step, approved) {
    if (step.status !== 'WAITING' || step.action !== 'approval') return null;
    const path = stepActionPath(step, approved ? 'advance' : 'cancel');
    return path ? {path, body: {approved}} : null;
}


export function orderEnvironments(environments, order = []) {
    const ranks = new Map((Array.isArray(order) ? order : []).map((id, index) => [String(id), index]));
    return [...environments].sort((a, b) =>
        (ranks.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER)
        || String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

export function executionStatusLabel(execution) {
    const status = String(execution?.status || '').toUpperCase();
    if (['RUNNING','WAITING'].includes(status)) {
        const waiting = (execution?._embedded?.stepStates || []).filter(step => step.status === 'WAITING');
        if (waiting.some(step => step.action === 'approval')) return 'Waiting';
        if (waiting.length) return 'Waiting';
    }
    return {FINISHED:'Success',ERROR:'Failed',FAILED:'Failed',RUNNING:'Running',CANCELLED:'Cancelled',CANCELLING:'Cancelling',NOT_STARTED:'Pending',WAITING:'Waiting'}[status] || 'Unknown';
}


export function pipelineStatusLabel(pipeline, execution, production = false) {
    if (production && ['BUSY','WAITING'].includes(pipeline.status)
        && ['RUNNING','WAITING'].includes(execution?.status)
        && (execution._embedded?.stepStates || []).some(step => step.action === 'approval' && step.status === 'WAITING')) return 'Waiting';
    return {BUSY:'Running',WAITING:'Waiting',IDLE:'Idle'}[pipeline.status] || pipeline.status || 'Unknown';
}
