## 1. Measure (stop gate: if a measurement contradicts the design, stop and report; never guess)

- [ ] 1.1 Live SP21, every library parameter value in the corpora: the `IExpression`'s type and text members against the
      text the Library Manager's Parameters tab shows. One member matching on all → proceed; none → stop.
- [ ] 1.2 Same run: does each `ParameterTable` entry's name equal the `LIBRARY` line of a walked reference's manifest; is a
      parameter name `PARAM.X` or bare; are there values for a library no walked reference names; the vendor's order of
      the values.
- [ ] 1.3 Live 3.5.18.30: the same for the per-reference `Params` (DIALECT V7).
- [ ] 1.4 DIALECT V7 row with the results.

## 2. Tests red (offline, after 1)

- [ ] 2.1 A CODESYS reference with set values pulls `PARAMETER` lines byte-identical to TwinCAT's for the same name and
      value (`test/shared/WireParityCases.cs`), in vendor order.
- [ ] 2.2 A changed value changes that manifest's version. Today: no version moves.
- [ ] 2.3 A value for a library no walked reference names stays a reason in the manager's one entry.

## 3. Implement

- [ ] 3.1 `ParameterValues` returns the values (name, text) by the member 1.1 found; `ToLibRef` passes them as
      `parameters`; the count reason goes.

## 4. Docs

- [ ] 4.1 `docs/wire.html` `Library Manager` example.
