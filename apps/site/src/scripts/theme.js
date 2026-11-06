// The day / night / auto switch (ADR 0026). Loaded as a blocking script in <head>, so the stored
// choice is on <html> before the first paint. "auto" stores nothing and leaves the theme to
// prefers-color-scheme; CSS shows the switch only once this script has run. Also the keys of
// ADR 0027 that work on every page: `t` swaps day and night, `?` opens the list of keys, whose
// switch turns all single keys off (WCAG 2.1.4) as `data-shortcuts` on <html>. The build ships it
// without its comments (scripts/postbuild.ts).
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

  const sync = () => {
    apply(stored());
    shortcuts(stored('shortcuts'));
  };

  root.dataset.themeSwitch = '';
  sync();
  // The first page of a tab's session marks it, so home's entrance (room.css) plays only when home
  // is that page. Set before the first paint and only here, so nothing waits on it without
  // scripts, and blocked storage means no entrance. The attribute lives only while the entrance
  // runs: left on, a change of motion preference or a restored page would play it again (ADR 0037).
  try {
    if (!sessionStorage.arrived) {
      sessionStorage.arrived = 1;
      if (location.pathname === '/' && !matchMedia('(prefers-reduced-motion)').matches) {
        root.dataset.entrance = '';
        const retire = () => delete root.dataset.entrance;
        addEventListener('pagehide', retire);
        addEventListener('animationcancel', retire);
        addEventListener('animationend', (e) => e.target.matches('.room-list') && retire());
      }
    }
  } catch {
    // No storage: no way to tell a first visit, so no entrance.
  }
  document.addEventListener('DOMContentLoaded', sync);
  // A page back from the back/forward cache still has the theme it was left with, and the page
  // change would fade into it. pageshow comes before that fade's first frame (ADR 0042).
  addEventListener('pageshow', (event) => event.persisted && sync());
  // A link to the open page loads it again from the build, so a fade would dissolve what its
  // scripts have drawn into older values (ADR 0042). The load is as it was without transitions.
  addEventListener('pageswap', ({ activation, viewTransition }) => {
    if (activation?.entry.url?.split('#')[0] === location.href.split('#')[0])
      viewTransition?.skipTransition();
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

  // A hello for whoever opens the console, once per page and on production only: Previews are on
  // workers.dev and tests on 127.0.0.1.
  if (location.hostname === 'ayagmar.dev') {
    console.log(
      '%cHello, console reader.',
      'color: #d98a2b; font-weight: 600',
      'How min7 is built: https://ayagmar.dev/colophon. The source: https://github.com/ayagmar/ayagmar.dev'
    );
  }

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    // AltGr (Ctrl+Alt on Windows) is how some layouts type `?`, so it is not a modifier here.
    if (
      ((event.ctrlKey || event.altKey) && !event.getModifierState('AltGraph')) ||
      event.metaKey ||
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
