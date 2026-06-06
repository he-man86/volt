"""
Type-extension registry — ONE place per CODESYS scripting kind we
care about.

For each kind we want Volt to track (libraries, tasks, project info,
recipes, image pools, text lists, traces, etc.), we register a
`TypeExtension` here. The bridge handlers (refs / fetch / push) drive
off this registry instead of growing if/elif chains:

  * `iter_all_items` (codesys_connection.py)
        — walks the project tree; for each non-source item, looks up
          which extension's marker matches and emits accordingly.
  * `compute_item_version` (fetch.py)
        — uses the extension's formatter to render a text manifest,
          then SHA1s it. Same hash both /refs and /fetch produce.
  * Fetch dispatch (fetch.py)
        — builds the FetchedItem with the formatter's output as
          `sourceText`.

Adding a new kind = ONE entry below + ONE line in the agent's
`CONFIG_KIND_EXT` for the file extension. No four-place edits.

API discovery story: in CODESYS 3.5.21.40, typed scripting methods
register dynamically — `dir(item)` doesn't list them, but
`getattr(item, name)` finds them. Use the `/debug/try-attrs` endpoint
to probe candidate property names before wiring an extractor.
"""
# pyright: reportMissingImports=false


def _matches_marker(token, marker):
	# type: (str, str) -> bool
	"""Boundary-aware marker check.

	CODESYS marker strings are comma-separated capability lists inside
	`{...}`. The positive form `ScriptXxxObject,` and the negative
	`NoScriptXxxObject,` differ only by the preceding char (`{` / ` `
	vs `o`). Without this check, a `find(token)` would false-match
	the negative form.
	"""
	idx = marker.find(token)
	while idx != -1:
		prev = marker[idx - 1] if idx > 0 else "{"
		if prev in ("{", " "):
			return True
		idx = marker.find(token, idx + 1)
	return False


# ─── TypeExtension ───────────────────────────────────────────────────


class TypeExtension(object):
	"""Single CODESYS kind → Volt tracking declaration.

	Fields:
	  kind           vendor-neutral string the agent sees ("library",
	                 "task", "project_info"). Must match the agent's
	                 CONFIG_KIND_EXT key.
	  marker_token   substring (with trailing comma) of the CODESYS
	                 ScriptObject marker that identifies this kind.
	                 Boundary-checked so the negative `No*` form
	                 doesn't false-match.
	  drill          optional fn(parent_item) -> [(child_name, child_obj), ...]
	                 For container patterns (Library Manager, Task
	                 Configuration, Recipe Manager) where the parent
	                 wraps typed children we want to emit individually.
	                 None for self-typed items (e.g. Project Information
	                 — the item itself IS the typed thing).
	  formatter      fn(item) -> str
	                 Renders a deterministic text manifest. Same text
	                 the workspace receives AND that /refs hashes for
	                 drift detection. Must be byte-stable across
	                 invocations on unchanged data.
	  nest_children  bool — default True. When True and the item has
	                 children, the item's own file is nested INSIDE
	                 its own folder (hybrid pattern, see _build_extension
	                 _item). Set False for kinds whose `get_children()`
	                 returns internal nodes we DON'T emit as separate
	                 items (e.g. visualizations whose internal
	                 elements aren't tracked) so we don't nest needlessly.
	"""

	def __init__(self, kind, marker_token, formatter, drill=None, nest_children=True):
		self.kind = kind
		self.marker_token = marker_token
		self.formatter = formatter
		self.drill = drill
		self.nest_children = nest_children

	def matches(self, marker):
		# type: (str) -> bool
		return _matches_marker(self.marker_token, marker)


# ─── Formatters ──────────────────────────────────────────────────────


def _safe_attr(obj, name):
	"""getattr that swallows exceptions — returns None on any failure.
	Necessary because some CODESYS wrapper accessors raise on
	properties that exist in dir() but aren't readable at this
	moment (e.g. half-initialized state)."""
	try:
		return getattr(obj, name, None)
	except Exception:
		return None


def _stringify(val):
	"""Coerce a value to a stable string for the manifest."""
	if val is None:
		return None
	if isinstance(val, bool):
		return "true" if val else "false"
	s = str(val)
	return s if s else None


