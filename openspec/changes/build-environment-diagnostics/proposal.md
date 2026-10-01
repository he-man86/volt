## Why

**A library the user's CODESYS does not have installed makes every build "fail", and nothing marks it as not the
code's fault.**

Seen in PLCAssist on 2026-09-30 (chat `4b328748`, WAGO PFC300 project, CODESYS). All 8 builds in a 22-item editing
session returned one error with no item attached:

```
Could not open library '#CmpOPCUAClient Implementation'. (Reason: The library 'CmpOPCUAClient Implementation,
3.5.19.10 (System)' has not been installed to the system.)
```

- It is the machine, not the code: the compile still ran (the warning count moved 14 → 13 → 19 with the edits).
- A client cannot tell it apart from a code error. It arrives as `severity: error`, the build is `status: errors`,
  and the client's advice is "fix and rebuild". PLCAssist's model then correctly judged it pre-existing, and
  reported "Build is clean: 0 errors" 8 times, which is not what the build said.
- There is a real risk it hides: code that uses the missing library may not be checked at all while it is missing,
  so "no other errors" says less than it seems.

## What Changes

- **A diagnostic says what KIND of problem it is**: a new optional field on `BridgeDiagnostic`, e.g.
  `category: "code" | "environment"`. A library the IDE could not open or resolve (not installed, placeholder
  unresolved, version missing) is `environment`. Everything else stays as today (absent or `code`).
- **Recognised by the IDE's own classification where it has one, not by the English text**: the message is
  localized, as seen in other incidents (Russian, Finnish). Find the stable handle first: message number/prefix, the
  object the message is about (the library manager), or a library-load API. Fall back to text only if nothing else
  exists, and say so in DIALECT.md.
- **The build result says it once**: e.g. `environment: [{ library, reason }]` beside the diagnostics, so a client
  can tell the user "install library X, version Y" and still read the code errors on their own.

## Impact

- `Volt.Contracts/Wire/BuildModels.cs` (`BridgeDiagnostic.Category`, additive), `Volt.Ide.Codesys` build
  diagnostics, TwinCAT parity (does XAE report missing libraries the same way?).
- Clients: PLCAssist would map `environment` to "tell the user what to install" instead of "fix and rebuild".
