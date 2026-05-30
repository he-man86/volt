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
		diagnostics = list(_collect_diagnostics())
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


def _collect_diagnostics():
	# type: () -> list
	"""Yield BridgeDiagnostic-shaped dicts from the CODESYS message
	store. Feature-detects SP18 (single get_message_objects()) vs SP21+
	(per-category enumeration)."""
	out = []
	if system is None:
		return out
	# Try SP18 path first (no category arg).
	try:
		msgs = list(system.get_message_objects())
		for m in msgs:
			out.append(_normalize_message(m))
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
					out.append(_normalize_message(m))
			except Exception:
				continue
	except Exception:
		pass
	return out


def _normalize_message(msg):
	# type: (object) -> dict
	"""Convert a CODESYS message-object to the canonical BridgeDiagnostic
	shape. Tolerant of missing attributes per CODESYS version."""
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

	obj_name = _resolve_object_name(msg)
	return {
		"severity": severity,
		"message": text,
		"line": line,
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


def _resolve_object_name(msg):
	# type: (object) -> object
	"""Walk position_object / object / source_object trying to recover
	a qualified name like 'ParentPOU.ChildName'."""
	for attr in ("position_object", "object", "source_object"):
		obj = getattr(msg, attr, None)
		if obj is None:
			continue
		try:
			name = obj.get_name() if hasattr(obj, "get_name") else None
		except Exception:
			name = None
		if not name:
			continue
		# Walk up one parent for "Parent.Child" qualification — CODESYS
		# uses this for method/property diagnostics.
		try:
			parent = getattr(obj, "parent", None)
			if parent is not None and hasattr(parent, "get_name"):
				try:
					pname = parent.get_name()
				except Exception:
					pname = None
				if pname and pname != name:
					return "{0}.{1}".format(pname, name)
		except Exception:
			pass
		return name
	return None
