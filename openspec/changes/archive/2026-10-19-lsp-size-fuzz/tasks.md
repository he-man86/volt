- [x] 1.1 Generators for deep nesting, flat chains and long files, sized from the limits in the proposal.
- [x] 1.2 Each generated input answers findings or one `not-analysed` on the shipped Node runtime and on bun.

## Close-out (2026-10-19)

Built as `packages/volt-lsp-iec/test/lsp/input-nobody-types.test.ts`: five generators (parentheses, nested `IF`, flat
`+`, flat `OR`, a 50000-statement file), run against `src/server/bin.ts` bundled for node and spawned under `node` over
stdio, and against the in-process server on bun. No input crashed the server or failed a request.

- The server's own limits are lower than the proposal's library-call ones: under node it answers `not-analysed` from
  parentheses 1000, `IF` 1000, chains 3000. Bun: parentheses 10000; `IF` 5000 (Windows) / 10000 (Linux); `+` 20000;
  `OR` 10000. The sizes chosen pass every one of them on both OSes.
- Finding for the owner, not a crash: below the stack limit the analysis is quadratic in chain length and nesting depth.
  Bun, Windows: a `+` chain of 5000 takes 9.6 s, 10000 takes 44 s (`checkBinaryOperators`, `checkNarrowingConversion`,
  `checkUnknownSource`); an `OR` chain of 5000 26 s; 3000 nested `IF`s 3 s (`checkEmptyBlock`). Under node a 2500-term
  `OR` takes 5 s. Real code (chain 29, nesting 8) is far below any of it.
