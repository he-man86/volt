## 1. Shared lifecycle in @volt/control

- [x] 1.1 Add `enterWorkspace(root)` (wraps `reconnectBound`) and `leaveWorkspace(root)` (`disconnect(await boundProjectId(root))`) to `bridge/actions.ts`; export from the index.
- [x] 1.2 Unit-test both against the mocked connector: `enter` connects; `leave` resolves the bound id then disconnects; `leave` on an unbound/undetected root disconnects nothing; neither throws when the connector is down.

## 2. Desktop wiring

- [x] 2.1 `panel.ts` `bindWorkspace` → fire-and-forget `enterWorkspace(root)` (connect on bind); status poll reflects it.
- [x] 2.2 `panel.ts` `unbindWorkspace` → best-effort `leaveWorkspace(root)` before tearing down the status feed (disconnect on home-route release).
- [x] 2.3 Dedupe: the `volt:disconnect` handler (`commands.ts`) and the `before-quit` disconnect (`main.ts`) call `leaveWorkspace(root)` instead of inlining `disconnect(await boundProjectId(...))`. Keep the manual button (override).

## 3. VS Code wiring

- [x] 3.1 `extension.ts` `activate` → `enterWorkspace(root)` for the bound workspace(s) (connect on open).
- [x] 3.2 `extension.ts` `deactivate` → `leaveWorkspace(root)` for each bound workspace, folded into the returned thenable so the editor waits (like `stopLsp` already is).
- [x] 3.3 Dedupe: the manual disconnect command calls `leaveWorkspace`. Keep the manual button (override).

## 4. Docs

- [x] 4.1 Note the "connection follows the active project (enter→connect / leave→disconnect)" model in both frontends' READMEs; record the shared-connection caveat + the deferred connector refcount (A).
