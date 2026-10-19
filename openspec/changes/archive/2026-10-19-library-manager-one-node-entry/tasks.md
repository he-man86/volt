## 1. Part A: tests red (offline)

- [x] 1.1 CODESYS walk: a manager with stray redirections AND parameter values → ONE `unreadableNodes` entry whose reason
      names both, the stray placeholders by name. Today: two (`CodesysDriver.Tree.cs:177-181`).
- [x] 1.2 Engine: the project version counts that manager once.
- [x] 1.3 Gate: a helper asserting no node path appears twice as a `folder`-kind entry, called on every walk result the
      offline CODESYS and TwinCAT walk tests produce. Red today on the 1.1 double.
      (`test/shared/OneEntryPerNode.cs`, `.Gated()`; 1.1/1.2 in `CodesysLibraryManagerOneEntryTests`.)

## 2. Part A: implement

- [x] 2.1 `GetLibraryRefs` returns the manager's reasons joined with `" and "`; the walk adds one entry.
