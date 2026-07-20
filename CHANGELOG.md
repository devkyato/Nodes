# Changelog

All notable changes are documented here. Releases follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.0] - 2026-07-20

### Added

- Persisted light and dark themes that respect the initial system preference.
- Silent per-browser draft autosaving and automatic draft recovery after reload.
- Structured XML project download and import alongside the existing JSON format.
- Browser coverage for theme persistence, local drafts, and XML round-tripping.

### Changed

- Refined the editor chrome with compact branding, restrained emoji cues, softer surfaces, and more consistent spacing.
- Reworked interface colors into reusable theme tokens while preserving clean white SVG and PNG exports.

## [1.1.1] - 2026-07-20

### Fixed

- Published manifest, sitemap, robots policy, humans file, and social preview from the GitHub Pages site root.

## [1.1.0] - 2026-07-20

### Added

- Personal maintainer attribution for @dev.mako across the interface and repository metadata.
- Open Graph and X social metadata with a purpose-built repository preview card.
- Search-engine structured data, canonical metadata, sitemap, robots policy, web manifest, and humans file.
- Search-friendly package metadata for the project homepage, repository, issues, author, and topic keywords.

### Changed

- Static packaging and local preview now include discovery assets from `public/`.

## [1.0.0] - 2026-07-20

### Added

- Compact single-page SVG flowchart editor.
- Twelve standard flowchart symbols and standalone text.
- Shape resizing, styling, grouping, alignment, distribution, and layer ordering.
- Straight, orthogonal, and curved attached connectors with labels and endpoint reconnection.
- Multiline inline editing, keyboard shortcuts, pan, zoom, snap, and fit-to-screen.
- Snapshot-based undo and redo for diagram-changing actions.
- Local storage, JSON project download/import, and SVG/PNG export.
- Dependency-free packaging and browser workflow tests.
- Automated CI, GitHub Pages deployment, and tag-based GitHub releases.

[Unreleased]: https://github.com/devkyato/Nodes/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/devkyato/Nodes/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/devkyato/Nodes/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/devkyato/Nodes/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/devkyato/Nodes/releases/tag/v1.0.0
