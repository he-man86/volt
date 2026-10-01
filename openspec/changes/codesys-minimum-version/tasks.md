## 1. Version

- [ ] 1.1 Find the reliable source of the running CODESYS version (scripting API, or the host executable's file
      version) and verify it on the CODESYS installs available (3.5.21.x; older if one can be installed).
- [ ] 1.2 `CodesysDriver.IdeVersion` returns it; the connector row and health show it.

## 2. Minimum

- [ ] 2.1 One constant for the minimum (3.5 SP21).
- [ ] 2.2 Below it: message-window line at start, not healthy, every call refused with a coded, versioned message.
- [ ] 2.3 Test: a driver double reporting 3.5.17 is refused with that text; 3.5.21 is served.

## 3. Bound-assembly log

- [ ] 3.1 At `PipeHost.Start`: log path + version of `Volt.Wire`, `Volt.Contracts`, `System.Text.Json` as bound.
- [ ] 3.2 Decide on the "another Volt build already loaded" refusal once a field log shows the 3.5.21 case.

## 4. Verify

- [ ] 4.1 Full suites; live start on 3.5.21 unchanged apart from the version and the new log lines.
