/**
 * THE EVIDENCE FOR EACH UNCLASSIFIED REFUSAL CODE — openspec `transpile-refusal-classification` 1.1.
 *
 * For every code `lower/diagnostics/codes.ts` still files `unclassified`, three independent pieces of evidence and the
 * kind each one points at, mechanically — PER CALL SITE, since one code's sites can refuse different things:
 *
 *   sites     every `"code"` literal under `src/transpile/` (registry and tests excluded) and its message: the string
 *             or template literal that is the next argument (`messageLiteral` — never the code on the next line);
 *             the message points at a kind only when it SAYS one (`unmeasured`, `not modelled`, ...).
 *   fixtures  every conformance fixture lowered as `evidence.ts` lowers it, keyed by what the VENDOR did with it:
 *             ran it (its recording has values or a run fault) → the ST is valid; refused it (a compile error, a
 *             failed build, a `refused` marker) → the code may be the refusal's reason, or an unrelated gap.
 *   corpus    the POUs of the six real corpora whose lowering reports the code (`probe-lowering-refusals.ts`'s walk);
 *             every corpus project builds with zero errors (measured 2026-09-24), so a hit is valid ST.
 *
 * Each fixture/corpus diagnostic is attributed to the site whose literal produces its message (`attribute`); one no
 * literal produces is counted `(unattributed)`, one several sites produce equally `(one of a, b)` — pseudo-entries,
 * never guessed onto a site and never counted as one (`isPseudoSite`). A lowering that throws is named on stderr
 * and counted in the header — it is dropped from every count, so it must never be silent.
 *
 * A pointer is never a classification: valid ST says only "not invalid", which leaves not-modelled vs not-measured.
 *
 * Run: bun scripts/probe-refusal-evidence.ts > evidence.md   (a markdown table, one row per code)
 */
import "../test/network-text-on.js"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

export type Pointer = "invalid" | "not-modelled" | "not-measured" | "two-cases" | "none"

function statedKind(text: string): Exclude<Pointer, "two-cases"> {
  if (/\bnot measured\b|\bunmeasured\b|\bunrecorded\b|no recording|\bnot recorded\b/.test(text)) return "not-measured"
  if (/\bnot modell?ed\b|\bunmodell?ed\b|\bdoes not model\b|\bnot supported\b|\bunsupported\b/.test(text)) return "not-modelled"
  if (/codesys refuses|does not compile|vendors? refuse/.test(text)) return "invalid"
  return "none"
}

/**
 * What a refusal message SAYS of itself — only an explicit phrase counts. A message whose alternatives (joined by
 * ", or") state different kinds — one says "not modelled", the other nothing — states the kind of one refusal of two:
 * `two-cases`. A kind stated after the dash (" — ... not recorded") covers every alternative before it.
 */
export function messagePointer(message: string): Pointer {
  const m = message.toLowerCase()
  const dash = m.indexOf(" — ")
  const tail = dash < 0 ? "none" : statedKind(m.slice(dash))
  if (tail !== "none") return tail
  const alternatives = (dash < 0 ? m : m.slice(0, dash)).split(/, or\b/).map(statedKind)
  if (alternatives.length > 1 && new Set(alternatives).size > 1) return "two-cases"
  return statedKind(m)
}

/**
 * The index just past the literal opening at `s[i]` (a quote or a backtick), or -1 when it does not close on this
 * text. A template's `${...}` is scanned as code — its braces, strings and NESTED templates — so an inner backtick
 * never ends the outer template (`no-unit`'s `${name === undefined ? "" : ` named ${name}`}`).
 */
function literalEnd(s: string, i: number): number {
  const q = s[i]!
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j]!
    if (c === "\\") j++
    else if (c === q) return j + 1
    else if (q === "`" && c === "$" && s[j + 1] === "{") {
      j = placeholderEnd(s, j + 1)
      if (j < 0) return -1
      j-- // the loop's j++ steps past the closing brace
    }
  }
  return -1
}

