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
//   628→608 (vg-undeclared 10→0).
// + assignment-check fixes: BOOL↔BIT is compatible (BIT is 1-bit boolean storage), and a member/bit-access
//   LHS (`word.Vacuum01 := TRUE`) is no longer mistaken for the same-named global. assignment-type-mismatch
//   21→0.
// + folder-name leading-dot encoding (520→523 files): a CODESYS folder named ".Interfaces / Data" (leading
//   dot) materialized as a HIDDEN directory the LSP file-scan skipped, dropping 3 source files — incl.
//   MagazineMotors_Positions.enum (24 refs). The bridge now encodes a leading dot too, so the folder is
//   visible. Diags 608→563.
// + library-signature-index Phase 1 (library namespaces): the corpus mirrors CODESYS — a read-only
//   `.library` reference file per library, nested under its Library Manager (bridge-encoded filenames for
//   the `*`-version placeholder libs). The LSP scans them and resolves qualified library-reference roots
//   (PACK_ML ×219, L_MC1P ×75, Stu ×72, L_MC4P ×42, …). Diags 563→95. The remaining 95 are device/axis
//   instances (~41), bare library ELEMENTS (~19, → Phase 2), and project-local gaps (~27).
// + device-tree instances: the corpus mirrors the CODESYS device tree — a read-only `.device` descriptor per
//   instance (Name/Vendor/Type/ID/Version/…), at its tree location (105 files, controller spine excluded). The
//   LSP registers each filename as a known global, so bare device references resolve (EtherCAT_Master, YDrive,
//   MagazineAxes, the drives + axes); member access into a device's internal type is not ours to check and
//   falls through. Diags 95→55. Remaining 55: bare library ELEMENTS (~19, → Phase 2) + project-local gaps.
// + complete tree mirror (structure only, diags unchanged at 55): the corpus now nests EXACTLY as CODESYS —
//   Device → Plc Logic → Application → usercode, with the hardware devices as siblings under Device (no more
//   split between hardware under Device/ and software flattened at the root). File scan is recursive, so the
//   counts + resolution are path-independent; this is a layout change, not a precision change.
// + method/function trailing-`;` fix: a `METHOD name : Type;` / `FUNCTION name : Type;` header (some CODESYS
//   exports emit the semicolon) left the `;` unconsumed, so collectVarSections skipped the VAR blocks and every
//   local + the return name resolved nowhere. Cleared the whole ZUnit_ForChainWithServoRotateFB cluster
//   (product0/product1/takeover/product/clearData). Diags 55→35. The remaining 35 are library-blocked: bare
//   library ELEMENTS + members inherited from library base FBs (BlinkHammerFB EXTENDS the Util `BLINK`) — all
//   Phase 2 — plus a 2-diag polymorphism edge case (a base FB calling a method defined only in a derived FB).
// bakon-nano (2026-07-03): the full-option "Bakon Nano new VISU v00_90" project (130 source files) added as
// a SECOND real-project corpus. Parser/lexer clean on first contact — 0 parse errors, 100% ingest. Also
// surfaced + fixed the `analysis` static-analysis attribute pragma (was mis-flagged unknown-pragma). No
// exclude-from-build manifest yet.
// + VG reference-catalog lookup (check-vg-code.ts): the graphical analyzer now consults the same reference
//   catalog the ST unresolved check does, so standard functions inside FBD/LD bodies (DELETE/REPLACE/…) no
//   longer false-positive. diags 280→277 (vg-undeclared 5→2).
// + bridge Execute-box round-trip (graphical-execute-box): the 2 remaining `EXECUTE()` were NOT
//   library-blindness — they were a bridge data-loss bug. Recipes.fbd holds CODESYS "Execute" boxes (a
//   STANDARD ST-in-FBD/LD element, <STCode>) the bridge dropped, rendering a lossy `EXECUTE()` call. Now a
//   first-class VG `EXECUTE … END_EXECUTE` construct renders the ST verbatim (EN via the ordinary wire+IF),
//   round-trips to a real CODESYS Execute box on push (VgParser + PlcOpenWriter, live-verified), and the LSP
//   skips the block from the simplified VG grammar (readable, no VG_PARSE). Re-harvested: Recipes.prg shows
//   the real recipe ST; vg-undeclared 2→0, VG_PARSE 0. diags 277→275 (all unresolved-identifier, library-blind).
const CORPORA: ReadonlyArray<{
	name: string;
	dir: string;
	base: { files: number; parseCleanFiles: number; ingestFiles: number; totalDiags: number; excludedFiles: number };
}> = [
	{ name: "pro2193", dir: "pro2193", base: { files: 523, parseCleanFiles: 523, ingestFiles: 523, totalDiags: 35, excludedFiles: 14 } },
	{ name: "bakon-nano", dir: "bakon-nano", base: { files: 130, parseCleanFiles: 130, ingestFiles: 130, totalDiags: 275, excludedFiles: 0 } },
	// awa-palletizer (2026-07-03): the "AWA_Palletizer 09_1" project (54 source files) — a PackML/NextGen-library
	// machine using `{attribute 'qualified_only'}` GVLs with deep qualified access (PC01_GVL.UN01.myState.…).
	// Surfaced + fixed a REAL parser gap: a stray double semicolon (`x : T;;`) in a STRUCT or VAR block (CODESYS
	// tolerates the empty declaration; we aborted the field/section) — 3 parse errors → 0, parse 94.4%→100%. Also
	// hardened gvlNameFromUri to split on `\` as well as `/` (a Windows OS-path URI made a GVL's block name the
	// full path, breaking qualified `GvlName.field` access — latent, not hit by the `/`-normalized coverage scan).
	// Baseline 16 diagnostics, all unresolved-identifier: library-blind (L_IE1P/L_TB2P/MC_DIRECTION) + a small tail
	// on `myState`/`iIndex` (a local FB var referenced via the `S=` set-assignment — a separate resolver follow-up).
	{ name: "awa-palletizer", dir: "awa-palletizer", base: { files: 54, parseCleanFiles: 54, ingestFiles: 54, totalDiags: 16, excludedFiles: 0 } },
	// lenze-mid (2026-07-03): the "Lenze_MID-S100_V5_00_602_T51" project (180 source files) — the first LD-HEAVY
	// corpus, a stress test for the bridge's PlcOpen⇄VG round-trip AND the LSP's VG analyzer. Every ambiguous case
	// was triaged against the bridge /debug endpoint (raw PlcOpen) before fixing. Surfaced ONE bridge bug — an
	// unconnected EN pin rendered a broken `LET en := ; IF en THEN…` (fixed by dropping the dangling pin at read) —
	// plus a batch of LSP VG-parser gaps: nested-instance call `a.b.c(…)`, SET/RESET keyword pin names,
	// SUPER^()/THIS^(), repeated-instance de-dup (VG_DUPLICATE_NAME), single-operand-paren unwrap, opaque-arithmetic
	// leaf vs malformed group, and EXTENDS-chain pin resolution. VG_PARSE / VG_BAD_EXPRESSION / VG_DUPLICATE_NAME /
	// vg-unknown-pin all → 0; the 79 baseline is the library-blind floor (24 vg-undeclared in VG bodies + 55 ST
	// unresolved, external Lenze/CODESYS libs not mirrored). 1 excluded-from-build object.
	{ name: "lenze-mid", dir: "lenze-mid", base: { files: 180, parseCleanFiles: 180, ingestFiles: 180, totalDiags: 79, excludedFiles: 1 } },
];

