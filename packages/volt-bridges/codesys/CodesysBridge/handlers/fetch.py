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
import hashlib

from .. import codesys_connection as _conn_mod
from .. import ui_thread
from ..helpers import block_type_mapper, log, plcopen_xml, st_assembler
from . import extensions


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

	# Optional allowlist — when present, skip materialization for any
	# item not in this set. Used by the agent's `peekBridgeItem` so the
	# SCM-tree single-item preview doesn't materialize all ~242 other
	# items in the project. Absent / empty list = serve every item
	# (current behavior, backward-compatible).
	only_items = None
	raw_only = body.get("onlyItems") if isinstance(body, dict) else None
	if isinstance(raw_only, list):
		filtered = [n for n in raw_only if isinstance(n, str)]
		if len(filtered) > 0:
			only_items = set(filtered)

	def _do():
		versions = {}
		changed = []
		# iter_all_items emits source POUs + folder markers + every
		# kind the TypeExtension registry claims. The dispatch below
		# is registry-driven — adding a new kind is a one-entry edit
		# in extensions.py, NOT four-place changes across handlers.
		for (name, kind, item, is_source, folder_override) in connection.iter_all_items():
			# Allowlist short-circuit — skip BOTH version computation
			# AND materialization for items outside the requested set.
			# This is what makes `peekBridgeItem` cheap: without it,
			# even the per-item version hash is hundreds of COM calls
			# for a 243-item project. The trade-off: the response's
			# `items` map and `removed` list become partial when
			# `onlyItems` is set — callers (peekBridgeItem) ignore
			# both, reading only `changed`. Normal pull/fetch paths
			# don't send `onlyItems` and get the wholesale picture.
			if only_items is not None and name not in only_items:
				continue
			try:
				ver = compute_item_version(item, name, kind, is_source)
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
					ext = extensions.by_kind(kind)
					if ext is None:
						log.warn("[FETCH] unregistered kind {0!r} for {1!r}".format(kind, name))
						continue
					slim = _build_extension_item(name, kind, ver, item, folder_override, ext)
			except Exception as e:
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
	if result.get("graphicalChildren"):
		slim["graphicalChildren"] = result["graphicalChildren"]
	return slim


def compute_item_version(item, name, kind, is_source):
	# type: (object, str, str, bool) -> str
	"""Canonical "what's the version of this item?" — used by /refs,
	/fetch, and /push. All three MUST agree on the version of every
	item; any drift produces phantom diffs on the next pull. Routed
	through this one helper.

	Foundation principle: per-item version = SHA1(everything the
	materializer needs to render this item). That's content +
	location (folder) + structure. A MOVE in the IDE produces a
	folder-path change → version bump → /refs sees the change →
	agent refetches → materializer writes at the new path →
	retired-files sweep removes the old path. No /move verb, no
	parallel folder map on /refs.

	Versions:
	  * source items   → SHA1(folder + decl + impl + child digests + body XML)
	                     — computed by `CodesysConnection.compute_item_version`
	  * folder markers → SHA1("folder:" + folder_path)
	                     — moving an empty folder bumps the version
	  * config items   → SHA1("folder=" + folder + manifest)
	                     — moving a task/library/device etc. bumps the version

	If `kind` isn't recognized, raise — iter_all_items should have
	filtered it. Silent fallbacks (`return kind` for unknown items)
	are what produced the cam-mis-classification and projectVersion-
	drift bugs we fixed earlier.
	"""
	if is_source:
		return _conn_mod.CodesysConnection.compute_item_version(item)
	folder = _conn_mod.CodesysConnection.folder_path_for(item)
	if kind == "folder":
		# Empty-folder markers — the folder path IS the content. Hash
		# it so a move (rename or reparent) bumps the version.
		h = hashlib.sha1()
		h.update(("folder:" + folder).encode("utf-8", errors="replace"))
		return h.hexdigest()[:16]
	ext = extensions.by_kind(kind)
	if ext is None:
		raise ValueError(
			"compute_item_version called with unknown kind '{0}' for item "
			"'{1}' — register a TypeExtension or filter at iter_all_items".format(kind, name)
		)
	h = hashlib.sha1()
	h.update(("folder=" + folder + "\x00").encode("utf-8", errors="replace"))
	h.update(ext.formatter(item).encode("utf-8", errors="replace"))
	return h.hexdigest()[:16]


