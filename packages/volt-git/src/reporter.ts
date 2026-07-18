/**
 * CLI progress reporter — turns streamed `ProgressFrame`s into stderr output. On a TTY it overwrites a single
 * live line; when captured/piped (the AI tool, CI logs) it emits throttled discrete lines so there's a trace
 * without spam. stdout is never touched, so `--json` output stays clean. `finish()` clears the TTY line before
 * the command prints its own summary.
 */
import type { ProgressHandler } from "./bridge/types.js";

export interface Reporter {
	onProgress: ProgressHandler;
	finish: () => void;
}

/** Prefix for the machine-readable progress line a GUI host (the VS Code extension) opts into via
 *  `VOLT_PROGRESS_JSON=1`. It parses `VOLT_PROGRESS <json>` off stderr to drive a real progress bar. */
const PROGRESS_JSON_PREFIX = "VOLT_PROGRESS ";

export function createReporter(): Reporter {
	// A GUI host sets VOLT_PROGRESS_JSON=1 to get structured frames on stderr (parseable); humans/AI get the
	// pretty/throttled text form. stdout is never touched either way.
	if (process.env.VOLT_PROGRESS_JSON === "1") {
		return {
			onProgress: (p) => process.stderr.write(`${PROGRESS_JSON_PREFIX}${JSON.stringify(p)}\n`),
			finish: () => {},
		};
	}

	const tty = process.stderr.isTTY === true;
	let lastBucket = -1;
	let lastLabel = "";
	let wroteTty = false;

	const onProgress: ProgressHandler = (p) => {
		const pct = p.total && p.total > 0 ? Math.floor((p.done / p.total) * 100) : undefined;
		const label = p.phase ?? p.operation;
		const line = pct !== undefined ? `${label}: ${p.done}/${p.total} (${pct}%)` : `${label}…`;
		if (tty) {
			process.stderr.write(`\r\x1b[2K${line}`); // carriage-return + clear-line → overwrite in place
			wroteTty = true;
		} else {
			// Non-TTY: emit only when the 10% bucket or the label changes — a readable trace, not a flood.
			const bucket = pct !== undefined ? Math.floor(pct / 10) : -1;
			if (bucket !== lastBucket || label !== lastLabel) {
				process.stderr.write(`${line}\n`);
				lastBucket = bucket;
				lastLabel = label;
			}
		}
	};

	const finish = (): void => {
		if (tty && wroteTty) process.stderr.write("\r\x1b[2K"); // clear the live line for the summary
	};

	return { onProgress, finish };
}
