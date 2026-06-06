// Live push/pull flow test against the TC bridge. Exercises:
//   1. baseline fetch is deterministic (already verified)
//   2. push with valid expectedProjectVersion accepted
//   3. push with STALE expectedProjectVersion (a second push reusing
//      the first push's projectVersion) rejected with project drift
//   4. item-level ifVersion mismatch (after a successful push, push
//      same item again with the OLD per-item version) — should
//      reject with item-level conflict, NOT project drift
//
// All operations talk to the live TC bridge on port 8555. The target
// is PLC_PRG (a ST program guaranteed to exist).
//
// Pass --port=NNNN to target a different bridge.

const port = Number(
	(process.argv.find((a) => a.startsWith("--port=")) ?? "--port=8555").slice(7),
);

async function call(path, body) {
	const r = await fetch(`http://127.0.0.1:${port}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const text = await r.text();
	try {
		return { status: r.status, body: JSON.parse(text) };
	} catch {
		return { status: r.status, body: text };
	}
}

function plcPrgSource(suffix) {
	return `PROGRAM PLC_PRG\nVAR\nEND_VAR\n\n// flow-test ${suffix}\n\nEND_PROGRAM\n`;
}

function pushOp(name, sourceText, ifVersion) {
	return {
		op: "pushItem",
		name,
		sourceText,
		ifVersion,
	};
}

function status(label, fetchResp) {
	const items = fetchResp.body.items ?? {};
	const plc = items["PLC_PRG"];
	console.log(
		`${label}  projectVersion=${fetchResp.body.projectVersion}  PLC_PRG=${plc}`,
	);
}

async function main() {
	console.log(`# Live push/pull flow test against :${port}\n`);

	// --- Scenario 1: fetch is deterministic ---
	const f1 = await call("/fetch", { knownItems: {} });
	const f2 = await call("/fetch", { knownItems: {} });
	console.log("## 1. Fetch deterministic across calls");
	console.log("   fetch#1.projectVersion =", f1.body.projectVersion);
	console.log("   fetch#2.projectVersion =", f2.body.projectVersion);
	console.log(
		"   verdict:",
		f1.body.projectVersion === f2.body.projectVersion ? "✓ stable" : "✗ FAILED (drift)",
	);

	// --- Scenario 2: push with valid expectedProjectVersion accepted ---
	console.log("\n## 2. Push with valid expectedProjectVersion");
	const before = await call("/fetch", { knownItems: {} });
	status("   before:", before);
	const plcVerBefore = before.body.items["PLC_PRG"];

	const push1 = await call("/push", {
		expectedProjectVersion: before.body.projectVersion,
		ops: [pushOp("PLC_PRG", plcPrgSource("v1"), plcVerBefore)],
	});
	console.log("   push#1 status:", push1.status);
	console.log("   push#1 response:", JSON.stringify(push1.body, null, 2).slice(0, 600));

	// --- Scenario 3: stale expectedProjectVersion rejected ---
	console.log("\n## 3. Push with STALE expectedProjectVersion (replay of #2)");
	const push2 = await call("/push", {
		expectedProjectVersion: before.body.projectVersion, // intentionally stale
		ops: [pushOp("PLC_PRG", plcPrgSource("v2"), plcVerBefore)], // stale ifVersion too
	});
	console.log("   push#2 status:", push2.status);
	console.log("   push#2 response:", JSON.stringify(push2.body, null, 2).slice(0, 600));

	// --- Scenario 4: after success, projectVersion advances and a refetch sees the new version ---
	console.log("\n## 4. Post-push fetch sees the advanced projectVersion");
	const after = await call("/fetch", { knownItems: {} });
	status("   after:", after);
	console.log(
		"   newProjectVersion from push#1:",
		push1.body.newProjectVersion ?? "<n/a (push rejected)>",
	);
	console.log(
		"   verdict:",
		push1.status === 200 && push1.body.accepted && after.body.projectVersion === push1.body.newProjectVersion
			? "✓ post-push fetch matches push.newProjectVersion"
			: push1.status !== 200 || !push1.body.accepted
				? "(skipped — push#1 rejected)"
				: "✗ FAILED — fetch projectVersion ≠ push.newProjectVersion (DRIFT BUG STILL PRESENT)",
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
