const tabs = [...document.querySelectorAll('[role="tab"]')];

function selectTab(selected) {
    for (const tab of tabs) {
        const active = tab === selected;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    }
}

for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = tabs.indexOf(tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
            (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        selectTab(tabs[next]);
        tabs[next].focus();
    });
}
