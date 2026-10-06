# Sudoku

A clean, offline-ready Sudoku game you can install as an app on your computer or phone.

No build step, no dependencies — just HTML, CSS and JavaScript.

## Features

- Four difficulty levels (Easy, Medium, Hard, Expert); every puzzle is generated fresh and has exactly one solution
- Notes (pencil marks) — placing a number automatically clears it from notes in the same row, column and box
- Undo, erase and hints
- Mistakes highlighted in red, clashing numbers shaded
- Highlights the selected row, column, box and matching numbers
- Timer that pauses automatically when you switch away, plus best times per difficulty
- Your game is saved automatically — close it and pick up where you left off
- Light and dark themes (follows your system by default)
- Works offline and installs as a standalone app (PWA)

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `1`–`9` | Enter number |
| `Shift` + `1`–`9` | Toggle a note |
| Arrow keys | Move selection |
| `Backspace` / `Delete` / `0` | Erase |
| `N` | Toggle notes mode |
| `H` | Hint |
| `P` / `Space` | Pause / resume |
| `Ctrl`/`Cmd` + `Z` | Undo |

## Install it as an app

Once it's hosted (see below), open the site and:

- **Chrome / Edge (Windows, Mac, Linux):** click the install icon at the right of the address bar (or menu → *Install Sudoku*). It opens in its own window and shows up in your Start menu / Dock / app launcher.
- **Safari (Mac):** File → *Add to Dock*.
- **iPhone / iPad:** Share → *Add to Home Screen*.
- **Android:** menu → *Install app*.

## Hosting on GitHub Pages

A workflow in `.github/workflows/pages.yml` deploys the site on every push to `main`.
One-time setup: in the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
The game will then be live at `https://<your-username>.github.io/sudoku/`.

## Run locally

Any static file server works, e.g.:

```sh
npx http-server .
```

then open http://localhost:8080.
