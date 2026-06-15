import { describe, test, expect } from "bun:test"
import {
  pickExtension,
  getByKind,
  getByExt,
  getByPath,
  isSourcePou,
  isTrackedPath,
  knownKinds,
  POU_KINDS,
  sourceExtensions,
  FOLDER_MARKER,
} from "../../registry/extensions.js"

describe("extensions", () => {
  test("pickExtension resolves every known kind to an extension", () => {
    // Derive from knownKinds() rather than a hardcoded copy — the vocabulary contract
    // (vocabulary.test.ts) is what keeps the registry honest against the bridge.
    for (const kind of knownKinds()) {
      if (POU_KINDS.has(kind)) {
        expect(pickExtension(kind)).toBe("st") // ST / no language default
        continue
      }
      expect(pickExtension(kind)).toBe(getByKind(kind)!.ext)
    }
  })

  test("reference kinds use kind == ext (no ad-hoc abbreviations)", () => {
    // The extension IS the identity. A read-only reference kind must NOT abbreviate: its kind
    // resolves straight back to the same extension. (interface/structure/enumeration and the tmc
    // artifact are the only sanctioned abbreviations — none of them read-only marker files.)
    for (const kind of knownKinds()) {
      if (POU_KINDS.has(kind)) continue // POU bodies resolve by language, not as a kind
      const def = getByKind(kind)!
      if (isSourcePou(def) || def.ext.length === 0) continue // not a reference kind / folder
      if (def.nameIsVerbatim === true) continue // tmc keeps its real artifact extension
      expect(pickExtension(kind)).toBe(kind) // kind resolves straight back to itself (== ext)
    }
  })

  test("getByKind returns a definition for every non-POU kind", () => {
    for (const kind of knownKinds()) {
      if (POU_KINDS.has(kind)) continue // POU kinds resolve by language, not via getByKind
      const found = getByKind(kind)
      expect(found).toBeDefined()
      expect(pickExtension(kind)).toBe(found!.ext)
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

    // Every source extension must resolve to a writable (rw) row; no read-only refs leak in.
    for (const ext of exts) {
      const def = getByExt(ext)
      expect(def).toBeDefined()
      expect(isSourcePou(def!)).toBe(true)
    }
  })

  test("FOLDER_MARKER is .gitkeep", () => {
    expect(FOLDER_MARKER).toBe(".gitkeep")
  })

  describe("body-language extensions", () => {
    test("a POU's extension follows its body language", () => {
      for (const kind of ["program", "function", "function_block"]) {
        expect(pickExtension(kind)).toBe("st")            // ST / no language → .st
        expect(pickExtension(kind, "ST")).toBe("st")
        expect(pickExtension(kind, "FBD")).toBe("fbd")
        expect(pickExtension(kind, "LD")).toBe("ld")
        expect(pickExtension(kind, "CFC")).toBe("cfc")
        expect(pickExtension(kind, "SFC")).toBe("sfc")
      }
    })

    test("language only affects POU kinds, not DUTs/gvl/interface", () => {
      expect(pickExtension("gvl", "FBD")).toBe("gvl")
      expect(pickExtension("structure", "FBD")).toBe("struct")
      expect(pickExtension("interface", "FBD")).toBe("itf")
    })

    test(".fbd/.ld are editable source; .cfc/.sfc are read-only", () => {
      expect(isSourcePou(getByPath("POUs/X.fbd")!)).toBe(true)
      expect(isSourcePou(getByPath("POUs/X.ld")!)).toBe(true)
      expect(isSourcePou(getByPath("POUs/X.cfc")!)).toBe(false)
      expect(isSourcePou(getByPath("POUs/X.sfc")!)).toBe(false)
    })

    test("graphical extensions are tracked; editable ones are source extensions", () => {
      for (const p of ["a.fbd", "a.ld", "a.cfc", "a.sfc"]) expect(isTrackedPath(p)).toBe(true)
      const src = sourceExtensions()
      expect(src).toContain(".fbd")
      expect(src).toContain(".ld")
      expect(src).not.toContain(".cfc")   // read-only, never pushed
      expect(src).not.toContain(".sfc")
    })
  })
})
