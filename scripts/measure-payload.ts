// Measure the installer payload per component: `dist/stage` (what Inno packs, uncompressed) and the installer size.
// Read-only. Used by openspec installer-rebuild 0.1 (the baseline) and 2.1 (the after) — same script, same buckets.
//   bun scripts/measure-payload.ts [stageDir] [installerExe]
//
// Buckets are defined by ROLE, not by today's file names, so the before (app-era layout: connector at the stage root,
// `codesys-scriptcommands\`, `desktop\Volt.exe`) and the after (`connector\`, `codesys\`, `desktop\VoltDesktop.exe`)
// land in the same rows. A file no component claims, or a required lever that matches nothing, is REFUSED by name —
// a bucket that silently reads 0 would make the before/after comparison lie.
import { readdirSync, statSync, existsSync } from "node:fs"
import { join, relative, extname } from "node:path"

const root = join(import.meta.dir, "..")
const stage = process.argv[2] ?? join(root, "dist", "stage")
const installer = process.argv[3] ?? join(root, "dist", "release", "Volt-win-Setup.exe")
if (!existsSync(stage)) throw new Error(`no stage dir at ${stage} — run bun run build:installer first`)

type F = { rel: string; size: number }
const files: F[] = []
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else files.push({ rel: relative(stage, p).replaceAll("\\", "/"), size: statSync(p).size })
  }
}
walk(stage)

// MiB (2^20): Explorer's unit, and the one design.md quotes.
const MB = (n: number) => (n / 2 ** 20).toFixed(1).padStart(7) + " MiB"
const sum = (fs: F[]) => fs.reduce((a, f) => a + f.size, 0)
const row = (label: string, fs: F[]) => console.log(`${label.padEnd(70)} ${MB(sum(fs))}  ${String(fs.length).padStart(5)} files`)
const errors: string[] = []

// A .NET satellite assembly: `<culture>/<name>.resources.dll`, any culture but English (en, en-US, …).
const SATELLITE = /(?:^|\/)([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\/[^/]+\.resources\.dll$/
const isSatellite = (f: F) => {
  const m = SATELLITE.exec(f.rel)
  return m !== null && !/^en(?:-|$)/.test(m[1])
}
const topDir = (f: F) => (f.rel.includes("/") ? f.rel.split("/")[0] : "")

// Components by role. Each file belongs to exactly one; an unclaimed file is refused.
const components: [string, (f: F) => boolean][] = [
  ["desktop (Electron)", f => topDir(f) === "desktop"],
  ["bin (on PATH: CLI + LSP)", f => topDir(f) === "bin"],
  // the connector + TwinCAT worker runtime: today bare files at the stage root plus their root-level satellite
  // folders; after the rebuild `connector\`
  ["connector + worker (one runtime)", f => topDir(f) === "" || topDir(f) === "connector" || (isSatellite(f) && f.rel.split("/").length === 2)],
  ["codesys (bridge DLL + scripts)", f => topDir(f) === "codesys-scriptcommands" || topDir(f) === "codesys"],
]
const claimed = new Map<string, F[]>(components.map(([k]) => [k, []]))
for (const f of files) {
  const owners = components.filter(([, p]) => p(f)).map(([k]) => k)
  if (owners.length !== 1) errors.push(`${f.rel}: claimed by ${owners.length === 0 ? "no component" : owners.join(" + ")}`)
  else claimed.get(owners[0])!.push(f)
}
console.log(`stage: ${stage}`)
row("TOTAL (uncompressed)", files)
console.log("-- per component")
for (const [k, fs] of claimed) {
  if (fs.length === 0) errors.push(`component "${k}" matched no file`)
  row("  " + k, fs)
}

// The size levers the design names. `required` levers exist in both layouts; the others are what the rebuild
// deletes, so 0 after is the expected result there.
const desktopExes = files.filter(f => /^desktop\/[^/]+\.exe$/.test(f.rel)).sort((a, b) => b.size - a.size)
const electronExe = desktopExes[0]
const lever = (label: string, required: boolean, pred: (f: F) => boolean) => {
  const fs = files.filter(pred)
  if (required && fs.length === 0) errors.push(`lever "${label}" matched no file`)
  row("  " + label + (required ? "" : " [deleted by the rebuild]"), fs)
}
console.log("-- levers")
lever("desktop/locales/ (all)", true, f => f.rel.startsWith("desktop/locales/"))
lever("desktop/locales/en-US.pak", true, f => f.rel === "desktop/locales/en-US.pak")
lever("desktop/LICENSES.chromium.html", true, f => f.rel === "desktop/LICENSES.chromium.html")
lever(`electron main exe (largest desktop/*.exe: ${electronExe?.rel ?? "none"})`, true, f => f === electronExe)
lever("bin/volt-lsp-iec.exe", true, f => f.rel === "bin/volt-lsp-iec.exe")
lever("bin/ minus volt-lsp-iec.exe (CLI)", true, f => f.rel.startsWith("bin/") && f.rel !== "bin/volt-lsp-iec.exe")
lever("satellite *.resources.dll (non-en)", false, isSatellite)
lever("*.pdb", false, f => extname(f.rel) === ".pdb")
lever("*.vsix", false, f => extname(f.rel) === ".vsix")

if (existsSync(installer)) console.log(`installer: ${installer}\n  ${MB(statSync(installer).size).trim()} (${statSync(installer).size} bytes)`)
else console.log(`installer: not built at ${installer}`)

if (errors.length) {
  console.error(`REFUSED — the buckets do not cover this stage:\n  ${errors.join("\n  ")}`)
  process.exit(1)
}
