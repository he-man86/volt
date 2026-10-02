## 0. Already built — do not redo (codesys-minimum-version, archived 2026-10-02)

The CODESYS platform version (`CodesysPlatform.ReadVersion`, DIALECT V1) as `IdeVersion` on `health.ideVersion` and
each row's `version`; the product name read (`CodesysDriver.ProductName` / `OemProduct`, log only); the capability
refusal `IDE_UNSUPPORTED` end to end; the `bound:` assembly log. Commits `5a27779448`, `14fe21dd70`, `e4652fdfc9`.
The former tasks 1.1 (plain-CODESYS source) and 1.2 (one generic source) are done there and are not repeated.

## 1. Measure

- [ ] 1.1 OEM check of the existing source: on any OEM install at hand (e.g. WAGO, Lenze, Machine Expert), only that
      `SystemInstances.dll`'s version is the platform's, or the bridge is refused by capability — never a wrong value.
      Record the product name `OEMCustomization.ProductName` answers there. Update DIALECT V1's UNMEASURED line; an OEM
      not checked is not special-cased.
- [ ] 1.2 `productVersion`: ONE generic source of the running product's own version (e.g. the host process's file or
      product version), no per-vendor code; measure it on plain CODESYS and any OEM at hand; record it in DIALECT.
- [ ] 1.3 TwinCAT: the TwinCAT build (`3.1.40xx.y`) as `ideVersion`, and the shell (TcXaeShell / Visual Studio and its
      version, today's `DTE.Version`) as product; record the sources.
- [ ] 1.4 Why PLCAssist sees `1.0.0.0`: an unstamped bundle (no `VOLT_VERSION` at `build-cli.ps1`) or the assembly
      version being read. Settle before choosing what health reports.

## 2. Report the identity

- [ ] 2.1 `health` carries `productName` and `productVersion` (nullable) for both vendors beside the existing
      `ideVersion`; publish them in the wire contract and regenerate the wire docs (`VOLT_WRITE_DOCS=1`).
- [ ] 2.2 `ideVersion` is null when not readable — never derived from `productVersion`. On TwinCAT it moves from the
      shell version to the TwinCAT build (1.3).
- [ ] 2.3 `health` carries the bridge's release: the binary's stamped version (the reading `volt --version` uses),
      `(dev)` when unstamped; two different releases never report the same value.
- [ ] 2.4 The connector (`DetectedProject`, `/status`) and `@volt/control` carry the new fields.

## 3. Field failures moved from codesys-minimum-version (each needs a field log)

- [ ] 3.1 (was codesys-minimum-version 2.1) Measure what failed on 3.5.17 (the proposal's exception, chat 896f798f):
      which API/type/member the bridge binds that the old platform lacks. List every framework API the bridge needs at
      start in ONE place (the capability list), each with the platform version it is known on.
      *State at hand-over:* the capability list is DONE (`CodesysPlatform.All`, DIALECT V2). Open — no CODESYS 3.5.17
      install and no field log from chat 896f798f. The missing member, `Volt.Wire.PipeClient.Call(String, Object,
      Action`1[JsonElement], Int32)`, is VOLT's, not a CODESYS API, and that install printed "connected to IDE", so no
      capability on the list explains it; it has the shape of the 3.5.21.50 `MissingFieldException: WireJson.Write` (a
      second bound copy of a Volt or System.Text.Json assembly). Settles with the first `bound:` log from such an install.
- [ ] 3.2 (was codesys-minimum-version 3.2) Decide on the "another Volt build already loaded" refusal once a field log
      shows the 3.5.21 case.
      *State at hand-over:* needs a field log from the 3.5.21.50 install (or the 3.5.17 one) carrying the `bound:`
      lines. Nothing here reproduces it: on 3.5.21.40 every Volt assembly is bound once (DIALECT V3).

## 4. Tests

- [ ] 4.1 Driver doubles: plain CODESYS (name, product version, platform version), an OEM with a readable platform,
      TwinCAT (shell as product, build as `ideVersion`); red before, green after.
- [ ] 4.2 Packaging test: the release in health matches the build that produced the bundle; an unstamped build says
      `(dev)`.

## 5. Verify

- [ ] 5.1 Live on CODESYS 3.5.21 and one OEM install if available, and on TwinCAT: health shows the expected fields.
