/**
 * `mainProgram` — where the recorders find the fixture's PLC_PRG/MAIN on the path-keyed wire (openspec
 * `multi-application-tree`). WHY: they looked up `refs.items["PLC_PRG.pou"]`, which the path wire answers as
 * `Device/Plc Logic/Application/PLC_PRG.pou`, so `record:language` threw "no PLC_PRG/MAIN in project" at startup and no
 * new ground truth could be recorded.
 */
import { expect, test } from "bun:test"
import { inFolder, legacyCreateFolder, mainProgram, pathIn } from "../e2e/lib/main-program"

const codesys = {
  items: { "Device/Device.device": "d", "Device/Plc Logic/Application/PLC_PRG.pou": "p", "GVL_Pool.gvl": "g" },
  applications: ["Device/Plc Logic/Application"],
}
const twincat = {
  items: { "TwinCAT Project14/PLC/Untitled2/Untitled2 Project/POUs/MAIN.pou": "m" },
  applications: ["TwinCAT Project14/PLC/Untitled2/Untitled2 Project"],
}

test("the main program is found by its file name, with its folder and application", () => {
  expect(mainProgram(codesys)).toEqual({
    path: "Device/Plc Logic/Application/PLC_PRG.pou",
    folder: "Device/Plc Logic/Application",
    application: "Device/Plc Logic/Application",
  })
  expect(mainProgram(twincat).folder).toBe("TwinCAT Project14/PLC/Untitled2/Untitled2 Project/POUs")
})

// Every CodesysTestProject fixture carries a second device whose application repeats the first one's names.
test("one main program per application: the first stated application's is the one driven", () => {
  expect(mainProgram({ items: { "A/PLC_PRG.pou": "a", "B/PLC_PRG.pou": "b" }, applications: ["A", "B"] })).toEqual({
    path: "A/PLC_PRG.pou",
    folder: "A",
    application: "A",
  })
})

test("no main program, two the applications do not tell apart, or two in one application, is refused by name", () => {
  expect(() => mainProgram({ items: { "X.pou": "x" } })).toThrow("no PLC_PRG/MAIN")
  expect(() => mainProgram({ items: { "A/PLC_PRG.pou": "a", "B/PLC_PRG.pou": "b" } })).toThrow("A/PLC_PRG.pou, B/PLC_PRG.pou")
  expect(() =>
    mainProgram({ items: { "A/PLC_PRG.pou": "a", "A/POUs/MAIN.pou": "m", "B/PLC_PRG.pou": "b" }, applications: ["A", "B"] }),
  ).toThrow("A/PLC_PRG.pou, A/POUs/MAIN.pou, B/PLC_PRG.pou")
})

test("an item beside it is spelled by path; the tree root is a bare file", () => {
  expect(inFolder("Device/Plc Logic/Application", "FB_X.pou")).toBe("Device/Plc Logic/Application/FB_X.pou")
  expect(inFolder("", "FB_X.pou")).toBe("FB_X.pou")
})

test("the old `toFolder: \"\"` lands where it did: the CODESYS project root, the TwinCAT PLC project's root", () => {
  expect(legacyCreateFolder(mainProgram(codesys), "codesys")).toBe("")
  expect(legacyCreateFolder(mainProgram(twincat), "twincat")).toBe("TwinCAT Project14/PLC/Untitled2/Untitled2 Project")
})

test("a file name resolves to the one path that holds it; two are refused by name", () => {
  expect(pathIn(codesys.items, "PLC_PRG.pou")).toBe("Device/Plc Logic/Application/PLC_PRG.pou")
  expect(pathIn(codesys.items, "GVL_Pool.gvl")).toBe("GVL_Pool.gvl")
  expect(pathIn(codesys.items, "Missing.pou")).toBeUndefined()
  expect(() => pathIn({ "A/X.pou": "a", "B/X.pou": "b" }, "X.pou")).toThrow("A/X.pou, B/X.pou")
  expect(pathIn({ "A/X.pou": "a", "B/X.pou": "b" }, "B/X.pou")).toBe("B/X.pou")
})

test("a file name every application repeats names the first application's item; outside them it is still refused", () => {
  const apps = ["A", "B"]
  expect(pathIn({ "A/X.pou": "a", "B/X.pou": "b" }, "X.pou", apps)).toBe("A/X.pou")
  expect(pathIn({ "B/X.pou": "b" }, "X.pou", apps)).toBe("B/X.pou")
  expect(pathIn({ "X.pou": "pool", "B/X.pou": "b" }, "X.pou", apps)).toBe("X.pou")
  expect(() => pathIn({ "A/X.pou": "a", "A/Sub/X.pou": "s" }, "X.pou", apps)).toThrow("A/X.pou, A/Sub/X.pou")
  expect(() => pathIn({ "B/X.pou": "b", "C/X.pou": "c" }, "X.pou", ["A", "B", "C"])).toThrow("B/X.pou, C/X.pou")
})
