#!/usr/bin/env node
/**
 * `volt` — process entry point. All real work is in `cli/`.
 *
 * Five flat verbs (init, pull, push, status, build). See the
 * cli/ directory or run `volt help` for details.
 *
 * Exit codes:
 *   0   success
 *   1   unknown verb / argument error / bridge unreachable / other failure
 *   2   build had errors  OR  push rejected (drift / conflict)
 *
 * Errors that reach this layer are EITHER a VoltError (structured —
 * we render what/why/hint) OR an unknown throw (we wrap it in a generic
 * VoltError shape so the user still sees a clean message). Raw stack
 * traces only appear with --debug or VOLT_DEBUG=1.
 */
import { formatVoltError, isDebugMode, isVoltError, VoltError } from "./_error.js";
import { parseArgs, runVerb } from "./index.js";

const { verb, flags } = parseArgs(process.argv.slice(2));
runVerb(verb, flags).then(
	(code) => process.exit(code),
	(err) => {
		const debug = isDebugMode(flags);
		const voltErr = isVoltError(err)
			? err
			: new VoltError({
					what: "unexpected internal error",
					why: err instanceof Error ? err.message : String(err),
					hint: "run with --debug for a full stack trace",
					cause: err,
				});
		process.stderr.write(formatVoltError(voltErr, debug));
		process.exit(voltErr.exitCode);
	},
);