/** The index just past the `}` that closes the `{` at `s[i]`, skipping strings and templates in between; -1 if none. */
function placeholderEnd(s: string, i: number): number {
  let depth = 0
  for (let j = i; j < s.length; j++) {
    const c = s[j]!
    if (c === '"' || c === "'" || c === "`") {
      const end = literalEnd(s, j)
      if (end < 0) return -1
      j = end - 1
    } else if (c === "{") depth++
    else if (c === "}" && --depth === 0) return j + 1
  }
  return -1
}

/** The literal's text (between its quotes) when `s`, after blanks, opens with a whole literal; else undefined. */
function leadingLiteral(s: string): string | undefined {
  const i = s.search(/\S/)
  if (i < 0 || !`"'\``.includes(s[i]!)) return undefined
  const end = literalEnd(s, i)
  return end < 0 ? undefined : s.slice(i + 1, end - 1)
}

/**
 * The message a site refuses with: the string or template literal that is the argument right after the code literal
 * (`after` = the index just past it), on this line or opening the next one when the call wraps. Anything else — the
 * code held in a variable, the next line's code — is no message: "".
 */
export function messageLiteral(line: string, next: string, after: number): string {
  const rest = line.slice(after)
  const comma = /^\s*,/.exec(rest)
  if (comma === null) return ""
  const tail = rest.slice(comma[0].length)
  if (tail.trim() !== "") return leadingLiteral(tail) ?? ""
  return leadingLiteral(next) ?? ""
}

/** A template literal's fixed text, each `${...}` cut out (scanned as code, so nested templates stay inside it). */
function fixedParts(literal: string): string[] {
  const parts: string[] = []
  let from = 0
  for (let j = 0; j < literal.length; j++) {
    if (literal[j] === "\\") j++
    else if (literal[j] === "$" && literal[j + 1] === "{") {
      const end = placeholderEnd(literal, j + 1)
      if (end < 0) throw new Error(`an unclosed \${ in the message literal ${JSON.stringify(literal)}`)
      parts.push(literal.slice(from, j))
      from = end
      j = end - 1
    }
  }
  parts.push(literal.slice(from))
  return parts.map((p) => p.replace(/\\(.)/g, "$1"))
}

/** The messages a site can produce: its literal, each `${...}` standing for any text. */
export function siteMatcher(literal: string): RegExp {
  const parts = fixedParts(literal).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  return new RegExp(`^${parts.join("[\\s\\S]*")}$`)
}

/**
 * Whether the code literal at `line[at]` (`length` long) is a refusal site — a bail argument, a `{ code: ... }`
 * refusal, a code chosen into a variable. Not one: a member of a union TYPE (`code: "graphical-body" | "parse"`) and a
 * parameter's DEFAULT (`notAMember = "place-shape")`) — neither refuses anything where it is written.
 */
export function isSiteLiteral(line: string, at: number, length: number): boolean {
  const before = line.slice(0, at)
  const after = line.slice(at + length)
  if (/\|\s*$/.test(before) || /^\s*\|/.test(after)) return false
  if (/\b\w+\s*=\s*$/.test(before) && !/\b(?:const|let|var)\s+\w+\s*=\s*$/.test(before) && /^\s*[,)]/.test(after)) return false
  return true
}

export interface SiteEvidence {
  at: string
  /** the message literal ("" when the site's message is not a literal next to the code) */
  literal: string
  pointer: Pointer
  /** fixtures the vendor RAN whose lowering refuses at this site */
  ran: number
  /** fixtures the vendor REFUSED whose lowering refuses at this site */
  vendorRefused: number
  corpus: number
}

/**
 * The sites a diagnostic can have come from: of the sites whose literal matches its message, the most specific (the
 * most fixed text). One site = attributed; none = unattributed; several TIED on the most fixed text = ambiguous —
 * the caller counts the hit on none of them, never picks one (the file walk's order would decide it).
 */
