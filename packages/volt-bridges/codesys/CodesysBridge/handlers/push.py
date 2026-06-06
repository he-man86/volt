"""
POST /push — atomic batch of item-level ops on the project tree.

Mirrors `packages/volt-bridges/beckhoff/BeckhoffBridge/Handlers/PushHandler.cs`.

Wire shape v2 (ST-on-the-wire):
  - Agent sends raw `.st` / `.gvl` / `.dut` / `.itf` per item.
  - Bridge runs StSplitter to recover POU + children.
  - Four ops: pushItem, deleteItem, renameItem, moveItem.
  - Atomic: ALL ops' ifVersion guards validate against pre-batch state
    (with forward-state simulation so in-batch dependencies work),
    then applied in declared order on success.

CODESYS-specific notes baked in from PLCAssist-bridge prior art:
  - Rename on some SPs copies the item instead of renaming — verify
    by name after, clean up the duplicate if needed.
  - Multi-signature fallback for create_pou / create_method / etc.;
    PouType enum import path varies (PouType vs ScriptPouType).
  - obj.remove() primary; fallback obj.parent.remove(obj).
"""
# pyright: reportMissingImports=false
from .. import codesys_connection as _conn_mod
from .. import ui_thread
from ..helpers import st_splitter


def handle(connection, body):
	# type: (object, dict) -> dict
	if not connection.is_connected:
		raise RuntimeError("CODESYS Scripting Engine not available")

	# Imported lazily — same reason as refs.py: bundle load order places
	# `push` before `fetch`, so top-level `from . import fetch` would
	# fail at bundle boot.
	from . import fetch as _fetch_mod

	ops = body.get("ops") if isinstance(body, dict) else None
	if not isinstance(ops, list):
		raise ValueError("Missing 'ops' array")
	expected_project_version = body.get("expectedProjectVersion")

	# Pre-flight: collect current per-item versions on the UI thread.
	# IMPORTANT — must mirror `refs.py::_do` exactly: same iteration
	# (iter_all_items, not iter_top_level), same version shape per kind
	# (compute_item_version for source items, sha1(export_native) for
	# non-source items, "folder" for folder markers). The
	# `projectVersion` hash is computed off this map on both sides; ANY
	# drift in what we iterate or how we tag an item produces phantom
	# conflicts where nothing has changed in the IDE.
	#
	# Pushable item cache stays SOURCE-ONLY because config / folder
	# items aren't writable through this handler — adding them to the
	# cache would only inflate memory.
	def _build_pre_state():
		versions = {}
		item_cache = {}
		for (name, kind, item, is_source, _folder) in connection.iter_all_items():
			try:
				versions[name] = _fetch_mod.compute_item_version(
					item, name, kind, is_source
				)
				if is_source:
					item_cache[name] = item
			except Exception:
				continue
		return versions, item_cache

	current_versions, item_cache = ui_thread.invoke_on_ui(_build_pre_state)
	current_project_version = _conn_mod.CodesysConnection.compute_project_version(current_versions)

	conflicts = []
	if expected_project_version is not None and expected_project_version != current_project_version:
		conflicts.append({
			"name": "<project>",
			"yourVersion": expected_project_version,
			"currentVersion": current_project_version,
			"reason": "project-level drift since you computed your batch",
		})

	# Forward-state simulation: each op's ifVersion validates against
	# `pending` (which tracks adds/deletes/renames as we walk).
	pending = dict(current_versions)
	for op in ops:
		if not isinstance(op, dict):
			continue
		op_type = op.get("op", "")
		name = op.get("name")
		if name is None:
			continue
		client_if_version = op.get("ifVersion")
		current_version = pending.get(name)

		if op_type == "pushItem":
			if client_if_version is None:
				# Create: must NOT exist.
				if current_version is not None:
					conflicts.append({
						"name": name,
						"yourVersion": None,
						"currentVersion": current_version,
						"reason": "expected to create new item but it already exists",
					})
				else:
					pending[name] = ""  # placeholder; real hash post-apply
			else:
				if current_version != client_if_version:
					conflicts.append({
						"name": name,
						"yourVersion": client_if_version,
						"currentVersion": current_version,
						"reason": "expected item to exist but it doesn't" if current_version is None
							else "item '{0}' changed since you fetched its version".format(name),
					})
		elif op_type in ("deleteItem", "renameItem", "moveItem"):
			if client_if_version is not None and current_version != client_if_version:
				conflicts.append({
					"name": name,
					"yourVersion": client_if_version,
					"currentVersion": current_version,
					"reason": "expected item to exist but it doesn't" if current_version is None
						else "item '{0}' changed since you fetched its version".format(name),
				})
			else:
				if op_type == "deleteItem":
					pending.pop(name, None)
				elif op_type == "renameItem":
					new_name = op.get("newName")
					if new_name:
						pending.pop(name, None)
						pending[new_name] = ""
		else:
			raise ValueError("Unknown op type: {0}".format(op_type))

	if conflicts:
		return {
			"accepted": False,
			"conflicts": conflicts,
			"currentProjectVersion": current_project_version,
		}

	# Apply on UI thread, then recompute refs.
	def _apply_all():
		for op in ops:
			if not isinstance(op, dict):
				continue
			op_type = op.get("op", "")
			if op_type == "pushItem":
				_apply_push_item(connection, op, item_cache)
			elif op_type == "deleteItem":
				_apply_delete_item(connection, op, item_cache)
			elif op_type == "renameItem":
				_apply_rename_item(connection, op, item_cache)
			elif op_type == "moveItem":
				_apply_move_item(connection, op, item_cache)

		# Recompute refs after apply. MUST use the same
		# `fetch.compute_item_version` path /refs and /fetch use —
		# any divergence here produces phantom drift on the very
		# next push (because the agent compares versionAfterPush
		# against the next /refs and refuses if they don't match).
		# Previously this branch used the kind string as the
		# "version" for non-source items, which was constant per
		# kind ("task", "library", ...) and disagreed with the
		# SHA1-of-manifest hash /refs produces.
		from . import fetch as _fetch_mod
		new_versions = {}
		for tup in connection.iter_all_items():
			# iter_all_items yields (name, kind, item, is_source) on
			# older bundles and (name, kind, item, is_source, folder)
			# on newer ones — accept either shape.
			n, k, it, is_source = tup[0], tup[1], tup[2], tup[3]
			try:
				new_versions[n] = _fetch_mod.compute_item_version(it, n, k, is_source)
			except Exception:
				continue
		return new_versions

	new_versions = ui_thread.invoke_on_ui(_apply_all)

	return {
		"accepted": True,
		"newProjectVersion": _conn_mod.CodesysConnection.compute_project_version(new_versions),
		"newItems": new_versions,
	}


