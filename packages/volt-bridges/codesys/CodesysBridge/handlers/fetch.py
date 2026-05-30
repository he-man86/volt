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
from ..helpers import block_type_mapper, log, plcopen_xml, st_assembler


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
			except Exception as e:
				# Log loud — silent drops mask real bugs (e.g. an FBD
				# POU classification path that produces an assembler
				# input the assembler doesn't accept).
				log.warn("[FETCH] dropped {0!r} (kind={1!r}): {2}".format(name, kind, e))
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
			# Non-ST POUs ship their graphical body as PLCopenXML so
			# the agent can either round-trip it or treat the POU as
			# read-only. ST POUs never set this field.
			if result.get("implementationXml"):
				slim["implementationXml"] = result["implementationXml"]
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
	implementation + children from the CODESYS item.

	For non-ST POUs (FBD / LD / SFC / CFC), the declaration is still
	textual (interface / VAR sections) but the implementation lives in
	PLCopenXML — we surface it on the side as `implementationXml`.
	"""
	cls = plcopen_xml.classify(item)
	language = cls.get("language") or "ST"
	is_textual = cls.get("is_textual", True)
	result = {
		"name": name,
		"kind": kind,
		"declaration": _safe_text(getattr(item, "textual_declaration", None)),
		"implementation": _safe_text(getattr(item, "textual_implementation", None)) if is_textual else "",
		"children": [],
		"folder": None,
		"language": language,
	}
	# Graphical POUs: their implementation isn't ST — surface the raw
	# PLCopenXML <body> so the agent can either round-trip it or treat
	# the POU as read-only. Wire consumers that don't recognize the
	# field will simply ignore it (strict zod on FetchedItem will need
	# the optional field added before this surfaces to the SaaS, but
	# the bridge emits it so /debug/fetch already sees it).
	if not is_textual:
		body_xml = plcopen_xml.extract_graphical_body(item)
		if body_xml:
			result["implementationXml"] = body_xml
	# Composite POU children. Use recursive=True so we flatten through
	# any `folder` container the user has created INSIDE the POU
	# (CODESYS lets you organize methods/actions under a folder inside
	# the POU's namespace). The folder itself has no textual marker
	# so is filtered by is_textual_item; Set/Get accessors get
	# KIND_UNKNOWN classification and are skipped here — they ride via
	# _collect_property_accessors when we process their parent Prop.
	if kind in ("function_block", "function", "program", "interface"):
		try:
			for child in item.get_children(recursive=True):
				try:
					marker = str(child)
				except Exception:
					continue
				if not block_type_mapper.is_textual_item(marker):
					continue
				cdecl = _safe_text(getattr(child, "textual_declaration", None))
				cimpl = _safe_text(getattr(child, "textual_implementation", None))
				child_kind = _classify_child(cdecl, marker)
				if child_kind == block_type_mapper.KIND_UNKNOWN:
					continue
				try:
					cname = child.get_name() if hasattr(child, "get_name") else ""
				except Exception:
					cname = ""
				if not cname:
					continue
				# CODESYS ACTIONs (and TRANSITIONs) are impl-only — they
				# have no textual_declaration document. The assembler
				# needs `ACTION <name>` as the declaration line so it
				# can emit `ACTION X / <impl> / END_ACTION`. Synthesize.
				if child_kind == block_type_mapper.KIND_ACTION and not cdecl.strip():
					cdecl = "ACTION {0}".format(cname)
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


def _classify_child(decl_text, marker_string=""):
	# type: (str, str) -> str
	"""Pick child kind (method/action/property) from declaration. ACTION
	and TRANSITION carry no declaration text (impl-only items) — they
	get classified from the marker string instead. Falls back to
	KIND_UNKNOWN on any other shape."""
	# Impl-only marker means ACTION (or TRANSITION, which we treat as
	# ACTION on the wire because TwinCAT lacks the distinction).
	if marker_string and block_type_mapper.MARKER_TEXTUAL_IMPL in marker_string \
			and block_type_mapper.MARKER_TEXTUAL_DECL_IMPL not in marker_string:
		return block_type_mapper.KIND_ACTION
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