# Re-export the formatters at module scope so existing callers (and
# external tests) keep working without changing imports.
format_library_ref = extensions.format_library_ref
format_task = extensions.format_task


def export_item_native(item, name):
	# type: (object, str) -> str
	"""Get the CODESYS-native XML serialization of a non-source item.

	CODESYS Scripting API. The full .NET signature (per CLR reflection
	on `IScriptObject7.export_native`) is:

	    void export_native(
	        String destination,
	        Boolean includeChildren,
	        String profileName,
	        INativeExportReporter reporter
	    )

	**Why all four args must be passed explicitly:** if you call
	`item.export_native(path)` with only the destination, IronPython
	fills the remaining args with .NET defaults — and the default
	value for `INativeExportReporter` is CODESYS's INTERACTIVE
	reporter, which pops a modal dialog the user has to ack per item.
	Verified via /debug/extract: the one-arg call fires a prompt and
	takes ~1-10s; the four-arg call with `None` reporter is silent and
	finishes in ~600 ms.

	`includeChildren=False` is the correct choice: children appear as
	their OWN entries in the project tree and get their own /fetch
	calls. Passing True duplicates child content into the parent's
	export (e.g. Device blows up from 26 KB to 403 KB).

	`profileName=None` selects the default profile.
	`reporter=None` selects a non-interactive default reporter.

	Result is opaque to the agent — written as `.xml` verbatim, never
	parsed. Returns empty string on failure.
	"""
	import os
	import tempfile
	# tempfile.mkstemp creates a zero-byte file; delete it so export_native
	# doesn't see an existing target (some CODESYS SPs prompt on overwrite
	# even with a non-interactive reporter).
	fd, path = tempfile.mkstemp(prefix="volt-codesys-export-", suffix=".xml")
	os.close(fd)
	try:
		try:
			os.unlink(path)
		except Exception:
			pass
		try:
			item.export_native(path, False, None, None)
		except Exception as e:
			log.warn("[FETCH] config item '{0}': item.export_native failed: {1}".format(name, e))
			return ""
		try:
			with open(path, "rb") as fh:
				raw = fh.read()
		except Exception as e:
			log.warn("[FETCH] config item '{0}': read-back failed: {1}".format(name, e))
			return ""
		if not raw:
			return ""
		# CODESYS writes UTF-8 with a BOM in most cases; fall through
		# legacy encodings if needed for older SPs.
		for enc in ("utf-8-sig", "utf-8", "utf-16", "cp1252", "latin-1"):
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


def _build_extension_item(name, kind, version, item, folder_override, ext):
	# type: (str, str, str, object, str, object) -> object
	"""Build a FetchedItem dict from a registered TypeExtension.

	`folder_override` (set by iter_all_items for items emitted via a
	container's drill function — libraries, tasks) trumps the parent-
	walk because some typed wrappers (ScriptPlaceholderReference)
	don't expose `.parent` cleanly. For self-typed items (no drill),
	folder_override is None and we fall back to the parent walk.

	Hybrid-folder rule: when a self-typed item has children that will
	appear under `<folder>/<name>/...`, we nest the item's OWN file
	inside that folder. Example: `EtherCAT_Master.device` lives at
	`<...>/EtherCAT_Master/EtherCAT_Master.device` (next to its
	slaves) instead of dangling beside the folder. Reads naturally
	in any file tree: the dir IS the container, the file inside IS
	the container's own settings.

	`sourceText` is the formatter's output — same string compute_item
	_version hashed, byte-stable across calls. /refs and /fetch
	therefore agree on what's in this item right now."""
	slim = {
		"name": name,
		"kind": kind,
		"sourceText": ext.formatter(item),
		"version": version,
	}
	folder = folder_override or _folder_path_for(item)
	# Drill-emitted items (libraries, tasks) already have the
	# container folder baked into folder_override, so the file
	# naturally lives inside it. For self-typed items we detect
	# children ourselves and nest — unless the extension explicitly
	# opts out (e.g. visualizations whose internal element-children
	# we don't emit as separate items).
	if (folder_override is None
		and getattr(ext, "nest_children", True)
		and _has_children(item)):
		folder = (folder + "/" + name) if folder else name
	if folder:
		slim["folder"] = folder
	return slim