def _emit_pairs(pairs):
	"""Render a `[(key, value), ...]` list as `key = value` lines,
	skipping None values. Deterministic — input order is preserved."""
	lines = []
	for key, value in pairs:
		v = _stringify(value)
		if v is None:
			continue
		lines.append("{0} = {1}".format(key, v))
	return "\n".join(lines) + "\n" if lines else ""


def format_library_ref(libref):
	"""Library placeholder reference → text manifest.

	Two layers of data:
	  1. The REFERENCE itself (`ScriptPlaceholderReference`) — how the
	     project points at the library: name, namespace, resolution,
	     placeholder/managed/redirected/optional flags.
	  2. The MANAGED LIBRARY (`ScriptLibManObject`) the ref resolves to,
	     when `is_managed` is true — the library's OWN metadata: title,
	     version, company, default-namespace, categories, dependencies.
	     This is the canonical "what library is actually loaded" info an
	     AI needs to know which APIs are available in the project.

	See https://content.helpme-codesys.com/en/ScriptingEngine/ for the
	property surface — both objects expose CLR properties via getattr.
	"""
	pairs = [
		("name", _safe_attr(libref, "name")),
		("placeholder", _safe_attr(libref, "placeholder_name")),
		("namespace", _safe_attr(libref, "namespace")),
		("resolution", _safe_attr(libref, "effective_resolution")),
		("default-resolution", _safe_attr(libref, "default_resolution")),
		("managed", _safe_attr(libref, "is_managed")),
		("placeholder-only", _safe_attr(libref, "is_placeholder")),
		("redirected", _safe_attr(libref, "is_redirected")),
		("optional", _safe_attr(libref, "optional")),
		("system", _safe_attr(libref, "system_library")),
		("qualified-only", _safe_attr(libref, "qualified_only")),
		("resolution-info", _safe_attr(libref, "resolution_info")),
	]

	# Managed-library metadata — only present when the reference points
	# at a concrete library (not a still-unresolved placeholder). The
	# tuple <company, title, version> is what uniquely identifies the
	# library in CODESYS's library repository.
	managed = _safe_attr(libref, "managed_library")
	if managed is not None:
		pairs.extend([
			("title", _safe_attr(managed, "title")),
			("version", _safe_attr(managed, "version")),
			("company", _safe_attr(managed, "company")),
			("default-namespace", _safe_attr(managed, "default_namespace")),
			("categories", _format_lib_categories(_safe_attr(managed, "categories"))),
		])

	# Library DEPENDENCIES (other libraries this one transitively needs).
	# `dependencies` lives on the reference itself per the ScriptingEngine
	# docs; for a managed lib it mirrors `managed_library.parameters`.
	# Knowing the dep chain helps an AI reason about transitive symbol
	# availability without re-walking the full library manager tree.
	deps = _safe_attr(libref, "dependencies")
	deps_text = _format_string_list(deps)
	if deps_text is not None:
		pairs.append(("dependencies", deps_text))

	return _emit_pairs(pairs)


def _format_lib_categories(cats):
	"""Render a list of LibCategory objects as a semicolon-joined string
	of their `name` attributes. Returns None on empty/missing input so
	`_emit_pairs` drops the field entirely — preserves the manifest's
	stable-shape invariant. Order from the API is preserved (CODESYS
	itself walks categories deterministically)."""
	if cats is None:
		return None
	try:
		names = []
		for c in cats:
			n = _safe_attr(c, "name")
			if n is not None:
				s = str(n).strip()
				if s:
					names.append(s)
		return "; ".join(names) if names else None
	except Exception:
		return None


def _format_string_list(items):
	"""Render an iterable of strings as a semicolon-joined value. Skips
	None / empty entries. Returns None when the input has nothing to
	emit, so `_emit_pairs` drops the line entirely."""
	if items is None:
		return None
	try:
		parts = []
		for s in items:
			if s is None:
				continue
			text = str(s).strip()
			if text:
				parts.append(text)
		return "; ".join(parts) if parts else None
	except Exception:
		return None


