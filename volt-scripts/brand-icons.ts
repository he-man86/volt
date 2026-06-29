#!/usr/bin/env bun
/**
 * Brand the desktop icons with the Volt mark before packaging.
 *
 * `packages/desktop/resources/icons` is gitignored (opencode ships/generates those out-of-band), so a swap
 * there isn't committed. This copies the **committed** Volt assets (`packages/volt-app/assets`) into that dir,
 * making the Volt brand the persistent source of truth: electron-builder (`win.icon`) and the window/taskbar
 * icon (`main/windows.ts` → `resources/icons/icon.ico`) both pick it up. Run before `package:win`.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

const repo = resolve(import.meta.dirname, "..")
const src = resolve(repo, "packages/volt-app/assets")
const dst = resolve(repo, "packages/desktop/resources/icons")

const ico = resolve(src, "volt-icon.ico")
const png = resolve(src, "volt-icon-mark.png") // the square bolt MARK, not volt-brand.png (the full bolt+wordmark lockup)
if (!existsSync(ico) || !existsSync(png)) {
  console.error(`✗ Volt brand assets missing: ${ico} / ${png}`)
  process.exit(1)
}

mkdirSync(dst, { recursive: true })
copyFileSync(ico, resolve(dst, "icon.ico"))
copyFileSync(png, resolve(dst, "icon.png"))
console.log("✓ branded resources/icons with the Volt mark (icon.ico + icon.png)")