export function attribute<S extends { literal: string }>(sites: readonly S[], message: string): S[] {
  let best: S[] = []
  let bestFixed = -1
  for (const s of sites) {
    if (s.literal === "" || !siteMatcher(s.literal).test(message)) continue
    const fixed = fixedParts(s.literal).join("").length
    if (fixed > bestFixed) [best, bestFixed] = [[s], fixed]
    else if (fixed === bestFixed) best.push(s)
  }
  return best
}

/** A pseudo-entry — hits no single site holds: `(unattributed)` or `(one of a, b)` — is shown, never counted as a site. */
export const isPseudoSite = (s: { at: string }): boolean => s.at.startsWith("(")

/**
 * The kind ONE site's evidence points at. Valid-ST evidence (a vendor run or a corpus hit) rules out `invalid`; a
 * site hit ONLY by vendor-refused fixtures points at `invalid?` (the refusal may be an unrelated gap the fixture also
 * hits); a message alone is tentative (`?`); `valid` = valid ST, not-modelled vs not-measured open.
 */
export function sitePointer(s: SiteEvidence): string {
  const valid = s.ran > 0 || s.corpus > 0
  const said = s.pointer === "two-cases" ? "none" : s.pointer
  if (valid && said === "invalid") return "conflict (valid ST, message says invalid)"
  if (!valid && s.vendorRefused > 0) return said === "none" || said === "invalid" ? "invalid?" : `conflict (only vendor-refused, message says ${said})`
  if (said !== "none") return said + (valid ? "" : "?")
  return valid ? "valid" : "none"
}

/**
 * The kind a CODE's evidence points at, site by site: decided only when EVERY site points at the same kind; a site
 * that says nothing does not agree with one that does (`partly decided`); sites pointing at two kinds — invalid ST at
 * one, valid ST at another, or two stated kinds — or a message joining two refusals are a split candidate.
 * Conflicts and silence are `undecided` — the recorders decide those, never this. Pseudo-entries (`isPseudoSite`) are
 * no site: they count in no denominator and form no side of a split.
 */
export function verdict(all: readonly SiteEvidence[]): string {
  const sites = all.filter((s) => !isPseudoSite(s))
  const pointers = sites.map(sitePointer)
  const conflicts = sites.map((s, i) => [s.at, pointers[i]!] as const).filter(([, p]) => p.startsWith("conflict"))
  if (conflicts.length > 0) return `undecided (${conflicts.map(([at, p]) => `conflict at ${at}: ${p.slice("conflict (".length, -1)}`).join("; ")})`
  const base = pointers.map((p) => p.replace(/\?$/, ""))
  const kinds = new Set(base.filter((p) => p === "invalid" || p === "not-modelled" || p === "not-measured"))
  const anyValid = base.includes("valid")
  if (kinds.has("invalid") && (anyValid || kinds.size > 1)) return "undecided (split? invalid ST at one site, valid ST at another)"
  if (sites.some((s) => s.pointer === "two-cases")) return "undecided (split? a site's message joins two refusals)"
  if (kinds.size > 1) return `undecided (split? sites say ${[...kinds].sort().join(" + ")})`
  if (kinds.size === 1) {
    const k = [...kinds][0]!
    const at = base.filter((p) => p === k).length
    if (at < sites.length) return `partly decided (${k} at ${at} of ${sites.length} sites)`
    return k + (pointers.every((p) => p.endsWith("?")) ? "?" : "")
  }
  return anyValid ? "undecided (valid ST: not-modelled or not-measured)" : "undecided (no evidence)"
}

