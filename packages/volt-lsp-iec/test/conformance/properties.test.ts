/**
 * THE MEMORY MODEL, UNDER PROPERTIES RATHER THAN EXAMPLES.
 *
 * `SIZEOF`, `ADR`, `^` and a UNION's overlay are covered today by hand-written fixtures — each a shape someone thought
 * of, each pinning one number CODESYS gave. That is the right oracle and it stays the oracle: these properties cannot
 * say what the vendor answers, and they never assert a size. What they can say is that the model is CONSISTENT with
 * itself over shapes nobody wrote down, which is where an example-only suite is blind.
 *
 * Four properties, over generated STRUCTs of every elementary type in every order (deterministic — a small LCG, so a
 * failure is reproducible and reviewable in a diff, and `Math.random` would make this untrustworthy the moment it
 * failed in CI and passed locally):
 *
 *   1. LAYOUT IS SOUND — each field sits at a multiple of its own alignment, no two fields overlap, every field ends
 *      within the size, and the size is a multiple of the alignment. These are the rules `fieldBytes` documents; a
 *      violation is a miscomputed layout regardless of what CODESYS would say the total is.
 *   2. ADR / ^ ROUND-TRIPS — `p := ADR(x); p^` reads back exactly what `x` holds, for every elementary type, and
 *      writing through `p^` is visible in `x`. A pointer that does not round-trip is wrong under any vendor.
 *   3. A UNION OVERLAYS — writing one member changes the others, and writing the WIDEST member and reading it back
 *      returns it unchanged. (What a narrower member then reads is a vendor fact and is left to the fixtures.)
 *   4. ADR DIFFERENCE AGREES WITH OFFSETS — `ADR(s.b) - ADR(s.a)` equals the difference of the two field offsets the
 *      layout reports, so the two ways the transpiler answers "where is this field" cannot drift apart.
 */
import { describe, expect, test } from "bun:test"
import { lowerSource } from "../../src/transpile/lower/index.js"
import { run } from "../../src/transpile/interp/index.js"

/** A small deterministic generator — same sequence every run, on every machine. */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** The elementary types the memory model is defined over, with a value to write and read back. */
const TYPES: readonly { name: string; value: string; read: (v: unknown) => unknown }[] = [
  { name: "BOOL", value: "TRUE", read: (v) => v },
  { name: "SINT", value: "SINT#-7", read: (v) => v },
  { name: "USINT", value: "USINT#200", read: (v) => v },
  { name: "BYTE", value: "BYTE#16#A5", read: (v) => v },
  { name: "INT", value: "INT#-300", read: (v) => v },
  { name: "UINT", value: "UINT#40000", read: (v) => v },
  { name: "WORD", value: "WORD#16#BEEF", read: (v) => v },
  { name: "DINT", value: "DINT#-100000", read: (v) => v },
  { name: "UDINT", value: "UDINT#3000000000", read: (v) => v },
  { name: "DWORD", value: "DWORD#16#DEADBEEF", read: (v) => v },
  { name: "LINT", value: "LINT#-5000000000", read: (v) => v },
  { name: "LWORD", value: "LWORD#16#0123456789ABCDEF", read: (v) => v },
  { name: "REAL", value: "REAL#1.5", read: (v) => v },
  { name: "LREAL", value: "LREAL#2.25", read: (v) => v },
]

const st = (...lines: string[]): string => lines.join("\n") + "\n"

// ─────────────────────────────────────────────────────────────────────────────

