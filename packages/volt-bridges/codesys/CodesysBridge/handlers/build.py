"""
POST /build — trigger a CODESYS compile and return canonical diagnostics.

Mirrors `packages/volt-bridges/beckhoff/BeckhoffBridge/Handlers/BuildHandler.cs`.

Wire shape mirrors BuildResponse in
`packages/volt-agent/src/bridge/types.ts`:
  { success: bool, duration: ms, diagnostics: BridgeDiagnostic[] }

Each diagnostic carries:
  { severity, message, line, object, section }

CODESYS message-API quirks (from PLCAssist prior art):
  - SP18: `system.get_message_objects()` works without args
  - SP21+: `system.get_message_objects(category)` requires per-category
    enumeration via `system.get_message_categories()`
  Feature-detected at first call.
"""
# pyright: reportMissingImports=false
import re
import time

from .. import codesys_connection as _conn_mod
from .. import ui_thread

try:
	from scriptengine import system  # type: ignore[import-not-found]
except ImportError:
	system = None


_POSITION_RE = re.compile(r"Line\s+(\d+)\s*\(?(\w+)?\)?", re.IGNORECASE)

# When the user has CODESYS's IronPython script tracer enabled
# (Tools > Options > Scripting > Trace Lines / Trace Function), each
# executed line is logged to the same message store the build handler
# reads from. Filter them out — they have a distinctive prefix
# `<filename>.py(<line>):` or `<filename>.py(<line> in <fn>@<line>):`.
# Without this filter, /build returns 5000+ "info" diagnostics per
# script execution and the response becomes unusable.
_TRACER_RE = re.compile(r"^[\w_-]+\.py\(\d+(?:\s+in\s+[\w_]+@\d+)?\):")

# CODESYS also captures stdout writes (our own log lines!) into the
# message store. Our log lines have a fixed prefix:
# `[HH:MM:SS] CATEGORY  message...` where CATEGORY is one of STARTUP /
# IDE / HTTP / WARN / ERROR (constant-width 7 chars). Filter those —
# they're our diagnostic output, not the user's build output.
_OWN_LOG_RE = re.compile(r"^\[\d{2}:\d{2}:\d{2}\]\s+(STARTUP|IDE|HTTP|WARN|ERROR)\s")


def handle(connection, body):
	# type: (object, dict) -> dict
	if not connection.is_connected:
		raise RuntimeError("CODESYS Scripting Engine not available")
	build_type = (body.get("buildType") if isinstance(body, dict) else None) or "incremental"

	def _do():
		t0 = time.time()
		app = connection.get_application()
		if app is None:
			return False, 0, []
		# Clear stale messages if API supports it.
		try:
			if hasattr(system, "clear_messages"):
				system.clear_messages()
		except Exception:
			pass

		try:
			if build_type == "full" and hasattr(app, "rebuild"):
				app.rebuild()
			else:
				app.build()
			success_flag = True
		except Exception:
			success_flag = False

		duration_ms = int((time.time() - t0) * 1000)
		diagnostics = list(_collect_diagnostics(app))
		# success is "no errors" — message presence overrides the
		# build() try/except since CODESYS may swallow the exception
		# and surface errors through the message store instead.
		has_error = any(d["severity"] == "error" for d in diagnostics)
		return (not has_error) and success_flag, duration_ms, diagnostics

	success, duration, diagnostics = ui_thread.invoke_on_ui(_do)
	return {
		"success": bool(success),
		"duration": int(duration),
		"diagnostics": diagnostics,
	}


def _collect_diagnostics(app):
	# type: (object) -> list
	"""Yield BridgeDiagnostic-shaped dicts from the CODESYS message
	store. Feature-detects SP18 (single get_message_objects()) vs SP21+
	(per-category enumeration). Tracer output filtered. `app` is the active
	application — used to exclude the container from object names."""
	out = []
	if system is None:
		return out
	# Try SP18 path first (no category arg).
	try:
		msgs = list(system.get_message_objects())
		for m in msgs:
			d = _normalize_message(m, app)
			if not _is_tracer_noise(d):
				out.append(d)
		return out
	except TypeError:
		# SP21+ requires category — fall through.
		pass
	except Exception:
		return out
	# SP21+ path
	try:
		for cat in system.get_message_categories():
			try:
				for m in system.get_message_objects(cat):
					d = _normalize_message(m, app)
					if not _is_tracer_noise(d):
						out.append(d)
			except Exception:
				continue
	except Exception:
		pass
	return out


def _is_tracer_noise(diag):
	# type: (dict) -> bool
	"""True for non-build noise that leaks into the message store:
	IronPython script-tracer entries (when tracing is enabled) AND
	our own bridge log lines (CODESYS captures script stdout)."""
	msg = diag.get("message") or ""
	return _TRACER_RE.match(msg) is not None or _OWN_LOG_RE.match(msg) is not None


