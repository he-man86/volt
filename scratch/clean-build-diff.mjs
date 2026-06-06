// Probe: push a CLEAN program, run a CLEAN build, then fetch.
// Hypothesis: a clean build emits compile artifacts the bridge sees,
// advancing projectVersion without our doing anything.

const port = Number(
	(process.argv.find((a) => a.startsWith("--port=")) ?? "--port=8555").slice(7),
);

async function call(path, body) {
	const r = await fetch(`http://127.0.0.1:${port}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return await r.json();
}

function diffItems(a, b) {
	const added = Object.keys(b.items).filter((k) => !(k in a.items));
	const removed = Object.keys(a.items).filter((k) => !(k in b.items));
	const changed = Object.keys(a.items).filter(
		(k) => k in b.items && a.items[k] !== b.items[k],
	);
	return { added, removed, changed };
}

async function snap(label) {
	const f = await call("/fetch", { knownItems: {} });
	console.log(`${label.padEnd(30)} pv=${f.projectVersion}  items=${Object.keys(f.items).length}`);
	return f;
}

async function main() {
	console.log("# Clean build state-change probe\n");

	const s0 = await snap("baseline");

	// Push a TRIVIAL clean POU + a PLC_PRG that uses it. Both compile clean.
	const push = await call("/push", {
		expectedProjectVersion: s0.projectVersion,
		ops: [
			{
				op: "pushItem",
				name: "PLC_PRG",
				sourceText: "PROGRAM PLC_PRG\nVAR\n\tinst: FB_CleanProbe;\nEND_VAR\ninst();\nEND_PROGRAM\n",
				ifVersion: s0.items["PLC_PRG"],
			},
			{
				op: "pushItem",
				name: "FB_CleanProbe",
				sourceText: "FUNCTION_BLOCK FB_CleanProbe\nVAR\n\tx: INT;\nEND_VAR\nx := x + 1;\nEND_FUNCTION_BLOCK\n",
				ifVersion: null, // create new
			},
		],
	});
	console.log(`\npush.accepted=${push.accepted}`);
	if (!push.accepted) {
		console.log("conflicts:", JSON.stringify(push.conflicts, null, 2));
		return;
	}

	const s1 = await snap("after push (pre-build)");

	const build = await call("/build", { buildType: "full" });
	console.log(`\nbuild errors=${(build.diagnostics ?? []).filter((d) => d.severity === "error").length}`);

	const s2 = await snap("after CLEAN build");

	const d = diffItems(s1, s2);
	if (s1.projectVersion === s2.projectVersion) {
		console.log("\n✓ projectVersion stable — no compile-artifact churn");
	} else {
		console.log("\n⚠ projectVersion ADVANCED after clean build");
		console.log("  added:", d.added.join(", ") || "(none)");
		console.log("  removed:", d.removed.join(", ") || "(none)");
		console.log(
			"  changed:",
			d.changed.map((k) => `${k} (${s1.items[k]} -> ${s2.items[k]})`).join(", ") || "(none)",
		);

		// For each changed item, show its kind from s2.
		const kindsResp = await call("/refs", {});
		console.log("  changed item kinds:");
		for (const k of d.changed) {
			console.log(`    ${k}: ${kindsResp.kinds?.[k] ?? "(no kind reported)"}`);
		}
	}

	// Cleanup.
	await call("/push", {
		expectedProjectVersion: s2.projectVersion,
		ops: [
			{ op: "deleteItem", name: "FB_CleanProbe", ifVersion: s2.items["FB_CleanProbe"] },
			{
				op: "pushItem",
				name: "PLC_PRG",
				sourceText: "PROGRAM PLC_PRG\nVAR\nEND_VAR\n\nEND_PROGRAM\n",
				ifVersion: s2.items["PLC_PRG"],
			},
		],
	});
}

main().catch((e) => { console.error(e); process.exit(1); });