# ─── Op applicators (UI THREAD ONLY) ─────────────────────────────────


def _apply_push_item(connection, op, item_cache):
	# type: (object, dict, dict) -> None
	name = op["name"]
	source_text = op.get("sourceText") or ""
	folder = op.get("folder")
	implementation_xml = op.get("implementationXml")  # graphical body XML or None
	split = st_splitter.split_st(source_text)

	existing = item_cache.get(name) or connection.find_by_name(name)
	if existing is None:
		# CREATE path. For graphical POUs (implementation_xml present),
		# detect the body language from the XML root tag and pass it to
		# `create_pou` so CODESYS opens the POU in the right editor.
		# Then splice the body via import_xml (same path as update).
		if implementation_xml:
			body_language = _detect_body_language(implementation_xml)
			if body_language is None:
				raise RuntimeError(
					"creating graphical POU '{0}' but body XML's root child is not "
					"a recognized language tag (<FBD>/<LD>/<SFC>/<CFC>)".format(name))
			_create_item(connection, name, split, folder, language=body_language)
			created = connection.find_by_name(name)
			if created is None:
				raise RuntimeError("created '{0}' but couldn't re-resolve for body import".format(name))
			_apply_graphical_body(created, name, implementation_xml)
		else:
			_create_item(connection, name, split, folder)
	else:
		_update_item(connection, name, existing, split, folder, implementation_xml)


def _apply_delete_item(connection, op, item_cache):
	# type: (object, dict, dict) -> None
	name = op["name"]
	item = item_cache.get(name) or connection.find_by_name(name)
	if item is None:
		return
	try:
		item.remove()
	except Exception:
		# Fallback: parent.remove(child)
		parent = getattr(item, "parent", None)
		if parent is not None and hasattr(parent, "remove"):
			parent.remove(item)


