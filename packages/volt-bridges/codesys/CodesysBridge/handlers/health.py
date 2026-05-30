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


def handle(connection, bridge_version):
	# type: (object, str) -> dict
	"""Build a HealthResponse dict. Safe to call from the HTTP thread
	directly — the inner project-name access is the only UI-touching
	bit and degrades silently when the UI is unavailable."""
	# Try to read project info via UI; if UI is unavailable, mark as
	# degraded but still return /health (the whole point of /health is
	# that it works even when the bridge is in trouble).
	project_name = None
	plc_project_name = None
	if connection.is_connected:
		try:
			project_name = ui_thread.invoke_on_ui(connection.get_project_name)
			plc_project_name = project_name
			connection.clear_degraded()
		except ui_thread.UiThreadUnavailable as e:
			connection.mark_degraded(str(e))
		except Exception as e:
			connection.mark_degraded("project read failed: {0}".format(e))

	if not connection.is_connected:
		status = "unavailable"
	elif connection.is_degraded:
		status = "degraded"
	else:
		status = "healthy"

	return {
		"status": status,
		"platform": "codesys",
		"connected": bool(connection.is_connected),
		"ideAlive": bool(connection.is_connected),
		"degraded": bool(connection.is_degraded),
		"degradedReason": connection.degraded_reason,
		"ideName": connection.ide_name,
		"ideVersion": connection.ide_version,
		"version": bridge_version,
		"projectName": project_name,
		"plcProjectName": plc_project_name,
		"projectDirty": False,
	}
