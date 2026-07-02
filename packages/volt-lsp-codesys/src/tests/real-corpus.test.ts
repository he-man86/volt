/**
 * Real-project LSP coverage — a RATCHET test against a committed materialized corpus (a full-option
 * CODESYS project, `test-corpus/pro2193/`). Asserts coverage never regresses; as parser/precision
 * gaps are fixed, tighten the thresholds toward the goal (100% parse, 0 diagnostics). The corpus is
 * the ground truth: it compiles clean in the IDE, so every LSP diagnostic on it is a false-positive.
 *
 * Run: `bun test src/tests/real-corpus.test.ts` — also prints the current coverage numbers.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { computeCoverage } from "../../scripts/coverage-report.js";

const CORPUS = join(import.meta.dir, "..", "..", "test-corpus", "pro2193");

// ── Baseline. Tighten (raise floors / lower the ceiling) as gaps are fixed; never loosen. ──
// 2026-07-01 initial: parse 239, ingest 418, diags 9285.
// + parser fixes (FB/interface access modifiers, %FOLDER skip): parse 239→319, ingest 418→424.
// + type-expr/var fixes (ARRAY[*] VLA, ARRAY-of-FB `[…]` element initializers): parse 319→347.
// + %FOLDER scan-strip (the directive's FOLDER/path words no longer scan as unresolved): diags 9437→8069.
// + typed inline enum `( … ) DINT` base type: parse 347→375 (also un-truncates those FBs' VAR sections).
// + EXTENDS inherited-member resolution (lookup walks the base-scope chain): diags 8069→6878.
// + parse-to-100 pass: property PUBLIC/ABSTRACT modifier stacking + trailing `;`, interface qualified/
//   multi EXTENDS, GET/SET/OVERRIDE/… as method|property names (expectName), enum initializers with
//   nested parens (`TO_WORD(…)`), `REF=` reference initializer, graphical FB body closed by END_METHOD:
//   parse 375→424 (100%). Precision 6878→6894 (more parsing surfaces a few more library-blind refs).
// + scope-identity fix (findScopeForUnit matches by AST-span identity, not first same-named scope):
//   diags 6894→1851. Same-named methods across FBs (Reset/Set/Map/…) no longer resolve a body against
//   the wrong FB's members. Remaining ~1573 unresolved are external library/builtin symbols that
//   `volt pull` does not mirror (L_MC1P, SER_*, CONCAT, …) + a small tail of project-local gaps.
// + exclude-from-build gate (pro2193.excluded.json — 15 items captured live from the bridge, 9 in-corpus):
//   diags 1851→1334 built-only. Objects the IDE never compiles (MagazineBaseFB & cluster) have NO ground
//   truth, so their 517 diagnostics are suppressed, not counted. "goal 0" now means 0 on BUILT objects.
// + standard-function reference table (LEN/CONCAT/UPPER_BOUND/LOWER_BOUND/MOVE + CODESYS Str*A), consulted
//   by the unresolved check: diags 1334→1119.
// + reserved-keyword exempts contextual keywords valid as names (Set/Override/…): diags 1119→1097.
// + corpus refresh (424→519 files — harvested COMPLETE from the bridge; the old subset was missing ~95
//   files, so their referenced project types looked "external"). Bundles two fixes: (a) the bridge now
//   classifies ITextListEnumerationObject as an enum DUT, so text-list enums (SER_OperationModeType,
//   IQSlices, enumRecipeCommandResult — ~355 refs) materialize instead of dropping to Unknown; (b) the
//   parser skips `%FOLDER` in interface methods/properties (incl. GET/END_GET accessor blocks). Built-only
//   diags 1097→628.
// + graphical-child declaration fix (519→520 files): a graphical (FBD/LD/CFC/SFC) method child was
//   materialized with its PARENT POU's declaration (both vendors export the enclosing POU; DeclFromExport
//   grabbed the parent's InterfaceAsPlainText). SetErrorFB.fb (previously omitted) now parses; ActuatorFB /
//   Cylinder_53ValveFB had corrupted children that silently parsed but emitted false positives. Diags
//   628→608 (vg-undeclared 10→0). Remaining ~587 unresolved are un-mirrored LIBRARY symbols (PACK_ML,
//   L_MC1P/L_MC4P motion, Fanuc/Cmp* types) — the floor until a library signature index exists.
const BASE = {
	files: 520, // corpus size — must not shrink (files went missing)
	parseCleanFiles: 520, // 100% — every corpus file parses clean; must not regress
	ingestFiles: 520, // 100% — floor
	totalDiags: 608, // ceiling — diagnostics on BUILT files only; each is a false-positive suspect (goal 0)
	excludedFiles: 14, // floor — the manifest must stay loaded (excluded corpus files whose diags are suppressed)
};

describe("real-project coverage (pro2193)", () => {
	const cov = computeCoverage(CORPUS, "codesys");

	test("report", () => {
		const pct = (n: number, d: number) => ((100 * n) / d).toFixed(1) + "%";
		console.log(
			`\n  corpus ${cov.files} files / ${cov.units} units` +
				`\n  parse   ${cov.parseCleanFiles}/${cov.files} clean (${pct(cov.parseCleanFiles, cov.files)}) — ${cov.parseErrors} errors` +
				`\n  ingest  ${cov.ingestFiles}/${cov.files} (${pct(cov.ingestFiles, cov.files)})` +
				`\n  precision ${cov.totalDiags} diagnostics (target 0): ${JSON.stringify(cov.byCode)}`,
		);
		expect(cov.files).toBeGreaterThanOrEqual(BASE.files);
	});

	test("parse coverage does not regress", () => {
		expect(cov.parseCleanFiles).toBeGreaterThanOrEqual(BASE.parseCleanFiles);
	});

	test("ingest coverage does not regress", () => {
		expect(cov.ingestFiles).toBeGreaterThanOrEqual(BASE.ingestFiles);
	});

	test("precision does not regress (no new false positives on built objects)", () => {
		expect(cov.totalDiags).toBeLessThanOrEqual(BASE.totalDiags);
	});

	test("exclude-from-build manifest stays loaded (built-only measurement is honest)", () => {
		// If the manifest fails to load, excludedFiles drops to 0 and totalDiags jumps back to ~1851 —
		// this floor makes that silent regression fail loudly rather than quietly re-counting excluded noise.
		expect(cov.excludedFiles).toBeGreaterThanOrEqual(BASE.excludedFiles);
	});
});
