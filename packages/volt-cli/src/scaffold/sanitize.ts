const FALLBACK = "plc-workspace"

export function toPackageName(plcProjectName: string): string {
	const sanitized = plcProjectName
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "")
	return sanitized.length > 0 ? sanitized : FALLBACK
}
