## 0. Owner prerequisite

- [ ] 0.1 Owner: create the `volt-ai` publisher on the VS Code Marketplace (Azure DevOps PAT, scope Marketplace →
      Manage) and the `volt-ai` namespace on Open VSX (token); add repository secrets `VSCE_PAT` and `OVSX_PAT`.

## 1. Publish

- [ ] 1.1 `packages/volt-vscode/package.json` passes `vsce package` and `ovsx` validation for a public listing (icon,
      repository, license, categories, README/CHANGELOG the listing shows); no `--allow-*` overrides.
- [ ] 1.2 `release.yml`: publish the built `.vsix` as a pre-release to both registries (`vsce publish --pre-release
      --packagePath`, `ovsx publish --pre-release`); a missing secret fails the step by name.
- [ ] 1.3 `promote.yml`: publish the promoted build's `.vsix` as stable to both registries.
- [ ] 1.4 Measure (dev build published): VS Code, Cursor and Windsurf each show the extension in their marketplace view,
      install it, and auto-update it to the next build; and whether a VSIX-sideloaded `volt-ai.volt-vscode` is updated
      from the registry. Record the answers in `installer/README.md`.

## 2. Remove from the installer

- [ ] 2.1 `Volt.iss`: the three editor tasks and the `--install-extension` runs gone; the `--uninstall-extension` lines
      kept for one release with a dated comment; the `.vsix` no longer in the payload (`build-payload.ts`,
      `build-installer.ts`).
- [ ] 2.2 `test:install`: the extension steps gone; a check that the installer runs no editor CLI (`code`, `cursor`,
      `windsurf`) on install or update.
- [ ] 2.3 If 1.4 shows a sideloaded copy is not updated from the registry: one notice (release notes + the desktop/tray)
      telling the user to install it from the marketplace; the installer never removes or replaces it.

## 3. Docs and close

- [ ] 3.1 `agents.mdx`, `installer/README.md`, `scripts/README.md`, CLAUDE.md current.
- [ ] 3.2 `bun run check`, `build:installer` + `test:install` green; archive. A follow-up release drops the
      `--uninstall-extension` lines.
