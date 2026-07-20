# ◈ Flowchart Creator

![Nodes — Flowchart Creator repository cover by @dev.mako](docs/assets/github-cover.png)

[![CI](https://github.com/devkyato/Nodes/actions/workflows/ci.yml/badge.svg)](https://github.com/devkyato/Nodes/actions/workflows/ci.yml)
[![Pages](https://github.com/devkyato/Nodes/actions/workflows/pages.yml/badge.svg)](https://github.com/devkyato/Nodes/actions/workflows/pages.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A compact, browser-based flowchart editor built with HTML, CSS, vanilla JavaScript, and SVG. It has no runtime dependencies, sends no diagram data to a server, and works by opening `index.html` directly.

[✨ Open Flowchart Creator](https://devkyato.github.io/Nodes/)

Built and maintained by [@dev.mako](https://github.com/devkyato) (`devkyato`). I made this as a practical, private diagram tool: fast enough to open for a five-minute sketch, capable enough to keep using when the flow gets real, and simple enough to understand without a manual.

## ✨ Highlights

- Twelve standard flowchart symbols with accurate SVG geometry
- Direct multiline text editing and standalone text
- Straight, orthogonal, and curved connectors that stay attached
- Multi-selection, alignment, distribution, grouping, and layer controls
- Pointer, keyboard, zoom, pan, resize, copy, paste, undo, and redo support
- Local browser saving plus portable JSON project files
- Automatic local drafts plus structured XML project import and export
- Clean SVG and PNG export cropped to the diagram bounds
- Responsive light and dark themes with a compact, minimal interface

## 🚀 Use locally

Open `index.html` in a modern browser. For a local HTTP server:

```bash
npm start
```

Then open `http://127.0.0.1:4173`.

## ⌨️ Essential controls

| Action | Control |
| --- | --- |
| Select multiple | Shift + click or drag a selection rectangle |
| Pan | Hold Space and drag |
| Zoom | Ctrl/Cmd + mouse wheel |
| Edit text | Double-click a shape, label, or standalone text |
| Add standalone text | Double-click empty canvas or use Text |
| Move precisely | Arrow keys; hold Shift for 10 px |
| Duplicate | Ctrl/Cmd + D |
| Copy / paste | Ctrl/Cmd + C / Ctrl/Cmd + V |
| Undo / redo | Ctrl/Cmd + Z / Ctrl/Cmd + Shift + Z |
| Finish text editing | Click outside or Ctrl/Cmd + Enter |
| Cancel text editing | Escape |

## 📁 Project files

```text
index.html          Application structure
style.css           Interface and responsive styling
script.js           State, rendering, interaction, persistence, export
scripts/            Dependency-free local server and build packaging
tests/              Headless-browser workflow verification
.github/            CI, Pages, releases, and contribution templates
docs/               Architecture and release notes for maintainers
```

## ✅ Quality checks

```bash
npm test
npm run build
```

The browser smoke suite exercises themes, rendering, connectors, zoomed dragging, resizing, text editing, history, local persistence, XML/JSON projects, and SVG/PNG export.

## 🔒 Privacy

Projects remain in the browser unless the user downloads or imports a file. The application has no analytics, accounts, API calls, or remote storage.

## 👋 Maintainer

I’m [@dev.mako](https://github.com/devkyato). If this tool saves you time, star the repository, share the live editor, or open a focused issue with an idea that would make real diagram work smoother.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Usage help is in [SUPPORT.md](SUPPORT.md), and security reports should follow [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
