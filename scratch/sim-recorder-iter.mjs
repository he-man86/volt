// Simulate what the recorder does for one iteration:
//   1. Pull state (fetch)
//   2. push FB + PLC_PRG that uses it
//   3. build
//   4. delete FB + revert PLC_PRG
//
// If step 4 fails with projectVersion drift, the recorder bug is here.

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

async function main() {
	console.log("# Simulate one recorder iteration\n");

	const s0 = await call("/fetch", { knownItems: {} });
	console.log(`step 0: fetch pv=${s0.projectVersion}`);

	// step 1: push FB + PLC_PRG (analogous to the recorder's main push)
	const fbSrc = "FUNCTION_BLOCK FB_LANG_test\nVAR\n\tn: INT;\nEND_VAR\nn := n + 1;\nEND_FUNCTION_BLOCK\n";
	const megaPlc = "PROGRAM PLC_PRG\nVAR\n\tinst: FB_LANG_test;\nEND_VAR\ninst();\nEND_PROGRAM\n";
	const push1 = await call("/push", {
		expectedProjectVersion: s0.projectVersion,
		ops: [
			{ op: "pushItem", name: "FB_LANG_test", sourceText: fbSrc, ifVersion: null },
			{ op: "pushItem", name: "PLC_PRG", sourceText: megaPlc, ifVersion: s0.items["PLC_PRG"] },
		],
	});
	if (!push1.accepted) {
		console.log("push1 REJECTED:", JSON.stringify(push1.conflicts, null, 2));
		return;
	}
	console.log(`step 1: push1 OK -> pv=${push1.newProjectVersion}  FB_LANG_test=${push1.newItems["FB_LANG_test"]}`);

	// step 2: build
	const build = await call("/build", { buildType: "full" });
	console.log(`step 2: build errors=${(build.diagnostics ?? []).filter((d) => d.severity === "error").length}`);

	// step 2.5: fetch — what does the bridge think NOW?
	const s2 = await call("/fetch", { knownItems: {} });
	console.log(`step 2.5: fetch pv=${s2.projectVersion}  FB_LANG_test=${s2.items["FB_LANG_test"]}  PLC_PRG=${s2.items["PLC_PRG"]}`);
	if (s2.projectVersion !== push1.newProjectVersion) {
		console.log("!! BRIDGE STATE ADVANCED between push and post-build fetch !!");
		const changed = Object.keys(s2.items).filter((k) => (push1.newItems[k] ?? null) !== s2.items[k]);
		console.log("  changed items:", changed.map((k) => `${k} (${push1.newItems[k]} -> ${s2.items[k]})`).join(", ") || "(none — but pv differs)");
	}

	// step 3: simulate reset — delete FB_LANG_test + revert PLC_PRG. Use
	// the state FROM AFTER PUSH#1 (what the recorder's state.json would
	// contain at this point).
	const cachedPv = push1.newProjectVersion;
	const cachedFbVersion = push1.newItems["FB_LANG_test"];
	const cachedPlcVersion = push1.newItems["PLC_PRG"];
	const bareSrc = "PROGRAM PLC_PRG\nVAR\nEND_VAR\n\nEND_PROGRAM\n";
	const reset = await call("/push", {
		expectedProjectVersion: cachedPv,
		ops: [
			{ op: "deleteItem", name: "FB_LANG_test", ifVersion: cachedFbVersion },
			{ op: "pushItem", name: "PLC_PRG", sourceText: bareSrc, ifVersion: cachedPlcVersion },
		],
	});
	console.log(`step 3: reset accepted=${reset.accepted}`);
	if (!reset.accepted) {
		console.log("  conflicts:");
		for (const c of reset.conflicts) {
			console.log(`    ${c.name}: ${c.reason}  yours=${c.yourVersion}  current=${c.currentVersion}`);
		}
		// Cleanup anyway
		const s3 = await call("/fetch", { knownItems: {} });
		await call("/push", {
			ops: [
				{ op: "deleteItem", name: "FB_LANG_test", ifVersion: s3.items["FB_LANG_test"] },
				{ op: "pushItem", name: "PLC_PRG", sourceText: bareSrc, ifVersion: s3.items["PLC_PRG"] },
			],
		});
	}
}

main().catch((e) => { console.error(e); process.exit(1); });