def _apply_rename_item(connection, op, item_cache):
	# type: (object, dict, dict) -> None
	old_name = op["name"]
	new_name = op["newName"]
	item = item_cache.get(old_name) or connection.find_by_name(old_name)
	if item is None:
		return
	# Multi-signature fallback per PLCAssist prior-art.
	if hasattr(item, "rename"):
		try:
			item.rename(new_name)
			return
		except Exception:
			pass
	if hasattr(item, "set_name"):
		try:
			item.set_name(new_name)
			return
		except Exception:
			pass
	try:
		item.name = new_name
	except Exception:
		pass


def _apply_move_item(connection, op, item_cache):
	# type: (object, dict, dict) -> None
	"""moveItem — delete the item, recreate at the new folder.

	CODESYS doesn't expose a clean cross-folder move primitive on its
	Scripting Engine surface (no `item.move_to(parent_folder)` on
	IScriptObject). The bridge emulates as snapshot + delete +
	recreate, matching `BeckhoffBridge PushHandler.ApplyMoveItem`.

	Safety: if the item has graphical children (FBD/LD/SFC/CFC
	actions or methods nested inside an otherwise-ST parent), refuse
	the move with a clear error — the recreate path can't round-trip
	graphical bodies. The engineer must move the POU in the IDE.
	Same rule we enforce on Beckhoff.
	"""
	from . import fetch as _fetch_mod
	name = op["name"]
	new_folder = op.get("newFolder") or ""
	item = item_cache.get(name) or connection.find_by_name(name)
	if item is None:
		raise RuntimeError("moveItem: item '{0}' not found".format(name))

	# Determine kind via the same iter_all_items path /refs uses. We
	# need it for the recreate call.
	kind = None
	for tup in connection.iter_all_items():
		if tup[0] == name:
			kind = tup[1]
			break
	if kind is None:
		raise RuntimeError("moveItem: couldn't classify '{0}' for recreate".format(name))

	# Snapshot via the same builder /fetch uses — gets decl, impl,
	# children (textual) and graphicalChildren (FBD/LD/SFC/CFC).
	snapshot = _fetch_mod._build_get_result(name, kind, item)

	# Safety net: graphical children can't round-trip through the
	# delete-recreate dance because the recreate path has no
	# implementationXml write hook for nested members. Refuse loudly
	# so the engineer moves the POU in CODESYS instead.
	gc = snapshot.get("graphicalChildren") or []
	if gc:
		raise RuntimeError(
			"moveItem refused: '{0}' contains {1} graphical child member(s) "
			"(FBD/LD/SFC/CFC) which can't be round-tripped through Volt yet. "
			"Move this POU in the CODESYS IDE instead.".format(name, len(gc)))

	# Build the assembled sourceText so the recreate writes a
	# byte-equivalent POU at the new folder. Use the same st_assembler
	# fetch.py uses — keeps move + create + fetch round-trip consistent.
	from ..helpers import st_assembler as _assembler
	source_text = _assembler.assemble(snapshot)

	# Top-level body XML (CFC/SFC/FBD/LD parent POUs). Threaded
	# through the recreate so the new POU comes back graphical.
	implementation_xml = snapshot.get("implementationXml")

	# Delete the existing item.
	_apply_delete_item(connection, {"name": name}, item_cache)

	# Recreate at the new folder using the regular push-item path.
	# Setting `op` to None / not passing ifVersion = treat as create-new.
	create_op = {
		"name": name,
		"folder": new_folder,
		"sourceText": source_text,
	}
	if implementation_xml:
		create_op["implementationXml"] = implementation_xml
	_apply_push_item(connection, create_op, item_cache)


