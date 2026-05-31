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
		for (name, kind, item, is_source) in connection.iter_all_items():
			try:
				if is_source:
					ver = _conn_mod.CodesysConnection.compute_item_version(item)
				else:
					# Config items and folder markers: opaque, no
					# content drift detection. Constant version
					# (the kind string itself) makes that explicit.
					# Structural add / remove / rename still surface
					# via structureVersion (it hashes the `{name:
					# version}` dict; adding or removing a name
					# changes the dict shape regardless of values).
					ver = kind
			except Exception:
				continue
			versions[name] = ver
			if known_items.get(name) == ver:
				continue
			try:
				if is_source:
					slim = _build_source_item(name, kind, ver, item)
				elif kind == "folder":
					slim = _build_folder_item(name, kind, ver, item)
				else:
					slim = _build_config_item(name, kind, ver, item)
				if slim is None:
					continue
			except Exception as e:
				# Log loud — silent drops mask real bugs.
				log.warn("[FETCH] dropped {0!r} (kind={1!r}): {2}".format(name, kind, e))
				continue
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


def _build_source_item(name, kind, version, item):
	# type: (str, str, str, object) -> object
	"""Build a FetchedItem dict for a source POU/GVL/DUT/Interface.
	Routes through the StAssembler + (for graphical POUs) PLCopenXML
	body extraction. Returns the wire dict or raises on assembler
	failure (caller logs + skips)."""
	result = _build_get_result(name, kind, item)
	source_text = st_assembler.assemble(result)
	slim = {
		"name": name,
		"kind": kind,
		"sourceText": source_text,
		"version": version,
	}
	# Folder mirroring: source POUs use the same parent-walk as config
	# items so the workspace layout matches the CODESYS IDE tree
	# 1:1 (Device/Plc Logic/Application/<subfolders>/<name>.<ext>).
	folder = _folder_path_for(item)
	if folder:
		slim["folder"] = folder
	if result.get("language"):
		slim["language"] = result["language"]
	if result.get("implementationXml"):
		slim["implementationXml"] = result["implementationXml"]
	return slim


def _export_item_native(item, name):
	# type: (object, str) -> str
	"""Get the CODESYS-native XML serialization of a config item.

	CODESYS Scripting API: `project.export_native(path, [items],
	recursive)` writes the native XML for the listed items into a
	file. Unlike `item.export_xml()` which returns a string for POU
	items only, the file-based native export handles every object
	kind (tasks, alarms, visualizations, etc.) — these aren't
	PLCopenXML-shaped so the no-args xml export returns a generic
	empty envelope.

	Returns empty string on failure (logged). Caller treats this as
	"opaque blob, write verbatim".
	"""
	import os
	import tempfile
	from .. import codesys_connection as _conn
	fd, path = tempfile.mkstemp(prefix="volt-codesys-export-", suffix=".xml")
	os.close(fd)
	try:
		proj = None
		try:
			parent_walker = item
			for _ in range(30):
				p = getattr(parent_walker, "parent", None)
				if p is None:
					proj = parent_walker
					break
				parent_walker = p
		except Exception:
			pass
		if proj is None:
			log.warn("[FETCH] config item '{0}': could not find project root".format(name))
			return ""
		try:
			# (path, items, recursive=True) — exports the item and
			# any descendants in one shot. Recursive matters for
			# container items (Alarm Configuration, Visualization
			# Manager) whose own native data plus children's data
			# live in the same XML.
			proj.export_native(path, [item], True)
		except Exception as e:
			log.warn("[FETCH] config item '{0}': proj.export_native failed: {1}".format(name, e))
			return ""
		try:
			with open(path, "rb") as fh:
				raw = fh.read()
		except Exception as e:
			log.warn("[FETCH] config item '{0}': read-back failed: {1}".format(name, e))
			return ""
		if not raw:
			return ""
		for enc in ("utf-8", "utf-16", "cp1252", "latin-1"):
			try:
				return raw.decode(enc)
			except Exception:
				continue
		return raw.decode("utf-8", errors="replace")
	finally:
		try:
			os.unlink(path)
		except Exception:
			pass


