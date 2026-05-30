"""
POST /fetch — return only items whose version differs from (or is
absent from) the client's known map. Each returned item carries the
assembled `sourceText` (StAssembler output) — the agent drops it
straight into the workspace.

Wire shape mirrors FetchResponse in
`packages/volt-agent/src/bridge/types.ts`. The per-item shape
matches FetchedItem: { name, kind, folder?, sourceText, language?,
version }.

Mirrors `packages/volt-bridges/beckhoff/BeckhoffBridge/Handlers/FetchHandler.cs`.
"""
# pyright: reportMissingImports=false
from .. import codesys_connection as _conn_mod
from .. import ui_thread
from ..helpers import block_type_mapper, st_assembler


def handle(connection, body):
	# type: (object, dict) -> dict
	if not connection.is_connected:
		raise RuntimeError("CODESYS Scripting Engine not available")

	known_items = {}
	raw_known = body.get("knownItems") if isinstance(body, dict) else None
	if isinstance(raw_known, dict):
		for k, v in raw_known.items():
			if isinstance(v, str):
				known_items[k] = v

	def _do():
		versions = {}
		changed = []
		for (name, kind, item) in connection.iter_top_level():
			try:
				ver = _conn_mod.CodesysConnection.compute_item_version(item)
			except Exception:
				continue
			versions[name] = ver
			if known_items.get(name) == ver:
				continue
			# Build the per-item result and assemble into sourceText.
			try:
				result = _build_get_result(name, kind, item)
				source_text = st_assembler.assemble(result)
			except Exception:
				# Skip bad items — they'll show up in `removed` if they
				# genuinely disappear next round.
				continue
			slim = {
				"name": name,
				"kind": kind,
				"sourceText": source_text,
				"version": ver,
			}
			if result.get("folder"):
				slim["folder"] = result["folder"]
			if result.get("language"):
				slim["language"] = result["language"]
			changed.append(slim)
		return versions, changed

	versions, changed = ui_thread.invoke_on_ui(_do)
	removed = [name for name in known_items.keys() if name not in versions]

	return {
		"projectVersion": _conn_mod.CodesysConnection.compute_project_version(versions),
		"structureVersion": _conn_mod.CodesysConnection.compute_structure_version(versions),
		"changed": changed,
		"removed": removed,
		"items": versions,
	}


def _build_get_result(name, kind, item):
	# type: (str, str, object) -> dict
	"""Build the dict shape st_assembler.assemble expects — equivalent
	to GetHandler.BuildResult in the C# bridge. Pulls declaration +
	implementation + children from the CODESYS item."""
	result = {
		"name": name,
		"kind": kind,
		"declaration": _safe_text(getattr(item, "textual_declaration", None)),
		"implementation": _safe_text(getattr(item, "textual_implementation", None)),
		"children": [],
		"folder": None,
		"language": "ST",
	}
	# Composite POU children
	if kind in ("function_block", "function", "program", "interface"):
		try:
			for child in item.get_children(recursive=False):
				try:
					marker = str(child)
				except Exception:
					continue
				if block_type_mapper.MARKER_TEXTUAL_DECL not in marker:
					continue
				cdecl = _safe_text(getattr(child, "textual_declaration", None))
				cimpl = _safe_text(getattr(child, "textual_implementation", None))
				child_kind = _classify_child(cdecl)
				if child_kind == block_type_mapper.KIND_UNKNOWN:
					continue
				try:
					cname = child.get_name() if hasattr(child, "get_name") else ""
				except Exception:
					cname = ""
				if not cname:
					continue
				child_entry = {
					"kind": child_kind,
					"name": cname,
					"declaration": cdecl,
					"implementation": cimpl,
				}
				# Property accessors live as nested children — collect
				# GET / SET from the property's own children.
				if child_kind == "property":
					_collect_property_accessors(child, child_entry)
				result["children"].append(child_entry)
		except Exception:
			pass
	return result


def _classify_child(decl_text):
	# type: (str) -> str
	"""Pick child kind (method/action/property) from declaration. Falls
	back to KIND_UNKNOWN on any other shape."""
	stripped = block_type_mapper.strip_leading_trivia(decl_text)
	upper = stripped.lstrip()[:9].upper()
	if upper.startswith("METHOD"):
		return block_type_mapper.KIND_METHOD
	if upper.startswith("ACTION"):
		return block_type_mapper.KIND_ACTION
	if upper.startswith("PROPERTY"):
		return block_type_mapper.KIND_PROPERTY
	return block_type_mapper.KIND_UNKNOWN


def _collect_property_accessors(property_item, child_entry):
	# type: (object, dict) -> None
	try:
		for acc in property_item.get_children(recursive=False):
			try:
				aname = acc.get_name() if hasattr(acc, "get_name") else ""
			except Exception:
				aname = ""
			a_decl = _safe_text(getattr(acc, "textual_declaration", None))
			a_impl = _safe_text(getattr(acc, "textual_implementation", None))
			low = aname.lower()
			if low == "get":
				child_entry["getterDeclaration"] = a_decl
				child_entry["getterCode"] = a_impl
			elif low == "set":
				child_entry["setterDeclaration"] = a_decl
				child_entry["setterCode"] = a_impl
	except Exception:
		pass


def _safe_text(textual_doc):
	# type: (object) -> str
	"""Get .text from a ScriptTextDocument-like object. Handles the
	three return shapes (str, bytes, None) and the encoding variance
	(UTF-8 / cp1252 / latin-1) seen on different SP versions."""
	if textual_doc is None:
		return ""
	try:
		text = textual_doc.text
	except Exception:
		return ""
	if text is None:
		return ""
	if isinstance(text, bytes):
		for enc in ("utf-8", "cp1252", "latin-1"):
			try:
				return text.decode(enc)
			except Exception:
				continue
		return text.decode("utf-8", errors="replace")
	return text