def _create_item(connection, name, split, folder, language=None):
	# type: (object, str, object, object, object) -> None
	app = connection.get_application()
	if app is None:
		raise RuntimeError("No CODESYS Application to create '{0}' under".format(name))
	# Multi-signature fallback per PLCAssist prior-art.
	# Try create_pou / create_function / create_struct / etc. based on kind.
	# `language` (when not None) selects FBD / LD / SFC / CFC for the POU's
	# implementation language. Default None → CODESYS uses ST. Graphical
	# create path threads the detected body language through here.
	kind = split.pou_kind
	lang_kwargs = {"language": language} if language is not None else {}
	created = None
	try:
		if kind == "function_block":
			created = _try_create(app, "create_pou", name, "FunctionBlock", **lang_kwargs) or \
				_try_create(app, "create_function_block", name, **lang_kwargs) or \
				_try_create(app, "create_pou", name, "FunctionBlock") or \
				_try_create(app, "create_function_block", name)
		elif kind == "program":
			created = _try_create(app, "create_pou", name, "Program", **lang_kwargs) or \
				_try_create(app, "create_program", name, **lang_kwargs) or \
				_try_create(app, "create_pou", name, "Program") or \
				_try_create(app, "create_program", name)
		elif kind == "function":
			rt = "INT"  # default; can read from split.pou_declaration parse if needed
			created = _try_create(app, "create_function", name, rt, **lang_kwargs) or \
				_try_create(app, "create_pou", name, "Function", **lang_kwargs) or \
				_try_create(app, "create_function", name, rt) or \
				_try_create(app, "create_pou", name, "Function")
		elif kind == "interface":
			created = _try_create(app, "create_interface", name)
		elif kind == "gvl":
			created = _try_create(app, "create_gvl", name) or _try_create(app, "create_pou", name, "GVL")
		elif kind in ("structure", "enumeration", "union", "alias"):
			created = _try_create(app, "create_dut", name)
	except Exception as e:
		raise RuntimeError("create '{0}' ({1}) failed: {2}".format(name, kind, e))
	if created is None:
		raise RuntimeError("No create_* signature on Application accepted '{0}' ({1})".format(name, kind))

	# Write declaration + implementation.
	_write_text(created, "textual_declaration", split.pou_declaration)
	if split.pou_implementation:
		_write_text(created, "textual_implementation", split.pou_implementation)

	# Create children (methods / actions / properties).
	for child in split.children:
		_create_child(created, child)


def _update_item(connection, name, existing, split, folder, implementation_xml=None):
	# type: (object, str, object, object, object, object) -> None
	# Write outer POU decl/impl.
	_write_text(existing, "textual_declaration", split.pou_declaration)
	if split.pou_implementation is not None:
		_write_text(existing, "textual_implementation", split.pou_implementation)
	# Graphical body push: apply the PLCopenXML <body> via import_xml.
	# Update-only — create path is gated upstream.
	if implementation_xml:
		_apply_graphical_body(existing, name, implementation_xml)

	# Diff children: collect current children by name, add new, update
	# existing, delete missing.
	current = {}
	try:
		for c in existing.get_children(recursive=False):
			try:
				cname = c.get_name() if hasattr(c, "get_name") else ""
			except Exception:
				continue
			if cname:
				current[cname.lower()] = c
	except Exception:
		pass

	new_names = set(c.name.lower() for c in split.children)
	for child in split.children:
		existing_child = current.get(child.name.lower())
		if existing_child is None:
			_create_child(existing, child)
		else:
			_update_child(existing_child, child)
	for cname, cobj in current.items():
		if cname not in new_names:
			try:
				cobj.remove()
			except Exception:
				pass


def _create_child(parent, child):
	# type: (object, object) -> None
	created = None
	try:
		if child.kind == "method":
			rt = child.return_type or "BOOL"
			created = _try_create(parent, "create_method", child.name, rt) or \
				_try_create(parent, "create_method", child.name)
		elif child.kind == "action":
			created = _try_create(parent, "create_action", child.name)
		elif child.kind == "property":
			dt = child.data_type or "INT"
			created = _try_create(parent, "create_property", child.name, dt) or \
				_try_create(parent, "create_property", child.name)
	except Exception:
		pass
	if created is None:
		return
	_write_text(created, "textual_declaration", child.declaration)
	if child.implementation:
		_write_text(created, "textual_implementation", child.implementation)
	# Property accessors
	if child.kind == "property":
		_apply_property_accessors(created, child)


def _update_child(child_item, child_snapshot):
	# type: (object, object) -> None
	_write_text(child_item, "textual_declaration", child_snapshot.declaration)
	if child_snapshot.implementation is not None:
		_write_text(child_item, "textual_implementation", child_snapshot.implementation)
	if child_snapshot.kind == "property":
		_apply_property_accessors(child_item, child_snapshot)


