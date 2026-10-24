import { landed } from "../harness"
﻿/**
 * Graphical bodies — create, round-trip, and verify FBD/LD programs.
 * CFC/SFC are unsupported (declaration-only, never created) — see BodyCodec.UnsupportedCodec.
 */
import { describe, expect, beforeAll, beforeEach, afterEach, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, cleanup, createItem, fetchItem, ensureCompiles, expectNoOperandsLost, requireHealthy, savePlcPrg, restorePlcPrg, fixPlcPrg, plcFolder, FOLDER, BASE, VENDOR, inFolder, fileOf, projectRoot, applicationRoot } from "../harness"

import { itGapped, PLATFORM_GAPS } from "../lib/platform"

/** On a CODESYS version that cannot take an LD/FBD write, every test here must end in that refusal (lib/platform.ts). */
const it = itGapped(PLATFORM_GAPS.graphicalWrite)

// A TwinCAT full build is ~9s — past bun's 5s default. The build-verification test compiles the project, so
// give every test headroom (the round-trip tests are fast; this only matters for the build check).
setDefaultTimeout(30000)

function fbdProgram(name: string) {
	// CANONICAL readable form (a fixed point of NetworkTextWriter∘NetworkTextReader, so it passes the round-trip gate): operands
	// inlined, single-use results inlined, full parenthesisation. Exercises OUTPUT negation (`out := NOT (a AND
	// b)`) — which now round-trips through both vendors (FBD inVariable negation is encoded as expression text;
	// see GraphWriter). The old verbose `i1 := a; … g1 := (i1 AND i2); out := NOT g1;` is now non-canonical.
	return `PROGRAM ${name}
VAR
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
END_VAR
IMPLEMENTATION FBD
NETWORK
  out := NOT (a AND b);
END_NETWORK

END_PROGRAM
`
}

function ldProgram(name: string) {
	return `PROGRAM ${name}
VAR
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
  out := a AND b;
END_NETWORK

END_PROGRAM
`
}

// LD featureset variations (mirror the C# LadderRoundTripTests at the live-bridge layer): a normally-closed
// (negated) contact, a longer series, multiple coils in one network, and a SET coil.
// A negated contact sits INLINE. This used to read `LET i1 := NOT a; out := (i1 AND b);`, which the writer
// hoisted because it tested the RENDERED text ("NOT a" has a space) instead of the operand's own text. Per
// network-text.html#opaque, an `i*` name is minted for an OPAQUE LEAF - "arbitrary inlined ST text" - and `a` is a
// plain identifier carrying a modifier, so no name was ever due. The spec also says a single-use LET is a
// textual convenience substituted back on read, so both spellings always meant the same tree; only one of them
// is what the writer emits, and now it is the one the spec describes.
function ldNegated(name: string) {
	return `PROGRAM ${name}
VAR
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
  out := NOT a AND b;
END_NETWORK

END_PROGRAM
`
}
function ldSeries3(name: string) {
	return `PROGRAM ${name}
VAR
\ta : BOOL;
\tb : BOOL;
\tc : BOOL;
\tout : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
  out := a AND b AND c;
END_NETWORK

END_PROGRAM
`
}
function ldMultiCoil(name: string) {
	return `PROGRAM ${name}
VAR
\ta : BOOL;
\tb : BOOL;
\tq : BOOL;
\tr : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
  q := a;
  r := b;
END_NETWORK

END_PROGRAM
`
}
function ldSetCoil(name: string) {
	return `PROGRAM ${name}
VAR
\ta : BOOL;
\tout : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
  out S= a;
END_NETWORK

END_PROGRAM
`
}

