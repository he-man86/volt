/**
 * The one place that parses argv. Centralised because the verb-detection bug
 * (treating a flag VALUE like the path after --workspace as the command) came
 * from parsing being scattered across bin.ts. Keep all flag knowledge here.
 */

/** Flags that consume the following token as their value. */
const FLAG_TAKING_VALUE = new Set(["--workspace", "--port", "--resolve", "--limit"])

export interface ParsedArgs {
	/** The command. The first POSITIONAL (flag values excluded), so flag order
	 *  doesn't matter: `--workspace <p> init` and `init --workspace <p>` both → init. */
	verb: string
	/** Positionals AFTER the verb (e.g. show's `<ref> <path>`). */
	operands: string[]
	workspace: string
	port: number
	/** True if a boolean flag is present (e.g. --force, --json). */
	has(flag: string): boolean
	/** The token following a value-flag (e.g. value("--resolve")), or undefined. */
	value(flag: string): string | undefined
}

export function parseArgs(
	argv: string[],
	env: Record<string, string | undefined> = process.env,
	cwd: string = process.cwd(),
): ParsedArgs {
	const value = (flag: string): string | undefined => {
		const i = argv.indexOf(flag)
		return i >= 0 ? argv[i + 1] : undefined
	}
	const has = (flag: string): boolean => argv.includes(flag)

	const positionals = argv.filter(
		(a, i) => !a.startsWith("-") && (i === 0 || !FLAG_TAKING_VALUE.has(argv[i - 1]!)),
	)
	const verb = positionals[0] ?? "help"
	const operands = positionals.slice(1)

	const workspace = value("--workspace") ?? env.VOLT_WORKSPACE ?? cwd
	const port = Number.parseInt(value("--port") ?? env.VOLT_BRIDGE_PORT ?? "8555", 10)

	return { verb, operands, workspace, port, has, value }
}
