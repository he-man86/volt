/**
 * THE QUARANTINE, ONE PER LAYER (split from `workspace-store.ts`, openspec lsp-server-scheduling gate 2) — the content of
 * a document whose parse or bind threw, kept out of the merged set until it changes. An open buffer and its disk copy
 * are two layers of one key, and each holds its OWN quarantine: one map for both let a buffer's quarantine stand for
 * the disk copy (the disk entry dropped, then the buffer's quarantine cleared on close — the file gone from the project
 * with no `not-analysed` to say why), and let a clean edit of the buffer clear the disk copy's.
 */

/** The layer a quarantined content came from: the client's open buffer, or the file on disk. */
export type Layer = "open" | "disk"

/** A document whose parse or bind threw: its URI and the content that threw. */
interface Quarantined {
  uri: string
  source: string
}

export class Quarantine {
  private readonly layers: Record<Layer, Map<string, Quarantined>> = { open: new Map(), disk: new Map() }

  /** Whether `source` is the content quarantined at `key` in `layer`. */
  has(layer: Layer, key: string, source: string): boolean {
    return this.layers[layer].get(key)?.source === source
  }

  /** Whether the document at `key` is quarantined as the client sees it: its open buffer's content where it has one (the
   *  buffer the user sees), else its disk copy's. */
  shows(key: string, openText: string | undefined, diskSource: string | undefined): boolean {
    if (openText !== undefined) return this.has("open", key, openText)
    const bad = this.source("disk", key)
    return bad !== undefined && (diskSource ?? bad) === bad
  }

  /** The content quarantined at `key` in `layer`, if any. */
  source(layer: Layer, key: string): string | undefined {
    return this.layers[layer].get(key)?.source
  }

  set(layer: Layer, key: string, uri: string, source: string): void {
    this.layers[layer].set(key, { uri, source })
  }

  /** Lift the quarantine at `key` in `layer`; whether there was one. */
  delete(layer: Layer, key: string): boolean {
    return this.layers[layer].delete(key)
  }

  clear(layer: Layer): void {
    this.layers[layer].clear()
  }

  /** The keys quarantined in `layer`. */
  keys(layer: Layer): string[] {
    return [...this.layers[layer].keys()]
  }

  /** Every quarantined document, once per key: `[key, uri]`. */
  documents(): [string, string][] {
    const out = new Map<string, string>()
    for (const layer of Object.values(this.layers)) for (const [key, q] of layer) out.set(key, q.uri)
    return [...out]
  }
}