// An FBD program with a CODESYS Execute box — the standard "ST inside FBD/LD" element. EN-guarded (the EN pin,
// `END_EXECUTE ENO EN bRun`), holding real multi-statement, commented ST. Exercises the full round-trip: NetworkTextReader
// detects `EXECUTE … END_EXECUTE`, GraphWriter reconstructs `<block typeName="EXECUTE"> + <STCode>`, and a
// re-push is byte-identical (the ST is carried verbatim).
function executeProgram(name: string) {
	return `PROGRAM ${name}
VAR
\tbRun : BOOL := TRUE;
\tiResult : INT;
END_VAR
IMPLEMENTATION FBD
NETWORK
  EXECUTE
  IF bRun THEN
\tiResult := 40 + 2;   (* the answer *)
  END_IF
  END_EXECUTE ENO EN bRun;
END_NETWORK

END_PROGRAM
`
}

// (The blank line between EXECUTE and END_EXECUTE is the CANONICAL form for an empty box — the writer
// emits one line for the empty ST, and the gate refuses anything else. Measured against the live gate,
// not guessed: the first cut of this fixture omitted it and was refused NETWORK_NOT_CANONICAL.)
// The same box with NO ST in it — an Execute box the engineer blanked, which is a shape a real project holds
// and Volt's own reader used to lose. `ReadStCode` trailed with `is { Length: > 0 } ? t : null`, so an empty
// snippet read back as StCode == null, the writer skipped its EXECUTE arm, and the box came back as
// `EXECUTE();` — a call to a function that does not exist. Push→pull was therefore not a fixed point, and
// pushing that `EXECUTE();` back rebuilt the network with no STSnippet at all: an ordinary box named EXECUTE.
function emptyExecuteProgram(name: string) {
	return `PROGRAM ${name}
VAR
	bRun : BOOL := TRUE;
END_VAR
IMPLEMENTATION FBD
NETWORK
  EXECUTE

  END_EXECUTE ENO EN bRun;
END_NETWORK

END_PROGRAM
`
}

// A graphical FUNCTION_BLOCK (not a PROGRAM) — instantiable, so it can be REFERENCED from PLC_PRG and TwinCAT
// will actually compile its body (TC skips unreferenced POUs; an instance declaration forces compilation).
function ldFb(name: string) {
	return `FUNCTION_BLOCK ${name}
VAR
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
  out := a AND b;
END_NETWORK

END_FUNCTION_BLOCK
`
}

