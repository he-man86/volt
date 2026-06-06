// Cross-bridge parity smoke test.
//
// Runs the same conceptual flow against BOTH bridges (TC :8555,
// CODESYS :8556) and asserts BEHAVIOURAL parity — same op shapes,
// same conflict structure, same projectVersion stability invariants.
// Doesn't compare hashes across vendors (each computes its own); it
// checks that within EACH vendor the contract holds, AND that the
// contract holds the same way on both.
//
// Run after every bridge change to catch regressions where one side
// updates an invariant the other still maintains.
//
// Usage: bun scratch/bridge-parity.mjs

const BRIDGES = [
	{ id: "TC", port: 8555 },
	{ id: "CODESYS", port: 8556 },
];

async function call(port, path, body) {
	// /refs is a GET (read-only); /fetch and /push are POST. Per
	// bridge convention, /refs takes no body. CODESYS strictly
	// enforces method-on-route; TC also accepts POST on /refs but
	// we keep parity strict.
	const isReadOnly = path === "/refs" || path === "/health";
	const r = await fetch(`http://127.0.0.1:${port}${path}`, {
		method: isReadOnly ? "GET" : "POST",
		headers: isReadOnly ? undefined : { "Content-Type": "application/json" },
		body: isReadOnly ? undefined : JSON.stringify(body ?? {}),
	});
	const txt = await r.text();
	let parsed;
	try {
		parsed = JSON.parse(txt);
	} catch {
		parsed = txt;
	}
	return { status: r.status, body: parsed };
}

async function health(port) {
	const r = await fetch(`http://127.0.0.1:${port}/health`);
	if (!r.ok) return null;
	return await r.json();
}

// Per-bridge assertion: every contract our agent depends on.
async function checkBridge(bridge) {
	console.log(`\n## ${bridge.id} (:${bridge.port})`);
	const h = await health(bridge.port);
	if (h === null) {
		console.log("  ✗ bridge unreachable (skipping)");
		return { id: bridge.id, ok: false, reason: "unreachable" };
	}
	console.log(`  ✓ alive · ${h.ideName}/${h.ideVersion} · project=${h.projectName}`);

	const checks = [];

	// 1) Fetch is deterministic across calls.
	const f1 = await call(bridge.port, "/fetch", { knownItems: {} });
	const f2 = await call(bridge.port, "/fetch", { knownItems: {} });
	const detPv = f1.body.projectVersion === f2.body.projectVersion;
	checks.push({ name: "fetch.projectVersion deterministic", ok: detPv });

	// 2) /refs returns the SAME projectVersion as /fetch.
	const r = await call(bridge.port, "/refs");
	const refsMatchesFetch =
		r.body.projectVersion === f1.body.projectVersion &&
		Object.keys(r.body.items).length === Object.keys(f1.body.items).length;
	checks.push({ name: "refs.projectVersion === fetch.projectVersion", ok: refsMatchesFetch });

	// 3) Wire shape: every response carries expected keys.
	const refsShape =
		typeof r.body.projectVersion === "string" &&
		typeof r.body.items === "object" &&
		typeof r.body.kinds === "object";
	checks.push({ name: "refs shape: projectVersion + items + kinds", ok: refsShape });

	const fetchShape =
		typeof f1.body.projectVersion === "string" &&
		Array.isArray(f1.body.changed) &&
		Array.isArray(f1.body.removed) &&
		typeof f1.body.items === "object";
	checks.push({ name: "fetch shape: projectVersion + changed + removed + items", ok: fetchShape });

	// 4) Push pre-flight rejects deliberately-wrong expectedProjectVersion
	//    with a project-level conflict in the response.
	const badPush = await call(bridge.port, "/push", {
		expectedProjectVersion: "deadbeefdeadbeef",
		ops: [],
	});
	const rejectsBadExpected =
		badPush.body.accepted === false &&
		Array.isArray(badPush.body.conflicts) &&
		badPush.body.conflicts.some((c) => c.name === "<project>");
	checks.push({ name: "push rejects bad expectedProjectVersion with <project> conflict", ok: rejectsBadExpected });

	// 5) push response shape: when accepted, returns newProjectVersion + newItems.
	//    Test with an empty ops array + correct expectedProjectVersion.
	const noopPush = await call(bridge.port, "/push", {
		expectedProjectVersion: f1.body.projectVersion,
		ops: [],
	});
	const noopShape =
		noopPush.body.accepted === true &&
		typeof noopPush.body.newProjectVersion === "string" &&
		typeof noopPush.body.newItems === "object";
	checks.push({ name: "empty push accepted shape: newProjectVersion + newItems", ok: noopShape });

	// 6) Post-empty-push fetch matches push.newProjectVersion.
	//    (For an empty-ops push, newProjectVersion should equal what
	//    fetch returns next — the cross-handler walker invariant.)
	const f3 = await call(bridge.port, "/fetch", { knownItems: {} });
	const postPushMatchesFetch = noopShape && f3.body.projectVersion === noopPush.body.newProjectVersion;
	checks.push({ name: "post-push fetch matches push.newProjectVersion", ok: postPushMatchesFetch });

	let allOk = true;
	for (const c of checks) {
		const mark = c.ok ? "✓" : "✗";
		console.log(`  ${mark} ${c.name}`);
		if (!c.ok) allOk = false;
	}
	return { id: bridge.id, ok: allOk, checks };
}

async function main() {
	console.log("# Cross-bridge parity smoke test");
	const results = [];
	for (const b of BRIDGES) {
		results.push(await checkBridge(b));
	}

	// Side-by-side: every contract present on one bridge must be present
	// on the other. The point isn't equal hashes — it's equal behaviour.
	console.log("\n## Parity matrix");
	const tc = results.find((r) => r.id === "TC");
	const cs = results.find((r) => r.id === "CODESYS");
	if (tc?.checks && cs?.checks) {
		for (let i = 0; i < tc.checks.length; i++) {
			const tcOk = tc.checks[i].ok;
			const csOk = cs.checks[i].ok;
			const match = tcOk === csOk;
			console.log(
				`  ${match ? "✓" : "⚠"} ${tc.checks[i].name.padEnd(60)}  TC=${tcOk ? "PASS" : "FAIL"}  CODESYS=${csOk ? "PASS" : "FAIL"}`,
			);
		}
	}

	const anyFail = results.some((r) => !r.ok);
	process.exit(anyFail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
