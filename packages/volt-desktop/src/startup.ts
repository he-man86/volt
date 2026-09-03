/**
 * Which workspace the app opens on, decided from the three things that can name one.
 *
 * Pure and electron-free, so the decision is testable — the wiring in `main.ts` is not.
 *
 * **Precedence: argv → `VOLT_WORKSPACE` → the remembered one.** Argv is the only channel that can carry a
 * workspace to an app that is ALREADY RUNNING (Electron delivers it through `second-instance`), which is why
 * `volt open <dir>` passes it that way rather than in the child's environment: env is read once at start, so a
 * second `volt open <otherDir>` against a live window would carry nothing and the directory the engineer named
 * would be silently ignored. A duplicate window is a nuisance; opening the wrong workspace without saying so is
 * a wrong answer.
 *
 * `VOLT_WORKSPACE` stays as the dev override it has always been, and `readRecent` stays the last resort — the
 * memory that keeps a returning user from being offered a brand-new workspace every launch. There is no fourth
 * option and deliberately no fallback beyond it: an unbound app shows the picker, which is a true statement,
 * rather than binding something nobody chose.
 */

/**
 * The `--workspace` value from a raw argv, or undefined.
 *
 * Accepts both spellings the CLI itself accepts (`--workspace <dir>` and `--workspace=<dir>`) and ignores
 * everything else — Electron injects its own flags, and a packaged app's argv[0]/argv[1] are the exe and, in
 * dev, the app path.
 */
export function workspaceArg(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--workspace") return argv[i + 1] // the value is the NEXT argument, absent at the end
    if (a.startsWith("--workspace=")) return a.slice("--workspace=".length) || undefined
  }
  return undefined
}

/**
 * The workspace to open on, by precedence.
 *
 * `recent` is a THUNK, not a value: reading the store logs when the remembered workspace has gone missing, and
 * an eagerly-evaluated argument would emit that line even when argv already decided — a confusing message about
 * a path nobody asked for.
 */
export function startupWorkspace(
  argv: readonly string[],
  env: string | undefined,
  recent: () => string | undefined,
): string | undefined {
  return workspaceArg(argv) ?? env ?? recent()
}
