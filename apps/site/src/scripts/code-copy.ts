// Copy buttons on code blocks (src/lib/markdown/code-copy.ts). The Clipboard API exists only in
// secure contexts; elsewhere the buttons stay hidden.
if (navigator.clipboard) {
  for (const button of document.querySelectorAll<HTMLElement>('[data-copy]')) {
    const status = button.nextElementSibling as Element;
    const say = (text: string) => {
      button.textContent = text === 'Copied' ? text : 'Copy';
      status.textContent = text;
    };
    let timer = 0;
    button.hidden = false;
    button.onclick = async () => {
      clearTimeout(timer);
      try {
        await navigator.clipboard.writeText(button.previousElementSibling?.textContent ?? '');
        say('Copied');
      } catch {
        say('Could not copy');
      }
      timer = window.setTimeout(say, 2000, '');
    };
  }
}
