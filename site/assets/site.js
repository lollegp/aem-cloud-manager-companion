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
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {return;}
        event.preventDefault();
        const index = tabs.indexOf(tab);
        const offset = event.key === 'ArrowRight' ? 1 : -1;
        let next = (index + offset + tabs.length) % tabs.length;
        if (event.key === 'Home') { next = 0; }
        else if (event.key === 'End') { next = tabs.length - 1; }
        selectTab(tabs[next]);
        tabs[next].focus();
    });
}
