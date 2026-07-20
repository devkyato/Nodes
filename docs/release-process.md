# Release process

1. Confirm `CHANGELOG.md` contains the release date and version.
2. Update the version in `package.json` and refresh `package-lock.json`.
3. Run `npm test` and `npm run build`.
4. Merge the release changes into `main`.
5. Create and push an annotated tag such as `v1.0.0`.

The release workflow verifies the tag, builds the FlyonUI/Tailwind stylesheet, packages the static application and discovery assets, and creates a GitHub release with generated notes. The Pages workflow deploys every successful change to `main` independently.
