"""
GET /debug/* — read-only introspection of the CODESYS Scripting
Engine surface for live diagnosis.

These endpoints don't change anything in the project; they just dump
what `scriptengine` actually returns so we can patch handlers
without guessing about per-SP API differences.

Endpoints:
  GET /debug/project   info about projects.primary
                        (str marker, attrs, name/path probes)
  GET /debug/flat      flat list of every descendant via
                        proj.get_children(recursive=True),
                        with type marker + name + decl preview
  GET /debug/tree      hierarchical dump of the project tree
                        (depth-limited), each node showing
                        marker + attrs + name probes
  GET /debug/item?name=X   introspect a specific item by name
                            (uses CodesysConnection.find_by_name)

Output is JSON, schema-free — these are for debugging by humans,
not for the agent's zod-validated wire surface.
"""
# pyright: reportMissingImports=false
from .. import ui_thread


_MAX_TREE_DEPTH = 6


def handle_project(connection):
	# type: (object) -> dict
	def _do():
		proj = connection.get_project()
		if proj is None:
			return {"error": "scriptengine.projects.primary returned None"}
		return _introspect(proj, include_children=False)
	return ui_thread.invoke_on_ui(_do)


def handle_flat(connection):
	# type: (object) -> dict
	def _do():
		proj = connection.get_project()
		if proj is None:
			return {"error": "scriptengine.projects.primary returned None"}
		try:
			children = list(proj.get_children(recursive=True))
		except Exception as e:
			return {"error": "get_children(recursive=True) failed: {0}".format(e)}
		out = []
		for c in children:
			out.append(_introspect(c, include_children=False, include_attrs=False))
		return {"count": len(out), "items": out}
	return ui_thread.invoke_on_ui(_do)


def handle_tree(connection):
	# type: (object) -> dict
	def _do():
		proj = connection.get_project()
		if proj is None:
			return {"error": "scriptengine.projects.primary returned None"}
		return _introspect(proj, include_children=True, depth=0)
	return ui_thread.invoke_on_ui(_do)


def handle_item(connection, query):
	# type: (object, dict) -> dict
	name = query.get("name")
	if not name:
		return {"error": "missing ?name= query"}
	def _do():
		item = connection.find_by_name(name)
		if item is None:
			return {"error": "no item named '{0}' found".format(name)}
		return _introspect(item, include_children=True, depth=0)
	return ui_thread.invoke_on_ui(_do)


