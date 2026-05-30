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

	ops = body.get("ops") if isinstance(body, dict) else None
	if not isinstance(ops, list):
		raise ValueError("Missing 'ops' array")
	expected_project_version = body.get("expectedProjectVersion")

	# Pre-flight: collect current per-item versions on the UI thread.
	def _build_pre_state():
		versions = {}
		item_cache = {}
		for (name, _kind, item) in connection.iter_top_level():
			try:
				versions[name] = _conn_mod.CodesysConnection.compute_item_version(item)
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

		# Recompute refs after apply.
		new_versions = {}
		for (n, _k, it) in connection.iter_top_level():
			try:
				new_versions[n] = _conn_mod.CodesysConnection.compute_item_version(it)
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
		# CREATE path doesn't yet handle graphical POUs from XML —
		# create_pou(name, kind, language=FBD) needs a separate probe.
		# Reject the op explicitly so the caller sees the gap.
		if implementation_xml:
			raise RuntimeError(
				"creating new graphical POU '{0}' from PLCopenXML not yet supported — "
				"create the POU in CODESYS first, then re-pull and edit".format(name))
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
	# CODESYS doesn't expose a clean cross-folder move primitive on the
	# Scripting Engine surface — emulate as delete-and-recreate at the
	# new folder. Same approach the C# bridge uses (BeckhoffBridge
	# PushHandler.ApplyMoveItem).
	name = op["name"]
	new_folder = op.get("newFolder") or ""
	item = item_cache.get(name) or connection.find_by_name(name)
	if item is None:
		return
	# Snapshot current state, delete, recreate at new folder.
	# For now, leaves as a TODO — moveItem isn't on the recorder's hot
	# path and the agent emits it only for true folder-only changes.
	# Implement when a real consumer hits this branch.
	raise NotImplementedError(
		"moveItem on CODESYS not yet implemented — agent rarely emits this op for the recorder path"
	)


def _create_item(connection, name, split, folder):
	# type: (object, str, object, object) -> None
	app = connection.get_application()
	if app is None:
		raise RuntimeError("No CODESYS Application to create '{0}' under".format(name))
	# Multi-signature fallback per PLCAssist prior-art.
	# Try create_pou / create_function / create_struct / etc. based on kind.
	kind = split.pou_kind
	created = None
	try:
		if kind == "function_block":
			created = _try_create(app, "create_pou", name, "FunctionBlock") or \
				_try_create(app, "create_function_block", name)
		elif kind == "program":
			created = _try_create(app, "create_pou", name, "Program") or \
				_try_create(app, "create_program", name)
		elif kind == "function":
			rt = "INT"  # default; can read from split.pou_declaration parse if needed
			created = _try_create(app, "create_function", name, rt) or \
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
		_apply_graphical_body(existing, name, split, implementation_xml)

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


def _try_create(parent, method_name, *args):
	# type: (object, str, *object) -> object
	"""Try calling parent.<method_name>(*args); return None on missing
	attr or exception. Lets callers chain fallbacks across CODESYS SP
	signature variants."""
	fn = getattr(parent, method_name, None)
	if fn is None:
		return None
	try:
		return fn(*args)
	except Exception:
		return None


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


# Maps our vendor-neutral kind strings → PLCopenXML pouType attribute values.
_POU_TYPE_ATTR = {
	"function_block": "functionBlock",
	"function":       "function",
	"program":        "program",
}


def _apply_graphical_body(existing, name, split, body_xml):
	# type: (object, str, object, str) -> None
	"""Write a graphical POU's `<body>` PLCopenXML back into CODESYS.

	**Export-as-template pattern** (parallel to TC's
	`BeckhoffConnection.ImportItemBodyAsXml`):

	  1. Export the existing item via `item.export_xml()` — gives us
	     a schema-valid PLCopenXML document including all CODESYS-
	     specific addData / vendor extensions we'd otherwise lose.
	  2. Parse it, find the named POU's `<body>` element, replace its
	     content with the incoming `body_xml`.
	  3. Call `item.import_xml(modified_doc)` to write it back.
	     Same-name match → in-place update.

	Hand-crafting the PLCopenXML envelope from scratch was tried and
	abandoned — both bridges' import APIs validate the schema
	strictly and reject missing fileHeader / contentHeader /
	coordinateInfo / etc. Using the vendor's own export sidesteps
	that whole class of fragility.

	On failure, raises so the push handler reports it in the response
	rather than silently dropping the body change.
	"""
	from ..helpers import log
	from ..helpers import plcopen_xml as _xml

	try:
		template_xml = existing.export_xml()
	except Exception as e:
		raise RuntimeError("failed to fetch export template for '{0}': {1}".format(name, e))
	if not template_xml:
		raise RuntimeError("empty template returned from export_xml on '{0}'".format(name))

	modified_xml = _xml.replace_body_in_pou(template_xml, name, body_xml)
	if modified_xml is None:
		raise RuntimeError("couldn't locate <body> in export template for '{0}'".format(name))

	try:
		existing.import_xml(modified_xml)
		log.startup("[push] graphical body applied for '{0}'".format(name))
	except Exception as e:
		raise RuntimeError("import_xml on '{0}' failed: {1}".format(name, e))


# Body-swap helper lives in `helpers.plcopen_xml` as `replace_body_in_pou`
# (parallel to TC's `BeckhoffConnection.ReplaceBodyInPou`). Single source
# of truth for the PLCopenXML body-replacement logic — also unit-tested
# in `CodesysBridge.Tests/test_plcopen_xml.py`.
