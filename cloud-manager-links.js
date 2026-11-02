export function cloudManagerLink(config, text, {environmentId, pipelineId, executionId, section = 'home'} = {}) {
    const segment = value => encodeURIComponent(String(value));
    let path = `/${section}.html/program/${segment(config.programId)}`;
    if (environmentId != null) {path = `/environments.html/program/${segment(config.programId)}/environment/${segment(environmentId)}`;}
    if (pipelineId != null && executionId != null) {path = `/pipelineexecution.html/program/${segment(config.programId)}/pipeline/${segment(pipelineId)}/execution/${segment(executionId)}`;}
    const organization = config.orgId ? `@${segment(config.orgId).replaceAll('%40','@')}/` : '';
    const anchor = document.createElement('a');
    anchor.href = `https://experience.adobe.com/#/${organization}cloud-manager${path}`;
    anchor.textContent = text;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.title = `${text} (opens in a new tab)`;
    return anchor;
}