def _has_children(item):
	# type: (object) -> bool
	"""True iff get_children(recursive=False) yields at least one
	child. Tolerant of CODESYS wrappers that raise on get_children
	(e.g. leaf items that aren't containers).
	"""
	try:
		for _ in item.get_children(recursive=False):
			return True
	except Exception:
		return False
	return False


# Folder-path resolution moved to `CodesysConnection.folder_path_for`
# so `compute_item_version` (in the connection module) can include the
# folder in its hash. This module-level alias keeps existing call
# sites (`_build_source_item` etc.) working without a refactor.
_folder_path_for = _conn_mod.CodesysConnection.folder_path_for


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
	# `language` only applies to POU kinds (function_block / function /
	# program). Declaration-only kinds — GVL, INTERFACE, STRUCTURE,
	# UNION, ENUMERATION, ALIAS — have NO body and therefore NO body
	# language by design. The wire schema makes `language` optional;
	# omitting it for declaration-only kinds is the truthful signal.
	#
	# For POU kinds: when classify() can't determine the body language
	# (export_xml failed, body element absent, unknown shape), emit
	# language="UNKNOWN" — no silent ST fallback. The agent treats
	# UNKNOWN as skip-with-warn so one weird POU doesn't poison the
	# whole sync.
	is_pou_kind = kind in ("function_block", "function", "program")
	classified_language = cls.get("language")
	language = None
	if is_pou_kind:
		language = classified_language
		if language is None:
			log.warn(
				"[fetch] {0} ({1}): plcopen_xml.classify returned no language "
				"— emitting language=UNKNOWN. Re-export the POU in the IDE if "
				"it should be ST/FBD/LD/SFC/CFC.".format(name, kind)
			)
			language = "UNKNOWN"
	is_textual = cls.get("is_textual", True)
	result = {
		"name": name,
		"kind": kind,
		"declaration": _safe_text(getattr(item, "textual_declaration", None)),
		"implementation": _safe_text(getattr(item, "textual_implementation", None)) if is_textual else "",
		"children": [],
		"folder": None,
	}
	if language is not None:
		result["language"] = language
	# Graphical POUs: their implementation isn't ST — surface the raw
	# PLCopenXML <body> so the agent can either round-trip it or treat
	# the POU as read-only. Wire consumers that don't recognize the
	# field will simply ignore it.
	if not is_textual:
		body_xml = plcopen_xml.extract_graphical_body(item)
		if body_xml:
			result["implementationXml"] = body_xml
	# Composite POU children. Two routes, picked per child by the
	# documented CODESYS Scripting marker (`ScriptTextualX...`
	# variants) — see helpers/block_type_mapper.py for the marker
	# catalog and the CODESYS Scripting API docs at
	# helpme-codesys.com/en/CODESYS Scripting/.
	#
	# Textual child (Script*TextualDeclarationObject /
	# *TextualImplementationObject / decl+impl variant):
	#   The scripting API exposes `textual_declaration.text` and
	#   `textual_implementation.text` directly. Fold into the parent's
	#   assembled sourceText as today.
	#
	# Non-textual child (ScriptNonTextualObject):
	#   The body lives in PLCopenXML. CODESYS stores each graphical
	#   member as an external file object; calling
	#   `child.export_xml()` returns the parent POU document with this
	#   child as a nested `<action>` / `<method>` / `<transition>`
	#   element whose own `<body>`'s first child tag is the body
	#   language (FBD/LD/SFC/CFC/ST/IL). We use that as the canonical
	#   source — no marker-substring guessing about container vs leaf.
	#   If `extract_self_member_body` returns None the child is a
	#   container (no body of its own); the recursive walk already
	#   yields its leaves separately, so we skip.
	#
	# Containers (folders / IEC member containers) appear in the
	# recursive enumeration but have no body — `extract_self_member_body`
	# returns None for them and the fall-through `continue` skips.
	if kind in ("function_block", "function", "program", "interface"):
		graphical_children = []
		try:
			for child in item.get_children(recursive=True):
				try:
					marker = str(child)
				except Exception:
					continue
				try:
					cname = child.get_name() if hasattr(child, "get_name") else ""
				except Exception:
					cname = ""
				if not cname:
					continue
				cdecl = _safe_text(getattr(child, "textual_declaration", None))
				cimpl = _safe_text(getattr(child, "textual_implementation", None))

				# Textual route — fastest, no XML parse needed. Uses the
				# scripting API's documented textual-object capability
				# markers (block_type_mapper.is_textual_item).
				if block_type_mapper.is_textual_item(marker):
					ck = _classify_child(cdecl, marker)
					if ck == block_type_mapper.KIND_UNKNOWN:
						continue
					# Impl-only items (ACTION/TRANSITION) carry no
					# textual_declaration document. The assembler needs
					# `ACTION <name>` as a declaration line so it can
					# emit `ACTION X / <impl> / END_ACTION`. Synthesize.
					if ck == block_type_mapper.KIND_ACTION and not cdecl.strip():
						cdecl = "ACTION {0}".format(cname)
					child_entry = {
						"kind": ck,
						"name": cname,
						"declaration": cdecl,
						"implementation": cimpl,
					}
					if ck == block_type_mapper.KIND_PROPERTY:
						_collect_property_accessors(child, child_entry)
					result["children"].append(child_entry)
					continue

				# Non-textual route — call the child's own export_xml,
				# locate its nested `<action>`/`<method>`/`<transition>`
				# element in the returned parent document, read the body
				# language and body XML from there.
				self_body = plcopen_xml.extract_self_member_body(child, cname)
				if self_body is None:
					# Container (no body of its own) — skip. Its leaf
					# descendants come through recursive=True
					# separately.
					continue
				schema_kind = self_body["kind"]
				schema_lang = self_body["language"]
				if schema_lang in ("FBD", "LD", "SFC", "CFC"):
					decl_for_child = cdecl if cdecl.strip() else "{0} {1}".format(
						schema_kind.upper(), cname
					)
					graphical_children.append({
						"name": cname,
						"kind": schema_kind,
						"language": schema_lang,
						"declaration": decl_for_child,
						"implementationXml": self_body["body_xml"],
					})
					continue
				# Non-textual marker but textual body language (ST/IL).
				# Unusual combination; surface a warning so we learn
				# when this happens in the wild rather than silently
				# dropping data.
				log.warn(
					"[fetch] {0}: non-textual child '{1}' reports body language "
					"'{2}'; surfacing as textual member.".format(name, cname, schema_lang)
				)
				if schema_kind in ("action", "transition") and not cdecl.strip():
					cdecl = "{0} {1}".format(schema_kind.upper(), cname)
				result["children"].append({
					"kind": schema_kind,
					"name": cname,
					"declaration": cdecl,
					"implementation": cimpl,
				})
		except Exception as e:
			log.warn("[fetch] {0}: child walk failed: {1}".format(name, e))
		if graphical_children:
			result["graphicalChildren"] = graphical_children
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
