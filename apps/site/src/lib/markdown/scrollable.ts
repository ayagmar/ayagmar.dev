// Code blocks and tables in posts scroll sideways when they are wider than the screen
// (base.css). A region that scrolls must be reachable from the keyboard, so each one gets
// tabindex="0" (WCAG 2.1.1; axe's scrollable-region-focusable).
import type { HastPluginEntry } from 'satteri';

export const scrollable: HastPluginEntry = () => ({
  name: 'min7-scrollable',
  element: {
    filter: ['pre', 'table'],
    visit(node, ctx) {
      ctx.setProperty(node, 'tabIndex', 0);
    },
  },
});
