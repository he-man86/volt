## 1. Observe opencode — mostly DONE (see observations.md)

- [x] 1.0 Confirmed: server is per-request directory-scoped, no global active-project state; the `x-opencode-directory` header (on every client request) is the sanctioned signal. Case A (query/subscribe the server) ruled out. Recorded in `observations.md`.
- [ ] 1.1 The one residual check — drive the **real GUI** (not curl): navigate opencode *to* its home/project-list and read the instrumented sniff log. Does it emit directory-less/`global` requests (a positive release signal) or go quiet? This decides only the release path; append the answer to `observations.md`.

## 2. Binding lifecycle (the load-bearing change) — DONE

- [x] 2.1 `unbindWorkspace(shell)` in `panel.ts`: disposes `shell.status`, clears `boundRoot`, sets `awaitingOpencode=false`, pushes a `{bound:false}` snapshot.
- [x] 2.2 Pure reducer `bindingAction(boundRoot, signal, same)` in new `binding.ts` (`dir`/`none`/`unknown` → bind/unbind/noop); `main.ts` `onActiveSignal` wires it with `sameDir` + the `none` debounce.
- [x] 2.3 `classifyActiveProject` binds on any request with a real project dir (late-bind fix); a dir resolving to a filesystem root = opencode's `global`/home → `none` → release, debounced ~1.5s. Home-goes-quiet fallback marked `ponytail:` pending 1.1.
- [x] 2.4 Cold-start `awaitingOpencode` renders "Connecting to opencode…" across the three sections; flips on the first signal.
- [x] 2.5 `binding.test.ts` — unknown/dir/none decisions + delegated equality (4 tests, green).

> `VOLT_BIND_DEBUG=1` logs every request's `dir → classification`, which is exactly the instrument task 1.1 needs.

## 3. Onboarding: create vs open — DONE

- [x] 3.1 `connectSurface(options)` in `@volt/control/bridge/connector.ts`: partitions the picker into `kind: create|reconnect` with matching project(s) `primary` (first) and others `alternates` (rebind). The shared framing/emphasis decision.
- [x] 3.2 Desktop renderer (`shell.html`): `createSurface` names the outcome ("create a new synced folder + git repo … your IDE isn't modified"); `reconnectSurface` shows the matching project under **Reconnect** first, others under **Bind to a different project instead**.
- [x] 3.3 `connectSurface` tested in `connector.test.ts` (create vs reconnect kind + matching-project-first, even when detected after a rebind alternate).
- [x] 3.4 VS Code `panel.ts` adopts `connectSurface` (primary-first ordering) — the 2nd consumer, so the shells can't drift on ordering.

## 4. One identity — DONE

- [x] 4.1 Bound panel shows ONE identity row: the project name (canonical) + health dot + connection caption, with the workspace folder path in the tooltip. The separate folder row is gone from the bound view (kept only for an uninitialized folder, where it's the only identity).
- [x] 4.2 A one-line reconcile hint appears only when folder basename ≠ project name (rename + rebind); otherwise a single name.

## 5. The UI is vendor-blind (superseded "vendor as a badge") — DONE

The original "badge, elided when single-vendor" was itself vendor-branching UI logic. Per the stronger principle (UI vendor-blind; control owns the vendor-blind view-model; shells are pure renderers), vendor was removed from the UI entirely:

- [x] 5.1 Deleted `vendorLabel` (control) — no vendor→label helper exists; a project is identified by name everywhere.
- [x] 5.2 Removed the dead `ideName` health field + the `vendor` param it forced through `healthStateOf`; `connectionLabel` and the connected health label are now project-name-only.
- [x] 5.3 Pickers/lists/identity rows in both shells show name only — dropped every `"CODESYS · "` prefix, badge, tree-node vendor description, and dialog `(CODESYS)` parenthetical; error/help copy made vendor-blind ("the IDE").
- [x] 5.4 Shells are pure renderers of control's decision: `snapshot()` provides `connectSurface`-partitioned groups; `shell.html` draws them without re-filtering by `action`. VS Code already consumes `connectSurface`.
- [x] 5.5 `vendor` retained ONLY below the wire (pipe name, LSP `--codesys/--twincat`, binding identity match) — verified none of those are UI. Tests updated (removed the vendor-label assertions).

> One deliberate exception: `outcomes.ts` keeps a vendor-named *recovery instruction* (the CODESYS in-proc host's `start_volt_codesys.py` restart) — a real vendor asymmetry where the concrete step is the actionable content. Flagged, not scrubbed.

## 6. Docs — DONE

- [x] 6.1 `packages/volt-desktop/README.md`: rewrote "Active workspace follows opencode" (eager bind + debounced release, no queryable current-project, cold-start "Connecting…", `VOLT_BIND_DEBUG`); added the "panel is a pure renderer of control / UI is vendor-blind" note and a `binding.ts` layout row.
- [x] 6.2 Swept all docs for stale `vendorLabel` / old-binding references — only archived change records remain (left as-is; they're the historical log). Control README had no connection-model references to update.