def format_task(task):
	"""IEC task → text manifest.

	Properties reachable via dynamic dispatch in CODESYS 3.5.21.40:
	priority / interval / kind_of_task / external_event / watchdog
	sub-object / pous iterable. None of these are in dir() but all
	resolve via getattr (verified /debug/try-attrs).
	"""
	pairs = [
		("kind", _safe_attr(task, "kind_of_task")),
		("priority", _safe_attr(task, "priority")),
		("interval", _safe_attr(task, "interval")),
		("external-event", _safe_attr(task, "external_event")),
	]
	# Watchdog sub-object — emit whatever properties it exposes.
	# SP-to-SP naming has varied; probe a few common variants.
	wd = _safe_attr(task, "watchdog")
	if wd is not None:
		for src, dst in (
			("is_active", "watchdog-active"),
			("active", "watchdog-active"),
			("sensitivity", "watchdog-sensitivity"),
			("threshold", "watchdog-threshold"),
			("threshold_time", "watchdog-threshold-time"),
			("time", "watchdog-time"),
		):
			v = _safe_attr(wd, src)
			if v is not None:
				pairs.append((dst, v))
	text = _emit_pairs(pairs)
	# POU call list — preserve declaration order (CODESYS calls them
	# in the listed sequence, so order is semantically meaningful).
	pous = _safe_attr(task, "pous")
	if pous is not None:
		try:
			pou_lines = []
			for entry in pous:
				try:
					nm = str(entry)
				except Exception:
					continue
				if nm:
					pou_lines.append("pou = {0}".format(nm))
			if pou_lines:
				text += "\n".join(pou_lines) + "\n"
		except Exception:
			pass
	return text


def format_recipe_manager(mgr):
	"""Recipe Manager → text manifest of its configuration settings.

	Confirmed via /debug/try-attrs in CODESYS 3.5.21.40:
	  storage_type → "textual" / "binary"
	More attrs MAY exist (recipe_file_extension, separator,
	save_at_runtime, with_value_check, ...) — probe at runtime via
	_safe_attr; whatever the SP exposes gets included, missing ones
	silently drop.
	"""
	return _emit_pairs([
		("storage-type", _safe_attr(mgr, "storage_type")),
		("storage-path", _safe_attr(mgr, "storage_path")),
		("recipe-file-extension", _safe_attr(mgr, "recipe_file_extension")),
		("separator", _safe_attr(mgr, "separator")),
		("save-at-runtime", _safe_attr(mgr, "save_at_runtime")),
		("sort-recipes-at-runtime", _safe_attr(mgr, "sort_recipes_at_runtime")),
		("with-value-check", _safe_attr(mgr, "with_value_check")),
		("unicode-recipe-file", _safe_attr(mgr, "unicode_recipe_file")),
		("update-value-change", _safe_attr(mgr, "update_value_change")),
	])


def format_trace(trace):
	"""Trace → text manifest of its sampling configuration.

	Confirmed: `resolution` → "MilliSeconds" / "Microseconds" / etc.
	Other attrs probed (task / sample_period / trigger) weren't present
	in 3.5.21.40 but may be in other SPs — included graceful-attempt
	style.
	"""
	return _emit_pairs([
		("resolution", _safe_attr(trace, "resolution")),
		("task", _safe_attr(trace, "task")),
		("sample-period", _safe_attr(trace, "sample_period")),
		("trigger-variable", _safe_attr(trace, "trigger_variable")),
		("trigger-edge", _safe_attr(trace, "trigger_edge")),
		("trigger-position", _safe_attr(trace, "trigger_position")),
	])


def format_image_pool(pool):
	"""Image Pool → text manifest listing each image entry.

	The `images` attribute is a `ScriptImagePoolItems` collection
	(confirmed iterable). Each entry is expected to expose `id` /
	`name` / `file_name` / `path` properties — graceful probe on
	each.
	"""
	lines = []
	images = _safe_attr(pool, "images")
	if images is not None:
		try:
			for img in images:
				entry_id = _safe_attr(img, "id")
				name = _safe_attr(img, "name") or _safe_attr(img, "file_name")
				path = _safe_attr(img, "path") or _safe_attr(img, "file_name")
				parts = []
				if entry_id is not None:
					parts.append("id={0}".format(entry_id))
				if name:
					parts.append("name={0}".format(name))
				if path and path != name:
					parts.append("path={0}".format(path))
				if parts:
					lines.append("image: " + ", ".join(parts))
		except Exception:
			pass
	# Deterministic order — preserve iteration order (CODESYS keeps it
	# stable per project) without sorting which would obscure the
	# original sequence.
	return ("\n".join(lines) + "\n") if lines else ""