def handle_probe(connection, query):
	# type: (object, dict) -> dict
	"""Exhaustive surface dump for a single CODESYS item. Used to
	decide whether POU kind / language can be read STRUCTURALLY
	(authoritative, Beckhoff-parity) instead of via header-text parse.
	Returns EVERY useful piece of evidence we can extract:

	  * the marker string (already known authoritative)
	  * the wrapper's Python type, MRO, and class-level dir()
	    (these may reveal class-level methods that dir(item) hides)
	  * structured-attribute probes across a broad name catalog
	    (snake_case, CamelCase, COM-style, boolean predicates)
	  * .NET CLR type info when available (IronPython exposes
	    item.GetType() for COM-wrapped objects)
	"""
	name = query.get("name")
	if not name:
		return {"error": "missing ?name= query"}

	def _do():
		item = connection.find_by_name(name)
		if item is None:
			return {"error": "no item named '{0}' found".format(name)}

		report = {"name": name}

		# 1. Marker (authoritative container-kind classifier).
		try:
			report["marker"] = str(item)
		except Exception as e:
			report["marker"] = "<str() failed: {0}>".format(e)

		# 2. Python-side type metadata. dir(item) is empty on Script
		#    wrappers, but dir(type(item)) often shows class methods.
		try:
			py_type = type(item)
			report["py_type"] = repr(py_type)
			report["py_type_name"] = getattr(py_type, "__name__", None)
			report["py_type_module"] = getattr(py_type, "__module__", None)
		except Exception as e:
			report["py_type"] = "<type() failed: {0}>".format(e)
		try:
			report["py_type_dir"] = sorted([a for a in dir(type(item)) if not a.startswith("_")])
		except Exception as e:
			report["py_type_dir"] = "<failed: {0}>".format(e)
		try:
			report["py_type_mro"] = [repr(c) for c in type(item).__mro__]
		except Exception:
			pass

		# 3. .NET CLR type (IronPython wraps COM objects with
		#    GetType() that returns the underlying CLR Type). The
		#    CLR Type exposes interfaces / properties / methods that
		#    Python's dir() doesn't see.
		try:
			gt = getattr(item, "GetType", None)
			if callable(gt):
				clr_type = gt()
				report["clr_type"] = str(clr_type)
				try:
					report["clr_full_name"] = clr_type.FullName
				except Exception:
					pass
				try:
					report["clr_namespace"] = clr_type.Namespace
				except Exception:
					pass
				try:
					ifaces = list(clr_type.GetInterfaces())
					report["clr_interfaces"] = [str(i) for i in ifaces]
				except Exception as e:
					report["clr_interfaces_err"] = str(e)
				try:
					props = list(clr_type.GetProperties())
					report["clr_properties"] = sorted([p.Name for p in props])
				except Exception as e:
					report["clr_properties_err"] = str(e)
				try:
					methods = list(clr_type.GetMethods())
					# Filter to interesting names (drop Object/COM noise).
					names = sorted(set(
						m.Name for m in methods
						if not m.Name.startswith("get_")
						and not m.Name.startswith("set_")
						and m.Name not in ("Equals", "GetHashCode", "GetType", "ToString")
					))
					report["clr_methods"] = names
				except Exception as e:
					report["clr_methods_err"] = str(e)
		except Exception as e:
			report["clr_err"] = str(e)

		# 4. Broad attribute-name catalog probe. Names cover three
		#    style families that CODESYS / Lenze / Schneider OEMs have
		#    historically used, plus boolean predicates.
		CANDIDATES = [
			# kind / type identifiers
			"pou_type", "PouType", "pouType", "type", "Type", "kind", "Kind",
			"category", "Category", "iec_type", "IecType",
			"language", "Language", "iec_language", "IECLanguage",
			"implementation_language", "ImplementationLanguage",
			"object_type", "ObjectType",
			"type_id", "TypeId", "type_name", "TypeName",
			"object_kind", "ObjectKind",
			# boolean predicates (typical .NET-ish CamelCase + snake_case)
			"is_function_block", "IsFunctionBlock",
			"is_function", "IsFunction",
			"is_program", "IsProgram",
			"is_interface", "IsInterface",
			"is_method", "IsMethod",
			"is_action", "IsAction",
			"is_property", "IsProperty",
			"is_dut", "IsDut", "is_struct", "IsStruct",
			"is_enum", "IsEnum", "is_alias", "IsAlias",
			"is_union", "IsUnion", "is_gvl", "IsGvl",
			"is_transition", "IsTransition",
			# CODESYS Scripting Engine specifics
			"has_textual_declaration", "has_textual_implementation",
			"textual_language", "TextualLanguage",
			"folder_path", "FolderPath",
			"parent", "Parent", "guid", "Guid",
			# ─── Non-ST language probes ────────────────────────────
			# Tell us if the POU is ST/IL/LD/FBD/SFC/CFC. CODESYS
			# stores the editor language per-POU and we need to know
			# which API exposes it (so the wire can either emit a
			# textual ST source OR mark the POU as "graphical, source
			# not available as text").
			"is_st", "IsSt", "is_il", "IsIl", "is_ld", "IsLd",
			"is_fbd", "IsFbd", "is_sfc", "IsSfc", "is_cfc", "IsCfc",
			"editor_language", "EditorLanguage",
			"body_language", "BodyLanguage",
			"graphical_language", "GraphicalLanguage",
			"is_graphical", "IsGraphical",
			"is_textual_pou", "IsTextualPou",
			"has_graphical_implementation", "HasGraphicalImplementation",
			# Export APIs (likely path for graphical POU source extract):
			# CODESYS supports PLCopenXML export, sometimes per-object,
			# sometimes only project-wide.
			"export_xml", "ExportXml", "export_to_xml", "ExportToXml",
			"export_native", "ExportNative", "export", "Export",
			"to_plcopenxml", "ToPlcopenxml",
			"graphical_implementation", "GraphicalImplementation",
			"network_count", "NetworkCount",  # FBD/LD networks
			"step_count", "StepCount",        # SFC steps
		]
		found = {}
		missing = []
		errors = {}
		for attr in CANDIDATES:
			try:
				val = getattr(item, attr, _MISSING)
			except Exception as e:
				errors[attr] = "getattr raised: {0}".format(e)
				continue
			if val is _MISSING:
				missing.append(attr)
				continue
			try:
				if callable(val):
					try:
						resolved = val()
						found[attr + "()"] = _coerce(resolved)
					except TypeError:
						found[attr] = "<callable, needs args>"
					except Exception as e:
						errors[attr + "()"] = "call raised: {0}".format(e)
				else:
					found[attr] = _coerce(val)
			except Exception as e:
				errors[attr] = "resolve failed: {0}".format(e)
		report["probe_found"] = found
		report["probe_missing_count"] = len(missing)
		report["probe_errors"] = errors

		return report

	return ui_thread.invoke_on_ui(_do)


