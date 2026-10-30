/**
 * ONE CONFIG PER PLC PROJECT (openspec codesys-application-defines-spelled 4.1; split from `workspace-store.ts`). A
 * TwinCAT solution holds one `.projectsettings` per PLC project, each at that project's own node; a CODESYS project has
 * one, at its root. Each file's compiler-warning states and its "Unicode identifiers" option govern the documents under
 * its folder — PROJECT LAST over the
 * editor's options: a warning's state is a fact about the project, and it beats an editor setting. A document under no
 * such folder is analysed under the editor's options alone. No file's settings replace another's.
 */
import { pathToFileURL } from "node:url"
import { resolveConfig, type AnalysisInitOptions, type ResolvedConfig } from "../analysis/index.js"
import { folderKey, normalizeKey } from "./document-key.js"
import type { ProjectSettings } from "./workspace-refs.js"

export class ProjectConfigs {
  /** Each `.projectsettings` folder, as a `folderKey`, deepest first — the first that holds a document is its project. */
  private projects: readonly { folder: string; config: ResolvedConfig }[] = []
  private gen = 0

  /** @param base the editor's config — what a document under no project's folder is analysed under. */
  constructor(private base: ResolvedConfig) {}

  /** The vendor and the dead-code switch, which no project's settings speak to. */
  get editor(): ResolvedConfig {
    return this.base
  }

  /** Bumped by every `configure` — part of the store's `generation`, what changes what analysis sees. */
  get generation(): number {
    return this.gen
  }

  /** The editor's options, and each project's settings over them for the documents under its folder. */
  configure(editor: AnalysisInitOptions, settings: readonly ProjectSettings[]): void {
    this.base = resolveConfig(editor)
    this.projects = settings
      .map((s) => ({
        folder: folderKey(pathToFileURL(s.folder).href),
        config: resolveConfig({
          ...editor,
          diagnostics: { ...editor.diagnostics, ...s.diagnostics },
          ...(s.unicodeIdentifiers === undefined ? {} : { unicodeIdentifiers: s.unicodeIdentifiers }),
        }),
      }))
      .sort((a, b) => b.folder.length - a.folder.length)
    this.gen++
  }

  /** The config the document at `uri` is analysed under: its project's, or the editor's where no project's folder
   *  holds it. A URI or a path (the scan's, as tests and the corpus seed it) — one key either way. */
  configFor(uri: string): ResolvedConfig {
    const key = normalizeKey(uri.startsWith("file:") ? uri : pathToFileURL(uri).href)
    return this.projects.find((p) => key.startsWith(p.folder))?.config ?? this.base
  }
}