def format_text_list(textlist):
	"""Text List → text manifest of every translation row.

	`rows` is a `ScriptTextListItems` collection. Each row exposes
	the text id plus per-language translations (column structure
	varies by SP). Render as `<id> | <lang1>=<val1> | <lang2>=<val2>`
	when extractable, otherwise `<id>` alone — but NEVER fall back to
	`str(row)`, which emits the CLR object's address (changes per
	call → spurious version churn → phantom drift on every /refs).
	The bridge's `live-wire-invariants.test.ts` per-item-version-
	stability test will trip when this regresses.
	"""
	lines = []
	rows = _safe_attr(textlist, "rows")
	if rows is None:
		return ""
	try:
		for row in rows:
			row_id = _safe_attr(row, "id") or _safe_attr(row, "text_id")
			row_text = _extract_text_list_row(row)
			id_str = "{0}".format(row_id) if row_id is not None else "?"
			if row_text is not None:
				lines.append("{0} | {1}".format(id_str, row_text))
			else:
				lines.append(id_str)
	except Exception:
		pass
	return ("\n".join(lines) + "\n") if lines else ""


def _extract_text_list_row(row):
	"""Pull row content via every API shape CODESYS Scripting has
	exposed across SPs. Returns a deterministic string (or None
	when no shape applies — caller renders just the row id).

	Probe order matches the scripting docs at helpme-codesys.com:
	  1. `.values` — dict of {language: translation} (SP21+ shape)
	  2. `.texts`  — list of (language, translation) tuples
	  3. iter(row) — some SPs expose row as a tuple-like
	"""
	# Shape 1: .values dict
	values = _safe_attr(row, "values")
	if values is not None:
		try:
			items = sorted(values.items(), key=lambda kv: str(kv[0]))
			return " | ".join(
				"{0}={1}".format(k, _stringify(v) or "") for k, v in items
			)
		except Exception:
			pass
	# Shape 2: .texts list of (language, translation) pairs
	texts = _safe_attr(row, "texts")
	if texts is not None:
		try:
			pairs = []
			for t in texts:
				lang = _safe_attr(t, "language") or _safe_attr(t, "key")
				val = _safe_attr(t, "text") or _safe_attr(t, "value")
				if lang is not None:
					pairs.append("{0}={1}".format(_stringify(lang) or "?", _stringify(val) or ""))
			if pairs:
				pairs.sort()
				return " | ".join(pairs)
		except Exception:
			pass
	# Shape 3: iter the row as a sequence (column-oriented SPs)
	try:
		cols = [_stringify(c) or "" for c in row]
		# Drop columns whose only content is a CLR-address marker
		# (`<...object at 0x...>`) — defensive in case _stringify
		# happens to pass one through.
		cols = [c for c in cols if not (c.startswith("<") and "object at 0x" in c)]
		if cols:
			return " | ".join(cols)
	except Exception:
		pass
	return None


def format_visualization_manager(mgr):
	"""Visualization Manager → text manifest of its settings.

	Earlier probe found nothing on this kind, but the SP may expose
	settings on a sub-object. Try the documented names anyway —
	missing ones return None and silently drop.
	"""
	return _emit_pairs([
		("used-text-list", _safe_attr(mgr, "used_text_list")),
		("used-image-pool", _safe_attr(mgr, "used_image_pool")),
		("startup-visualization", _safe_attr(mgr, "startup_visualization")),
		("style", _safe_attr(mgr, "style")),
		("target-visualization", _safe_attr(mgr, "target_visualization")),
	])


