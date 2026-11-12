// The image viewer (ADR 0049): a [data-view] link opens its image in dialog.viewer instead of
// leaving the page. Without this script the link goes to the file, which is the whole fallback.
// Opening adds a history entry, so Back closes the viewer; closing any other way takes the entry
// off again, so Back afterwards leaves the page as it would have before.
const dialog = document.querySelector<HTMLDialogElement>('dialog.viewer');

if (dialog?.showModal) {
  const part = <T extends HTMLElement>(selector: string) => dialog.querySelector(selector) as T;
  const stage = part<HTMLElement>('.viewer-stage');
  const caption = part<HTMLElement>('figcaption');
  const count = part<HTMLElement>('.viewer-count');
  const original = part<HTMLAnchorElement>('.viewer-original');
  const previous = part<HTMLButtonElement>('.viewer-previous');
  const next = part<HTMLButtonElement>('.viewer-next');
  // Built here rather than in the HTML: an <img> with no file yet would fail the budgets' checks.
  // Its alt is empty because the caption, which names the dialog, says what it shows.
  const image = document.createElement('img');
  image.alt = '';
  stage.append(image);

  let links: HTMLAnchorElement[] = [];
  let index = 0;
  let opener: HTMLAnchorElement | null = null;
  let closedByBack = false;

  const show = (at: number) => {
    index = (at + links.length) % links.length;
    const link = links[index] as HTMLAnchorElement;
    // Text and buttons first: they decide how much room the stage has left.
    caption.textContent = link.dataset.viewAlt ?? '';
    original.href = link.href;
    count.textContent = links.length > 1 ? `${index + 1} of ${links.length}` : '';
    previous.hidden = next.hidden = links.length < 2;
    const width = Number(link.dataset.viewWidth);
    const height = Number(link.dataset.viewHeight);
    // The size it is drawn at: the room the stage has, never more than the file's own pixels.
    const fit = Math.max(
      1,
      Math.floor(Math.min(width, stage.clientWidth, (stage.clientHeight * width) / height))
    );
    image.removeAttribute('srcset');
    image.width = fit;
    image.height = Math.round((fit * height) / width);
    image.sizes = `${fit}px`;
    image.srcset = link.dataset.viewSrcset ?? '';
    image.src = link.href;
  };

  document.addEventListener('click', (event) => {
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[data-view]');
    // A modified click keeps its meaning: a new tab or window with the file.
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (event.altKey) return;
    event.preventDefault();
    // Only the links on screen: of a day and night pair, the one for the current theme.
    links = [...document.querySelectorAll<HTMLAnchorElement>('a[data-view]')].filter(
      (candidate) => candidate.getClientRects().length > 0
    );
    opener = link;
    dialog.showModal();
    show(links.indexOf(link));
    history.pushState({ viewer: true }, '');
  });

  part<HTMLButtonElement>('.viewer-close').onclick = () => dialog.close();
  previous.onclick = () => show(index - 1);
  next.onclick = () => show(index + 1);

  // A phone turned on its side has a different room for the image.
  addEventListener('resize', () => dialog.open && show(index));

  // The dialog covers the window; a click on its empty space, outside the image and the
  // controls, is a click on the backdrop.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target === stage) dialog.close();
  });

  dialog.addEventListener('keydown', (event) => {
    if (links.length < 2 || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    show(index + (event.key === 'ArrowLeft' ? -1 : 1));
  });

  // Escape closes a modal dialog by itself; every way out ends here.
  dialog.addEventListener('close', () => {
    image.removeAttribute('srcset');
    image.removeAttribute('src');
    opener?.focus();
    if (!closedByBack && history.state?.viewer) history.back();
    closedByBack = false;
  });

  addEventListener('popstate', () => {
    if (!dialog.open) return;
    closedByBack = true;
    dialog.close();
  });
}
