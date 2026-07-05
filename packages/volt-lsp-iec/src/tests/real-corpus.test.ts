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
	// + library-signature-index Phase 2 (build-free extraction): `AllPrecompiledSignatures(true,true)` returns
	//   every resolved library signature WITHOUT a build (libraries precompile independently), so `_libsigs`
	//   materializes even on projects whose headless build fails. Harvested per corpus. pro2193 35→30 (2222
	//   stubs; residual = bare lib elements CLOCK/TICKS + enum values). Remaining floors are non-library gaps.
	// + bare enum-member resolution: a non-`{attribute 'qualified_only'}` enum's members are global constants
	//   reachable unqualified (`StateAutomatic`), but the member symbol lives in the enum's own scope, off the
	//   resolver's parent chain — so bare refs false-positived. The unresolved check now skips them (cached set
	//   of bare-accessible enum members). bakon 231→11, pro2193 30→29.
	// + transitive-namespace `.library` stubs (full GetDependencies() tree) + verbose /fetch signatures materialized
	//   under each library's folder in the Library Manager (no more `_libsigs/`; `/lib-symbols` folded into
	//   `/fetch?verbose`; extraction builds first so a freshly-opened project precompiles). Re-harvested from the
	//   cleaned `_COdesys` project variant. pro2193 29→17 (5220 sigs).
	// + referenced-only signatures: emit a library element's signature ONLY when project source names it (bridge
	//   FetchService tokenizes source; drops the blanket `(system)` filter). Shrinks the corpus ~92% AND fixes
	//   used-system-lib refs (`BLINK`/`StrReplaceA`). Renderer now emits a FB's internal VARs too (a derived FB
	//   reads its base's internals, e.g. BLINK's `CLOCK`). Parser: soft keywords (`SET`) are valid var names
	//   (Standard `RS` declares `SET : BOOL`). pro2193 17→3 (279 sigs; residual = `TYPE_CLASS` + a project action).
	// + missingInterfaceImplementation enabled for CODESYS (was TwinCAT-only): the check now follows the EXTENDS
	//   base chain and collects PROPERTY symbols (a standalone PROPERTY ingests as a symbol, not a child scope),
	//   fixing 192 former FPs → 0. The last 2 (`Conveyor_SingleFB` missing `ReturnNextStack`/`HasStacks` from
	//   `IConveyor_Shared_Move_Commands`) were on a DEAD FB CODESYS never compiles (never instantiated → no build
	//   ground truth); the harvest missed its `@volt-uncompiled` marker, now added → diagnostics suppressed.
	//   totalDiags stays 3; excludedFiles 14→15.
	// + 2026-07-05: `TYPE_CLASS` resolved via COMPILER_PROVIDED_IMPLICITS (a system enum the LSP now knows). The
	//   remaining FP was `FirstCycle_XUnitsToParking` in XYControlFB — a method defined only in the sibling variant
	//   XYControl_ForZURFB, so XYControlFB is a dead copy-paste variant. All 16 excluded/uncompiled objects are now
	//   REMOVED from the corpus (the new bridge doesn't ship them at fetch): files 803→787, excludedFiles 15→0,
	//   totalDiags 3→0. No new FPs — no built body referenced a deleted type.
	{ name: "pro2193", dir: "pro2193", base: { files: 787, parseCleanFiles: 787, ingestFiles: 787, totalDiags: 0, excludedFiles: 0, stBodiesClean: 1712 } },
	// bakon 275→231 (4351 stubs). The −44 was the library floor; the 231 residual is a PROJECT-LOCAL gap — bare
	// enum-value references (`StateAutomatic` of sState, `Prod_*` of sProdType) the unresolved check doesn't yet
	// resolve against in-scope enums. Tracked separately from libraries.
	// bakon 11→10 (117 sigs; `SysTimeRtcGet` cleared). Residual 10 = implicit CODESYS globals (`IoConfig_Globals`,
	// `g_dwAGM1_Status`) — a separate follow-up; compiler-verified as false positives (bakon builds 0 errors).
	// + 2026-07-05: `IoConfig_Globals` (auto-generated I/O-mapping GVL) resolved via COMPILER_PROVIDED_IMPLICITS.
	//   `g_dwAGM1_Status` was only a COMMENT in Global_Variables.gvl and its call site in CyclicTask is commented
	//   out ("Moved to the CAN BRIDGE PLC") → ControlStatusAGMs is dead; REMOVED (new bridge doesn't ship it):
	//   files 247→246, totalDiags 10→0. ("bakon builds 0 errors" above = the object was already build-excluded.)
	{ name: "bakon-nano", dir: "bakon-nano", base: { files: 246, parseCleanFiles: 246, ingestFiles: 246, totalDiags: 0, excludedFiles: 0, stBodiesClean: 105 } },
	// awa-palletizer (2026-07-03): the "AWA_Palletizer 09_1" project (54 source files) — a PackML/NextGen-library
	// machine using `{attribute 'qualified_only'}` GVLs with deep qualified access (PC01_GVL.UN01.myState.…).
	// Surfaced + fixed a REAL parser gap: a stray double semicolon (`x : T;;`) in a STRUCT or VAR block (CODESYS
	// tolerates the empty declaration; we aborted the field/section) — 3 parse errors → 0, parse 94.4%→100%. Also
	// hardened gvlNameFromUri to split on `\` as well as `/` (a Windows OS-path URI made a GVL's block name the
	// full path, breaking qualified `GvlName.field` access — latent, not hit by the `/`-normalized coverage scan).
	// Baseline 16 diagnostics, all unresolved-identifier: library-blind (L_IE1P/L_TB2P/MC_DIRECTION) + a small tail
	// on `myState`/`iIndex` (a local FB var referenced via the `S=` set-assignment — a separate resolver follow-up).
	// awa 16→15 (`_libsigs`) →0. The last 15 were NOT the suspected `S=` gap: `FUNCTION_BLOCK UN01_Main EXTENDS
	// StateMachine;` has a stray trailing `;` after the header, so collectVarSections stopped at it and dropped
	// every local (myState/iIndex) from the symbol table — every member reference then false-flagged. Consuming
	// the `;` in parseFunctionBlock (same class as the METHOD/FUNCTION trailing-`;` fix) cleared all 15 → 0.
	{ name: "awa-palletizer", dir: "awa-palletizer", base: { files: 113, parseCleanFiles: 113, ingestFiles: 113, totalDiags: 0, excludedFiles: 0, stBodiesClean: 64 } },
	// lenze-mid (2026-07-03): the "Lenze_MID-S100_V5_00_602_T51" project (180 source files) — the first LD-HEAVY
	// corpus, a stress test for the bridge's PlcOpen⇄VG round-trip AND the LSP's VG analyzer. Every ambiguous case
	// was triaged against the bridge /debug endpoint (raw PlcOpen) before fixing. Surfaced ONE bridge bug — an
	// unconnected EN pin rendered a broken `LET en := ; IF en THEN…` (fixed by dropping the dangling pin at read) —
	// plus a batch of LSP VG-parser gaps: nested-instance call `a.b.c(…)`, SET/RESET keyword pin names,
	// SUPER^()/THIS^(), repeated-instance de-dup (VG_DUPLICATE_NAME), single-operand-paren unwrap, opaque-arithmetic
	// leaf vs malformed group, and EXTENDS-chain pin resolution. VG_PARSE / VG_BAD_EXPRESSION / VG_DUPLICATE_NAME /
	// vg-unknown-pin all → 0; the 79 baseline is the library-blind floor (24 vg-undeclared in VG bodies + 55 ST
	// unresolved, external Lenze/CODESYS libs not mirrored). 1 excluded-from-build object.
	// + library-signature-index Phase 2 (full signatures): the bridge's `POST /lib-symbols` extracts every
	//   referenced-library element's SIGNATURE (FB/function pins+types, struct fields, enum members, GVLs,
	//   interfaces) from the resolved compile context and materializes them as read-only per-element stub
	//   files (`_libsigs/<lib>/<Element>.<kind>`) — 1490 files. The LSP already scans those kind extensions,
	//   so the stubs ingest into the symbol table for free: bare library elements + member access now resolve
	//   (files 180→1670, all parse/ingest clean, no self-diagnostics). ST unresolved 55→2. Two check fixes
	//   rode along: (a) the VG undeclared check now consults libraryNamespaces + deviceInstances like the ST
	//   check (device/library roots in graphical bodies stopped false-flagging, −18); (b) the VG opaque-leaf
	//   identifier scan skips `.`-preceded member segments (a deep chain `a.b.c.d/10` no longer flags c/d, −2).
	//   Diags 79→6. Remaining 6 are corpus-staleness, not code: 4 `EXECUTE` (re-harvest with the execute-box
	//   bridge fix) + 2 `MEM` (a library ref missing from the corpus's Library Manager).
	// lenze re-harvested from the cleaned `_Codesys` variant (v21): 5406 sigs + full `.library` tree. MEM now
	// resolves (CAA Memory.library carries NAMESPACE MEM). 6→4; the 4 residual are the `EXECUTE` graphical boxes
	// (a separate bridge round-trip issue: the ST inside a CODESYS Execute box is dropped, rendered as `EXECUTE()`).
	// + Execute-box STCode in LD bodies: the LD block-read path omitted `ReadStCode` (the FBD path had it), so a
	//   CODESYS Execute box in an LD network dropped its inline ST → rendered `EXECUTE()`. Now it round-trips as
	//   `EXECUTE … END_EXECUTE`. That exposed a VG-parser gap: an EXECUTE box's `IF en THEN` guard is multi-line and
	//   consumed in preprocessing, so `en` wasn't registered as an EN wire and `LET en := <wire>` mis-tripped
	//   VG_LEAF_REFERENCES_TEMP. Now the guard is seeded into enWires from the execute body. lenze 4→0.
	{ name: "lenze-mid", dir: "lenze-mid", base: { files: 365, parseCleanFiles: 365, ingestFiles: 365, totalDiags: 0, excludedFiles: 0, stBodiesClean: 138 } },
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
					`\n  precision ${cov.totalDiags} ERRORS (target 0): ${JSON.stringify(cov.byCode)}  ·  ${cov.warnDiags} warnings (oracle-validated, not ratcheted): ${JSON.stringify(cov.warnByCode)}` +
					`\n  body-AST ${cov.stBodiesClean}/${cov.stBodies} bodies clean (${pct(cov.stBodiesClean, cov.stBodies)}) — ${cov.identMismatchBodies} identifier mismatches`,
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

		// ── ST body AST (st-body-ast). The tree is additive + falls back to the token scan on any unmodeled
		//    construct, so `ok=false` bodies are safe. Two ratchets guard it: (1) body-parse-clean never
		//    regresses — raise the floor as grammar gaps close; (2) ZERO identifier-set mismatches — where the
		//    AST parses, it must cover every identifier the token scan finds, else it silently mis-parsed. ──
		test("ST body-parse-clean does not regress", () => {
			expect(cov.stBodiesClean).toBeGreaterThanOrEqual(base.stBodiesClean);
		});

		test("ST body AST covers every scanned identifier (no mis-parse)", () => {
			expect(cov.identMismatchBodies).toBe(0);
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