def format_visualization(visu):
	"""Visualization (screen) → empty manifest.

	Probed CODESYS 3.5.21.40 via /debug/try-attrs with ~20 candidate
	attribute names (size, elements, used_text_lists, root, etc.) —
	none resolve. The visualization wrapper exposes only the generic
	IScriptObject surface; CODESYS has a separate Visualization
	Scripting API but it isn't loaded by default (and the docs are
	sparse).

	We still emit the item as a TRACKED kind so the engineer/agent
	sees `<name>.visualization` in the workspace tree — structural
	presence is visible (added / removed / renamed visualizations
	surface via structureVersion). The CONTENT is empty by design:
	we don't pretend to track edits inside the visualization. When
	the Visualization Scripting API is loadable or CODESYS exposes
	typed accessors, fill this in.
	"""
	return ""


def format_device(device):
	"""Device node → text manifest of its identification.

	CODESYS device wrappers expose `get_device_identification()` (a
	method, not a property — that's why /debug/try-attrs needs the
	`get_` prefix to find it). It returns a typed `DeviceID` object
	with `.type` (int), `.Id` (vendor-product string), `.Version`
	(device firmware/hardware revision).

	Example outputs probed on this project:
	  EtherCAT_Master  → DeviceID(type=64, Id='1028 0100',   Version='3.32.0.1')
	  L_i750_Pinion_1  → DeviceID(type=65, Id='3B_6907...',  Version='1.4.0.7')

	These three fields uniquely identify the device hardware/firmware
	combo, so when an engineer swaps axis types or upgrades firmware
	the hash changes and Volt sees a diff.
	"""
	pairs = []
	# Method-call accessors first.
	get_dev_id = _safe_attr(device, "get_device_identification")
	if callable(get_dev_id):
		try:
			dev_id = get_dev_id()
		except Exception:
			dev_id = None
		if dev_id is not None:
			pairs.append(("device-type", _safe_attr(dev_id, "type")))
			pairs.append(("device-id", _safe_attr(dev_id, "Id")))
			pairs.append(("device-version", _safe_attr(dev_id, "Version")))
	# `is_enabled` is a method too — call if present so the value
	# reflects the current enable state.
	is_enabled = _safe_attr(device, "is_enabled")
	if callable(is_enabled):
		try:
			pairs.append(("enabled", is_enabled()))
		except Exception:
			pass
	# Some SPs also expose user-friendly metadata as properties.
	for src, dst in (
		("vendor", "vendor"),
		("vendor_name", "vendor"),
		("product_name", "product"),
		("hardware_revision", "hardware-revision"),
		("connector_type", "connector"),
		("description", "description"),
	):
		v = _safe_attr(device, src)
		if v is not None:
			pairs.append((dst, v))
	return _emit_pairs(pairs)


def format_symbol_config(symcfg):
	"""Symbols / Symbol Configuration → text manifest.

	Confirmed: `is_symbol_config = True`. Other useful attrs likely
	live on a sub-object; probe via candidate names.
	"""
	return _emit_pairs([
		("is-symbol-config", _safe_attr(symcfg, "is_symbol_config")),
		("libraries-enabled", _safe_attr(symcfg, "libraries_enabled")),
		("xml-output-path", _safe_attr(symcfg, "xml_output_path")),
	])


def format_project_info(info):
	"""Project Information → text manifest.

	`ScriptProjectInfo` exposes title / author / company / description /
	version directly, plus an arbitrary `values` dictionary for
	user-added fields. Verified via /debug/try-attrs on CODESYS
	3.5.21.40.
	"""
	pairs = [
		("title", _safe_attr(info, "title")),
		("version", _safe_attr(info, "version")),
		("author", _safe_attr(info, "author")),
		("company", _safe_attr(info, "company")),
		("description", _safe_attr(info, "description")),
	]
	text = _emit_pairs(pairs)
	# Extra user-added fields live in a dict-like `values` attr.
	# Iterate keys deterministically (sorted) so the manifest is
	# stable across calls.
	values = _safe_attr(info, "values")
	if values is not None:
		try:
			extra = []
			# IronPython exposes the dict via items() typically.
			try:
				items = list(values.items())
			except Exception:
				items = []
			# Skip the well-known fields we already emitted.
			known = ("title", "version", "author", "company", "description")
			for key, val in sorted(items, key=lambda kv: str(kv[0])):
				k_str = str(key).strip()
				if not k_str or k_str.lower() in known:
					continue
				v_str = _stringify(val)
				if v_str is not None:
					extra.append("custom:{0} = {1}".format(k_str, v_str))
			if extra:
				text += "\n".join(extra) + "\n"
		except Exception:
			pass
	return text


