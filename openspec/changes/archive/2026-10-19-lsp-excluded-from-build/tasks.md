## 1. Tests red

- [x] 1.1 Oracle (`test/corpus/corpus-diagnostics.test.ts`): on every corpus project that has an object excluded by its
      own flag, run the server pass with `diagnoseDeadCode` on. Every finding inside an excluded object must be one the
      recorded build emitted, and every `%EXCLUDE_FROM_BUILD` line must sit in an object `effectivelyExcluded` names.
      Today: 370 findings in pro2193 and 8 in lenze-mid, none of them in either build.
- [x] 1.2 `src/analysis/reachability/exclusion.test.ts`: the own flag on a POU, DUT, GVL and interface makes the whole
      file excluded. On a method, action, property or interface member it excludes only that member. No flag
      means nothing is excluded, and a `%EXCLUDE_FROM_BUILD` in a comment or misplaced in a body excludes nothing. A
      property's accessor has no property lines (the push peels none under its IMPLEMENTATION line), so it has no own flag.
- [x] 1.3 `src/analysis/pipeline/document.test.ts`: an excluded FB that a live PROGRAM reaches gives nothing. That
      includes its parse errors, with `diagnoseDeadCode` on as well. An excluded method in a live FB whose name an
      interface declares gives nothing. A missing language in an excluded object is still reported.
- [x] 1.4 `src/analysis/reachability/reachability.test.ts`: an FB used only from an excluded method, and one used only
      from an excluded PROGRAM, is dead. An excluded PROGRAM in no task is no root.

## 2. Implement

- [x] 2.1 `exclusion.ts` `effectivelyExcluded`, the one place. Its doc names where the folder half is added.
- [x] 2.2 `pipeline/document.ts`: an excluded file is silent like a dead one, and a finding in an excluded member is
      quiet, parse errors included.
- [x] 2.3 `reachability.ts` `fileReachInfo`: no refs from excluded code, and no excluded PROGRAM root.
- [x] 2.4 `docs/architecture.md`: the reachability row names exclusion.

## 3. Gates and hand-off

- [x] 3.1 `bun typecheck`, `VOLT_REQUIRE_FULL=1 bun test` (package), `bun run lint` (root).
- [x] 3.2 `excluded-folder-items-pulled`: its LSP tasks are replaced by one line pointing here. That line names what stays
      there: the folder half of `effectivelyExcluded`, and the scope half with its live recording.
