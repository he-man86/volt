/**
 * WHICH CANDIDATE DOES THIS NAME MEAN? — one rule, for every lookup that can face more than one.
 *
 * A project can legitimately hold several top-level things with the same bare name, and they need not be the
 * same thing. Measured across the six corpus projects: 343 names have more than one candidate. `ETRIG` is
 * exported by BOTH `CAA Behaviour Model` (namespace CBM, CAA Technical Workgroup) and `CBML` (Common
 * Behaviour Model, 3S) with different declarations, and real projects reference both. CODESYS tells them
 * apart by NAMESPACE; Volt materializes each referenced library into `Library Manager/<folder>/` under its
 * elements' bare names, so an unqualified reference really does have two candidates.
 *
 * <b>Which one is right depends on who is asking.</b> `CAA Device Diagnosis`, `CAA File` and `CAA Storage`
 * each DEPEND ON `CAA Behaviour Model`, so `ETRIG` inside them means CBM's. `VisuUtils` depends on `CBML`, so
 * the same five characters in that file mean a different function block. No global choice can be right for
 * both, and picking by position — which is what every `[0]` and every last-write-wins `Map.set` did — made the
 * answer a property of the order the files happened to be bound.
 *
 * The ranks, lowest wins:
 *
 *   0. the asker's OWN library — or, for project source, another project unit
 *   1. a library the asker's library DEPENDS ON (the manifest's own `DEPENDENCIES` line)
 *   2. any library at all, but only for a PROJECT unit — project code may use anything it references
 *   3. anything else
 *
 * Ties break on the defining URI, so no rank depends on bind order. That matters beyond reproducibility: the
 * live server re-binds incrementally as files open and change, so a positional rule could hand the same
 * workspace different answers between two keystrokes.
 */
import { libraryOf, type Scope } from "./symbol.js"

/** The file a scope belongs to. Only TOP-LEVEL children carry `defUri`, so a member scope asks its parents. */
export function scopeUri(scope: Scope | undefined): string | undefined {
  for (let s = scope; s !== undefined; s = s.parent) if (s.defUri !== undefined) return s.defUri
  return undefined
}

/** The `Library Manager/<folder>` a URI sits in, lowercased — undefined for project source. */
const folderOf = (uri: string | undefined): string | undefined =>
  uri === undefined ? undefined : libraryOf({ uri })?.toLowerCase()

/**
 * How well `candidateUri` answers a reference made from `askerUri`. Lower is better; see the ranks above.
 *
 * `project._libVisible` is the folder→visible-folders map `linkExtends` builds from the manifests. When a
 * workspace has no manifests it is absent, every library candidate lands on the last rank, and the URI
 * tiebreak decides — still deterministic, just uninformed, which is the honest outcome when nothing on disk
 * says which library a bare name belongs to.
 */
export function libraryRank(
  project: Scope,
  candidateUri: string | undefined,
  askerUri: string | undefined,
): number {
  const mine = folderOf(askerUri)
  const theirs = folderOf(candidateUri)
  if (mine === undefined) return theirs === undefined ? 0 : 2
  if (theirs === undefined) return 3
  if (theirs === mine) return 0
  return project._libVisible?.get(mine)?.has(theirs) === true ? 1 : 3
}

/**
 * The candidate a reference from `askerUri` means. `undefined` asker (no file context to hand) still returns
 * a stable answer — the first by URI — rather than whichever happened to be bound first.
 */
export function pickForAsker<T>(
  project: Scope,
  candidates: readonly T[],
  uriOf: (c: T) => string | undefined,
  askerUri: string | undefined,
): T | undefined {
  if (candidates.length <= 1) return candidates[0]
  let best: T | undefined
  let bestRank = Number.POSITIVE_INFINITY
  let bestUri = ""
  for (const c of candidates) {
    const uri = uriOf(c) ?? ""
    const rank = libraryRank(project, uriOf(c), askerUri)
    if (rank < bestRank || (rank === bestRank && best !== undefined && uri < bestUri)) {
      best = c
      bestRank = rank
      bestUri = uri
    }
  }
  return best
}
