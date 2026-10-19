## 1. Part A: tests red (offline)

- [ ] 1.1 CODESYS walk: a manager with stray redirections AND parameter values → ONE `unreadableNodes` entry whose reason
      names both, the stray placeholders by name. Today: two (`CodesysDriver.Tree.cs:177-181`).
- [ ] 1.2 Engine: the project version counts that manager once.
- [ ] 1.3 Gate: a helper asserting no node path appears twice as a `folder`-kind entry, called on every walk result the
      offline CODESYS and TwinCAT walk tests produce. Red today on the 1.1 double.

## 2. Part A: implement

- [ ] 2.1 `GetLibraryRefs` returns the manager's reasons joined with `" and "`; the walk adds one entry.

## 3. Part B1: measure (stop gate: if a measurement contradicts the design, stop B1 and report; never guess)

- [ ] 3.1 Live SP21, every library parameter value in the corpora: the `IExpression`'s type and text members against the
      text the Library Manager's Parameters tab shows. One member matching on all → B1 proceeds; none → stop.
- [ ] 3.2 Same run: does each `ParameterTable` entry's name equal the `LIBRARY` line of a walked reference's manifest; is a
      parameter name `PARAM.X` or bare; are there values for a library no walked reference names; the vendor's order of
      the values.
- [ ] 3.3 Live 3.5.18.30: the same for the per-reference `Params` (DIALECT V7).
- [ ] 3.4 DIALECT V7 row with the results.

## 4. Part B1: tests red (offline, after 3)

- [ ] 4.1 A CODESYS reference with set values pulls `PARAMETER` lines byte-identical to TwinCAT's for the same name and
      value (`test/shared/WireParityCases.cs`), in vendor order.
- [ ] 4.2 A changed value changes that manifest's version. Today: no version moves.
- [ ] 4.3 A value for a library no walked reference names stays a reason in the manager's one entry.

## 5. Part B1: implement

- [ ] 5.1 `ParameterValues` returns the values (name, text) by the member 3.1 found; `ToLibRef` passes them as
      `parameters`; the count reason goes.

## 6. Docs

- [ ] 6.1 `docs/wire.html` `Library Manager` example.
