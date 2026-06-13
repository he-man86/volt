import { describe, test, expect } from "bun:test"
import {
  pickExtension,
  getByKind,
  sourceExtensions,
  FOLDER_MARKER,
  EXTENSIONS,
} from "../../registry/extensions.js"

describe("extensions", () => {
  test("pickExtension returns the registry ext for every known kind", () => {
    // Derive from EXTENSIONS rather than a hardcoded copy — the vocabulary contract
    // (vocabulary.test.ts) is what keeps the registry honest against the bridge.
    for (const def of EXTENSIONS) {
      expect(pickExtension(def.kind)).toBe(def.ext)
    }
  })

  test("config kinds use ext == kind (read-only marker files; no ad-hoc abbreviations)", () => {
    for (const def of EXTENSIONS) {
      if (def.family !== "config") continue
      // The one exception: a kind whose file IS a real on-disk artifact keeps its
      // real extension (e.g. tmc_file -> .tmc), flagged by nameIsVerbatim.
      if (def.nameIsVerbatim === true) continue
      expect(def.ext).toBe(def.kind)
    }
  })

  test("getByKind returns definition for every known kind", () => {
    for (const def of EXTENSIONS) {
      const found = getByKind(def.kind)
      expect(found).toBeDefined()
      expect(found!.ext).toBe(def.ext)
      expect(found!.family).toBe(def.family)
    }
  })

  test("sourceExtensions returns all source extensions", () => {
    const exts = sourceExtensions()
    expect(exts).toContain(".st")
    expect(exts).toContain(".itf")
    expect(exts).toContain(".gvl")
    expect(exts).toContain(".struct")
    expect(exts).toContain(".union")
    expect(exts).toContain(".enum")
    expect(exts).toContain(".alias")

    // Source extensions should NOT include config types
    for (const ext of exts) {
      const def = getByKind(
        EXTENSIONS.find((e) => `.${e.ext}` === ext)?.kind ?? "",
      )
      if (def) {
        expect(def.family).toBe("source")
      }
    }
  })

  test("FOLDER_MARKER is .gitkeep", () => {
    expect(FOLDER_MARKER).toBe(".gitkeep")
  })
})
