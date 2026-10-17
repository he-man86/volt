/**
 * WHERE THE RECORDERS PUSH (openspec `multi-application-tree`): the wire keys an item by its PATH in the IDE's tree
 * (`Device/Plc Logic/Application/PLC_PRG.pou`, `TwinCAT Project14/PLC/Untitled2/Untitled2 Project/POUs/MAIN.pou`), and a push op names
 * the path it writes — there is no `toFolder` any more, and a bare `X.pou` is an item at the TREE ROOT (the CODESYS POU
 * pool; nothing on TwinCAT, whose root holds system projects). So every script finds the fixture's main program by its
 * file name, and pushes beside it by path.
 */

/** The fixture project's main program — `PLC_PRG` (CODESYS) or `MAIN` (TwinCAT) — and where it sits. */
export interface MainProgram {
  /** Its wire path, e.g. `Device/Plc Logic/Application/PLC_PRG.pou`. */
  path: string
  /** Its folder (`""` at the tree root). */
  folder: string
  /** The root of the application it belongs to, as the walk states it (`applications`), or null for the pool. */
  application: string | null
}

const MAIN_FILES = ["PLC_PRG.pou", "MAIN.pou"]

export const fileOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1)
export const folderOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "")
/** The path of `file` in `folder` — spelled as the walk spells it (`""` is the tree root). */
export const inFolder = (folder: string, file: string): string => (folder === "" ? file : `${folder}/${file}`)

/**
 * The one main program of the project `refs` answered. None, or more than one (a fixture of two applications), is
 * refused by name: a recorder that picked one would push and build a project the fixture does not describe.
 */
export function mainProgram(refs: { items: Record<string, unknown>; applications?: readonly string[] }): MainProgram {
  const found = Object.keys(refs.items).filter((p) => MAIN_FILES.includes(fileOf(p)))
  if (found.length === 0) throw new Error(`no PLC_PRG/MAIN in project (looked for ${MAIN_FILES.join(", ")} by file name)`)
  if (found.length > 1)
    throw new Error(`the project holds ${found.length} main programs (${found.join(", ")}) — the recorders serve one application`)
  const path = found[0]!
  const lower = path.toLowerCase()
  const application =
    (refs.applications ?? [])
      .filter((root) => lower === root.toLowerCase() || lower.startsWith(root.toLowerCase() + "/"))
      .sort((a, b) => b.length - a.length)[0] ?? null
  return { path, folder: folderOf(path), application }
}

/**
 * Where a script that pushed `toFolder: ""` before the path wire created its items: the root of the tree it was served,
 * which was the project root on CODESYS (the POU pool) and the PLC project's root on TwinCAT (the walk read ONE PLC
 * project). Kept so a recording made through it describes the same project it did.
 */
export function legacyCreateFolder(main: MainProgram, vendor: "codesys" | "twincat"): string {
  if (vendor === "codesys") return ""
  if (main.application === null)
    throw new Error(`the TwinCAT main program ${main.path} lies in no application the walk states — no PLC project to create in`)
  return main.application
}

/**
 * The path of `name` in a version map: `name` itself when it is a key, else the ONE key whose file name it is
 * (`VltE2E_x.pou` → `Device/Plc Logic/Application/POUs/VltE2E_x.pou`). Undefined when no key has it; two or more are
 * refused by name — a file name two folders hold names no one item, and a caller that picked one would act on the wrong.
 */
export function pathIn(items: Record<string, unknown>, name: string): string | undefined {
  if (name in items) return name
  const found = Object.keys(items).filter((p) => fileOf(p) === name)
  if (found.length > 1) throw new Error(`'${name}' names ${found.length} items (${found.join(", ")}) — name one by its path`)
  return found[0]
}
