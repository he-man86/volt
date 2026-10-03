/**
 * THE THREE GROUPS OF `sources.ts`, BOUND — each file in the project the LSP would analyse it in, for the dumps that
 * need a scope (0.3, 0.4, snapshot F).
 *
 *   corpus    one symbol table per project, over every file, with the project's library manifests, its device-tree
 *             instances and its vendor's dialect — what the server binds;
 *   fixtures  the fixture project's libraries bound once per vendor, and each fixture's own item, its PLC_PRG and the
 *             fixtures it depends on, parsed as that vendor, bound on top for the length of one visit — what the replay
 *             binds for that vendor (`conformance/fixtures.test.ts` `runLsp`);
 *   library   the fixture project's libraries with the repo's bodies in place of the declarations (`withImplementations`),
 *             which is where each body is lowered from.
 */
import { parseSource, type Dialect } from "../../src/frontend/syntax/index.js"
import { build, type Scope } from "../../src/frontend/symbols/index.js"
import { loadWorkspaceRefs, workspaceEnvironment } from "../../src/workspace-refs.js"
import { splitLists, withDependencies } from "../conformance/support/fixture-units.js"
import { PROJECT_LIBRARY, PROJECT_LOWERING, PROJECT_MANIFESTS, projectDevices } from "../conformance/support/project-libraries.js"
import { RECORDING_ENVIRONMENT } from "../conformance/support/recording-environment.js"
import { ALL_TESTS } from "../conformance/fixtures/index.js"
import { parse, type Bound, type Parsed } from "./dumps.js"
import { fixtureUri, libraryRepoFiles, type CorpusProject, type FixtureSources } from "./sources.js"
import type { LanguageTest } from "../conformance/types.js"

/** Every file of a corpus project, parsed and bound together — ONCE PER PROCESS: the parse census and the bound census
 *  both walk it in one `bun test test/frontend` run, and binding the six projects is ~4 s a time (2026-10-02).
 *  Read-only to every caller, like `corpusProjects`. */
export function boundCorpus(p: CorpusProject): Bound[] {
  let bound = boundCorpora.get(p)
  if (bound === undefined) {
    const parsed = p.files.map((f) => parse(f, p.vendor))
    const refs = loadWorkspaceRefs(p.dir)
    // …in the environment the server binds it in: the target its device descriptor gives, where measured
    const project = build.buildSymbolTable(parsed, refs.libraryManifests, p.vendor, workspaceEnvironment(refs), refs.devices)
    boundCorpora.set(p, (bound = parsed.map((f) => ({ parsed: f, project }))))
  }
  return bound
}
const boundCorpora = new WeakMap<CorpusProject, Bound[]>()

const libraryProjects = new Map<Dialect, Scope>()
/** The fixture project's libraries, parsed and bound as `vendor` once — what every fixture is bound on top of. */
function fixtureBase(vendor: Dialect): Scope {
  let project = libraryProjects.get(vendor)
  if (project === undefined) {
    project = build.buildSymbolTable(
      PROJECT_LIBRARY.map((l) => ({ uri: l.uri, source: l.source, parseResult: parseSource(l.source, { networkText: true }, vendor) })),
      PROJECT_MANIFESTS,
      vendor,
      RECORDING_ENVIRONMENT, // the recording projects' measured compile defines — the replay's
      projectDevices(vendor), // and their device trees
    )
    libraryProjects.set(vendor, project)
  }
  return project
}

/**
 * Visit one fixture bound as the replay binds it for `vendor`: its own item and PLC_PRG, parsed as that vendor, and
 * every fixture it depends on, on top of the libraries. The binding is undone after `visit`, whatever it throws.
 *
 * A fixture's GLOBAL LISTS are objects of their own (`fixture-units` `splitLists`), bound as the replay binds them and
 * handed to `visit` beside the dependencies, which are not counted: a list's declarations have no scope in the census
 * (`dumps.ts` `sites`), so their rows were NOSCOPE, never a measurement.
 */
export function withBoundFixture<T>(
  f: FixtureSources,
  vendor: Dialect,
  visit: (own: Bound, plc: Bound, deps: readonly Bound[]) => T,
): T {
  const project = fixtureBase(vendor)
  const { item: own, lists } = named(f.test, parse(f.own, vendor))
  const plc = parse(f.plc, vendor)
  const deps: Parsed[] = withDependencies(f.test, ALL_TESTS)
    .filter((d) => d.name !== f.test.name && d.source !== "")
    .flatMap((d) => {
      const split = named(d, parse({ id: d.name, uri: fixtureUri(d), source: d.source }, vendor))
      return [split.item, ...split.lists]
    })
  const files = [own, plc, ...lists, ...deps]
  for (const file of files) build.bindFile(project, file)
  build.relink(project, PROJECT_MANIFESTS)
  try {
    const bound = (parsed: Parsed): Bound => ({ parsed, project })
    return visit(bound(own), bound(plc), [...lists, ...deps].map(bound))
  } finally {
    for (const file of files) build.unbindFile(project, file.uri)
    build.relink(project, PROJECT_MANIFESTS)
  }
}

/**
 * Every body of the library repo, bound where it is lowered: in the fixture project's libraries, under the uri of the
 * declaration it replaces. A repo file the fixture project does not resolve to is not bound anywhere, and throws — the
 * repo holds only versions some project resolves.
 */
export function boundLibrary(): Bound[] {
  const files = PROJECT_LOWERING.filter((f) => !f.uri.toLowerCase().endsWith(".library"))
  const parsed: Parsed[] = files.map((f) => ({
    id: f.uri,
    uri: f.uri,
    source: f.source,
    dialect: "codesys",
    parseResult: f.parseResult!,
  }))
  const project = build.buildSymbolTable(parsed, PROJECT_MANIFESTS)
  const bySource = new Map(parsed.map((p) => [p.source, p]))
  return libraryRepoFiles().map((r) => {
    const at = bySource.get(r.source)
    if (at === undefined) throw new Error(`${r.id} is not among the bodies the fixture project resolves`)
    return { parsed: { ...at, id: r.id }, project }
  })
}

/** `splitLists`, each list's id its object's. */
function named(t: LanguageTest, parsed: Parsed): { item: Parsed; lists: Parsed[] } {
  const { item, lists } = splitLists(t, parsed)
  return { item, lists: lists.map((l) => ({ ...l, id: `fixture/${t.name}/${l.uri.slice(l.uri.lastIndexOf("/") + 1)}` })) }
}
