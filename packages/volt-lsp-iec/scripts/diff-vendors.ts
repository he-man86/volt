/**
 * `diff:vendors` — compare the two committed conformance recordings
 * (`expected-codesys.json` vs `expected-tc.json`) fixture-by-fixture.
 *
 * Answers "where do CODESYS and TwinCAT actually disagree?" without a re-record:
 *   - VERDICT divergence — one IDE accepts, the other rejects (the load-bearing set;
 *     these are the `KNOWN_DIVERGENCES` candidates).
 *   - MESSAGE divergence — same verdict, different diagnostic text (mostly cosmetic
 *     wording: `token`→`Token`, `Function block`→`Functionblock`, quoting).
 *
 * Comparison is presence/verdict-first by design — see `language.test.ts` (the replay
 * compares error+warning PRESENCE, not text; each IDE phrases errors its own way).
 *
 * Usage:  bun run diff:vendors            # summary + all divergences
 *         bun run diff:vendors --messages # also dump the cosmetic message diffs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REC = resolve(THIS_DIR, "..", "src", "tests", "conformance", "recordings");

interface Diag { severity: string; message: string; line?: number }
interface Rec { buildSuccess: boolean; diagnostics: Diag[] }

const load = (v: string): Record<string, Rec> =>
	JSON.parse(readFileSync(resolve(REC, `expected-${v}.json`), "utf-8")).tests;

const errs = (r: Rec | undefined): string[] =>
	(r?.diagnostics ?? []).filter((d) => d.severity === "error").map((d) => d.message).sort();
const eq = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

const cs = load("codesys");
const tc = load("tc");
const names = [...new Set([...Object.keys(cs), ...Object.keys(tc)])].sort();

const verdictDiff: Array<[string, string, string]> = [];
const msgDiff: Array<[string, string[], string[]]> = [];
let identical = 0;

for (const n of names) {
	const a = cs[n];
	const b = tc[n];
	if (!a || !b) {
		verdictDiff.push([n, a ? "accept/reject" : "MISSING", b ? "accept/reject" : "MISSING"]);
		continue;
	}
	if (a.buildSuccess !== b.buildSuccess) {
		verdictDiff.push([n, a.buildSuccess ? "accept" : "REJECT", b.buildSuccess ? "accept" : "REJECT"]);
		continue;
	}
	const ea = errs(a);
	const eb = errs(b);
	if (eq(ea, eb)) identical++;
	else msgDiff.push([n, ea, eb]);
}

console.log(`\n=== ${names.length} fixtures — CODESYS (:8556) vs TwinCAT (:8555) ===`);
console.log(`identical verdict + messages : ${identical}`);
console.log(`same verdict, different msg  : ${msgDiff.length}`);
console.log(`VERDICT divergence           : ${verdictDiff.length}`);

console.log(`\n--- VERDICT DIVERGENCES (one accepts, the other rejects) ---`);
for (const [n, c, t] of verdictDiff) console.log(`  ${n.padEnd(38)} CS=${c}  TC=${t}`);

if (process.argv.includes("--messages")) {
	console.log(`\n--- SAME VERDICT, DIFFERENT MESSAGES ---`);
	for (const [n, ea, eb] of msgDiff) {
		console.log(`  ${n}`);
		console.log(`     CS: ${ea.join(" | ") || "(clean)"}`);
		console.log(`     TC: ${eb.join(" | ") || "(clean)"}`);
	}
}
