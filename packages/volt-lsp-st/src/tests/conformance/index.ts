/**
 * Public entry point for `@opencode-ai/volt-lsp-st/conformance`.
 *
 * Re-exports the catalog (`CATEGORIES`, `ALL_TESTS`) and the
 * `LanguageTest` / `CategoryGroup` shapes. Consumers outside this
 * package import via the package's `./conformance` export (see
 * `package.json`'s `exports` field).
 *
 * Tests inside this package should import directly from
 * `./fixtures/index.js` or `./types.js` to keep their import
 * paths obvious — this barrel exists for cross-package use.
 */
export type { LanguageTest } from "./types.js";
export {
	ALL_TESTS,
	CATEGORIES,
	type CategoryGroup,
} from "./fixtures/index.js";
