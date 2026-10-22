/**
 * THE CONTRACT AS DATA — `docs/volt-bridge.openrpc.json`, read the way a foreign client reads it (openspec
 * `volt-cli-rework` 1.3). The contract suite (`test/e2e/contract/`) builds its requests from this document, not from our
 * CLI's DTOs, and checks every answer against it, so a rule that holds only because our CLI is polite shows up.
 *
 * <p>Pure: no pipe, no IDE. The validator implements exactly the JSON-Schema the generated document uses (`type`,
 * `properties`, `required`, `additionalProperties`, `items`, `$ref`, `enum`, `const`, `oneOf`) and REFUSES any other
 * keyword, so a new schema construct cannot be silently skipped. Tested offline in `test/unit/openrpc.test.ts`.</p>
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

export type Schema = {
	type?: "object" | "array" | "string" | "integer" | "number" | "boolean"
	properties?: Record<string, Schema>
	required?: string[]
	additionalProperties?: boolean | Schema
	items?: Schema
	$ref?: string
	enum?: unknown[]
	const?: unknown
	oneOf?: Schema[]
	description?: string
}
export type Method = {
	name: string
	params: { name: string; required?: boolean; schema: Schema }[]
	result: { name: string; schema: Schema }
	"x-errorCodes"?: string[]
	"x-outcomes"?: string[]
}
export type OpenRpc = { info: { version: string }; methods: Method[]; components: { schemas: Record<string, Schema> } }

export const OPENRPC_PATH = join(import.meta.dir, "..", "..", "..", "docs", "volt-bridge.openrpc.json")

export function loadOpenRpc(path = OPENRPC_PATH): OpenRpc {
	return JSON.parse(readFileSync(path, "utf8")) as OpenRpc
}

const KNOWN = new Set(["type", "properties", "required", "additionalProperties", "items", "$ref", "enum", "const", "oneOf", "description"])

export function resolve(doc: OpenRpc, s: Schema): Schema {
	if (!s.$ref) return s
	const m = /^#\/components\/schemas\/(\w+)$/.exec(s.$ref)
	if (!m || !doc.components.schemas[m[1]]) throw new Error(`unresolvable $ref ${s.$ref}`)
	return doc.components.schemas[m[1]]
}

/**
 * Every way `value` breaks `schema`, as `<json-path>: <why>` lines; empty when it conforms. `strict` also refuses a
 * member the schema does not name where the schema leaves `additionalProperties` open: the document says it lists
 * "every type that travels on the wire", so an answer member it does not name is a contract drift, not an extension.
 */
export function validate(doc: OpenRpc, schema: Schema, value: unknown, opts: { strict?: boolean } = {}, at = "$"): string[] {
	const s = resolve(doc, schema)
	for (const k of Object.keys(s)) if (!KNOWN.has(k)) throw new Error(`${at}: the validator does not implement schema keyword '${k}'`)
	const errors: string[] = []
	if (s.const !== undefined && value !== s.const) errors.push(`${at}: is ${JSON.stringify(value)}, the schema's const is ${JSON.stringify(s.const)}`)
	if (s.enum && !s.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(s.enum)}`)
	if (s.type && !hasType(value, s.type)) {
		errors.push(`${at}: is ${describe(value)}, the schema says ${s.type}`)
		return errors
	}
	if (s.oneOf) {
		const matching = s.oneOf.filter((o) => validate(doc, o, value, opts, at).length === 0)
		if (matching.length !== 1) errors.push(`${at}: matches ${matching.length} of the oneOf alternatives, not exactly one`)
	}
	if (isObject(value) && (s.type === "object" || s.properties)) {
		for (const r of s.required ?? []) if (!(r in value)) errors.push(`${at}: lacks the required member '${r}'`)
		for (const [k, v] of Object.entries(value)) {
			const p = s.properties?.[k]
			if (p) errors.push(...validate(doc, p, v, opts, `${at}.${k}`))
			else if (typeof s.additionalProperties === "object") errors.push(...validate(doc, s.additionalProperties, v, opts, `${at}[${JSON.stringify(k)}]`))
			else if (s.additionalProperties === false || (opts.strict && !s.oneOf && s.properties))
				errors.push(`${at}: has the member '${k}' the schema does not name`)
		}
	}
	if (Array.isArray(value) && s.items) value.forEach((v, i) => errors.push(...validate(doc, s.items!, v, opts, `${at}[${i}]`)))
	return errors
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v)
}

function hasType(v: unknown, t: NonNullable<Schema["type"]>): boolean {
	switch (t) {
		case "object": return isObject(v)
		case "array": return Array.isArray(v)
		case "string": return typeof v === "string"
		case "boolean": return typeof v === "boolean"
		case "number": return typeof v === "number" && Number.isFinite(v)
		case "integer": return typeof v === "number" && Number.isInteger(v)
	}
}

function describe(v: unknown): string {
	return v === null ? "null" : Array.isArray(v) ? "an array" : typeof v
}

export function method(doc: OpenRpc, name: string): Method {
	const m = doc.methods.find((x) => x.name === name)
	if (!m) throw new Error(`the OpenRPC document has no method '${name}'`)
	return m
}

/** The request body schema of a method, resolved — undefined for a method that takes no params (`health`, `disconnect`). */
export function bodySchema(doc: OpenRpc, m: Method): Schema | undefined {
	const p = m.params.find((x) => x.name === "body")
	return p ? resolve(doc, p.schema) : undefined
}

/** A value of the schema's type that conforms (for a member whose CONTENT the case does not care about). */
export function sample(doc: OpenRpc, schema: Schema): unknown {
	const s = resolve(doc, schema)
	if (s.const !== undefined) return s.const
	if (s.enum) return s.enum[0]
	switch (s.type) {
		case "object": return {}
		case "array": return []
		case "string": return "x"
		case "boolean": return false
		case "integer": return 1
		case "number": return 1
	}
	return null
}

/** A value of ANOTHER JSON type than the schema's: what a client gets wrong first. */
export function wrongType(doc: OpenRpc, schema: Schema): unknown {
	switch (resolve(doc, schema).type) {
		case "object": return []
		case "array": return "x"
		case "string": return 7
		case "boolean": return "yes"
		case "integer": return "1"
		case "number": return "1"
	}
	return {}
}

/** `name` with the case of its first letter flipped — `knownItems` → `KnownItems`: the same member, another case. */
export function otherCase(name: string): string {
	const c = name[0]
	const flipped = c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()
	return flipped + name.slice(1)
}

/** The object with its members in reverse order — the same JSON object to every reader that treats it as one. */
export function reversed<T extends Record<string, unknown>>(o: T): T {
	return Object.fromEntries(Object.entries(o).reverse()) as T
}
