// Shared appearance bootstrap. CSS supplies the system palette before storage resolves.
(() => {
    const key = 'appearanceTheme';
    const storage = globalThis.chrome?.storage;
    let preference = 'system', revision = 0;
    const normalize = value => ['light', 'dark'].includes(value) ? value : 'system';
    const feedback = message => {
        const status = document.getElementById('themeFeedback');
        if (status) status.textContent = message;
    };
    const apply = value => {
        preference = normalize(value);
        document.documentElement.dataset.theme = preference;
        const control = document.getElementById('themePreference');
        if (control) control.value = preference;
    };
    apply('system');

    function bind() {
        const control = document.getElementById('themePreference');
        if (!control) return;
        control.value = preference;
        control.addEventListener('change', async () => {
            const previous = preference, selected = normalize(control.value), attempt = ++revision;
            apply(selected);
            control.disabled = true;
            feedback('Saving appearance…');
            try {
                if (!storage?.local) throw new Error('Storage unavailable');
                await storage.local.set({[key]: selected});
                feedback('Appearance saved.');
            } catch {
                if (revision === attempt) apply(previous);
                feedback('Appearance could not be saved. Try again.');
            } finally { control.disabled = false; }
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, {once: true});
    else bind();

    storage?.onChanged?.addListener((changes, area) => {
        if (area !== 'local' || !(key in changes)) return;
        revision++;
        apply(changes[key].newValue);
    });
    if (storage?.local) {
        const initialRevision = revision;
        storage.local.get([key]).then(values => {
            if (revision === initialRevision) apply(values[key]);
        }).catch(() => {if(revision===initialRevision)feedback('Saved appearance could not be loaded. Using system theme.');});
    }
})();
