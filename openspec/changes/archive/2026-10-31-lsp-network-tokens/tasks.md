## 1. Build

- [x] 1.1 `services/shared/network-words.ts`: the network words of every plain-ST network body, each with its class and
  what it runs as, read off `plainStText` (its `%` lines, its receivers' marks) and `sourceStatements` (its labels);
  `networkLabels(body)` for completion
- [x] 1.2 `services/shared/network-meanings.ts`: the one table of hover lines (`NETWORK_MEANINGS`, `markMeaning`,
  `labelMeaning`)
- [x] 1.3 Semantic tokens read the network words first; the legend gains `label` (last)
- [x] 1.4 Completion in a network body: `JMP.` → the body's labels; before a receiver the mark words; where a value or
  a call stands `RAIL()`, `BRANCH`, `BRANCH_SHORTCIRCUIT`, `EXECUTE`, `OPERAND` (`assist/network-completion.ts`)
- [x] 1.5 Hover answers a network word with its one line before any symbol lookup
- [x] 1.6 `networkTokens(text, dialect?)` in `structure/semantic-tokens.ts`, exported through `services/index.ts`
- [x] 1.7 Tests first, colocated: `services/shared/network-words.test.ts` (colours, `networkTokens` equal to the token
  stream, completion only where valid and never in an ST body, hover one line per word)

## 2. Consumers

- [x] 2.1 Sim-Assist adds `networkTokens` to its bundle's `services/index.ts` exports and runs `npm run build:volt` —
  handed to Sim-Assist 2026-10-31 (its task, not Volt's)
