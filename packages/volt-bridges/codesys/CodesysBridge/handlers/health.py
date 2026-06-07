"""
GET /health — bridge liveness + cached IDE state.

PURE CACHE READ. Never invokes COM, never blocks behind /refs/fetch/push
on the single CODESYS UI thread. Returns whatever the connection's
IDE-state cache holds and triggers a background async probe when the
cache is stale (stale-while-revalidate).

Why decoupled: previously this handler called `ui_thread.invoke_on_ui`
three times (probe_ide_alive, get_project_name, get_project_dirty). All
three serialized behind any in-flight /refs walk because CODESYS COM is
STA — single thread. The client's 2s /health timeout then fired during
the COM-thread recovery window after a long /refs walk and spuriously
flipped the extension's connection state to "unreachable", clobbering
a clean post-pull tree state. Decoupling /health from COM eliminates
the race entirely.

Wire shape mirrors HealthResponse in
`packages/volt-agent/src/bridge/types.ts` — zod-validated with
`.strict()` on the agent side, so any new field this handler emits
without a matching schema entry surfaces as a loud MALFORMED_RESPONSE.
"""
# pyright: reportMissingImports=false


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

# Cache age threshold (ms) above which /health schedules a background
# probe to refresh IDE state. 5s strikes a balance: with the client
# polling /health every 30s while the SCM view is visible, the cache
# refreshes once per heartbeat — fresh enough for UI badges to track
# project renames promptly, infrequent enough that the COM thread isn't
# constantly being woken up.
_STALE_THRESHOLD_MS = 5000


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
	"""Build a HealthResponse dict from the cached IDE state. Safe to
	call from the HTTP thread; does no UI-thread work."""
	cache = connection.get_cache_snapshot()

	# Stale-while-revalidate: trigger a background COM probe when the
	# cache is empty or aging out. The probe updates the cache for the
	# NEXT /health call; the current response uses what we already have.
	age_ms = cache["age_ms"]
	if age_ms is None or age_ms > _STALE_THRESHOLD_MS:
		connection.trigger_async_probe()

	ide_alive = cache["ide_alive"]
	project_name = cache["project_name"]
	plc_project_name = cache["plc_project_name"]
	project_dirty = cache["project_dirty"]

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
