## 1. Version

- [ ] 1.1 Find the reliable source of the UNDERLYING CODESYS PLATFORM version (3.5.x.y) — NOT the host executable's
      file version: OEM IDEs built on CODESYS (WAGO CODESYS V3.5 / e!COCKPIT, Lenze PLC Designer, Schneider Machine
      Expert, …) carry their OWN product version on the exe. Use what the framework itself reports (scripting API /
      the core framework assemblies' version / the profile), and record which source and why in DIALECT.md. Verify on
      the installs available (3.5.21.x; older if one can be installed); record the product name too where readable.
- [ ] 1.2 `CodesysDriver.IdeVersion` returns the platform version (plus the product name when it is an OEM build);
      the connector row and health show it.

## 2. Refuse by capability, not by number (owner, 2026-10-01)

A fixed SP21 floor would lock out OEM IDEs on an older platform that work today (the WAGO PFC300 PLCAssist sessions of
2026-09-30 built and served normally). So the bridge refuses when what it NEEDS is missing, and states the version.

- [ ] 2.1 Measure what failed on 3.5.17 (the proposal's exception, chat 896f798f): which API/type/member the bridge
      binds that the old platform lacks. List every framework API the bridge needs at start in ONE place
      (the capability list), each with the platform version it is known on.
- [ ] 2.2 At start the bridge checks the capability list. Missing → message-window line at start naming the platform
      version, the product, and what is missing; not healthy; every call refused with `IDE_UNSUPPORTED`, fixed English
      wording: `CODESYS <platform version> is not supported: it lacks <capability>.` No number floor anywhere.
- [ ] 2.3 Tests: a driver double lacking a capability is refused with that text (any version number); a double with every
      capability on an older version number is SERVED.

## 3. Bound-assembly log

- [ ] 3.1 At `PipeHost.Start`: log path + version of `Volt.Wire`, `Volt.Contracts`, `System.Text.Json` as bound.
- [ ] 3.2 Decide on the "another Volt build already loaded" refusal once a field log shows the 3.5.21 case.

## 4. Verify

- [ ] 4.1 Full suites; live start on 3.5.21 unchanged apart from the version and the new log lines.