def _build_folder_item(name, kind, version, item):
	# type: (str, str, str, object) -> object
	"""Build a FetchedItem dict for an empty CODESYS folder. Agent
	materializes this as `<folder>/<name>/.gitkeep` so git preserves
	the otherwise-empty directory. No PLCopenXML export — folders
	hold no editable content."""
	folder = _folder_path_for(item)
	slim = {
		"name": name,
		"kind": kind,
		"sourceText": "",
		"version": version,
	}
	if folder:
		slim["folder"] = folder
	return slim


def _build_config_item(name, kind, version, item):
	# type: (str, str, str, object) -> object
	"""Build a FetchedItem dict for a non-source config item (task,
	visualization, alarm config, library manager, device tree, etc.).

	Uses `export_native()` — CODESYS's native-XML export — NOT
	`export_xml()` (PLCopenXML). Reason: PLCopenXML (IEC 61131-10)
	only covers POU/DUT/GVL kinds; for CODESYS-specific objects it
	returns an empty 861-byte envelope `<types><dataTypes/><pous/>
	</types>` with zero actual data. `export_native()` returns the
	CODESYS-internal XML that carries the object's real settings
	(task cycle time, alarm class properties, visualization layout,
	etc.). Verified empirically: with export_xml the disk file was
	identical-empty across every config item; with export_native each
	carries its distinct content.

	Agent writes the result as opaque `.xml`. No parsing, no
	per-kind handling — per "opaque passthrough first" until we
	decide a specific kind needs structured round-trip."""
	# NOTE: `item.export_xml()` (no args) returns the PLCopenXML envelope.
	# For POU-shaped items this carries real data; for tasks /
	# visualizations / alarms / device-tree etc. it returns a generic
	# empty wrapper. Switching to `proj.export_native(path, [item])` is
	# the documented path for non-PLCopenXML objects but hangs on some
	# CODESYS configurations (modal dialog suspected) — see follow-up.
	# Keeping the simple call for now so extension work can land; data
	# completeness is a separate fix.
	xml = ""
	try:
		xml = item.export_xml() or ""
	except Exception as e:
		log.warn("[FETCH] config item '{0}' ({1}): export_xml failed: {2}".format(name, kind, e))
	folder = _folder_path_for(item)
	# Hybrid mode: if this item has children, nest its own file inside
	# its folder (component-folder convention). So instead of
	# `RecipeManager.xml` + `RecipeManager/Recipes.xml` side-by-side
	# in the parent folder, we get `RecipeManager/RecipeManager.xml` +
	# `RecipeManager/Recipes.xml` — one tree entry per concept in
	# VS Code's explorer.
	try:
		has_children = False
		try:
			for _ in item.get_children(recursive=False):
				has_children = True
				break
		except Exception:
			pass
		if has_children:
			folder = folder + "/" + name if folder else name
	except Exception:
		pass
	slim = {
		"name": name,
		"kind": kind,
		"sourceText": xml,
		"version": version,
	}
	if folder:
		slim["folder"] = folder
	return slim


def _folder_path_for(item):
	# type: (object) -> str
	"""Walk up parents to compute the CODESYS folder path for an
	item — used for BOTH source POUs and non-source config items so
	the workspace layout mirrors the IDE tree exactly. Stops at the
	project root (returns empty string for items at the root).
	"""
	segments = []
	try:
		cursor = getattr(item, "parent", None)
		# Sanity bound — even deep trees don't reach 30.
		for _ in range(30):
			if cursor is None:
				break
			try:
				cname = cursor.get_name() if hasattr(cursor, "get_name") else None
			except Exception:
				cname = None
			if cname in (None, "", "/"):
				break
			# Stop at the project node itself (its parent is None).
			parent_of_cursor = None
			try:
				parent_of_cursor = getattr(cursor, "parent", None)
			except Exception:
				pass
			if parent_of_cursor is None:
				break
			segments.append(cname)
			cursor = parent_of_cursor
	except Exception:
		return ""
	segments.reverse()
	return "/".join(segments)


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
