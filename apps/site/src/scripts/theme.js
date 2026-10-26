// The day / night / auto switch (ADR 0026). Loaded as a blocking script in <head>, so the stored
// choice is on <html> before the first paint. "auto" stores nothing and leaves the theme to
// prefers-color-scheme; CSS shows the switch only once this script has run.
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
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element && event.target.closest('[data-theme-choice]');
    if (!button) return;
    const choice = button.dataset.themeChoice;
    try {
      if (choice === 'auto') localStorage.removeItem(key);
      else localStorage.setItem(key, choice);
    } catch {
      // Not stored: the choice holds for this page only.
    }
    apply(choice);
  });
})();