describe(`graphical / round-trip (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy() })
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })

	for (const [lang, buildSrc] of [["FBD", fbdProgram], ["LD", ldProgram]] as [string, (n: string) => string][]) {
		it(`creates a ${lang} program from scratch and round-trips byte-identical`, async () => {
			const name = id(`net_${lang.toLowerCase()}`)
			const fullName = inFolder(await projectRoot(), fid(`net_${lang.toLowerCase()}`, "pou"))   // a graphical PROGRAM is X.pou like every POU (kept graphical by content)
			const src = buildSrc(name)
			expect(src).toContain("NETWORK")

			const refs = await bridge.refs()
			const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "set", name: fullName, sourceText: src, ifVersion: null }] })
			expect(landed(r)).toBe(true)

			const after = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name === fullName)
			expect(after).toBeDefined()
			expect(after.name.endsWith(".pou")).toBe(true)                        // named by KIND (pou); graphical-ness is in the content
			expect(after.sourceText).toContain(`IMPLEMENTATION ${lang}`)   // stayed ${lang}, not flattened to ST
			expectNoOperandsLost(src, after.sourceText)   // …and nothing in the diagram was dropped on the way

			// WHAT VOLT WROTE IS WHAT VOLT READS BACK — the pushed source, byte for byte.
			//
			// This is the assertion the suite was missing, and its absence is not academic: every other check
			// here compares a FETCH to a FETCH, so the bridge only had to be self-consistent, not faithful. A
			// body that lost its declaration, or gained a line, satisfied all of them. (`v1 === v2` after a
			// re-push is exactly that shape — it pins stability, and stability is not fidelity.)
			//
			// The fixtures above are the CANONICAL network-text form, which they claimed to be and were not:
			// they omitted the blank line StWriter emits before every END keyword, for every kind. Nothing was
			// wrong with the bridge — the fixtures simply were not the form the format defines, and no
			// assertion compared them to it, so the discrepancy sat here unseen.
			expect(after.sourceText).toBe(src)

			// The program-scope DECLARATION must survive a push-create — NetworkCode.Write writes the BODY
			// only, so without an explicit decl write the VAR section comes back empty and the vars the
			// contacts/coils reference are undeclared. The body round-trip alone never caught this.
			const decl = after.sourceText.split("NETWORK")[0]
			expect(decl).toContain("a :")
			expect(decl).toContain("out :")

			// Round-trip: push the same source back, should be accepted and unchanged
			const refs2 = await bridge.refs()
			const r2 = await bridge.push({ expectedProjectVersion: refs2.projectVersion, ops: [{ op: "set", name: fullName, sourceText: after.sourceText, ifVersion: refs2.items[fullName] }] })
			expect(landed(r2)).toBe(true)
			const after2 = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name === fullName)
			expect(after2.sourceText).toBe(after.sourceText)
		})
	}

	it("creates an FBD program with an Execute box (ST-in-FBD) and round-trips it byte-identical", async () => {
		const name = id("net_execute")
		const fullName = inFolder(await projectRoot(), fid("net_execute", "pou"))

		const refs = await bridge.refs()
		const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "set", name: fullName, sourceText: executeProgram(name), ifVersion: null }] })

		// TwinCAT refused this while its PLCopen import was the create door (the importer returned a plain box named
		// EXECUTE with the ST gone); the native writer builds the box from the drawn one's members (twincat-inproc-host).
		expect(landed(r)).toBe(true)

		const after = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name === fullName)
		expect(after).toBeDefined()
		expect(after.sourceText).toContain("IMPLEMENTATION FBD")   // stayed FBD, not flattened to ST
		// The Execute box materialized as a real CODESYS Execute box and read back with its inline ST intact.
		expect(after.sourceText).toContain("EXECUTE")
		expect(after.sourceText).toContain("END_EXECUTE")
		expect(after.sourceText).toContain("iResult := 40 + 2")               // the box's ST survived verbatim…
		expect(after.sourceText).toContain("the answer")                      // …comments and all
		expectNoOperandsLost(executeProgram(name), after.sourceText)

		// Fixed point: re-pushing the fetched body is byte-identical (the round-trip is stable). An UPDATE OMITS
		// `to` — matching how `volt push` builds one. That is not cosmetic: absent means "keep the current
		// path", while a `to` is a real destination and would MOVE this item out of
		// Device/Plc Logic/Application.
		const refs2 = await bridge.refs()
		const r2 = await bridge.push({ expectedProjectVersion: refs2.projectVersion, ops: [{ op: "set", name: fullName, sourceText: after.sourceText, ifVersion: refs2.items[fullName] }] })
		expect(landed(r2)).toBe(true)
		const after2 = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name === fullName)
		expect(after2.sourceText).toBe(after.sourceText)
	})

	// THE EMPTY ONE. The test above only ever pushed a box WITH ST, so the reader's empty-vs-missing conflation
	// was invisible to the whole live tier: an empty snippet came back as `EXECUTE();` and nothing asked.
	it("an Execute box with EMPTY ST stays an Execute box", async () => {
		const name = id("net_execute_empty")
		const fullName = inFolder(await projectRoot(), fid("net_execute_empty", "pou"))

		const refs = await bridge.refs()
		const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "set", name: fullName, sourceText: emptyExecuteProgram(name), ifVersion: null }] })

		expect(landed(r)).toBe(true)

		const after = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name === fullName)
		expect(after).toBeDefined()
		expect(after.sourceText).toContain("END_EXECUTE")          // …and NOT the `EXECUTE();` call form
		expect(after.sourceText).not.toContain("EXECUTE()")

		// A fixed point, which is the half the bug actually broke: the pulled text pushes back unchanged.
		const refs2 = await bridge.refs()
		const r2 = await bridge.push({ expectedProjectVersion: refs2.projectVersion, ops: [{ op: "set", name: fullName, sourceText: after.sourceText, ifVersion: refs2.items[fullName] }] })
		expect(landed(r2)).toBe(true)
		const after2 = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name === fullName)
		expect(after2.sourceText).toBe(after.sourceText)
	})

	// `exact` = the pushed text must come back byte for byte — on every shape now. `multicoil` (two INDEPENDENT rungs in
	// one network) was the exception while TwinCAT created bodies through its PLCopen import, which builds one network per
	// connected component (D25); the native writer builds the network the text states (openspec twincat-inproc-host).
	for (const [label, buildSrc, exact] of [
		["negated", ldNegated, true],
		["series3", ldSeries3, true],
		["multicoil", ldMultiCoil, true],
		["setcoil", ldSetCoil, true],
	] as [string, (n: string) => string, boolean][]) {
		it(`LD featureset (${label}) round-trips to a stable LD body`, async () => {
			const name = id(`net_ld_${label}`)
			const fullName = inFolder(await projectRoot(), fid(`net_ld_${label}`, "pou"))
			const refs = await bridge.refs()
			const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "set", name: fullName, sourceText: buildSrc(name), ifVersion: null }] })
			expect(landed(r)).toBe(true)

			const v1 = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => fileOf(i.name).startsWith(name + "."))
			expect(v1).toBeDefined()
			expect(v1.name.endsWith(".pou")).toBe(true)                // a graphical program is a .pou file like any POU
			expect(v1.sourceText).toContain("IMPLEMENTATION LD")   // stayed ladder (LD), not flattened to ST
			expectNoOperandsLost(buildSrc(name), v1.sourceText)          // and every element survived the write
			if (exact) expect(v1.sourceText).toBe(buildSrc(name))        // …and it came back exactly as pushed
			// The one inexact shape still has to keep every rung — the split may regroup them, never drop one.
			else expect(v1.sourceText.match(/^NETWORK\b/gm)!.length).toBeGreaterThanOrEqual(1)

			// Fixed point: pushing the fetched network text back leaves the body byte-identical.
			const refs2 = await bridge.refs()
			const r2 = await bridge.push({ expectedProjectVersion: refs2.projectVersion, ops: [{ op: "set", name: fullName, sourceText: v1.sourceText, ifVersion: refs2.items[v1.name] }] })
			expect(landed(r2)).toBe(true)
			const v2 = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name === v1.name)
			expect(v2.sourceText).toBe(v1.sourceText)
		})
	}

	it("a created graphical FB compiles when referenced — build-verified on BOTH vendors", async () => {
		// The deeper guard: round-tripping a body proves the BODY is stable, not that the POU is VALID. A
		// push-created graphical POU once landed with an empty VAR section → its contacts referenced undeclared
		// vars → a BUILD error neither the round-trip nor a naive build caught. We use an FB (instantiable) and
		// declare an instance in PLC_PRG so TwinCAT actually compiles its body — proven necessary: an
		// UNREFERENCED POU builds clean on TC (skipped), a REFERENCED one with a bad var fails with "Identifier
		// not defined". CODESYS compiles every POU regardless. So this build-verifies the declaration on BOTH.
		const name = id("net_build_fb")
		await createItem(fid("net_build_fb"), ldFb(name), await projectRoot())
		await ensureCompiles(name)   // declare an instance in PLC_PRG + build + assert zero errors
	})

	// This used to be SKIPPED on TwinCAT, on a finding that has since been retracted: no MoveChild/Move/Reparent
	// member exists on a TwinCAT tree item, which was read as "the vendor cannot move", so asserting a move
	// looked like asserting a capability that did not exist. The absent member is real; the conclusion was not.
	// Relocation there is not a method call at all — TcItemArchive round-trips the item through its own archive
	// export, which moves it whole. The skip then outlived that finding by an entire implementation, because a
	// skipped test reports nothing: it just keeps describing the world as it was on the day it was written.
	it("a graphical POU can be MOVED, body intact — it used to be refused outright", async () => {
		// A move used to be a delete-and-recreate, and a graphical body cannot be rebuilt from text, so a
		// graphical move was REFUSED ("reorganize it in the IDE, then pull"). With a real IVendorTree.Move the
		// IDE relocates the object whole, so this is now a supported operation — and the body must survive it
		// byte-identical, which is the whole reason the old path refused rather than tried.
		const name = id("net_move")
		const fullName = inFolder(await applicationRoot(), fid("net_move", "pou"))
		await createItem(fid("net_move", "pou"), fbdProgram(name), await applicationRoot())
		const before = (await fetchItem(fullName)).sourceText

		// Moved into a folder the fixture ALREADY has, rather than a fresh "Moved/Deep". The shared cleanup()
		// deletes prefixed ITEMS, and a folder is not one — so a test-created folder survives, lands in the
		// TwinCAT fixture's `.plcproj` as a `<Folder Include="Moved\Deep" />`, and dirties the working tree on
		// every run. An existing folder proves relocation just as well, because the item starts at the root.
		const target = await plcFolder(FOLDER)
		const refs = await bridge.refs()
		const r = await bridge.push({
			expectedProjectVersion: refs.projectVersion,
			ops: [{ op: "set", name: fullName, to: inFolder(target, fileOf(fullName)), ifVersion: refs.items[fullName] }],
		})
		expect(landed(r)).toBe(true)

		const after = await fetchItem(inFolder(target, fileOf(fullName)))
		expect(after.sourceText).toBe(before)                     // the graphical body is untouched
		const items = (await bridge.refs()).items as Record<string, string>
		expect([items[inFolder(target, fileOf(fullName))] !== undefined, items[fullName] !== undefined]).toEqual([true, false]) // and it really moved
	})

	it("a graphical POU in the project re-pushes byte-identical (no phantom drift)", async () => {
		// Self-provisioned (NOT discover()) so it runs identically on every bridge: a fetched graphical
		// body pushed back unchanged must round-trip byte-identical — the no-phantom-drift guarantee on a
		// POU that already lives in the project. (CFC/SFC unsupported behaviour is covered vendor-agnostically
		// by GraphicalCodeTests.Cfc_/Sfc_body_is_a_read_only_marker — no live fixture needed.)
		const name = id("net_existing")
		const fullName = inFolder(await projectRoot(), fid("net_existing", "pou"))
		const refs0 = await bridge.refs()
		expect(landed((await bridge.push({ expectedProjectVersion: refs0.projectVersion, ops: [{ op: "set", name: fullName, sourceText: fbdProgram(name), ifVersion: null }] })))).toBe(true)

		const g = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => fileOf(i.name).startsWith(name + "."))
		expect(g).toBeDefined()
		const s1: string = g.sourceText
		expect(s1).toContain("NETWORK")
		expect(s1).toBe(fbdProgram(name))   // the provisioning push is itself faithful, before drift is measured

		const refs = await bridge.refs()
		const r = await bridge.push({ expectedProjectVersion: refs.projectVersion, ops: [{ op: "set", name: fullName, sourceText: s1, ifVersion: refs.items[g.name] }] })
		expect(landed(r)).toBe(true)
		const after = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name === g.name)
		expect(after.sourceText).toBe(s1)
	})

	// ── format guard: a malformed/mismatched push is REFUSED and the IDE item is left untouched (the
	//    bridge is the last line of defence — never lose code). Self-provisioned, runs on both bridges. ──
	// A textual push over a graphical body is a LANGUAGE CHANGE (openspec bridge-refusal-review D7, DIALECT N24): CODESYS
	// writes it in place — the body becomes ST, `language-change.test.ts` — so only TwinCAT, which has no in-place route,
	// still refuses it. The premise "the push refuses it" was Volt's own refusal, disproved on CODESYS by measurement.
	it("refuses to overwrite a graphical body with textual ST where the vendor cannot (TwinCAT) and leaves it untouched", async () => {
		const name = id("net_guard_st")
		const fullName = inFolder(await projectRoot(), fid("net_guard_st", "pou"))
		const r0 = await bridge.refs()
		expect(landed((await bridge.push({ expectedProjectVersion: r0.projectVersion, ops: [{ op: "set", name: fullName, sourceText: fbdProgram(name), ifVersion: null }] })))).toBe(true)
		const before = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => fileOf(i.name).startsWith(name + "."))
		expect(before.name.endsWith(".pou")).toBe(true)                 // .pou file holding an FBD body
		expect(before.sourceText).toContain("IMPLEMENTATION FBD")

		const r1 = await bridge.refs()
		const stSrc = `PROGRAM ${name}\nVAR\n\tx : BOOL;\nEND_VAR\nIMPLEMENTATION ST\nx := TRUE;\nEND_PROGRAM\n`
		const r = await bridge.push({ expectedProjectVersion: r1.projectVersion, ops: [{ op: "set", name: fullName, sourceText: stSrc, ifVersion: r1.items[before.name] }] })
		if (VENDOR === "codesys") {
			expect(landed(r), `CODESYS refused a language change it writes (N24): ${JSON.stringify(r.conflicts)}`).toBe(true)
			const st = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => i.name === fullName)
			expect(st.sourceText).toContain("IMPLEMENTATION ST\nx := TRUE;")
			return
		}
		expect(landed(r)).toBe(false)
		// Clear, actionable reason — and it names BOTH languages. It used to assert the word "graphical", which
		// was a proxy for "the refusal explains itself"; the refusal now comes from the body codec, which knows
		// the two concrete languages instead of one boolean, so "has a FBD body … carries ST" is what it can say.
		// Tightened rather than relaxed: two exact languages is a stronger claim than one category word.
		expect(JSON.stringify(r.conflicts)).toContain("FBD")
		expect(JSON.stringify(r.conflicts)).toContain("ST")

		const after = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => fileOf(i.name).startsWith(name + "."))
		expect(after.name).toBe(before.name)              // unchanged — the textual push was refused, body still FBD
		expect(after.sourceText).toBe(before.sourceText)  // byte-identical: the bad push never reached the IDE
	})

	it("refuses a malformed graphical body (missing END_NETWORK) and leaves the item untouched", async () => {
		const name = id("net_guard_malformed")
		const fullName = inFolder(await projectRoot(), fid("net_guard_malformed", "pou"))
		const r0 = await bridge.refs()
		expect(landed((await bridge.push({ expectedProjectVersion: r0.projectVersion, ops: [{ op: "set", name: fullName, sourceText: fbdProgram(name), ifVersion: null }] })))).toBe(true)
		const before = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => fileOf(i.name).startsWith(name + "."))

		const r1 = await bridge.refs()
		const malformed = fbdProgram(name).replace("END_NETWORK\n", "")   // a valid FBD body with END_NETWORK removed
		const r = await bridge.push({ expectedProjectVersion: r1.projectVersion, ops: [{ op: "set", name: fullName, sourceText: malformed, ifVersion: r1.items[before.name] }] })
		expect(landed(r)).toBe(false)
		expect(JSON.stringify(r.conflicts)).toContain("END_NETWORK")

		const after = (await bridge.fetch({ knownItems: {}, onlyItems: [fullName] })).changed.find((i: any) => fileOf(i.name).startsWith(name + "."))
		expect(after.sourceText).toBe(before.sourceText)  // unchanged
	})
})
