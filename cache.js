import {abortable, safeAPIPath} from './api.js';

const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined && (value[key] === null || ['string','number','boolean'].includes(typeof value[key]))).map(key => [key, value[key]]));
export function snapshotKey(config) {
    return `pipelineSnapshot:v1:${JSON.stringify(['clientId','orgId','programId','oauthScopes'].map(key => String(config[key] || '')))}`;
}
export function projectPipeline(pipeline) {
    return {...pick(pipeline, ['id','name','status','type','buildType','buildEnvironment','pipelineType','lastStartedAt','lastFinishedAt']),
        ...(Array.isArray(pipeline.phases) ? {phases: pipeline.phases.map(phase => ({
            ...pick(phase, ['type','name','environmentId','environmentType','buildType','buildEnvironment']),
            steps: (phase.steps || []).map(step => ({...pick(step, ['type','name','action']),
                options: pick(step.options, ['type','buildType','buildEnvironment','pipelineType'])}))
        }))} : {})};
}
export function projectExecution(execution) {
    if (!execution) return null;
    return {...pick(execution, ['id','status','pipelineId','createdAt','startedAt','finishedAt']),
        _embedded: {stepStates: (execution._embedded?.stepStates || []).map(step => ({
            ...pick(step, ['id','phaseId','stepId','name','action','status','environmentId','environmentType']),
            _links: Object.fromEntries(['http://ns.adobe.com/adobecloud/rel/pipeline/advance','http://ns.adobe.com/adobecloud/rel/pipeline/cancel'].flatMap(key => {
                const value = step._links?.[key];
                try {
                    const path = safeAPIPath(typeof value === 'string' ? value : value?.href);
                    return path ? [[key,{href:path.split('?')[0]}]] : [];
                } catch { return []; }
            }))
        }))}};
}
function projectSnapshot(snapshot) {
    return {version:1,updatedAt:snapshot.updatedAt || 0,
        environments:(snapshot.environments || []).map(env => pick(env, ['id','name','type','status','region','variableUpdateStatus','variableUpdateObserved','variableUpdateStartedAt'])),
        pipelines:(snapshot.pipelines || []).map(projectPipeline),
        executions:Object.fromEntries(Object.entries(snapshot.executions || {}).map(([id, record]) => [id, {
            updatedAt:record.updatedAt || 0, historical:!!record.historical, missing:!!record.missing, historyChecked:!!record.historyChecked, stale:!!record.stale,
            execution:projectExecution(record.execution)
        }]))};
}
export async function loadSnapshot(config, signal, storage = chrome.storage.session) {
    const deadline = signal ? AbortSignal.any([signal,AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000);
    try {
        const key = snapshotKey(config);
        const value = (await abortable(storage.get([key]),deadline))[key];
        if (value?.version !== 1 || !Array.isArray(value.environments) || !Array.isArray(value.pipelines)) return null;
        return projectSnapshot(value);
    } catch (error) {
        if (signal?.aborted) throw signal.reason;
        return null;
    }
}
export async function saveSnapshot(config, snapshot, signal, storage = chrome.storage.session) {
    signal?.throwIfAborted();
    const value = projectSnapshot(snapshot);
    if (JSON.stringify(value).length > 2000000) throw new Error('Pipeline cache exceeds its size limit.');
    const deadline = signal ? AbortSignal.any([signal,AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000);
    await abortable(storage.set({[snapshotKey(config)]:value}),deadline);
}
