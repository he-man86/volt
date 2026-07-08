## Why

Two connector UX problems bite users.

1. **Silent auto-attach (TwinCAT).** When no target is set, the Beckhoff worker attaches to whatever instance
   and project happen to be *first* in the COM Running Object Table (`TcObjectModel.Connect`, `:55-59`; project
   loop takes the first match). On login, with two solutions open, Volt silently binds the wrong project — and
   then `pull`/`push` run against it. The user must not have an arbitrary project chosen for them.

2. **The confusing "Enabled" toggle.** The per-vendor tray toggle wears one label over unrelated jobs: for
   TwinCAT (ExternalAttach) unchecking it *stops the worker* — which is exactly what "Stop bridge" already does;
   for CODESYS (InIdeLoad) it merely gates health probing. It exists mostly so an unused vendor doesn't paint
   the aggregate tray icon red (`VendorProvider.cs:91` defaults CODESYS off) — a *display* concern solved with a
   manual switch. The tray toggle and the control-plane `/enable` even behave differently (`TrayContext.cs:166`
   vs `:65`).

## What Changes

- **No silent attach.** With no target selected, the TwinCAT worker starts in a `no-project` degraded state and
  does **not** attach. The user picks the instance/project from the tray "Connect to" submenu (already built) or
  the control-plane `/select` (already built). Remove the tray's **"Default (first active)"** item — that item
  *is* the silent auto-attach.
- **Testing escape hatch preserved.** `VOLT_TC_INSTANCE` / `VOLT_TC_PROJECT` / `VOLT_TC_PLC` env and the
  control-plane `/select` still force a target for automated tests and dev. Explicit selection is required only
  when nothing forces one.
- **Delete the per-vendor `Enabled` flag + toggle.** Worker lifecycle is Stop/Restart (already there) plus
  auto-start; the red-icon problem moves to **aggregate severity** — a vendor with no IDE present / no project
  is "not applicable" (grey), not red (`UpdateIcon`/`Severity` in `TrayContext.cs`).
- **Close the CSRF surface on BOTH HTTP planes with one shared Origin guard.** A web page the user visits can
  hit the loopback ports. The control plane emits `Access-Control-Allow-Origin: *` (`ControlServer.cs:136`); the
  data plane (`BridgeHttpServer`) does no Origin check AND ignores `Content-Type` (`ReadBody`, `:170`) — so a
  CORS "simple" `text/plain` POST to `/push` reaches the bridge and, via `set` with `ifVersion: null` (create),
  can **inject new POUs/items into the live PLC project**. Legit clients (`volt-git` via `node:http`, the LSP)
  never send an `Origin` header, so one shared helper that rejects any request carrying one closes both planes;
  also drop the control plane's `ACAO: *`. (The data-plane fix is the high-value one — it writes PLC code.)

## Impact

- `packages/volt-bridge` Connector — `Ide/TcObjectModel.cs` (drop the `First()` fallback → stay unattached),
  `Program.cs`/`BeckhoffDriver` (start degraded "no project"), `TrayContext.cs` (remove Enable toggle +
  "Default (first active)"; severity for not-applicable), `VendorProvider.cs` (remove `Enabled`). A shared
  Origin-guard helper is applied in both `ControlServer.cs` (drop ACAO `*`) and `Wire/BridgeHttpServer.cs`
  (the data plane — in Core, so both vendors get it).
- `BridgeSupervisor` unchanged — target still flows via env on (re)spawn.
- **Parity**: the attach behavior is TwinCAT-specific (the in-proc CODESYS bridge attaches to the IDE it is
  loaded into, so "which project" is never ambiguous there); the Origin guard is Core-level, identical for both.
