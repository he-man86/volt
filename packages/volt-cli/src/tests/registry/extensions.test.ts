import { describe, test, expect } from "bun:test"
import {
  pickExtension,
  getByKind,
  sourceExtensions,
  FOLDER_MARKER,
  EXTENSIONS,
} from "../../registry/extensions.js"

describe("extensions", () => {
  test("pickExtension returns correct ext for every known kind", () => {
    const expected: Record<string, string> = {
      function_block: "st",
      function: "st",
      program: "st",
      interface: "itf",
      gvl: "gvl",
      structure: "struct",
      union: "union",
      enumeration: "enum",
      alias: "alias",
      library: "library",
      task: "task",
      device: "device",
      trace: "trace",
      image_pool: "imagepool",
      text_list: "textlist",
      recipe_manager: "recipes",
      visualization_manager: "visu",
      visualization: "visualization",
      symbol_config: "symbols",
      project_info: "projectinfo",
      library_manager: "libraries",
      class_diagram: "uml",
      external_types: "exttypes",
      tmc_file: "tmc",
      folder: "",
    }

    for (const [kind, expectedExt] of Object.entries(expected)) {
      expect(pickExtension(kind)).toBe(expectedExt)
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
