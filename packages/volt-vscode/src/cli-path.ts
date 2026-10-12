import { existsSync } from "node:fs"
import { join } from "node:path"

// Resolve volt.exe by ABSOLUTE path. Relying on `volt` from PATH fails as `spawn volt ENOENT` whenever VS Code was
// launched BEFORE the installer put it on PATH — the running process captured the old PATH, and a broadcast can't
// retro-fit it. The installer lays volt.exe down at a fixed place (…\Programs\Volt\bin — installer/Volt.iss,
// DisableDirPage); undefined when it is not there, and the caller falls back to `volt` on PATH (dev).
export function resolveVoltCli(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  const exe = process.platform === "win32" ? "volt.exe" : "volt"
  if (!env.LOCALAPPDATA) return undefined
  return [join(env.LOCALAPPDATA, "Programs", "Volt", "bin", exe)].find(exists)
}