# ─── Container drillers ──────────────────────────────────────────────


def _drill_library_manager(mgr):
	"""Library Manager → list of (placeholder_name, libref).

	Refs come from `.references` (typed iter). We strip the leading
	`#` that some refs carry on their `name` so the workspace
	filename is clean (`IoStandard.library`, not `#IoStandard.library`).
	"""
	out = []
	try:
		refs = list(mgr.references)
	except Exception:
		return out
	for ref in refs:
		try:
			nm = getattr(ref, "placeholder_name", None) or getattr(ref, "name", None)
		except Exception:
			continue
		if not nm:
			continue
		out.append((str(nm).lstrip("#"), ref))
	return out


def _drill_task_configuration(tc):
	"""Task Configuration → list of (task_name, task).

	Children come from `get_children()`. We filter to only items
	whose marker contains `ScriptTaskObject,` (multicore projects
	can also contain Task Group wrappers under the same parent;
	those don't have the typed properties we extract).
	"""
	out = []
	try:
		children = list(tc.get_children(recursive=False))
	except Exception:
		return out
	for task in children:
		try:
			marker = str(task)
		except Exception:
			continue
		if not _matches_marker("ScriptTaskObject,", marker):
			continue
		try:
			nm = task.get_name() if hasattr(task, "get_name") else None
		except Exception:
			continue
		if not nm:
			continue
		out.append((nm, task))
	return out


# ─── Registry ────────────────────────────────────────────────────────


EXTENSIONS = [
	# Containers — manager isn't emitted; its typed children are.
	TypeExtension(
		kind="library",
		marker_token="ScriptLibManObject,",
		formatter=format_library_ref,
		drill=_drill_library_manager,
	),
	TypeExtension(
		kind="task",
		marker_token="ScriptTaskConfigObject,",
		formatter=format_task,
		drill=_drill_task_configuration,
	),
	# Self-typed items — the item IS the typed thing, no drill.
	# Order doesn't matter; matching_for_marker returns first hit.
	TypeExtension(
		kind="project_info",
		marker_token="ScriptProjectInfo,",
		formatter=format_project_info,
		drill=None,
	),
	TypeExtension(
		kind="recipe_manager",
		marker_token="ScriptRecipeManObject,",
		formatter=format_recipe_manager,
		drill=None,
	),
	TypeExtension(
		kind="trace",
		marker_token="ScriptTraceObject,",
		formatter=format_trace,
		drill=None,
	),
	TypeExtension(
		kind="image_pool",
		marker_token="ScriptImagePoolObject,",
		formatter=format_image_pool,
		drill=None,
	),
	TypeExtension(
		kind="text_list",
		marker_token="ScriptTextListObject,",
		formatter=format_text_list,
		drill=None,
	),
	TypeExtension(
		kind="visualization_manager",
		marker_token="ScriptVisualObjectContainer,",
		formatter=format_visualization_manager,
		drill=None,
	),
	TypeExtension(
		kind="symbol_config",
		marker_token="ScriptSymbolConfigObject,",
		formatter=format_symbol_config,
		drill=None,
	),
	TypeExtension(
		kind="device",
		marker_token="ScriptDeviceObject,",
		formatter=format_device,
		drill=None,
	),
	TypeExtension(
		kind="visualization",
		marker_token="ScriptVisualObject,",
		formatter=format_visualization,
		drill=None,
		# Visualizations have INTERNAL element children (buttons,
		# frames, rectangles) that we DON'T track. Skip the hybrid-
		# folder nesting so the .visualization file lives alongside
		# siblings rather than inside a needless `<name>/` folder.
		nest_children=False,
	),
]


def by_kind(kind):
	# type: (str) -> object
	"""Look up an extension by its vendor-neutral kind string.
	Returns None if not registered."""
	for ext in EXTENSIONS:
		if ext.kind == kind:
			return ext
	return None


def matching_for_marker(marker):
	# type: (str) -> object
	"""First extension whose marker_token matches `marker` (with
	boundary safety). Returns None if no extension claims this kind."""
	for ext in EXTENSIONS:
		if ext.matches(marker):
			return ext
	return None
