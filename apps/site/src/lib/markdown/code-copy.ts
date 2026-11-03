// A copy button on each code block, with a status line that tells screen readers it worked
// (src/scripts/code-copy.ts). The button is hidden until that script finds the Clipboard API,
// so without it, or without JavaScript, there is none. Mermaid fences are figures by now
// (diagrams runs first), so a diagram gets no button. Search skips the button's words.
import type { HastPluginEntry } from 'satteri';

export const codeCopy: HastPluginEntry = () => ({
  name: 'min7-code-copy',
  element: {
    filter: ['pre'],
    visit: (pre) => ({
      type: 'element',
      tagName: 'div',
      properties: { className: ['code-block'] },
      children: [
        pre,
        {
          type: 'element',
          tagName: 'button',
          properties: { type: 'button', hidden: true, dataCopy: true, dataPagefindIgnore: true },
          children: [{ type: 'text', value: 'Copy' }],
        },
        {
          type: 'element',
          tagName: 'span',
          properties: { className: ['sr-only'], role: 'status' },
          children: [],
        },
      ],
    }),
  },
});
