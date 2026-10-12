## Why

The owner (2026-10-12): drop the VS Code extension from the installer — "user must download in official way". The
installer (`installer/Volt.iss`) today sideloads `volt-vscode.vsix` into VS Code, Windsurf and Cursor (`<editor>
--install-extension … --force`, three wizard tasks, re-run on every silent update; `--uninstall-extension` on
uninstall). That is Volt writing into another vendor's product, which CLAUDE.md rules out ("the installer publishes
`PATH` and nothing else"; host wiring ships as "a published artifact (an extension in a registry …)"), and it carries
known sharp edges (`scripts/README.md`: a VSIX-installed extension never auto-updates; `--install-extension` is a no-op
unless the version strictly increases).

**But the extension is published nowhere today.** `release.yml` only stamps its version (`<maj>.<min>.<count>`); nothing
uploads it to the VS Code Marketplace or Open VSX. Removing it from the installer first would leave users with no way to
get it — so this change publishes first, then removes.

## What Changes

- **Publish (official channels):** the release workflow publishes `volt-vscode` to the **VS Code Marketplace** (VS Code)
  and **Open VSX** (Cursor, Windsurf, VSCodium) under publisher `volt-ai`. A dev build (`release.yml`) publishes as a
  marketplace **pre-release**; `promote.yml` publishes the promoted build as the **stable** release. The extension then
  updates through the editor's own auto-update.
- **Owner prerequisite:** the `volt-ai` publisher on the Marketplace (an Azure DevOps PAT) and an Open VSX namespace and
  token, as repository secrets `VSCE_PAT` and `OVSX_PAT`. Without them the publish step fails by name; it never falls back
  to sideloading.
- **Remove from the installer:** the three editor tasks, the `--install-extension` runs, the `.vsix` in the payload and
  in `build-payload.ts` / `build-installer.ts`, the extension steps of `test:install`. The uninstall's
  `--uninstall-extension` lines stay for ONE release (so an uninstall still cleans a copy an older installer
  sideloaded), then go.
- **Existing users:** measured first — whether VS Code / Cursor / Windsurf update a VSIX-installed `volt-ai.volt-vscode`
  from the registry once the same id is published there. If they do, nothing to do; if not, the release notes and the
  desktop/tray tell the user once to install it from the marketplace (the installer never removes or replaces it).
- **Docs:** `packages/volt-web/app/docs/agents.mdx`, `installer/README.md` (the "every location" table loses the
  extension), `scripts/README.md`, CLAUDE.md's host table now true ("VS Code Marketplace + Open VSX").

## Impact

`installer/Volt.iss`, `scripts/build-payload.ts`, `scripts/build-installer.ts`, `scripts/test-install.ts`,
`.github/workflows/release.yml` + `promote.yml`, `packages/volt-vscode/package.json` (marketplace metadata: icon,
repository, license, categories as the registries require), docs. The installer gets smaller and touches no editor.

## Close-out (2026-10-12) — closed unfinished, by the owner

Owner: "you can forget about extension for now. i will do this whenever i am ready. close it". Nothing of this change
was built: no publisher accounts or secrets exist, nothing publishes the extension. The installer half was done anyway by
`installer-rebuild` (archived 2026-10-12), which removed the extension sideload from the installer and the `.vsix` from
the payload; releases now carry only `Volt-win-Setup.exe`.

**Consequence until the owner publishes:** from the first release of the rebuilt installer, the extension is available
nowhere — no installer task, no release asset, no registry. Copies an older installer sideloaded keep working but do not
update. The spec delta (extension ships only through the registries) was NOT built, so it is archived without being
filed as a requirement (`--skip-specs`). When the owner is ready: re-open from this proposal (publisher accounts,
`VSCE_PAT`/`OVSX_PAT`, publish in `release.yml`/`promote.yml`, then the measure in tasks 1.4).
