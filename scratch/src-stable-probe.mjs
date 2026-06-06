// Push a clean POU, fetch source, build, fetch again, diff sources.
// If TC modifies source post-build (adds qualifier attributes, comments,
// etc.) → that's the recorder's killer.

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

async function getPOU(name) {
	const f = await call("/fetch", { knownItems: {} });
	const it = f.changed.find((i) => i.name === name);
	return {
		pv: f.projectVersion,
		version: f.items[name],
		sourceText: it?.sourceText,
	};
}

async function main() {
	const cleanSrc =
		"FUNCTION_BLOCK FB_StableProbe\nVAR\n\tcounter: INT;\nEND_VAR\ncounter := counter + 1;\nEND_FUNCTION_BLOCK\n";

	// Get current state, push the probe FB + a PLC_PRG that uses it.
	const before = await call("/fetch", { knownItems: {} });
	console.log("baseline pv:", before.projectVersion);

	const push = await call("/push", {
		expectedProjectVersion: before.projectVersion,
		ops: [
			{ op: "pushItem", name: "FB_StableProbe", sourceText: cleanSrc, ifVersion: null },
			{
				op: "pushItem",
				name: "PLC_PRG",
				sourceText: "PROGRAM PLC_PRG\nVAR\n\tinst: FB_StableProbe;\nEND_VAR\ninst();\nEND_PROGRAM\n",
				ifVersion: before.items["PLC_PRG"],
			},
		],
	});
	console.log("push accepted:", push.accepted);
	if (!push.accepted) { console.log(push.conflicts); return; }

	const a = await getPOU("FB_StableProbe");
	console.log("\nFB_StableProbe BEFORE build:");
	console.log("  pv:", a.pv, "ver:", a.version);
	console.log("  source:", JSON.stringify(a.sourceText));

	const build = await call("/build", { buildType: "full" });
	console.log(`\nbuild errors=${(build.diagnostics ?? []).filter((d) => d.severity === "error").length}`);

	const b = await getPOU("FB_StableProbe");
	console.log("\nFB_StableProbe AFTER build:");
	console.log("  pv:", b.pv, "ver:", b.version);
	console.log("  source:", JSON.stringify(b.sourceText));

	if (a.sourceText !== b.sourceText) {
		console.log("\n!! SOURCE MUTATED BY BUILD !!");
		console.log("Diff char-by-char:");
		for (let i = 0; i < Math.max(a.sourceText.length, b.sourceText.length); i++) {
			if (a.sourceText[i] !== b.sourceText[i]) {
				console.log(`  @${i}: '${a.sourceText[i] ?? "<eof>"}' vs '${b.sourceText[i] ?? "<eof>"}'`);
				console.log(`  context A: ...${JSON.stringify(a.sourceText.slice(Math.max(0, i - 20), i + 20))}`);
				console.log(`  context B: ...${JSON.stringify(b.sourceText.slice(Math.max(0, i - 20), i + 20))}`);
				break;
			}
		}
	} else if (a.version !== b.version) {
		console.log("\n⚠ Source text matches BUT item version differs!");
		console.log("  -> ComputeItemVersion may hash something beyond declaration+implementation");
	} else {
		console.log("\n✓ Source AND version stable across build");
	}

	// Cleanup.
	await call("/push", {
		expectedProjectVersion: b.pv,
		ops: [
			{ op: "deleteItem", name: "FB_StableProbe", ifVersion: b.version },
			{ op: "pushItem", name: "PLC_PRG", sourceText: "PROGRAM PLC_PRG\nVAR\nEND_VAR\n\nEND_PROGRAM\n", ifVersion: (await call("/fetch", { knownItems: {} })).items["PLC_PRG"] },
		],
	});
}

main().catch((e) => { console.error(e); process.exit(1); });
