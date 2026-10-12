/**
 * The EXTENDS walks of `core/chain.ts` (task 1.7.3): each mechanism's order, where it ends, and the cycle guard every walk
 * now has.
 */
import { expect, test } from "bun:test"
import { parseSource, type TopLevel } from "../../../frontend/syntax/index.js"
import { lookup } from "../../../frontend/symbols/index.js"
import { prepareProject, TRANSPILE_PARSE } from "../project/prepare.js"
import { Lowering } from "./lowering.js"
import { chainNames, declaredChain, implementsOf, interfaceChainOf, pouChain, scopeChain } from "./chain.js"

const SOURCE = `
INTERFACE I_A
END_INTERFACE
INTERFACE I_B EXTENDS I_A
END_INTERFACE
INTERFACE I_C EXTENDS I_B, I_A
END_INTERFACE
FUNCTION_BLOCK FB_Base
END_FUNCTION_BLOCK
FUNCTION_BLOCK FB_Mid EXTENDS FB_Base IMPLEMENTS I_C, I_A
END_FUNCTION_BLOCK
FUNCTION_BLOCK FB_Top EXTENDS FB_Mid
END_FUNCTION_BLOCK
FUNCTION_BLOCK FB_Loop1 EXTENDS FB_Loop2
END_FUNCTION_BLOCK
FUNCTION_BLOCK FB_Loop2 EXTENDS FB_Loop1
END_FUNCTION_BLOCK
FUNCTION_BLOCK FB_Lost EXTENDS FB_Nowhere
END_FUNCTION_BLOCK
`

const parseResult = parseSource(SOURCE, TRANSPILE_PARSE, "codesys")
const { project } = prepareProject([{ uri: "transpile://chain", parseResult, source: SOURCE }], [])
const lw = new Lowering(project, project)
const unit = (name: string) => lookup(project, name)?.symbol.ast as TopLevel
const names = (units: readonly { name: { text: string } }[]) => units.map((u) => u.name.text)

test("by name lookup: nearest first, ending where a base does not resolve or at a unit reached again", () => {
  expect(names(declaredChain(lw, unit("FB_Top")) as never)).toEqual(["FB_Top", "FB_Mid", "FB_Base"])
  expect(names(declaredChain(lw, unit("FB_Lost")) as never)).toEqual(["FB_Lost"])
  expect(names(declaredChain(lw, unit("FB_Loop1")) as never)).toEqual(["FB_Loop1", "FB_Loop2"])
  expect(declaredChain(lw, undefined)).toEqual([])
  expect(names(pouChain(lw, "FB_Top"))).toEqual(["FB_Top", "FB_Mid", "FB_Base"])
  expect([...chainNames(lw, "fb_mid")]).toEqual(["FB_MID", "FB_BASE"])
  expect([...chainNames(lw, "FB_Loop2")]).toEqual(["FB_LOOP2", "FB_LOOP1"])
})

test("an interface's chain: itself first, depth first through each EXTENDS list, each once", () => {
  expect(interfaceChainOf(lw, "I_C").map((i) => i.name.text)).toEqual(["I_C", "I_B", "I_A"])
  expect(interfaceChainOf(lw, "FB_Top")).toEqual([])
})

test("by the binder's link: nearest first", () => {
  expect(scopeChain(project.children.find((s) => s.name === "FB_Top")).map((s) => s.name)).toEqual(["FB_Top", "FB_Mid", "FB_Base"])
  expect(scopeChain(undefined)).toEqual([])
})

test("a unit's own IMPLEMENTS list, in source order — none for an FB without one, none inherited from its base", () => {
  expect(implementsOf(unit("FB_Mid")).map((i) => i.text)).toEqual(["I_C", "I_A"])
  expect(implementsOf(unit("FB_Base"))).toEqual([])
  expect(implementsOf(unit("FB_Top"))).toEqual([])
})