def _normalize_message(msg, app):
	# type: (object, object) -> dict
	"""Convert a CODESYS message-object to the canonical BridgeDiagnostic
	shape — TwinCAT-compatible: a bare / FB-qualified `object` (the
	`Application` container is NOT part of the name) and a COMBINED decl+impl
	`line`. Tolerant of missing attributes per CODESYS version."""
	severity = _normalize_severity(getattr(msg, "severity", None))
	text = ""
	try:
		text = msg.text or ""
	except Exception:
		text = ""
	position_text = ""
	try:
		position_text = getattr(msg, "position_text", "") or ""
	except Exception:
		pass
	line = 0
	section = None
	m = _POSITION_RE.search(position_text)
	if m:
		try:
			line = int(m.group(1))
		except Exception:
			line = 0
		section_word = (m.group(2) or "").lower()
		if section_word.startswith("decl"):
			section = "decl"
		elif section_word.startswith("impl"):
			section = "impl"

	leaf = _source_object(msg)
	obj_name = _qualified_name(leaf, app)

	# CODESYS reports lines RELATIVE TO THE SECTION (decl-relative, or
	# impl-relative with the section word omitted). TwinCAT — our canonical —
	# reports the COMBINED decl+impl line. Convert impl lines by adding the
	# object's declaration length so both bridges agree and one mapper serves
	# both. Decl lines (and any we can't measure) pass through unchanged.
	combined_line = line
	if line > 0 and section != "decl":
		dcount = _decl_line_count(leaf)
		# Property accessors (`FB.Prop.Get`/`.Set`) always carry at least a
		# 2-line VAR block in the canonical (TwinCAT) model, even when empty —
		# so a var-less accessor's empty declaration (1 line) must count as 2.
		if _is_accessor(obj_name) and (dcount is None or dcount < 2):
			dcount = 2
		if dcount is not None:
			combined_line = dcount + line

	return {
		"severity": severity,
		"message": text,
		"line": combined_line,
		"object": obj_name,
		"section": section,
	}


def _normalize_severity(raw):
	# type: (object) -> str
	if raw is None:
		return "info"
	s = str(raw).lower()
	if "error" in s:
		return "error"
	if "warn" in s:
		return "warning"
	return "info"


def _source_object(msg):
	# type: (object) -> object
	"""The CODESYS object a diagnostic is attached to, if any."""
	for attr in ("position_object", "object", "source_object"):
		obj = getattr(msg, attr, None)
		if obj is not None and hasattr(obj, "get_name"):
			return obj
	return None


def _qualified_name(leaf, app):
	# type: (object, object) -> object
	"""Bare / FB-qualified name (`FB`, `FB.Method`, `FB.Prop.Get`) — walk the
	object up to but NOT including the application container. The application
	is project STRUCTURE (and user-renamable), not part of the item identity;
	leaking it into the object name broke the conformance recorder's per-test
	attribution and is inconsistent with /refs (which names items bare)."""
	if leaf is None:
		return None
	app_guid = _safe_guid(app)
	app_name = _safe_name(app)
	names = []
	cur = leaf
	for _ in range(20):  # guard against cycles
		if cur is None:
			break
		if _is_application(cur, app_guid, app_name):
			break
		nm = _safe_name(cur)
		if not nm:
			break
		names.append(nm)
		cur = _safe_parent(cur)
	if not names:
		return None
	names.reverse()
	return ".".join(names)


def _is_application(obj, app_guid, app_name):
	# type: (object, object, object) -> bool
	"""True if `obj` is the application container (matched by guid, falling
	back to the live app name so a renamed application still matches)."""
	g = _safe_guid(obj)
	if app_guid is not None and g is not None and str(g) == str(app_guid):
		return True
	n = _safe_name(obj)
	if app_name is not None and n is not None and n == app_name:
		return True
	return False


def _is_accessor(obj_name):
	# type: (object) -> bool
	"""True when the qualified name is a property accessor (`...Get`/`...Set`)."""
	if not obj_name:
		return False
	low = obj_name.lower()
	return low.endswith(".get") or low.endswith(".set")


def _decl_line_count(obj):
	# type: (object) -> object
	"""Number of lines in an object's textual declaration, or None when it
	has none / can't be read."""
	if obj is None:
		return None
	try:
		decl = getattr(obj, "textual_declaration", None)
		if decl is None:
			return None
		txt = getattr(decl, "text", None)
		if txt is None:
			txt = str(decl)
		return txt.count("\n") + 1
	except Exception:
		return None


def _safe_name(obj):
	# type: (object) -> object
	try:
		return obj.get_name() if hasattr(obj, "get_name") else None
	except Exception:
		return None


def _safe_parent(obj):
	# type: (object) -> object
	try:
		return getattr(obj, "parent", None)
	except Exception:
		return None


def _safe_guid(obj):
	# type: (object) -> object
	try:
		return getattr(obj, "guid", None)
	except Exception:
		return None
