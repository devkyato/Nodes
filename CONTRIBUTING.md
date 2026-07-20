# Contributing

Thanks for improving Flowchart Creator. Keep changes focused, accessible, dependency-free at runtime, and compatible with opening `index.html` directly.

## Development

1. Create a topic branch from `main`.
2. Run `npm ci`.
3. Start the local server with `npm start`.
4. Make the smallest complete change.
5. Run `npm test` and `npm run build`.
6. Update `CHANGELOG.md` for user-visible changes.

## Pull requests

- Explain the user-facing problem and the chosen behavior.
- Include screenshots for visible interface changes.
- Add browser coverage when changing core interaction behavior.
- Keep generated output, browser profiles, and editor settings out of commits.
- Use clear commit messages such as `feat:`, `fix:`, `test:`, `docs:`, `build:`, or `ci:`.

## Design principles

- Prefer direct manipulation and compact controls.
- Preserve correct flowchart geometry.
- Keep one coordinate system for nodes, connectors, selection, and export.
- Make pointer behavior, keyboard behavior, and focus states agree.
- Avoid network calls, telemetry, and new runtime dependencies.

By contributing, you agree that your work may be distributed under the MIT License.
