## 1. Sweep

- [x] 1.1 Test first: a `%TEMP%\volt-packaging\<pid>-x` folder whose `<pid>` is a process the user cannot inspect (a system
      process such as `audiodg` / `csrss`, or a stubbed `Alive`) — the sweep must not throw.
- [x] 1.2 `BridgePackagingTests.Alive`: also catch `System.ComponentModel.Win32Exception` (access denied) and return false.
- [x] 1.3 `build-cli.ps1` green with such a folder present — covered by the 7 BridgePackagingTests (the tests build-cli.ps1 runs), green with pid 4 standing in for the reused pid.