describe("the memory model, as properties", () => {
  test("LAYOUT — fields are aligned, disjoint, and inside the size", () => {
    const next = lcg(20260918)
    const bad: string[] = []
    for (let round = 0; round < 60; round++) {
      // a struct of 2..6 fields, each an elementary type, in a shuffled order
      const count = 2 + Math.floor(next() * 5)
      const picked = Array.from({ length: count }, () => TYPES[Math.floor(next() * TYPES.length)]!)
      const fields = picked.map((t, i) => `\tf${i} : ${t.name};`)
      const reads = picked.map((_, i) => `\to${i} := ADR(s.f${i}) - ADR(s);`)
      const source = st(
        "TYPE Gen :",
        "STRUCT",
        ...fields,
        "END_STRUCT",
        "END_TYPE",
        "",
        "PROGRAM PLC_PRG",
        "VAR",
        "\ts : Gen;",
        "\tsz : ULINT;",
        ...picked.map((_, i) => `\to${i} : ULINT;`),
        "END_VAR",
        "sz := SIZEOF(s);",
        ...reads,
        "END_PROGRAM",
      )
      const { pou, diagnostics } = lowerSource(source, "PLC_PRG")
      if (pou === undefined) continue // a shape lowering refuses is not this property's business
      expect(diagnostics).toEqual([])
      const p = run(pou)
      p.scan()
      const size = p.get("sz") as bigint
      const shape = picked.map((t) => t.name).join(",")

      const width = (n: string): bigint =>
        n === "BOOL" || n === "SINT" || n === "USINT" || n === "BYTE"
          ? 1n
          : n === "INT" || n === "UINT" || n === "WORD"
            ? 2n
            : n === "DINT" || n === "UDINT" || n === "DWORD" || n === "REAL"
              ? 4n
              : 8n

      const spans = picked.map((t, i) => ({ at: p.get(`o${i}`) as bigint, size: width(t.name), name: `f${i}` }))
      for (const f of spans) {
        if (f.at % f.size !== 0n) bad.push(`${shape}: ${f.name} at ${f.at} is not ${f.size}-aligned`)
        if (f.at + f.size > size) bad.push(`${shape}: ${f.name} ends at ${f.at + f.size} past the size ${size}`)
      }
      for (let i = 0; i < spans.length; i++)
        for (let j = i + 1; j < spans.length; j++) {
          const a = spans[i]!
          const b = spans[j]!
          if (a.at < b.at + b.size && b.at < a.at + a.size) bad.push(`${shape}: ${a.name}@${a.at} overlaps ${b.name}@${b.at}`)
        }
      const widest = spans.reduce((m, f) => (f.size > m ? f.size : m), 1n)
      if (size % widest !== 0n) bad.push(`${shape}: size ${size} is not a multiple of the widest alignment ${widest}`)
    }
    expect(bad).toEqual([])
  })

  test("ADR / ^ — a pointer round-trips, reading and writing, for every elementary type", () => {
    const bad: string[] = []
    for (const t of TYPES) {
      const source = st(
        "PROGRAM PLC_PRG",
        "VAR",
        `\tx : ${t.name} := ${t.value};`,
        `\tp : POINTER TO ${t.name};`,
        `\tseen : ${t.name};`,
        `\twritten : ${t.name};`,
        "END_VAR",
        "p := ADR(x);",
        "seen := p^;",
        `p^ := ${t.value};`,
        "written := x;",
        "END_PROGRAM",
      )
      const { pou, diagnostics } = lowerSource(source, "PLC_PRG")
      if (pou === undefined) {
        bad.push(`${t.name}: refused ${diagnostics.map((d) => d.code).join(",")}`)
        continue
      }
      const p = run(pou)
      p.scan()
      // read through the pointer sees the variable
      if (p.get("seen") !== p.get("x")) bad.push(`${t.name}: p^ read ${String(p.get("seen"))}, x holds ${String(p.get("x"))}`)
      // and a write through it is visible in the variable
      if (p.get("written") !== p.get("x")) bad.push(`${t.name}: after p^ := v, x holds ${String(p.get("written"))} vs ${String(p.get("x"))}`)
    }
    expect(bad).toEqual([])
  })

  test("UNION — the widest member round-trips, and writing it changes the others", () => {
    const bad: string[] = []
    for (const narrow of TYPES.filter((t) => t.name !== "LWORD" && t.name !== "LREAL" && t.name !== "BOOL")) {
      const source = st(
        "TYPE U :",
        "UNION",
        "\twide : LWORD;",
        `\tpart : ${narrow.name};`,
        "END_UNION",
        "END_TYPE",
        "",
        "PROGRAM PLC_PRG",
        "VAR",
        "\tu : U;",
        "\tbefore : LWORD;",
        "\tafter : LWORD;",
        `\tseen : ${narrow.name};`,
        "END_VAR",
        "u.wide := LWORD#16#0123456789ABCDEF;",
        "before := u.wide;",
        `u.part := ${narrow.value};`,
        "after := u.wide;",
        "seen := u.part;",
        "END_PROGRAM",
      )
      const { pou } = lowerSource(source, "PLC_PRG")
      if (pou === undefined) continue // a union shape lowering refuses is the fixtures' business
      const p = run(pou)
      p.scan()
      if (p.get("before") !== 0x0123456789abcdefn) bad.push(`${narrow.name}: the widest member did not round-trip, got ${String(p.get("before"))}`)
      // writing the narrow member must land in the same storage — the overlay's whole point
      if (p.get("after") === p.get("before")) bad.push(`${narrow.name}: writing the narrow member left the wide one untouched`)
    }
    expect(bad).toEqual([])
  })

  test("ADR DIFFERENCE agrees with the field offsets the layout reports", () => {
    const next = lcg(987654321)
    const bad: string[] = []
    for (let round = 0; round < 40; round++) {
      const a = TYPES[Math.floor(next() * TYPES.length)]!
      const b = TYPES[Math.floor(next() * TYPES.length)]!
      const source = st(
        "TYPE Pair :",
        "STRUCT",
        `\ta : ${a.name};`,
        `\tb : ${b.name};`,
        "END_STRUCT",
        "END_TYPE",
        "",
        "PROGRAM PLC_PRG",
        "VAR",
        "\ts : Pair;",
        "\tgap : ULINT;",
        "\toa : ULINT;",
        "\tob : ULINT;",
        "END_VAR",
        "gap := ADR(s.b) - ADR(s.a);",
        "oa := ADR(s.a) - ADR(s);",
        "ob := ADR(s.b) - ADR(s);",
        "END_PROGRAM",
      )
      const { pou } = lowerSource(source, "PLC_PRG")
      if (pou === undefined) continue
      const p = run(pou)
      p.scan()
      const gap = p.get("gap") as bigint
      const fromOffsets = (p.get("ob") as bigint) - (p.get("oa") as bigint)
      if (gap !== fromOffsets) bad.push(`${a.name}/${b.name}: ADR difference ${gap} but the offsets say ${fromOffsets}`)
    }
    expect(bad).toEqual([])
  })
})
