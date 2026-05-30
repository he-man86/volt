"""
CODESYS IDE COM is STA — every CODESYS Scripting API call MUST run on
the IDE's UI thread. The HTTP server runs on a background daemon
thread, so handlers MUST marshal each CODESYS-touching call through
`invoke_on_ui(fn)`.

Direct call from the HTTP thread access-violates the IDE process: the
user sees CODESYS disappear with no error message. The earliest
versions of the predecessor bridge cached `Application.OpenForms[0]`
ONCE at script load — that broke when:
  - Bridge launched before CODESYS's main window finished init
    (OpenForms empty → cached None → every call ran on the HTTP thread)
  - OpenForms[0] was a transient tooltip / dialog that later disposed

Current design (re-implemented fresh here for the CODESYS bridge):
  - Re-scan `Application.OpenForms` on EVERY dispatch; pick the
    largest visible form by area (CODESYS main window dwarfs dialogs).
  - REFUSE any direct-call fallback. If no usable form exists, raise
    `UiThreadUnavailable` → handler returns 503. Refusing the request
    is strictly better than crashing the IDE.
  - `BeginInvoke + WaitOne(30_000)` protects against modal-dialog
    deadlock; a single modal dialog would otherwise wedge the bridge
    until the user clicked it away.

Outside CODESYS (CPython 3 unit tests), invoke_on_ui calls fn
directly — there's no UI to marshal to and the caller code is the
same shape.
"""
# pyright: reportMissingImports=false
from . import log

INVOKE_TIMEOUT_MS = 30_000

_cached_form = None  # type: object
_winforms_available = False
_Application = None
_Action = None

try:
	# IronPython inside CODESYS.
	import clr  # type: ignore[import-not-found]
	clr.AddReference("System.Windows.Forms")
	from System.Windows.Forms import Application as _Application  # type: ignore[import-not-found,no-redef]
	from System import Action as _Action  # type: ignore[import-not-found,no-redef]
	_winforms_available = True
except Exception:
	# CPython 3 (unit tests) — winforms not present; invoke_on_ui
	# becomes a pass-through call.
	pass


class UiThreadUnavailable(Exception):
	"""The CODESYS UI thread cannot service this request right now.

	Raised when no usable Form can be found in Application.OpenForms,
	or when a dispatched call exceeds the UI-thread wait timeout.
	The HTTP handler converts this into a 503 PLC_UI_UNAVAILABLE so
	the user sees a clear "bridge cannot reach CODESYS" message
	instead of a crashed IDE.
	"""
	pass


def invoke_on_ui(fn):
	# type: (callable) -> object
	"""Run fn on the CODESYS UI thread and return its result. Outside
	CODESYS (no winforms), runs fn directly."""
	if not _winforms_available:
		return fn()

	form = _resolve_ui_form()
	if form is None:
		raise UiThreadUnavailable("No CODESYS UI form available — IDE may still be initializing")

	# Capture result + exception across the thread boundary.
	holder = {"result": None, "error": None}

	def _wrapper():
		try:
			holder["result"] = fn()
		except Exception as e:
			holder["error"] = e

	try:
		async_result = form.BeginInvoke(_Action(_wrapper))
		completed = async_result.AsyncWaitHandle.WaitOne(INVOKE_TIMEOUT_MS)
		if not completed:
			raise UiThreadUnavailable(
				"UI-thread dispatch exceeded {0}ms — modal dialog or wedged IDE".format(INVOKE_TIMEOUT_MS)
			)
		form.EndInvoke(async_result)
	except UiThreadUnavailable:
		raise
	except Exception as e:
		# BeginInvoke can throw if the form's handle is destroyed
		# between resolve and invoke. Surface as UiThreadUnavailable
		# so the HTTP handler returns 503, not 500.
		log.warn("[UI] BeginInvoke failed: {0}".format(e))
		raise UiThreadUnavailable("BeginInvoke failed: {0}".format(e))

	if holder["error"] is not None:
		# Re-raise the inner exception so the HTTP handler sees the
		# real cause, not a UiThreadUnavailable.
		raise holder["error"]
	return holder["result"]


def _resolve_ui_form():
	# type: () -> object
	"""Find a usable CODESYS Form to marshal onto. Re-validates on
	every dispatch so a disposed cached form is replaced, not
	permanently degrading the bridge."""
	global _cached_form
	if not _winforms_available:
		return None

	# Fast path: cached form still alive and handle-created.
	if _cached_form is not None:
		try:
			if not _cached_form.IsDisposed and _cached_form.IsHandleCreated:
				return _cached_form
		except Exception:
			pass
		_cached_form = None

	# Slow path: scan OpenForms, pick the largest visible form.
	try:
		candidates = []
		for f in _Application.OpenForms:
			try:
				if f.IsDisposed:
					continue
				if not f.IsHandleCreated:
					continue
				area = int(f.Width) * int(f.Height)
				candidates.append((area, f))
			except Exception:
				continue
		if not candidates:
			return None
		candidates.sort(key=lambda p: p[0], reverse=True)
		_cached_form = candidates[0][1]
		return _cached_form
	except Exception as e:
		log.warn("[UI] _resolve_ui_form scan failed: {0}".format(e))
		return None
