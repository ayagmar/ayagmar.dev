---

slug: dotfiles
tagline: 'The configuration of my Arch Linux desktop: niri, Noctalia, Kitty, zsh and the scripts around them.'
status: active
group: desktop
---

My dotfiles, managed with chezmoi. They hold the niri compositor config with its helper scripts, the Noctalia shell's settings and templates, Kitty, zsh, user systemd services, session environment and a few app configs such as OBS and Vesktop.

On a new machine, `dotfiles-bootstrap` installs the tracked native and AUR packages and turns the tracked user services back on. Secrets are encrypted with age or kept out of the repository.

[/uses](/uses) lists what runs on that machine.
