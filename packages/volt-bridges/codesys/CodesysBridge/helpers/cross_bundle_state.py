"""
Cross-bundle-exec persistent state for CODESYS Scripting Engine.

THE handoff channel that makes "re-run the script without restarting
CODESYS" work reliably. Diagnosed empirically — see README's
"CODESYS gotchas" section for the full backstory. Short version:

  * Each Execute Script File run creates a FRESH module namespace,
    so any module-level globals (_server_singleton etc.) reset to
    their initial values every run.
  * CODESYS does NOT share `sys` attributes across runs either,
    despite IronPython docs implying it does.
  * `System.AppDomain.CurrentDomain` IS process-wide and survives
    every Execute Script File invocation for the CODESYS lifetime.

So we stash the live HTTPServer reference on AppDomain via
SetData/GetData. The new bundle's startup reads it back and calls
server.shutdown() + server.server_close() + raw_socket.close() on
the prior bridge directly — no racy HTTP probe, no port-bind
gymnastics, no Task Manager required.

Fallback: when running outside .NET (CPython tests), uses a module
global. Single-process, no persistence problem to solve.
"""
# pyright: reportMissingImports=false

# AppDomain key — namespaced so we don't collide with any other
# Volt component that might one day also persist on AppDomain.
_KEY = "VoltCodesysBridge_State"

# CPython fallback storage. Unused under IronPython.
_fallback_state = None


def _store():
	"""Return the shared state dict, creating it if absent. Always
	the SAME dict across calls within one CODESYS process."""
	try:
		from System import AppDomain  # type: ignore[import-not-found]
		domain = AppDomain.CurrentDomain
		state = domain.GetData(_KEY)
		if state is None:
			state = {"server": None, "thread": None, "build_id": None}
			domain.SetData(_KEY, state)
		return state
	except Exception:
		global _fallback_state
		if _fallback_state is None:
			_fallback_state = {"server": None, "thread": None, "build_id": None}
		return _fallback_state


# ─── Public API ──────────────────────────────────────────────────────


def get_active_bridge():
	# type: () -> dict
	"""Return the live registration dict. Keys: server, thread, build_id.
	Each value is None if no prior bridge has registered."""
	return _store()


def register_bridge(server, thread, build_id):
	# type: (object, object, str) -> None
	"""Record this bridge in the shared store so future bundle execs
	can find and shut it down. Call AFTER a successful bind."""
	s = _store()
	s["server"] = server
	s["thread"] = thread
	s["build_id"] = build_id


def clear():
	# type: () -> None
	"""Wipe the registration. Call after cleanly shutting down the
	previous bridge so the next probe sees a clean slate."""
	s = _store()
	s["server"] = None
	s["thread"] = None
	s["build_id"] = None


def backing_description():
	# type: () -> str
	"""For diagnostic endpoints — tells the user which storage backed
	the state (so they can spot when AppDomain isn't available)."""
	try:
		from System import AppDomain  # type: ignore[import-not-found]  # noqa: F401
		return "AppDomain.GetData({0!r})".format(_KEY)
	except Exception:
		return "fallback-dict (no .NET)"
