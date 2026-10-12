/**
 * THE STORE'S WHOLE-PROJECT BUILD (split from `workspace-store.ts`, openspec lsp-server-scheduling step 2) — the table
 * from every merged document, and, when that build throws, which documents' BIND throws: what the store quarantines
 * before it builds again. The build itself pays for no per-file guard; the search runs only after a failed build.
 */
import { build, type Scope } from "../frontend/symbols/index.js"
import type { Vendor } from "../analysis/index.js"
import { workspaceEnvironment, type WorkspaceRefs } from "./workspace-refs.js"
import type { Document } from "../services/index.js"

/** The project table of `docs` with the workspace's references. */
export function buildProject(docs: readonly Document[], refs: WorkspaceRefs, vendor: Vendor): Scope {
  // each referenced library's units under the NAMESPACE the source qualifies them with (`bindLibraryNamespaces`)
  // the VENDOR belongs here as much as it does on the parse — `project.dialect` is what decides that
  // `LDATE` does not resolve on TwinCAT, and omitting it left every such branch dead in the running server
  // …and the device-tree instances, from the `.device` descriptors (rule Y24)
  return build.buildSymbolTable(docs, refs.libraryManifests, vendor, workspaceEnvironment(refs), refs.devices)
}

/** The documents whose bind throws — each bound into one scratch project, in the build's order — with the error. Empty
 *  when none does: the build's fault is then no one file's. */
export function bindFailures(docs: readonly Document[], vendor: Vendor): { doc: Document; error: unknown }[] {
  const scratch = build.buildSymbolTable([], [], vendor)
  const failed: { doc: Document; error: unknown }[] = []
  for (const doc of docs) {
    try {
      build.bindFile(scratch, { uri: doc.uri, parseResult: doc.parseResult, source: doc.source })
    } catch (error) {
      failed.push({ doc, error })
    }
  }
  return failed
}
