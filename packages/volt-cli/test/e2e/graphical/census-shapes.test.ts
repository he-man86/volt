/**
 * THE CENSUS SHAPES, LIVE (openspec ld-fbd-coverage 2.3): every shape the six corpora pulled UNSUPPORTED (tasks 0.1) —
 * S1 a bit operator connected by a stored output slot, S2 an assignment below the top level, S3 a wire of unknown type
 * (a2 leaf-fed, b rail-fed), S5 a call through `SUPER^`, S6 a negated box input pin — pushed as the text spells it, pulled
 * back, pushed again: a fixed point, and a clean build.
 *
 * The offline tests (`NetworkShapeSpellingTests`, `NetworkPragmaTests`) prove the text round-trips against the model;
 * only the IDE can say whether the vendor KEEPS what the push builds — a box's stored output names (`{OutputParam.Names
 * := ['']}`), a pin's negation through `SetInputFlag`, a leaf's stored type — and whether it compiles.
 *
 * On TwinCAT the same invariant, not the same outcome: a shape the native builder has no TwinCAT form for (S6: this
 * vendor's reader cannot read a pin's InputFlags back) is REFUSED by name, never accepted and reshaped.
 */
import { describe, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { id, fid, requireHealthy, VENDOR, BASE } from "../harness"
import { itGapped, PLATFORM_GAPS } from "../lib/platform"
import { expectRoundTrip, expectRoundTripOrRefusal } from "../lib/roundtrip"
import { ensureCompiles, withMainProgramRestored } from "../lib/compile"
import { createItem, removeItem } from "../lib/workspace"

/** On a CODESYS version that cannot take an LD/FBD write, every test here must end in that refusal (lib/platform.ts). */
const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(120_000)

/** A FUNCTION_BLOCK wrapping one network body, with the declarations the shapes reference. */
function fb(name: string, lang: "FBD" | "LD", statements: string, header = `FUNCTION_BLOCK ${name}`): string {
	return (
		`${header}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tgo : BOOL;\n\tout : BOOL;\n\tout2 : BOOL;\n\tt1 : TON;\n\tpt : TIME;\nEND_VAR\n` +
		`IMPLEMENTATION ${lang}\nNETWORK\n${statements}\nEND_NETWORK\n\nEND_FUNCTION_BLOCK\n`
	)
}

/** Round-trips on CODESYS; on TwinCAT round-trips or is refused naming `twincatRefusal` (an unmeasured import). */
async function shape(key: string, src: (name: string) => string, twincatRefusal?: string): Promise<void> {
	const name = id(key)
	const item = fid(key, "pou")
	try {
		const text = src(name)
		if (VENDOR === "twincat" && twincatRefusal !== undefined) {
			if ((await expectRoundTripOrRefusal(item, text, twincatRefusal)) === "refused") return
		} else await expectRoundTrip(item, text)
		await withMainProgramRestored(() => ensureCompiles(name))
	} finally {
		await removeItem(item)
	}
}

describe(`graphical / census shapes, ld-fbd-coverage 2.3 (${BASE})`, () => {
	beforeAll(async () => {
		await requireHealthy()
	})

	it("S1: a bit operator storing an output slot is its pragmas, and the IDE keeps them", async () => {
		await shape("s1", (n) => fb(n, "FBD", "  out := a AND b;"))
	})

	it("S2: an assignment below the top level is its own pair", async () => {
		await shape("s2", (n) => fb(n, "LD", "  t1 : TON(IN := (out := go), PT := pt);"), "an assignment to 'out' below the top level")
	})

	it("S3a: a leaf-fed wire is declared with the leaf's stored type", async () => {
		await shape("s3a", (n) => fb(n, "LD", "  split1 := a;\n  out := split1 AND b;\n  out2 := split1;"), "fed by the leaf 'a'")
	})

	it("S3b: in LD a wire fed by nothing is the left rail, BOOL", async () => {
		await shape("s3b", (n) => fb(n, "LD", "  split2 := ;\n  out := split2 AND a;\n  out2 := split2;"))
	})

	it("S6: a negated pin is spelled on its formal, on an operator's and on a call's", async () => {
		await shape("s6", (n) => fb(n, "FBD", "  out := `AND`(IN1 := a, NOT IN2 := b);"), "a modifier on its input pin")
		await shape("s6fb", (n) => fb(n, "FBD", "  t1 : TON(NOT IN := go, PT := pt);"), "a modifier on its input pin")
	})

	describe("S5", () => {
		const base = id("s5base")
		beforeAll(async () => {
			await removeItem(fid("s5base", "pou"))
			await createItem(fid("s5base", "pou"), `FUNCTION_BLOCK ${base}\nVAR_INPUT\n\tx : BOOL;\nEND_VAR\nIMPLEMENTATION ST\n\nEND_FUNCTION_BLOCK\n`)
		})
		afterAll(async () => {
			await removeItem(fid("s5base", "pou"))
		})

		it("a call through SUPER^ is the backticked instance of the base, its type the base", async () => {
			await shape("s5", (n) => fb(n, "FBD", `  \`SUPER^\` : ${base}(x := go);`, `FUNCTION_BLOCK ${n} EXTENDS ${base}`), "SUPER^")
		})
	})
})
