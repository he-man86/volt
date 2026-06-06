"""
GET /health — bridge liveness + the stable identifiers `volt init`
binds a workspace to.

Wire shape mirrors HealthResponse in
`packages/volt-agent/src/bridge/types.ts` — zod-validated with
`.strict()` on the agent side, so any new field this handler
emits without a matching schema entry surfaces as a loud
MALFORMED_RESPONSE.
"""
# pyright: reportMissingImports=false
from .. import ui_thread


# Map OEM-rebranded CODESYS product names → variant slug. The
# bridge auto-detects via Process.MainModule.FileVersionInfo
# (see codesys_connection._IDE_NAME). Vanilla CODESYS returns
# "CODESYS" → null variant. Future library-docs lookup uses this
# to load the right library catalog (Lenze ships LMC/L-force libs,
# Schneider ships EcoStruxure libs, etc.). LSP doesn't consume it.
_OEM_VARIANTS = (
	("lenze",       ("lenze", "plc designer")),
	("schneider",   ("schneider", "ecostruxure", "machine expert", "som machine")),
	("wago",        ("wago", "e!cockpit", "ecockpit")),
	("abb",         ("abb", "automation builder")),
	("eaton",       ("eaton", "xsoft")),
	("bachmann",    ("bachmann",)),
	("festo",       ("festo",)),
	("phoenix",     ("phoenix contact", "phoenixcontact", "ple")),
	("ifm",         ("ifm",)),
	("kw_software", ("kw-software", "multiprog")),
)


def _derive_platform_variant(ide_name):
	# type: (object) -> object
	"""Return the OEM-variant slug (lenze / schneider / wago / ...) or
	None for vanilla CODESYS. Case-insensitive substring match on the
	IDE's product name."""
	if not ide_name:
		return None
	low = str(ide_name).lower()
	# "CODESYS" matches almost everything — only emit variant when a
	# more specific brand token appears alongside.
	for slug, tokens in _OEM_VARIANTS:
		for tok in tokens:
			if tok in low:
				return slug
	return None  # vanilla CODESYS


def handle(connection, bridge_version):
	# type: (object, str) -> dict
	"""Build a HealthResponse dict. Safe to call from the HTTP thread
	directly — UI work is invoked through ui_thread.invoke_on_ui and
	degrades silently when the UI is unavailable.

	`connected` / `ideAlive` reflect the SAME active probe the request
	gate uses (`probe_ide_alive`), not the import-time scriptengine
	flag. That way `/health` and the gate agree: if /health says
	connected=true, /refs will let you through; if false, both fail
	for the same reason."""
	project_name = None
	plc_project_name = None
	project_dirty = None
	ide_alive = False
	if connection.is_connected:
		try:
			# Active probe — same one the request gate uses. If a project
			# is loaded, this is also the cheapest moment to grab its
			# name for the response payload (one UI roundtrip).
			ide_alive = ui_thread.invoke_on_ui(connection.probe_ide_alive)
			if ide_alive:
				project_name = ui_thread.invoke_on_ui(connection.get_project_name)
				plc_project_name = project_name
				project_dirty = ui_thread.invoke_on_ui(connection.get_project_dirty)
				connection.clear_degraded()
		except ui_thread.UiThreadUnavailable as e:
			connection.mark_degraded(str(e))
		except Exception as e:
			connection.mark_degraded("project read failed: {0}".format(e))

	if not connection.is_connected or not ide_alive:
		status = "unavailable"
	elif connection.is_degraded:
		status = "degraded"
	else:
		status = "healthy"

	response = {
		"status": status,
		"platform": "codesys",
		"platformVariant": _derive_platform_variant(connection.ide_name),
		"connected": bool(ide_alive),
		"ideAlive": bool(ide_alive),
		"degraded": bool(connection.is_degraded),
		"degradedReason": connection.degraded_reason,
		"ideName": connection.ide_name,
		"ideVersion": connection.ide_version,
		"version": bridge_version,
		"projectName": project_name,
		"plcProjectName": plc_project_name,
	}
	# `projectDirty` only included when the SP actually exposes it.
	# The agent's schema marks it `.optional()`, so absence is the
	# correct "unknown" signal — preferable to a faked false that a
	# downstream consumer might trust as "engineer has saved everything".
	if project_dirty is not None:
		response["projectDirty"] = bool(project_dirty)
	return response
