// Probe: does push+build of an FB with a METHOD child produce a stable
// projectVersion? The recorder failures all involve test FBs that have
// METHOD children — Documents.SaveAll() in BuildHandler may normalize
// method declarations on save, advancing their hash.

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

const TEST_SRC =
`FUNCTION_BLOCK FB_LANG_conditional_define_then_if
VAR
	iCounter : INT;
END_VAR

END_FUNCTION_BLOCK

METHOD Run
{define MY_FLAG}
{IF defined (MY_FLAG)}
iCounter := 42;
{ELSE}
this_is_not_valid_st_at_all_xyz_999;
{END_IF}
END_METHOD
`;

const PLC_SRC =
`PROGRAM PLC_PRG
VAR
	fb_cdti : FB_LANG_conditional_define_then_if;
END_VAR

fb_cdti.Run();

END_PROGRAM
`;

async function main() {
	console.log("# FB-with-METHOD push/build/fetch probe\n");

	const s0 = await call("/fetch", { knownItems: {} });
	console.log(`pre push   pv=${s0.projectVersion}`);

	const push = await call("/push", {
		expectedProjectVersion: s0.projectVersion,
		ops: [
			{ op: "pushItem", name: "FB_LANG_conditional_define_then_if", sourceText: TEST_SRC, ifVersion: null },
			{ op: "pushItem", name: "PLC_PRG", sourceText: PLC_SRC, ifVersion: s0.items["PLC_PRG"] },
		],
	});
	if (!push.accepted) {
		console.log("push REJECTED:", JSON.stringify(push.conflicts, null, 2));
		return;
	}
	console.log(`post push  pv=${push.newProjectVersion}  FB=${push.newItems["FB_LANG_conditional_define_then_if"]}`);

	const beforeBuild = await call("/fetch", { knownItems: {} });
	const fbBeforeItem = beforeBuild.changed.find((i) => i.name === "FB_LANG_conditional_define_then_if");
	console.log(`pre build  pv=${beforeBuild.projectVersion}  FB=${beforeBuild.items["FB_LANG_conditional_define_then_if"]}`);

	const build = await call("/build", { buildType: "full" });
	console.log(`build      errors=${(build.diagnostics ?? []).filter((d) => d.severity === "error").length}`);

	const afterBuild = await call("/fetch", { knownItems: {} });
	const fbAfterItem = afterBuild.changed.find((i) => i.name === "FB_LANG_conditional_define_then_if");
	console.log(`post build pv=${afterBuild.projectVersion}  FB=${afterBuild.items["FB_LANG_conditional_define_then_if"]}`);

	if (beforeBuild.projectVersion !== afterBuild.projectVersion) {
		console.log("\n⚠ projectVersion ADVANCED across build");
		const changed = Object.keys(afterBuild.items).filter(
			(k) => beforeBuild.items[k] !== afterBuild.items[k],
		);
		console.log("  changed items:", changed);

		if (fbBeforeItem && fbAfterItem && fbBeforeItem.sourceText !== fbAfterItem.sourceText) {
			console.log("\nFB sourceText shifted across build:");
			console.log("--- BEFORE ---");
			console.log(fbBeforeItem.sourceText);
			console.log("--- AFTER ---");
			console.log(fbAfterItem.sourceText);
		} else if (fbBeforeItem && fbAfterItem) {
			console.log("\nFB sourceText IDENTICAL but version differs — something inside ComputeItemVersion hashes more than text");
		}
	} else {
		console.log("\n✓ projectVersion stable across build");
	}

	// Cleanup.
	await call("/push", {
		expectedProjectVersion: afterBuild.projectVersion,
		ops: [
			{
				op: "deleteItem",
				name: "FB_LANG_conditional_define_then_if",
				ifVersion: afterBuild.items["FB_LANG_conditional_define_then_if"],
			},
			{
				op: "pushItem",
				name: "PLC_PRG",
				sourceText: "PROGRAM PLC_PRG\nVAR\nEND_VAR\n\nEND_PROGRAM\n",
				ifVersion: afterBuild.items["PLC_PRG"],
			},
		],
	});
}

main().catch((e) => { console.error(e); process.exit(1); });
