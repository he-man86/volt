## 1. Measure (stop gate: if a measurement contradicts the design, stop and report; never guess)

- [x] 1.1 Live SP21, every library parameter value in the corpora: the `IExpression`'s type and text members against the
      text the Library Manager's Parameters tab shows. One member matching on all → proceed; none → stop.
      MATCHES: `IExprement.ToString()` (= `ToString()`) on all 24 values; it is what the tab renders (DIALECT V7).
- [x] 1.2 Same run: does each `ParameterTable` entry's name equal the `LIBRARY` line of a walked reference's manifest; is a
      parameter name `PARAM.X` or bare; are there values for a library no walked reference names; the vendor's order of
      the values.
      CONTRADICTS: the entry name is the reference's `ILibManItem.Name` (`#Util`, not `LIBRARY Util`); the parameter name
      is BARE (`TABLE_UPPER_BOUND`) where TwinCAT spells `PARAM.TABLE_UPPER_BOUND` for the same parameter of the same
      library; the archive order is sorted by key (TwinCAT's is declaration order). No orphan values in the corpora.
- [x] 1.3 Live 3.5.18.30: the same for the per-reference `Params` (DIALECT V7).
      On the native `CodesysTestProject.3.5.18.30.project` (7 values on `#Analyzation`, `#Util`): same text member, bare
      names, declaration order.
- [x] 1.4 DIALECT V7 row with the results.

**STOPPED at the gate (2026-10-19).** A `PARAMETER` line byte-identical to TwinCAT's cannot be built from the manager:
the list name (`PARAM`) is only in the library's signature, and the order differs. 2–4 are not built; the owner decides
the principle (qualify from the signature, spell bare on both vendors, or keep the count).

## 2. Tests red (offline, after 1)

- [x] 2.1 ~~not built~~ A CODESYS reference with set values pulls `PARAMETER` lines byte-identical to TwinCAT's for the same name and
      value (`test/shared/WireParityCases.cs`), in vendor order.
- [x] 2.2 ~~not built~~ A changed value changes that manifest's version. Today: no version moves.
- [x] 2.3 ~~not built~~ A value for a library no walked reference names stays a reason in the manager's one entry.

## 3. Implement

- [x] 3.1 ~~not built~~ `ParameterValues` returns the values (name, text) by the member 1.1 found; `ToLibRef` passes them as
      `parameters`; the count reason goes.

## 4. Docs

- [x] 4.1 ~~not built~~ `docs/wire.html` `Library Manager` example.

## Close-out (owner, 2026-10-19)

Closed unbuilt at the 1.x gate. The measurement (DIALECT V7) contradicts byte-identical parity: CODESYS stores the
parameter name bare (`TABLE_UPPER_BOUND`), TwinCAT qualified (`PARAM.TABLE_UPPER_BOUND`); the list name is only in the
library's signature (a precompile the walk does not do), and SP21 sorts the values by key where TwinCAT keeps declaration
order. Owner chose option 3: the values stay a counted reason in the Library Manager's one `unreadableNodes` entry. Known
gap kept: an IDE edit to a value moves no version. Rejected for now: qualifying from the signature (cost), and spelling
bare on both vendors (ambiguous when two lists share a name). Revisit in volt-cli-rework if needed. The spec delta is not
applied (archived with --skip-specs): no requirement was built.
