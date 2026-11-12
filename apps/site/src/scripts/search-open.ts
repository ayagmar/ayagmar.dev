// The 404's "Search" button. The header's Search island hydrates when the browser is idle, up to
// 2 s after load, so a click may come first: the attribute keeps the request until the island
// mounts and opens the dialog, and the event opens it at once when it already has.
for (const button of document.querySelectorAll('[data-search-open]')) {
  button.addEventListener('click', () => {
    document.documentElement.setAttribute('data-search-wanted', '');
    dispatchEvent(new Event('search-open'));
  });
}
