// The day / night / auto switch (ADR 0026). Loaded as a blocking script in <head>, so the stored
// choice is on <html> before the first paint. "auto" stores nothing and leaves the theme to
// prefers-color-scheme; CSS shows the switch only once this script has run. Also the keys of
// ADR 0027 that work on every page: `t` swaps day and night, `?` opens the list of keys.
(() => {
  const root = document.documentElement;
  const key = 'theme';

  // Storage throws when the browser blocks it; the page then follows the system theme.
  const stored = () => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
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
  document.addEventListener('DOMContentLoaded', () => apply(stored()));
  const choose = (choice) => {
    try {
      if (choice === 'auto') localStorage.removeItem(key);
      else localStorage.setItem(key, choice);
    } catch {
      // Not stored: the choice holds for this page only.
    }
    apply(choice);
  };

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element && event.target.closest('[data-theme-choice]');
    if (button) choose(button.dataset.themeChoice);
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]'))
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
