import {request, embedded, link, safeAPIPath} from './api.js';

export function createHistoryPager(path, fetchPage = request) {
    let next = safeAPIPath(path), loading = false;
    const visited = new Set(), ids = new Set();
    return {
        get done() { return !next; },
        async load() {
            if (loading || !next) return [];
            if (visited.has(next)) throw new Error('Repeated history pagination link.');
            loading = true;
            try {
                const data = await fetchPage(next);
                const rows = embedded(data, 'executions');
                const fresh = rows.filter(row => row.id != null && !ids.has(String(row.id)));
                const pageIds = new Set(fresh.map(row => String(row.id)));
                const total = data._totalNumberOfItems;
                const complete = !rows.length || (Number.isInteger(total) && total >= 0 && ids.size + pageIds.size >= total);
                if (!complete && !fresh.length) throw new Error('History pagination returned no new records.');
                const following = complete ? null : safeAPIPath(link(data, 'next'));
                const unique = fresh.filter(row => {
                    if (ids.has(String(row.id))) return false;
                    ids.add(String(row.id)); return true;
                });
                visited.add(next);
                next = following;
                return unique;
            } finally { loading = false; }
        }
    };
}

export function historyPanel(path, signal, onLatest, onLoading) {
    const panel = document.createElement('details');
    panel.className = 'pipeline-history';
    const summary = document.createElement('summary');
    summary.textContent = 'Execution history';
    const list = document.createElement('div');
    list.className = 'history-list';
    list.tabIndex = 0;
    list.setAttribute('aria-label', 'Execution history');
    const rows = document.createElement('div');
    const status = document.createElement('p');
    status.className = 'muted'; status.setAttribute('role', 'status');
    const more = document.createElement('button');
    more.textContent = 'Load more';
    list.append(rows, status, more);
    panel.append(summary, list);
    const pager = createHistoryPager(path, next => request(next, 'GET', undefined, {signal}));
    let loading = false, started = false, failed = false, firstPage = true;
    async function load() {
        if (loading || pager.done || signal.aborted || !panel.isConnected) return;
        loading = true; started = true; failed = false;
        list.setAttribute('aria-busy','true');
        onLoading?.(true);
        more.disabled = true; status.textContent = 'Loading history...';
        try {
            const entries = await pager.load();
            if (signal.aborted || !panel.isConnected) return;
            for (const entry of entries) {
                const row = document.createElement('div');
                row.className = 'history-entry';
                const title = document.createElement('strong');
                title.textContent = `Execution ${entry.id} · ${entry.status || 'Unknown'}`;
                const date = document.createElement('p');
                date.className = 'muted';
                const time = entry.createdAt || entry.startedAt;
                date.textContent = time ? `Started: ${time}` : 'Start time unavailable';
                row.append(title, date); rows.append(row);
            }
            status.textContent = pager.done ? (rows.childElementCount ? 'End of history' : 'No executions found.') : 'Scroll for older executions';
            more.hidden = pager.done;
            more.textContent = 'Load more';
            if (firstPage) { firstPage = false; await onLatest?.(entries[0] || null); }
        } catch (error) {
            if (signal.aborted || !panel.isConnected) return;
            failed = true; status.textContent = `History unavailable: ${error.message}`;
            more.textContent = 'Retry history';
        } finally {
            loading = false; more.disabled = false;
            list.setAttribute('aria-busy','false');
            onLoading?.(false);
        }
    }
    panel.addEventListener('toggle', () => { if (panel.open && !started) load(); });
    list.addEventListener('scroll', () => {
        if (panel.open && !failed && list.scrollTop + list.clientHeight >= list.scrollHeight - 50) load();
    });
    more.addEventListener('click', load);
    return panel;
}