for (const { name, dir, base } of CORPORA) {
	describe(`real-project coverage (${name})`, () => {
		const cov = computeCoverage(join(import.meta.dir, "..", "..", "test-corpus", dir), "codesys");

		test("report", () => {
			const pct = (n: number, d: number) => ((100 * n) / d).toFixed(1) + "%";
			console.log(
				`\n  [${name}] ${cov.files} files / ${cov.units} units` +
					`\n  parse   ${cov.parseCleanFiles}/${cov.files} clean (${pct(cov.parseCleanFiles, cov.files)}) — ${cov.parseErrors} errors` +
					`\n  ingest  ${cov.ingestFiles}/${cov.files} (${pct(cov.ingestFiles, cov.files)})` +
					`\n  precision ${cov.totalDiags} diagnostics (target 0): ${JSON.stringify(cov.byCode)}`,
			);
			expect(cov.files).toBeGreaterThanOrEqual(base.files);
		});

		test("parse coverage does not regress", () => {
			expect(cov.parseCleanFiles).toBeGreaterThanOrEqual(base.parseCleanFiles);
		});

		test("ingest coverage does not regress", () => {
			expect(cov.ingestFiles).toBeGreaterThanOrEqual(base.ingestFiles);
		});

		test("precision does not regress (no new false positives on built objects)", () => {
			expect(cov.totalDiags).toBeLessThanOrEqual(base.totalDiags);
		});

		if (base.excludedFiles > 0) {
			test("exclude-from-build markers are read (built-only measurement is honest)", () => {
				// Excluded objects carry an in-file `(* @volt-exclude-from-build *)` marker. If it stops being read,
				// excludedFiles drops to 0 and totalDiags jumps back up — this floor makes that regression fail loudly
				// rather than quietly re-counting the excluded (no-ground-truth) noise.
				expect(cov.excludedFiles).toBeGreaterThanOrEqual(base.excludedFiles);
			});
		}
	});
}
