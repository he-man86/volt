## Why

The native Windows installer (the Volt Connector + the C# bridges) — Layer 4, the one
"like-Git" install — is being reworked. Until it's done, users can't cleanly install the
bridge layer that automates the PLC IDEs. (VOLT-PLAN Next-steps #3.)

## What Changes

- Rework the `VoltConnector` installer, replacing the old `volt-connector.iss` + scripts.
- Bundle + install the `.NET` bridges to `%LocalAppData%\Programs\Volt\`.

## Capabilities

### Modified Capabilities
- (none — packaging/installer; no spec-level behavior change.)

## Impact

`packages/volt-bridge` (Connector) + installer scripts. Windows-only.
