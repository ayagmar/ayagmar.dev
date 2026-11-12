---

slug: pi-extmgr
tagline: 'An extension manager for pi: browse, install, toggle and update extensions from one screen.'
status: active
install: 'pi install npm:pi-extmgr'
group: agents
---

`pi-extmgr` is a pi extension that manages the other ones. Local extensions and installed packages sit in one list, where you switch them on and off, update or remove them, and set which entry points of a package load.

It searches npm for community extensions and sorts them by weekly downloads, and installs from npm, git, a URL or a local path. It checks for updates on a schedule, keeps profiles you can diff and apply, and has a health view for conflicts and a pending reload. Installs go through pi's own package commands, so it follows whatever pi does upstream.

It is published on npm and installs with `pi install npm:pi-extmgr`.
