const variableName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const validService = new Set(['', 'author', 'publish', 'preview']);
const variableKey = (name, service = '') => JSON.stringify([name, service]);

export function buildVariablePatch(existing, rows) {
    const original = new Map(existing.map(variable => [variableKey(variable.name, variable.service), variable]));
    const previousVariable = row => {
        if (row.originalService !== undefined) return original.get(variableKey(row.originalName, row.originalService));
        const matches = existing.filter(variable => variable.name === row.originalName);
        return matches.length === 1 ? matches[0] : original.get(variableKey(row.originalName, row.service));
    };
    const activeRows = rows.filter(row => !row.remove);
    const names = new Set();
    for (const row of activeRows) {
        const name = String(row.name || '').trim();
        if (!variableName.test(name)) throw new Error(`Invalid variable name: ${name || '(empty)'}. Use letters, numbers, and underscores; start with a letter or underscore.`);
        const key = variableKey(name, row.service);
        if (names.has(key)) throw new Error(`Duplicate variable: ${name} for ${row.service || 'all services'}.`);
        names.add(key);
        if (!validService.has(row.service || '')) throw new Error(`Unsupported service for ${name}.`);
        const previous = previousVariable(row);
        const type = row.type || 'string';
        if (!['string','secretString'].includes(type)) throw new Error(`Unsupported type for ${name}.`);
        if (previous && type !== (previous.type || 'string')) throw new Error(`Variable type for ${name} cannot be changed. Delete it and add it again.`);
        if (previous && type === 'secretString' && !row.value && ((row.service || '') !== (previous.service || '') || name !== row.originalName)) throw new Error(`Enter a replacement secret to rename ${name} or change its service.`);
        if ((!previous || type === 'secretString' && row.value) && !String(row.value || '')) throw new Error(`Enter a value for ${name}.`);
        if (type === 'secretString' && String(row.value || '').length >= 500) throw new Error(`Secret value for ${name} must be shorter than 500 characters.`);
    }
    if (names.size > 200) throw new Error('An environment can contain at most 200 variables. Remove a variable before adding another.');
    const deletions = new Map(), updates = [];
    for (const row of rows) {
        const oldName = row.originalName;
        const previous = oldName ? previousVariable(row) : null;
        const oldKey = previous ? variableKey(oldName, previous.service) : null;
        const deletion = previous ? {name:oldName,value:'',...(previous.service ? {service:previous.service} : {})} : null;
        if (row.remove) {
            if (previous) deletions.set(oldKey,deletion);
            continue;
        }
        const name = String(row.name).trim(), type = row.type || 'string', service = row.service || '';
        if (previous && (name !== oldName || service !== (previous.service || ''))) deletions.set(oldKey,deletion);
        const value = type === 'secretString' && !row.value && previous ? null : String(row.value || '');
        const changed = !previous || name !== oldName || value !== null && value !== String(previous.value ?? '') || service !== (previous.service || '');
        if (!changed) continue;
        const item = {name,type};
        if(value !== null) item.value = value;
        if (service) item.service = service;
        updates.push(item);
    }
    return [...deletions.values(),...updates];
}

export function variableDisplayValue(variable) {
    return variable?.type === 'secretString' ? '••••••••' : String(variable?.value ?? '');
}

export function environmentBlocksStart(environment) {
    const status = String(environment?.status || '').toLowerCase();
    return ['updating','failed'].includes(environment?.variableUpdateStatus) ||
        !!status && !['ready','created'].includes(status);
}

export function variableUpdateState(environment, variables, now = Date.now()) {
    const updating = variables.some(variable => ['creating','updating','deleting'].includes(String(variable.status).toLowerCase())) ||
        String(environment.status).toLowerCase() === 'updating';
    const failed = variables.some(variable => ['failed','deleted_failed'].includes(String(variable.status).toLowerCase())) ||
        ['failed','deploy_failed','restore_failed','reset_failed'].includes(String(environment.status).toLowerCase());
    if (updating) return {variableUpdateStatus:'updating',variableUpdateObserved:true,variableUpdateStartedAt:environment.variableUpdateStartedAt || now};
    if (failed) return {variableUpdateStatus:'failed',variableUpdateObserved:false,variableUpdateStartedAt:0};
    // A freshly accepted PATCH can briefly return the previous ready state.
    const settled = ['ready','created'].includes(String(environment.status).toLowerCase()) &&
        variables.every(variable => ['ready','deleted'].includes(String(variable.status).toLowerCase()));
    if (environment.variableUpdateStatus === 'updating' && (!settled || !environment.variableUpdateObserved && now - environment.variableUpdateStartedAt < 15000)) {
        return {variableUpdateStatus:'updating',variableUpdateObserved:!!environment.variableUpdateObserved,variableUpdateStartedAt:environment.variableUpdateStartedAt};
    }
    return {variableUpdateStatus:null,variableUpdateObserved:false,variableUpdateStartedAt:0};
}
