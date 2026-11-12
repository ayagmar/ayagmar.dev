---

slug: pi-promptsmith
tagline: 'Rewrites the rough prompt in the pi editor into a clearer one, in place.'
status: maintained
install: 'pi install npm:pi-promptsmith'
group: agents
---

`pi-promptsmith` is a pi extension. Press `Alt+P` or run `/promptsmith` and the draft in the editor is rewritten where it is; `/promptsmith undo` puts the old one back.

It has two styles: a plain rewrite that tightens the prompt, and an execution contract that turns a rough task into a short spec an agent can work from. In `auto` mode, local rules pick one: coding work like a feature, a bug or a refactor gets a contract, an explanation or brainstorm gets a plain rewrite. The wording is tuned for GPT or Claude, depending on the model.

It is published on npm and installs with `pi install npm:pi-promptsmith`.
