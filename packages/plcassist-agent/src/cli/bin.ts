#!/usr/bin/env node
/**
 * `plc` — process entry point. All real work is in `cli/`.
 *
 * Five flat verbs (init, import, export, status, compile). See the
 * cli/ directory or run `plc help` for details.
 *
 * Exit codes:
 *   0   success
 *   1   unknown verb / argument error / bridge unreachable / other failure
 *   2   compile had errors  OR  export rejected (drift / conflict)
 */
import { parseArgs, runVerb } from "./index.js";

const { verb, flags } = parseArgs(process.argv.slice(2));
runVerb(verb, flags).then(
	(code) => process.exit(code),
	(err) => {
		process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(1);
	},
);
