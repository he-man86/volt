## 0. Remove opencode (done — this was deferred in the proposal, then done first)

- [x] 0.1 Delete `opencode-config/`, `verify-opencode.ts` and the `compat` gate; `bun run check` replaces it
- [x] 0.2 Make `volt-desktop` standalone: no `WebContentsView`, no `opencode serve`, the IDE panel IS the window
- [x] 0.3 Replace opencode's GUI route as the "which workspace" signal — `recent.ts` + an open-a-workspace action
- [x] 0.4 Strip opencode from the installer: no `OPENCODE_CONFIG_DIR`, and retire a stale one on upgrade
- [x] 0.5 Remove the extension's "Open Agent" command and its "Agent & Settings" view — both frontends now show the same three views
- [x] 0.6 Update CLAUDE.md, READMEs, the website copy and the mockups

## 1. Registry accounts and secrets

- [ ] 1.1 Claim a VS Code Marketplace publisher and confirm its id matches the `publisher` field in `packages/volt-vscode/package.json` (mismatch means users get two extensions)
- [ ] 1.2 Claim the Volt namespace on Open VSX and complete namespace verification
- [ ] 1.3 Create `VSCE_PAT` (Azure DevOps) and `OVSX_PAT`, add both as repo secrets, and record their expiry dates
- [ ] 1.4 Publish one build to both registries by hand first, to prove credentials and metadata before touching CI

## 2. Publish the extension from CI

- [ ] 2.1 Add `vsce publish` and `ovsx publish` steps to the release pipeline, using the already-stamped 3-part `<maj>.<min>.<count>` version
- [ ] 2.2 Fail the release job when either publish exits non-zero, with a message naming the registry that rejected the upload
- [ ] 2.3 Verify the published build installs and activates in VS Code, Cursor and Windsurf on a clean machine
- [ ] 2.4 Verify a machine holding the installer's sideloaded copy upgrades in place to the registry build rather than gaining a second extension
- [ ] 2.5 Fix the stale `check-wiring.ts` comment claiming the extension "self-publishes to the Marketplace" — make it describe what now actually happens

## 3. Retire the installer sideload

- [ ] 3.1 Remove the extension install task from the installer (`installer/Volt.iss`)
- [ ] 3.2 Drop `volt-vscode.vsix` from `build-payload.ts` and its guard in `build-installer.ts`
- [ ] 3.3 Confirm `bun run test:install` still passes and that uninstall leaves the registry-installed extension alone
- [ ] 3.4 Confirm the installer's only remaining environment effect is `PATH` — one variable, nothing else.
      (This task used to name `OPENCODE_CONFIG_DIR` as a second permitted effect. It is not permitted, it is
      RETIRED: `Volt.iss` deletes it on upgrade and `test-install.ts` fails if it survives.)

## 4. Claude Code plugin

- [x] 4.1 Move the working draft from `.claude/plugins/volt-lsp/` to `plugins/volt-lsp/` and commit `.claude-plugin/marketplace.json` at the repo root
- [ ] 4.2 Confirm the `lspServers` entry runs `volt-lsp-iec --stdio` and maps `.fb .prg .fun .itf .dut .gvl` to `structured-text`
- [ ] 4.3 Add a test that fails when the plugin's `extensionToLanguage` keys drift from the `structured-text` extensions declared in `packages/volt-vscode/package.json`
- [ ] 4.4 Verify end to end: `/plugin marketplace add he-man86/volt`, `/plugin install volt-lsp@volt`, then go-to-definition and diagnostics in a real `.prg` and `.dut`
- [ ] 4.5 Verify `claude plugin install volt-lsp@volt --scope project` writes enablement to the repo's `.claude/settings.json`
- [x] 4.6 Keep the project `.claude/settings.json` permission rules (read-only volt verbs allowed, mutating verbs ask)

## 5. `volt mcp` subcommand

- [ ] 5.1 Decide the MCP implementation — official `ModelContextProtocol` C# SDK versus hand-rolled JSON-RPC — confirming TFM compatibility with the CLI (resolves an open question in design.md)
- [ ] 5.2 Add the `mcp` verb to the CLI, serving MCP over stdio and exiting cleanly on stdin EOF
- [ ] 5.3 Route all diagnostics to stderr and assert in a test that stdout carries nothing but JSON-RPC
- [ ] 5.4 Expose the CLI verbs as tools that call the same engine paths — no reimplementation in the MCP layer
- [ ] 5.5 Annotate `status`/`show`/`build` as read-only and `init`/`pull`/`push`/`merge` as destructive; implement no Volt-side approval layer
- [ ] 5.6 Implement workspace resolution: explicit `--workspace <path>`, else the working directory, else a loud error naming the resolved path — no parent search, no default project
- [ ] 5.7 Return structured content rather than scraped terminal output
- [ ] 5.8 Add tests covering the transport lifecycle, the unbound-workspace error, and read-only versus mutating annotations

## 6. Verify the hosts

- [ ] 6.1 Claude Desktop: configure `%APPDATA%\Claude\claude_desktop_config.json` with `{"command": "volt", "args": ["mcp", "--workspace", "<path>"]}` and confirm the tools appear and run
- [ ] 6.2 Claude Code: confirm the LSP arrives via the plugin and the CLI via PATH, with mutating verbs prompting
- [ ] 6.3 Cursor and Windsurf: confirm the extension installs from Open VSX and `volt` resolves on PATH in the agent's terminal
- [ ] 6.4 Confirm no host verification step required writing to a vendor-owned config file on Volt's behalf

## 7. Documentation

- [x] 7.1 Add a host-setup page to `volt-web` covering all five hosts: mechanism, what to install, exact config path and snippet (`app/docs/agents.mdx`, routed at `/docs/agents`)
- [x] 7.2 State plainly that Claude Desktop reaches Volt over MCP only and cannot host the language server
- [x] 7.3 Update `CLAUDE.md` — the package map and the agent-host section
- [x] 7.4 Record the installer's boundary (PATH only, no vendor config writes) where the next person will find it before proposing a `volt setup` that breaks it
- [ ] 7.5 Revisit whether the storefront routes (pricing / faq / contact / legal) come back — `/docs` was restored to the holding-page site because a user needs it at install time; the rest stayed removed
