import { expect, test } from "bun:test"
import { readdir } from "node:fs/promises"
import { join } from "node:path"

// VOLT: pins that every token volt-theme.css overrides is declared at a selector that can actually WIN.
//
// The whole brand layer rests on one assumption: re-declare opencode's custom properties later in the cascade and
// ours win. That assumption is silently false if the SELECTOR differs. opencode splits its tokens across two:
// style/token/color.css declares on `:root`, style/token/{font,space}.css declare on `body`. A `:root` override
// loses to a `body` declaration for every element inside body — the nearer ancestor supplies the value, and
// specificity never comes into it.
//
// That is not hypothetical: the volt-www port shipped the colours on :root (matching color.css, so they applied)
// and the fonts on :root too (against font.css's `body`, so they did NOT). The console kept rendering in IBM Plex
// Mono with Inter sitting unused one level up. Nothing caught it — it typechecks, builds, passes the divergence
// gate and the contrast test, and only a human looking at the running page can see it. Hence this.

const STYLE = join(import.meta.dir, "..", "src", "style")

/**
 * Map custom-property name -> the selector it is declared under. Tokenizes on braces rather than lines, so a token
 * is attributed correctly whether its rule spans lines OR is written on one (`:root { --x: #fff; }`). A selector
 * stack handles nesting, so a declaration inside `@media (…) { :root { … } }` is attributed to `:root`, not @media.
 *
 * Scanning line-by-line (the first version) silently DROPPED single-line rules — the very silent-loss failure this
 * test guards against, in the guard itself. It survived only because the vendored token files happen to be
 * multi-line; a one-line override would have escaped the check entirely.
 */
function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>()
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "") // strip comments (may span lines)
  const stack: string[] = []
  let pending = "" // text since the last brace — a selector prelude or a declaration body

  for (const ch of clean) {
    if (ch === "{") {
      stack.push(pending.trim())
      pending = ""
    } else if (ch === "}") {
      stack.pop()
      pending = ""
    } else if (ch === ";") {
      const decl = pending.match(/(--[a-z0-9-]+)\s*:/)
      if (decl) {
        const selector = [...stack].reverse().find((s) => s && !s.startsWith("@"))
        if (selector) out.set(decl[1]!, selector)
      }
      pending = ""
    } else {
      pending += ch
    }
  }
  return out
}

async function opencodeTokens(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const dir = join(STYLE, "token")
  for (const file of await readdir(dir)) {
    if (!file.endsWith(".css")) continue
    for (const [name, selector] of declarations(await Bun.file(join(dir, file)).text())) out.set(name, selector)
  }
  return out
}

test("the token files still split across two selectors (the reason this test exists)", async () => {
  const oc = await opencodeTokens()
  // If upstream ever unifies these, this test's premise changes — better to be told than to keep guarding a ghost.
  expect(oc.get("--color-bg")).toBe(":root")
  expect(oc.get("--font-sans")).toBe("body")
})

test("every token volt-theme.css overrides is declared where it can win", async () => {
  const oc = await opencodeTokens()
  const volt = declarations(await Bun.file(join(STYLE, "volt-theme.css")).text())

  expect(volt.size).toBeGreaterThan(10) // guard the guard: a broken parse must not pass vacuously

  const losing: string[] = []
  for (const [name, voltSelector] of volt) {
    const ocSelector = oc.get(name)
    if (!ocSelector) continue // a Volt-only token: nothing upstream to lose to
    if (ocSelector !== voltSelector) {
      losing.push(`${name}: opencode declares it on \`${ocSelector}\`, volt-theme.css on \`${voltSelector}\``)
    }
  }

  expect(losing).toEqual([])
})
