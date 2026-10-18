#!/usr/bin/env bun
/**
 * WHAT CPU EVERY SHIPPED BINARY RUNS ON (openspec environment-dependency-audit 1.2, the bitness/target gate).
 *
 *   bun scripts/binary-targets.ts [dir]     # default dist/volt; also an installed {app}
 *
 * Reads the PE header of every .exe/.dll under the payload and refuses the tree when one is built for a CPU its place
 * does not allow. Volt installs on x64 Windows only (installer/Volt.iss `ArchitecturesAllowed=x64compatible`), and these
 * places have a bitness of their own:
 *   - every DLL under `codesys/` (the bridge `Volt.Ide.Codesys.dll`, and any dependency beside it) is loaded IN-PROC by
 *     CODESYS, which exists as 32- and 64-bit: it must be AnyCPU (IL only, neither 32BITREQUIRED nor 32BITPREFERRED) or
 *     one of the two IDEs cannot load it.
 *   - the two TwinCAT worker builds read an XAE's hierarchy through XAE's own proxy, of XAE's bitness (DIALECT C2t):
 *     `connector/x86/VoltBridgeTwincat.exe` (the worker of a 32-bit XAE) must be x86, `connector/VoltBridgeTwincat.exe`
 *     (the worker of a 64-bit XAE) x64.
 *   - `unins000.exe` (or the next free number — Inno numbers on) at the root of an INSTALLED {app} is Inno Setup's
 *     uninstaller, which Inno builds x86 whatever the install mode (measured: `Setup.e32`, the stub it copies there, is x86). It is not in the payload; it is allowed so
 *     the check runs on an installed tree.
 *   - `bin/git/usr/libexec/getprocaddr32.exe` is MinGit's (the CLI's bundled git, unmodified) helper for interrupting a
 *     32-bit child process: x86 by its purpose.
 *   - everything else is x64 or AnyCPU — an x86 binary anywhere else is a 32-bit process nobody chose (an AnyCPU exe
 *     with 32BITPREFERRED included), an ARM64 one does not run on the machines Volt installs on.
 * What a PE header cannot say — the LSP's bun target being the `-baseline` build (no AVX2: a panel PC's Atom/Celeron) —
 * is held as text by `Volt.Repo.Gates/ShippedBinaryTargetTests`. `build-payload.ts` runs this on the tree it built.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

export type Target = "x64" | "x86" | "AnyCPU" | "AnyCPU-32bit-preferred" | "arm64" | `machine 0x${string}`

const IMAGE_FILE_MACHINE_I386 = 0x14c
const IMAGE_FILE_MACHINE_AMD64 = 0x8664
const IMAGE_FILE_MACHINE_ARM64 = 0xaa64
const COMIMAGE_FLAGS_ILONLY = 0x1
const COMIMAGE_FLAGS_32BITREQUIRED = 0x2
const COMIMAGE_FLAGS_32BITPREFERRED = 0x20000

/** The CPU a PE file runs on, or null when the file is not a PE image. Managed images are read through their CLR header:
 *  an IL-only PE32 is AnyCPU unless it requires (x86) or prefers (AnyCPU-32bit-preferred) 32 bits. */
export function peTarget(bytes: Uint8Array): Target | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 0x40 || v.getUint16(0, true) !== 0x5a4d) return null // "MZ"
  const pe = v.getUint32(0x3c, true)
  if (pe + 24 > bytes.length || v.getUint32(pe, true) !== 0x00004550) return null // "PE\0\0"
  const machine = v.getUint16(pe + 4, true)
  const sections = v.getUint16(pe + 6, true)
  const optSize = v.getUint16(pe + 20, true)
  const opt = pe + 24
  const magic = v.getUint16(opt, true)
  const dirs = opt + (magic === 0x20b ? 112 : 96)
  const clrRva = v.getUint32(dirs + 14 * 8, true)
  const native: Target =
    machine === IMAGE_FILE_MACHINE_AMD64 ? "x64"
    : machine === IMAGE_FILE_MACHINE_I386 ? "x86"
    : machine === IMAGE_FILE_MACHINE_ARM64 ? "arm64"
    : `machine 0x${machine.toString(16)}`
  if (clrRva === 0) return native
  const table = opt + optSize
  for (let s = 0; s < sections; s++) {
    const h = table + s * 40
    const va = v.getUint32(h + 12, true)
    const size = Math.max(v.getUint32(h + 8, true), v.getUint32(h + 16, true))
    if (clrRva < va || clrRva >= va + size) continue
    const cor = v.getUint32(h + 20, true) + (clrRva - va)
    const flags = v.getUint32(cor + 16, true)
    if (machine !== IMAGE_FILE_MACHINE_I386 || !(flags & COMIMAGE_FLAGS_ILONLY)) return native
    if (flags & COMIMAGE_FLAGS_32BITREQUIRED) return flags & COMIMAGE_FLAGS_32BITPREFERRED ? "AnyCPU-32bit-preferred" : "x86"
    return "AnyCPU"
  }
  throw new Error("the CLR header's RVA lies in no section")
}

/** The targets a payload path may have: the places with a bitness of their own, and the rule for the rest. */
export function allowed(path: string): readonly Target[] {
  if (path === "codesys/Volt.Ide.Codesys.dll") return ["AnyCPU"]
  if (path.startsWith("codesys/") && path.toLowerCase().endsWith(".dll")) return ["AnyCPU"] // in-proc beside the bridge
  if (path === "connector/x86/VoltBridgeTwincat.exe") return ["x86"]
  if (path === "connector/VoltBridgeTwincat.exe") return ["x64"]
  if (/^unins\d{3}\.exe$/i.test(path)) return ["x86"] // Inno Setup's uninstaller (unins000.exe, or the next free number), in an installed {app}
  // MinGit's helper that reads a 32-bit process's Ctrl+C entry point (how git interrupts a 32-bit child) — x86 by its
  // purpose; the bundled git is unmodified (bin/git, openspec environment-dependency-audit 2.1; measured on 2.56.0.2).
  if (path === "bin/git/usr/libexec/getprocaddr32.exe") return ["x86"]
  return ["x64", "AnyCPU"]
}

/** Every PE under `dir` whose target its place does not allow, as `path: target (allowed: …)`; and how many were read. */
export function check(dir: string): { read: number; wrong: string[] } {
  const wrong: string[] = []
  let read = 0
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.(exe|dll)$/i.test(name)) continue
      const rel = relative(dir, p).replaceAll("\\", "/")
      const target = peTarget(readFileSync(p))
      if (target === null) { wrong.push(`${rel}: not a PE image`); continue }
      read++
      if (!allowed(rel).includes(target)) wrong.push(`${rel}: ${target} (allowed: ${allowed(rel).join(", ")})`)
    }
  }
  walk(dir)
  return { read, wrong }
}

if (import.meta.main) {
  const dir = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../dist/volt"))
  const { read, wrong } = check(dir)
  if (read === 0) {
    console.error(`✗ no PE image under ${dir}`)
    process.exit(1)
  }
  if (wrong.length > 0) {
    console.error(`✗ ${wrong.length} of ${read} binaries in ${dir} are built for a CPU their place does not allow:\n  ${wrong.join("\n  ")}`)
    process.exit(1)
  }
  console.log(`✓ ${read} binaries in ${dir}: every one built for the CPU its place allows`)
}
