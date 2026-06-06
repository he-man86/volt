// Push an FBD/LD .fbd file to a bridge by splitting it into decl + body
// and POSTing /push. Default target: TC bridge (port 8555). Pass any
// .fbd file as the first arg; pass `--port=NNNN` to target another
// bridge (CODESYS default = 8556) or `--name=NAME` to override the
// POU name derived from the declaration.

import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { extractGraphicalBody } from "../../packages/volt-agent/src/engine/graphical-pou.ts";

const BRIDGES = {
	TC: 8555,
	CODESYS: 8556,
};

const args = argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const file = positional[0];
if (!file) {
	console.error("usage: bun _push.mjs <demo.fbd> [--port=NNNN] [--name=NAME]");
	exit(1);
}
const port = Number((args.find((a) => a.startsWith("--port=")) ?? "--port=8555").slice(7));
const nameArg = args.find((a) => a.startsWith("--name="));
const overrideName = nameArg ? nameArg.slice(7) : undefined;

const content = readFileSync(file, "utf8");
const split = extractGraphicalBody(content);
if (!split) {
	console.error("could not split file: no <body> found");
	exit(2);
}
const m = content.match(/^\s*(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+(\w+)/m);
const name = overrideName ?? (m ? m[2] : "FBD");

// Current bridge state — fetch versions for expectedProjectVersion / ifVersion.
const fetchResp = await fetch(`http://127.0.0.1:${port}/fetch`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ knownItems: {} }),
});
if (!fetchResp.ok) {
	console.error("fetch failed:", fetchResp.status, await fetchResp.text());
	exit(3);
}
const fetchJson = await fetchResp.json();
const expectedProjectVersion = fetchJson.projectVersion;
const currentVersion = fetchJson.items[name];

const op = {
	op: "pushItem",
	name,
	sourceText: split.declarationText,
	implementationXml: split.bodyXml,
	ifVersion: currentVersion ?? null,
};

console.log(`Pushing to bridge :${port}  name=${name}  current=${currentVersion ?? "<new>"}`);
console.log(`  declarationText: ${split.declarationText.length} bytes`);
console.log(`  implementationXml: ${split.bodyXml.length} bytes`);

// Pass expectedProjectVersion so a real concurrent edit in the IDE
// would cause the push to fail-safe. (TC bridge: fixed 2026-05-31 so
// fetch & push compute the same projectVersion — they now hash the
// same item set; previously push omitted config items, causing
// phantom drift on every push.)
const pushResp = await fetch(`http://127.0.0.1:${port}/push`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ expectedProjectVersion, ops: [op] }),
});
const text = await pushResp.text();
console.log(`Status: ${pushResp.status}`);
console.log(text);
