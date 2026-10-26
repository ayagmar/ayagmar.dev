// The day / night / auto switch (ADR 0026). Loaded as a blocking script in <head>, so the stored
// choice is on <html> before the first paint. "auto" stores nothing and leaves the theme to
// prefers-color-scheme; CSS shows the switch only once this script has run. Also the keys of
// ADR 0027 that work on every page: `t` swaps day and night, `?` opens the list of keys, whose
// switch turns all single keys off (WCAG 2.1.4) as `data-shortcuts` on <html>.
(() => {
  const root = document.documentElement;
  const key = 'theme';

  // Storage throws when the browser blocks it; the page then follows the system theme.
  const stored = (name = key) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  };

  const store = (name, value) => {
    try {
      if (value === null) localStorage.removeItem(name);
      else localStorage.setItem(name, value);
    } catch {
      // Not stored: the choice holds for this page only.
    }
  };

  const shortcuts = (value) => {
    if (value === 'off') root.dataset.shortcuts = value;
    else delete root.dataset.shortcuts;
    const toggle = document.querySelector('input[data-shortcuts]');
    if (toggle) toggle.checked = value !== 'off';
  };

  const apply = (choice) => {
    if (choice === 'day' || choice === 'night') root.dataset.theme = choice;
    else delete root.dataset.theme;
    const current = root.dataset.theme ?? 'auto';
    for (const button of document.querySelectorAll('[data-theme-choice]')) {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === current));
    }
  };

  root.dataset.themeSwitch = '';
  apply(stored());
  shortcuts(stored('shortcuts'));
  document.addEventListener('DOMContentLoaded', () => {
    apply(stored());
    shortcuts(stored('shortcuts'));
  });
  const choose = (choice) => {
    store(key, choice === 'auto' ? null : choice);
    apply(choice);
  };

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('[data-theme-choice]');
    if (button) choose(button.dataset.themeChoice);
    if (target?.closest('[data-keys-open]')) document.querySelector('dialog.keys')?.showModal();
  });

  document.addEventListener('change', (event) => {
    if (!event.target.matches('input[data-shortcuts]')) return;
    const value = event.target.checked ? null : 'off';
    store('shortcuts', value);
    shortcuts(value);
  });

  // An open phone Menu is top-layer, so close it when the desktop layout starts (base.css).
  matchMedia('(min-width: 52rem)').onchange = (e) =>
    e.matches && document.getElementById('site-menu').hidePopover();

  // Escape can leave focus on a closed dialog's field or switch, which would swallow the next key.
  document.addEventListener(
    'cancel',
    (event) => {
      if (event.target.contains(document.activeElement)) document.activeElement.blur();
    },
    true
  );

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      root.dataset.shortcuts ||
      document.querySelector('dialog[open]')
    )
      return;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.matches('input, textarea, select'))
    )
      return;
    if (event.key === '?') {
      event.preventDefault();
      document.querySelector('dialog.keys')?.showModal();
    } else if (event.key === 't') {
      const dark = root.dataset.theme
        ? root.dataset.theme === 'night'
        : matchMedia('(prefers-color-scheme: dark)').matches;
      choose(dark ? 'day' : 'night');
    }
  });
})();
