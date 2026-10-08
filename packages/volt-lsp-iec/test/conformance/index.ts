// Conformance harness public surface (the `./conformance` package export). The catalog + types the
// recorder consumes to push fixtures to a live bridge; the replays (transpile-replay.test.ts, lsp-replay.test.ts) are the offline gate.
export type { LanguageTest } from "./types.js"
export { ALL_TESTS, CATEGORIES } from "./fixtures/index.js"
