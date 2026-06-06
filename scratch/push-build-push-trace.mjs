// Trace projectVersion through: fetch → push → fetch → build → fetch → push.
// If the bridge's projectVersion advances between fetches without our doing
// anything, that's the bug the recorder is hitting.
//
// Usage: bun scratch/push-build-push-trace.mjs [--port=8555]

const port = Number(
	(process.argv.find((a) => a.startsWith("--port=")) ?? "--port=8555").slice(7),
);

async function call(path, body) {
	const r = await fetch(`http://127.0.0.1:${port}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return await r.json();
}

async function pv(label) {
	const r = await call("/fetch", { knownItems: {} });
	console.log(`${label.padEnd(30)} pv=${r.projectVersion}  items=${Object.keys(r.items).length}  PLC_PRG=${r.items["PLC_PRG"]}`);
	return r;
}

async function main() {
	console.log("# Trace projectVersion through push+build+push\n");

	const s0 = await pv("after start (clean)");

	// Push some content to PLC_PRG.
	const push1 = await call("/push", {
		expectedProjectVersion: s0.projectVersion,
		ops: [{
			op: "pushItem",
			name: "PLC_PRG",
			sourceText: "PROGRAM PLC_PRG\nVAR\n\ti: INT;\nEND_VAR\ni := i + 1;\nEND_PROGRAM\n",
			ifVersion: s0.items["PLC_PRG"],
		}],
	});
	console.log(`\npush#1 accepted=${push1.accepted}  newProjectVersion=${push1.newProjectVersion}`);

	const s1 = await pv("after push#1");

	// Build.
	const build1 = await call("/build", { buildType: "full" });
	console.log(`\nbuild#1 errors=${(build1.diagnostics ?? []).filter((d) => d.severity === "error").length}`);

	const s2 = await pv("after build#1");

	if (s2.projectVersion !== s1.projectVersion) {
		console.log(`\n!! BRIDGE STATE CHANGED during build !!`);
		const changed = Object.keys(s2.items).filter((k) => s1.items[k] !== s2.items[k]);
		const added = Object.keys(s2.items).filter((k) => !(k in s1.items));
		const removed = Object.keys(s1.items).filter((k) => !(k in s2.items));
		console.log(`  added: ${added.join(", ") || "(none)"}`);
		console.log(`  removed: ${removed.join(", ") || "(none)"}`);
		console.log(
			`  changed: ${changed.map((k) => `${k} (${s1.items[k]} -> ${s2.items[k]})`).join(", ") || "(none)"}`,
		);
	} else {
		console.log(`\n  (no change during build)`);
	}

	// A second push using the s1 view of things — should still succeed
	// because items themselves haven't changed in our code, only build
	// metadata may have shifted.
	const push2 = await call("/push", {
		expectedProjectVersion: s1.projectVersion,
		ops: [{
			op: "pushItem",
			name: "PLC_PRG",
			sourceText: "PROGRAM PLC_PRG\nVAR\n\ti: INT;\nEND_VAR\ni := i + 2;\nEND_PROGRAM\n",
			ifVersion: s1.items["PLC_PRG"],
		}],
	});
	console.log(`\npush#2 accepted=${push2.accepted}`);
	if (!push2.accepted) console.log("  conflicts:", JSON.stringify(push2.conflicts, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
