/**
 * The refusal census's `--against` comparison, checked against itself (openspec bridge-refusal-review step 0).
 * Every step of that change reports the refusals it removed and added through this comparison, and 6.3 classifies
 * each new row — so a refusal change the comparison cannot see is a change nobody reviews.
 */
import { describe, expect, it } from "bun:test"
import { censusOf, compare } from "../../scripts/refusal-census"

const reader = (body: string) => ({
  path: "Volt.Engine/Format/Network/NetworkTextReader.cs",
  text: `class R {\n  void A() {\n${body}\n  }\n}\n`,
})
const diff = (before: { path: string; text: string }[], now: { path: string; text: string }[]) =>
  compare(censusOf(before), censusOf(now))

describe("refusal census --against", () => {
  it("sees a refusal replaced by a different one whose code and message are both variables", () => {
    const { gone, added } = diff(
      [reader("    if (a) throw Err(code, message);\n    if (b) throw Err(code, message);")],
      [reader("    if (a) throw Err(code, message);\n    if (b) throw Err(otherCode, detail);")],
    )
    expect(gone.length).toBe(1)
    expect(added.length).toBe(1)
    expect(added[0]).toContain("otherCode")
  })

  it("sees one of five identical-looking argument checks change its argument", () => {
    const five = (last: string) =>
      reader(
        ["a", "b", "c", "d", last]
          .map((n) => `    if (${n} is null) throw new ArgumentNullException(nameof(${n}));`)
          .join("\n"),
      )
    const { gone, added } = diff([five("e")], [five("f")])
    expect([gone.length, added.length]).toEqual([1, 1])
  })

  it("counts two identical refusals twice: deleting one is a gone row", () => {
    const line = "    throw new BridgeException(BridgeErrorCodes.UNSUPPORTED, x);"
    const { gone, added } = diff([reader(`${line}\n${line}`)], [reader(line)])
    expect([gone.length, added.length]).toEqual([1, 0])
  })

  it("lists nothing for a refusal that moved within its file or was only re-wrapped", () => {
    const { gone, added } = diff(
      [reader('    int x = 1;\n    throw new BridgeException(BridgeErrorCodes.UNSUPPORTED, "no slot " + n);')],
      [
        reader(
          '    throw new BridgeException(\n      BridgeErrorCodes.UNSUPPORTED,\n      "no slot " + n);\n    int x = 1;',
        ),
      ],
    )
    expect([gone.length, added.length]).toEqual([0, 0])
  })

  it("lists a refusal moved to another file as moved, not as gone plus new", () => {
    const site = '    throw new BridgeException(BridgeErrorCodes.INVALID_ST, "unclosed comment");'
    const st = (b: string) => ({ path: "Volt.Engine/Format/St/StReader.cs", text: `class S {\n${b}\n}\n` })
    const helper = (b: string) => ({ path: "Volt.Engine/Format/St/CodeHelper.cs", text: `class H {\n${b}\n}\n` })
    const r = compare(censusOf([st(site), helper("")]), censusOf([st(""), helper(site)]))
    expect([r.gone.length, r.added.length]).toEqual([0, 0])
    expect(r.moved.length).toBe(1)
    expect(r.moved[0].from).toContain("StReader.cs")
    expect(r.moved[0].to).toContain("CodeHelper.cs")
  })
})