async function main(): Promise<void> {
  const ROOT = join(import.meta.dir, "..")
  const { LOWER_CODES } = await import("../src/transpile/lower/diagnostics/codes.js")
  const codes = Object.entries(LOWER_CODES).filter(([, k]) => k === "unclassified").map(([c]) => c).sort()

  // ── sites ──────────────────────────────────────────────────────────────────────────────────────────────────
  const UNATTRIBUTED = "(unattributed)"
  const sites = new Map<string, SiteEvidence[]>(codes.map((c) => [c, []]))
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n)
      return statSync(p).isDirectory() ? walk(p) : n.endsWith(".ts") && !n.endsWith(".test.ts") ? [p] : []
    })
  for (const file of walk(join(ROOT, "src", "transpile"))) {
    if (file.endsWith(join("diagnostics", "codes.ts"))) continue
    const lines = readFileSync(file, "utf8").split("\n")
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/"([a-z0-9_-]+)"/g)) {
        const list = sites.get(m[1]!)
        if (list === undefined || !isSiteLiteral(line, m.index, m[0].length)) continue
        const literal = messageLiteral(line, lines[i + 1] ?? "", m.index + m[0].length)
        const at = `${relative(join(ROOT, "src", "transpile"), file).replaceAll("\\", "/")}:${i + 1}`
        list.push({ at, literal, pointer: messagePointer(literal), ran: 0, vendorRefused: 0, corpus: 0 })
      }
    })
  }
  // a diagnostic no site's literal produces (its code or message held in a variable) is counted `(unattributed)`, one
  // two or more sites produce equally is counted `(one of a, b)` — a pseudo-entry each, never guessed onto a site
  const siteOf = (d: { code: string; message: string }): SiteEvidence | undefined => {
    const list = sites.get(d.code)
    if (list === undefined) return undefined
    const found = attribute(list.filter((s) => !isPseudoSite(s)), d.message)
    if (found.length === 1) return found[0]
    const at = found.length === 0 ? UNATTRIBUTED : `(one of ${found.map((s) => s.at.replace(/^.*\//, "")).join(", ")})`
    let rest = list.find((s) => s.at === at)
    if (rest === undefined) list.push((rest = { at, literal: "", pointer: "none", ran: 0, vendorRefused: 0, corpus: 0 }))
    return rest
  }
  /** each site one lowering refused at, once */
  const hitSites = (diagnostics: readonly { code: string; message: string }[]): Set<SiteEvidence> =>
    new Set(diagnostics.map(siteOf).filter((s): s is SiteEvidence => s !== undefined))
  // a lowering that throws is dropped from every count — so it is named, and counted in the output's header
  let threw = 0

  // ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────
  const { ALL_TESTS } = await import("../test/conformance/fixtures/index.js")
  const { assembleFixture } = await import("../test/conformance/support/fixture-units.js")
  const { PROJECT_BASE } = await import("../test/conformance/support/project-libraries.js")
  const { RUNS } = await import("../test/conformance/support/recordings.js")
  const { lowerSource } = await import("../src/transpile/lower/index.js")
  const buildRec = JSON.parse(readFileSync(join(ROOT, "test", "conformance", "recordings", "codesys.build.json"), "utf8")).tests as Record<string, { buildSuccess?: boolean }>
  const ranBy = new Map<string, string[]>(codes.map((c) => [c, []]))
  const refusedBy = new Map<string, string[]>(codes.map((c) => [c, []]))
  for (const t of ALL_TESTS) {
    if (t.execSkip !== undefined || t.recorderSkip === true) continue
    const rec = RUNS[t.name]
    const vendorRefused = rec?.error?.startsWith("does not compile") === true || buildRec[t.name]?.buildSuccess === false || t.refused !== undefined
    const vendorRan = !vendorRefused && (rec?.values !== undefined || rec?.error !== undefined)
    if (!vendorRefused && !vendorRan) continue
    let diagnostics: readonly { code: string; message: string }[]
    try {
      const { source, gvls } = assembleFixture(t, ALL_TESTS)
      diagnostics = lowerSource(source, "PLC_PRG", gvls, undefined, PROJECT_BASE).diagnostics ?? []
    } catch (e) {
      threw++
      console.error(`THREW  \tfixture ${t.name}\t${String(e)}`)
      continue
    }
    for (const code of new Set(diagnostics.map((d) => d.code))) (vendorRefused ? refusedBy : ranBy).get(code)?.push(t.name)
    for (const s of hitSites(diagnostics)) {
      if (vendorRefused) s.vendorRefused++
      else s.ran++
    }
  }

  // ── corpus ─────────────────────────────────────────────────────────────────────────────────────────────────
  const { isStBody, bodyStatements } = await import("../src/frontend/syntax/index.js")
  const { isLibrarySymbol, scopeForUnit } = await import("../src/frontend/symbols/index.js")
  const { lowerUnit } = await import("../src/transpile/index.js")
  const { loweringProject } = await import("../test/corpus/support/project.js")
  const CORPUS = join(ROOT, "test-corpus")
  if (!existsSync(CORPUS)) throw new Error(`no corpus at ${CORPUS}`)
  const corpus = new Map<string, Map<string, number>>(codes.map((c) => [c, new Map()]))
  for (const projectName of readdirSync(CORPUS).filter((p) => statSync(join(CORPUS, p)).isDirectory()).sort()) {
    const lowering = loweringProject(join(CORPUS, projectName))
    for (const { parseResult } of lowering.files.filter((f) => !isLibrarySymbol(f)))
      for (const unit of parseResult.units) {
        if (unit.kind !== "program" && unit.kind !== "function_block") continue
        const scope = scopeForUnit(lowering.project, unit)
        if (scope === undefined || !isStBody(unit.body) || bodyStatements(unit.body).statements.length === 0) continue
        let diagnostics: readonly { code: string; message: string }[]
        try {
          diagnostics = lowerUnit(unit, scope, lowering).diagnostics ?? []
        } catch (e) {
          threw++
          console.error(`THREW  \t${projectName} ${unit.name.text}\t${String(e)}`)
          continue
        }
        for (const code of new Set(diagnostics.map((d) => d.code))) {
          const per = corpus.get(code)
          if (per !== undefined) per.set(projectName, (per.get(projectName) ?? 0) + 1)
        }
        for (const s of hitSites(diagnostics)) s.corpus++
      }
  }

  // ── table ──────────────────────────────────────────────────────────────────────────────────────────────────
  const sample = (names: string[]): string => (names.length === 0 ? "0" : `${names.length} (${names.slice(0, 2).join(", ")}${names.length > 2 ? ", …" : ""})`)
  console.log(`unclassified codes: ${codes.length}; lowerings that THREW (dropped from every count, named on stderr): ${threw}\n`)
  console.log("| code | sites | message says | vendor ran | vendor refused | corpus POUs | per site: pointer ran/refused/corpus | points at |")
  console.log("|---|---|---|---|---|---|---|---|")
  for (const c of codes) {
    const s = sites.get(c)!
    const declared = s.filter((x) => !isPseudoSite(x))
    const pseudo = s.filter(isPseudoSite)
    const said = [...new Set(declared.map((x) => x.pointer).filter((p) => p !== "none"))].join("/") || "—"
    const per = corpus.get(c)!
    const corpusN = [...per.values()].reduce((a, b) => a + b, 0)
    const corpusText = corpusN === 0 ? "0" : `${corpusN} (${[...per].map(([p, n]) => `${p} ${n}`).join(", ")})`
    const where = declared.length === 0 ? "0" : `${declared.length}: ${[...new Set(declared.map((x) => x.at.replace(/:\d+$/, "")))].join(", ")}`
    const cell = (x: SiteEvidence): string => `${x.at.replace(/^.*\//, "")} ${sitePointer(x)} ${x.ran}/${x.vendorRefused}/${x.corpus}`
    // pseudo-entries are listed after the sites, apart — they are evidence no single site holds, read by hand
    const perSite = declared.map(cell).join("; ") + (pseudo.length === 0 ? "" : ` ‖ ${pseudo.map(cell).join("; ")}`)
    const note = pseudo.length === 0 ? "" : " + hits on no single site (read by hand)"
    console.log(`| \`${c}\` | ${where} | ${said} | ${sample(ranBy.get(c)!)} | ${sample(refusedBy.get(c)!)} | ${corpusText} | ${perSite} | ${verdict(s)}${note} |`)
  }
}

if (import.meta.main) await main()