def _apply_property_accessors(property_item, child_snapshot):
	# type: (object, object) -> None
	"""Find or create Get/Set accessors and write their text."""
	current = {}
	try:
		for c in property_item.get_children(recursive=False):
			try:
				cname = (c.get_name() if hasattr(c, "get_name") else "").lower()
			except Exception:
				cname = ""
			if cname in ("get", "set"):
				current[cname] = c
	except Exception:
		pass

	if child_snapshot.getter is not None:
		acc = current.get("get") or _try_create(property_item, "create_get", "Get") or \
			_try_create(property_item, "create_accessor", "Get")
		if acc is not None:
			_write_text(acc, "textual_declaration", child_snapshot.getter.declaration or "")
			_write_text(acc, "textual_implementation", child_snapshot.getter.implementation or "")
	if child_snapshot.setter is not None:
		acc = current.get("set") or _try_create(property_item, "create_set", "Set") or \
			_try_create(property_item, "create_accessor", "Set")
		if acc is not None:
			_write_text(acc, "textual_declaration", child_snapshot.setter.declaration or "")
			_write_text(acc, "textual_implementation", child_snapshot.setter.implementation or "")


# ─── Tiny helpers ────────────────────────────────────────────────────


def _try_create(parent, method_name, *args, **kwargs):
	# type: (object, str, *object, **object) -> object
	"""Try calling parent.<method_name>(*args, **kwargs); return None on
	missing attr or exception. Lets callers chain fallbacks across
	CODESYS SP signature variants (e.g. some SPs accept a `language`
	kwarg on create_pou, older ones don't)."""
	fn = getattr(parent, method_name, None)
	if fn is None:
		return None
	try:
		return fn(*args, **kwargs)
	except Exception:
		return None


def _detect_body_language(body_xml):
	# type: (str) -> object
	"""Detect the body language from a PLCopenXML `<body>` fragment by
	reading the root child element name. Returns "FBD" / "LD" / "SFC" /
	"CFC" / "ST" / "IL", or None when the body is malformed or carries
	an unrecognized language tag.

	Mirrors `PlcOpenXml.DetectBodyLanguage` in the Beckhoff bridge —
	both bridges share the same wire shape, so both detection helpers
	implement the same algorithm in their respective languages.
	"""
	if not body_xml or not body_xml.strip():
		return None
	# Minimal XML scan: find the first `<TAG` after `<body`. Avoids
	# pulling in a full XML library for a one-shot tag check.
	import re
	# Strip <body ...> opening tag; find the first non-whitespace element after.
	body_match = re.search(r"<(?:[A-Za-z_][\w.-]*:)?body\b[^>]*>", body_xml)
	if body_match is None:
		# Body wrapper missing — maybe caller passed inner content directly.
		# Try the first element overall.
		root_match = re.search(r"<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_]\w*)\b", body_xml)
		if root_match is None:
			return None
		tag = root_match.group(1)
	else:
		# Find the FIRST child element after </body's-opening>.
		after = body_xml[body_match.end():]
		# Skip whitespace + comments + CDATA.
		stripped = re.sub(r"\s+", "", after, count=0)
		# Pull out the first opening tag's local name.
		child_match = re.search(r"<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_]\w*)\b", after)
		if child_match is None:
			return None
		tag = child_match.group(1)
	mapping = {"FBD": "FBD", "LD": "LD", "SFC": "SFC", "CFC": "CFC", "ST": "ST", "IL": "IL"}
	return mapping.get(tag)


def _write_text(obj, doc_attr, text):
	# type: (object, str, str) -> None
	"""Write text into a ScriptTextDocument-like attribute. Tries
	`replace` first (preserves cursor / undo on some SPs), falls back
	to clear + insert."""
	doc = getattr(obj, doc_attr, None)
	if doc is None:
		return
	text = text or ""
	try:
		current = doc.text or ""
		doc.replace(0, len(current), text)
		return
	except Exception:
		pass
	try:
		doc.clear()
		doc.insert(0, text)
	except Exception:
		# Last resort: try direct property assignment.
		try:
			doc.text = text
		except Exception:
			pass


# ─── Graphical body application ────────────────────────────────────


