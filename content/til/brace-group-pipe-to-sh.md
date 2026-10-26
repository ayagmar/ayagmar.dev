---

title: A brace group makes a piped script all or nothing
date: 2026-10-18
tags: [shell, install]
draft: true
---

`sh` reads a script from a pipe one command at a time and runs each as it arrives, so a download that stops halfway runs the half it got. Wrapping the whole script in one brace group changes that: `sh` has to read to the closing `}` before it runs anything, so a cut-off download is a syntax error and nothing runs.

```sh
curl -fsSL https://github.com/ayagmar/niri-computer-use/releases/latest/download/install.sh | sh
```

It also keeps a command inside the script that reads stdin, such as an agent's `mcp add`, from eating the script's own remaining lines. The install script of niri-computer-use has been one brace group since 0.1.4.