# Sentinel for "attribute not present at all" — distinguishes from
# an attribute that's present but returns None.
class _Missing(object):
	def __repr__(self):
		return "<MISSING>"

_MISSING = _Missing()


# ─── Introspection helpers ───────────────────────────────────────────


def _introspect(item, include_children=False, include_attrs=True, depth=0):
	# type: (object, bool, bool, int) -> dict
	info = {}

	# Type marker (most important diagnostic).
	try:
		info["type"] = str(item)
	except Exception as e:
		info["type"] = "<str() failed: {0}>".format(e)

	# Common name / path attrs (different SPs use different ones).
	for attr in ("name", "path", "FilePath"):
		try:
			val = getattr(item, attr, None)
			if val is not None and not callable(val):
				info[attr] = _coerce(val)
		except Exception:
			pass

	# Common method probes — only call zero-arg ones that are safe.
	for method in ("get_name",):
		fn = getattr(item, method, None)
		if callable(fn):
			try:
				info["{0}()".format(method)] = _coerce(fn())
			except Exception as e:
				info["{0}()".format(method)] = "<call failed: {0}>".format(e)

	# Textual declaration preview (if available).
	td = getattr(item, "textual_declaration", None)
	if td is not None:
		try:
			text = td.text or ""
			info["decl_preview"] = text[:300]
			info["decl_len"] = len(text)
		except Exception as e:
			info["decl_preview"] = "<read failed: {0}>".format(e)

	# Implementation preview (if available).
	ti = getattr(item, "textual_implementation", None)
	if ti is not None:
		try:
			text = ti.text or ""
			info["impl_preview"] = text[:200]
			info["impl_len"] = len(text)
		except Exception:
			pass

	# Attribute list — filtered to non-dunder + non-builtin.
	if include_attrs:
		try:
			info["attrs"] = sorted([a for a in dir(item) if not a.startswith("_")])
		except Exception:
			pass

	# Children (depth-limited).
	if include_children:
		if depth >= _MAX_TREE_DEPTH:
			info["children"] = "<max depth reached>"
			return info
		try:
			children = list(item.get_children(recursive=False))
		except Exception as e:
			info["children"] = "<get_children failed: {0}>".format(e)
			return info
		info["child_count"] = len(children)
		dumped = []
		for c in children:
			dumped.append(_introspect(c, include_children=True, include_attrs=False, depth=depth + 1))
		info["children"] = dumped

	return info


def _coerce(val):
	# type: (object) -> object
	"""Make sure the value is JSON-encodable."""
	if val is None or isinstance(val, (bool, int, float)):
		return val
	try:
		return str(val)
	except Exception:
		return "<coerce failed>"