def _apply_graphical_body(existing, name, body_xml):
	# type: (object, str, str) -> None
	"""Write a graphical POU's `<body>` PLCopenXML back into CODESYS.

	**Export-as-template pattern** (parallel to TC's
	`BeckhoffConnection.ImportItemBodyAsXml`):
	  1. Export the existing item via `item.export_xml()` — gives a
	     schema-valid PLCopenXML document carrying all CODESYS-
	     specific addData / vendor extensions we'd otherwise lose.
	  2. Splice the new `<body>` into it via `replace_body_in_pou`.
	  3. Call `parent.import_xml(ReplaceReporter(), modified_doc)` —
	     the reporter tells CODESYS to REPLACE same-named POUs in
	     place. Without the reporter CODESYS auto-renames colliding
	     imports to `<name>_1`.

	Hand-crafting the PLCopenXML envelope from scratch was tried and
	abandoned — both bridges' import APIs validate the schema
	strictly. Using the vendor's own export sidesteps that fragility.

	Raises on any failure so the push handler surfaces it in the
	response (rather than silently changing GUIDs or dropping the
	body change).
	"""
	from ..helpers import log
	from ..helpers import plcopen_xml as _xml

	try:
		template_xml = existing.export_xml()
	except Exception as e:
		raise RuntimeError("export_xml template fetch for '{0}' failed: {1}".format(name, e))
	if not template_xml:
		raise RuntimeError("empty export_xml template for '{0}'".format(name))

	modified_xml = _xml.replace_body_in_pou(template_xml, name, body_xml)
	if modified_xml is None:
		raise RuntimeError("replace_body_in_pou couldn't locate <body> in template for '{0}'".format(name))

	# import_xml goes on the parent, not the item itself (verified
	# live: calling on the item itself raises "No importable objects
	# found"). The ImportReporter is mandatory for replace semantics.
	parent = getattr(existing, "parent", None)
	if parent is None:
		raise RuntimeError("'{0}' has no parent — can't reach import_xml".format(name))

	try:
		from scriptengine import ImportReporter, ConflictResolve  # type: ignore[import-not-found]
	except Exception as e:
		raise RuntimeError(
			"scriptengine.ImportReporter / ConflictResolve unavailable: {0} "
			"(graphical-body push requires CODESYS SP19+)".format(e))

	class _ReplaceReporter(ImportReporter):
		"""Resolves every name collision by replacing the existing
		object in place — preserves the POU's identity (GUID, parent
		reference, neighbor ordering). Verified live: GUID is byte-
		identical before and after."""
		def error(self, message):    log.warn("[push] import error: {0}".format(message))
		def warning(self, message):  log.warn("[push] import warning: {0}".format(message))
		def resolve_conflict(self, obj):  return ConflictResolve.Replace
		def added(self, obj):     pass
		def replaced(self, obj):  pass
		def skipped(self, obj):   pass
		@property
		def aborting(self):       return False

	try:
		parent.import_xml(_ReplaceReporter(), modified_xml)
	except Exception as e:
		raise RuntimeError("import_xml(ReplaceReporter, xml) for '{0}' failed: {1}".format(name, e))

	# Sanity check: if Replace was silently ignored, CODESYS would
	# auto-rename the incoming POU to `<name>_1`. Crash loudly so the
	# user knows their push didn't actually take. Past bugs in this
	# area silently rewrote GUIDs via a delete-then-import fallback;
	# we trust the reporter path now and want the bug visible if it
	# regresses.
	if _has_duplicate(parent, name):
		raise RuntimeError(
			"ReplaceReporter was ignored — '{0}_1' duplicate created. "
			"CODESYS scripting API may have changed; investigate before retrying.".format(name))

	log.startup("[push] graphical body replaced in place for '{0}'".format(name))


def _has_duplicate(parent, item_name):
	# type: (object, str) -> bool
	"""True if a `<name>_N` sibling exists under `parent`. CODESYS's
	default-policy auto-renames colliding imports — we use this to
	detect ReplaceReporter being silently ignored."""
	try:
		for child in parent.get_children(recursive=False):
			try:
				cname = (child.get_name() if hasattr(child, "get_name") else "") or ""
			except Exception:
				continue
			if cname.startswith(item_name + "_"):
				suffix = cname[len(item_name) + 1:]
				if suffix.isdigit():
					return True
	except Exception:
		pass
	return False


# Body-swap helper lives in `helpers.plcopen_xml` as `replace_body_in_pou`
# (parallel to TC's `BeckhoffConnection.ReplaceBodyInPou`). Single source
# of truth for the PLCopenXML body-replacement logic — also unit-tested
# in `CodesysBridge.Tests/test_plcopen_xml.py`.
