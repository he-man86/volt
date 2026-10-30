/**
 * THE MERGED SOURCE SET (split from `workspace-store.ts`) — the disk layer's documents with each open buffer over its disk
 * copy (open wins), every quarantined content left out: what the project is built from.
 */
import type { TextDocument } from "vscode-languageserver-textdocument"
import { normalizeKey } from "./document-key.js"
import type { Quarantine } from "./quarantine.js"
import type { Document } from "../services/index.js"

/** `openParse` answers an open buffer's parse, undefined while its content is quarantined. */
export function mergedDocs(
  disk: ReadonlyMap<string, Document>,
  open: Iterable<TextDocument>,
  failed: Quarantine,
  openParse: (td: TextDocument) => Document | undefined,
): Document[] {
  const merged = new Map<string, Document>()
  for (const [key, d] of disk) if (!failed.has("disk", key, d.source)) merged.set(key, d)
  for (const td of open) {
    const key = normalizeKey(td.uri)
    const d = openParse(td)
    if (d !== undefined) merged.set(key, d)
    else merged.delete(key) // the buffer the user sees is quarantined; its disk copy is not what they see
  }
  return [...merged.values()]
}
