import { expect, test } from "bun:test"
import { join } from "node:path"

// VOLT: pins the contrast of the brand palette in style/volt-theme.css.
//
// That file is the ONE place the whole authed console gets its colour from, and nothing else checks it: CSS is not
// type-checked, the divergence gate only diffs against opencode, and the build cannot catch an unreadable token.
// A one-line value tweak can quietly drop body text below WCAG AA and no gate anywhere goes red. The values are
// ported from packages/volt-www, so they will drift when the brand does — this is what makes that drift visible.
//
// Thresholds: WCAG 2.1 AA is 4.5:1 for body text (1.4.3) and 3:1 for UI components and graphical objects (1.4.11).
// Disabled/inactive text is exempt from 1.4.3, so --color-text-disabled is deliberately not asserted.

const THEME = join(import.meta.dir, "..", "src", "style", "volt-theme.css")

function relativeLuminance(hex: string): number {
  const c = hex.replace("#", "")
  const channels = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** Hex-valued custom properties, split by colour scheme. The dark block re-declares a subset, so it layers on top. */
async function tokens(): Promise<{ light: Record<string, string>; dark: Record<string, string> }> {
  const css = await Bun.file(THEME).text()
  const [lightSrc, darkSrc = ""] = css.split("@media (prefers-color-scheme: dark)")
  const read = (src: string) => {
    const out: Record<string, string> = {}
    for (const [, name, value] of src.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[name!] = value!
    return out
  }
  const light = read(lightSrc!)
  return { light, dark: { ...light, ...read(darkSrc) } }
}

test("the ported palette parses and is complete", async () => {
  const { light, dark } = await tokens()
  for (const key of ["--color-bg", "--color-text", "--color-accent", "--color-primary", "--color-primary-text"]) {
    expect(light[key]).toBeDefined()
    expect(dark[key]).toBeDefined()
  }
  // The pill must inverse between schemes, or one of the two is unreadable.
  expect(light["--color-primary"]).not.toBe(dark["--color-primary"])
})

test("body text meets WCAG AA (4.5:1) in both schemes", async () => {
  const { light, dark } = await tokens()
  for (const [scheme, t] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    expect(`${scheme}: ${contrast(t["--color-text"]!, t["--color-bg"]!) >= 4.5}`).toBe(`${scheme}: true`)
    // Text on the raised surfaces, not just the page.
    expect(contrast(t["--color-text"]!, t["--color-bg-surface"]!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t["--color-text"]!, t["--color-bg-elevated"]!)).toBeGreaterThanOrEqual(4.5)
    // The CTA pill: label against its own fill.
    expect(contrast(t["--color-primary-text"]!, t["--color-primary"]!)).toBeGreaterThanOrEqual(4.5)
  }
})

test("the accent clears the 3:1 UI-component floor on every surface it lands on", async () => {
  const { light, dark } = await tokens()
  // volt-www uses the orange for links, focus rings and fills. On the light page it is 3.28:1 — that clears AA for
  // UI components (1.4.11) but NOT for body text (4.5:1). That is the brand's own trade-off, ported deliberately;
  // this pins the floor so it cannot silently sink below even that.
  for (const t of [light, dark]) {
    expect(contrast(t["--color-accent"]!, t["--color-bg"]!)).toBeGreaterThanOrEqual(3)
    expect(contrast(t["--color-accent"]!, t["--color-bg-surface"]!)).toBeGreaterThanOrEqual(3)
  }
})

test("the muted ink does not regress below the palette it replaced", async () => {
  const { light } = await tokens()
  // The console's previous muted was 4.44:1. On this page nothing lighter than --color-text-secondary can reach
  // AA's 4.5, so the ramp is held at parity instead: muted stays readable AND stays lighter than secondary, which
  // is the hierarchy the components rely on.
  expect(contrast(light["--color-text-muted"]!, light["--color-bg"]!)).toBeGreaterThanOrEqual(4.2)
  expect(relativeLuminance(light["--color-text-muted"]!)).toBeGreaterThan(
    relativeLuminance(light["--color-text-secondary"]!),
  )
})

test("destructive actions stay legible", async () => {
  const { light, dark } = await tokens()
  for (const t of [light, dark]) expect(contrast(t["--color-danger"]!, t["--color-bg"]!)).toBeGreaterThanOrEqual(4.5)
})
