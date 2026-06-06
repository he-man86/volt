"""
GET /debug/* — read-only introspection of the CODESYS Scripting
Engine surface for live diagnosis.

These endpoints don't change anything in the project; they just dump
what `scriptengine` actually returns so we can patch handlers
without guessing about per-SP API differences.

Endpoints:
  GET /debug/project   info about projects.primary
  GET /debug/flat      flat list of every descendant
  GET /debug/tree      hierarchical project dump (depth-limited)
  GET /debug/item      introspect a specific item by name
  GET /debug/build-id  bundle build identifier (sanity check after reload)

  **GET /debug/inspect — the swiss-army knife.** One endpoint, every
  introspection mode the bridge needs. Replaces the ad-hoc probes
  (/debug/probe, /debug/properties, /debug/library-refs,
  /debug/modification-signals, /debug/native-overloads). See its
  docstring for parameters.

Output is JSON, schema-free — these are for debugging by humans,
not for the agent's zod-validated wire surface.
"""
# pyright: reportMissingImports=false
import re

from .. import ui_thread


_MAX_TREE_DEPTH = 6


# ─── /debug/inspect — unified introspection ─────────────────────────────


def handle_try_attrs(connection, query):
	# type: (object, dict) -> dict
	"""Probe ONE item with an EXPLICIT list of candidate attribute
	names — not via dir() but via direct `getattr(item, name)`.

	IronPython exposes CODESYS scripting extension methods through
	dynamic dispatch that often doesn't show up in `dir()` or CLR
	reflection. The only way to verify whether an attribute is
	reachable is to ask for it by name. This endpoint takes a comma-
	separated list and reports the outcome of each lookup.

	Query: ?name=<item>&attrs=<a,b,c,...>
	"""
	name = query.get("name")
	attrs_str = query.get("attrs")
	if not name or not attrs_str:
		return {"error": "missing ?name= or ?attrs= (comma-separated)"}

	def _coerce(v):
		if v is None or isinstance(v, (bool, int, float, str)):
			return v
		try:
			return str(v)
		except Exception:
			return "<coerce failed>"

	def _do():
		item = connection.find_by_name(name)
		if item is None:
			return {"error": "no item named '{0}' found".format(name)}

		report = {"name": name, "attrs": {}}
		for attr in [a.strip() for a in attrs_str.split(",") if a.strip()]:
			try:
				val = getattr(item, attr)
			except AttributeError as e:
				report["attrs"][attr] = "<missing: {0}>".format(e)
				continue
			except Exception as e:
				report["attrs"][attr] = "<raised: {0}>".format(e)
				continue
			if callable(val):
				try:
					resolved = val()
					report["attrs"][attr + "()"] = _coerce(resolved)
				except TypeError:
					report["attrs"][attr] = "<callable, needs args>"
				except Exception as e:
					report["attrs"][attr + "()"] = "<call raised: {0}>".format(e)
			else:
				report["attrs"][attr] = _coerce(val)
		return report

	return ui_thread.invoke_on_ui(_do)


def handle_inspect(connection, query):
	# type: (object, dict) -> dict
	"""Inspect a CODESYS scripting object (or container) in one of
	several modes. ONE endpoint subsumes every per-purpose probe we
	wrote during the bridge bring-up.

	Query parameters:
	  name        item name (required), looked up via find_by_name
	  traverse    'none'        only the item itself (default)
	              'children'    + get_children(recursive=False)
	              'iter'        + iter(item) — typed iteration (works
	                              on Library Manager, returning the
	                              specialized lib-ref wrappers)
	              'references'  + item.references property if present
	              'auto'        try iter → references → children, take
	                              the first non-empty result
	  filter      regex; only attrs whose name matches are reported.
	              Omit to report every readable attribute.
	  methods     'true' to also auto-invoke zero-arg method-like
	              attrs. Default 'false' (safer — some methods have
	              side effects).
	  overloads   'true' to also list .NET method overloads (every
	              method on the type, with parameter types + return).
	              Default 'false'. Useful for finding "is there a
	              version of export_native I haven't tried?"

	Output shape:
	  {
	    "root": {
	      "name": "...",
	      "marker": "ScriptObject{...}",
	      "py_type": "...",
	      "clr_type": "...",
	      "attrs": {<name>: <value or "<callable>" or "<error>"}},
	      "methods": {<name>: <return value>},    # if methods=true
	      "overloads": [{name, signature, return_type}]   # if overloads=true
	    },
	    "children": [<same shape as root>],
	    "traversal": [{method, count|error}]   # what we tried
	  }
	"""
	name = query.get("name")
	if not name:
		return {"error": "missing ?name= query"}
	traverse = query.get("traverse", "none")
	filter_str = query.get("filter")
	want_methods = _truthy(query.get("methods"))
	want_overloads = _truthy(query.get("overloads"))

	filter_re = None
	if filter_str:
		try:
			filter_re = re.compile(filter_str, re.IGNORECASE)
		except Exception as e:
			return {"error": "invalid ?filter= regex: {0}".format(e)}

	def _do():
		item = connection.find_by_name(name)
		if item is None:
			return {"error": "no item named '{0}' found".format(name)}

		report = {
			"name": name,
			"traverse": traverse,
			"root": _introspect_one(item, filter_re, want_methods, want_overloads),
			"children": [],
			"traversal": [],
		}
		if traverse != "none":
			children, attempts = _enumerate_children(item, traverse)
			report["traversal"] = attempts
			for child in children:
				report["children"].append(
					_introspect_one(child, filter_re, want_methods, want_overloads)
				)
		return report

	return ui_thread.invoke_on_ui(_do)


def _truthy(v):
	# type: (object) -> bool
	if isinstance(v, bool):
		return v
	if isinstance(v, str):
		return v.lower() in ("1", "true", "yes", "y", "on")
	return False


def _enumerate_children(item, mode):
	# type: (object, str) -> tuple
	"""Try the requested traversal mode; return (children, attempts).
	`attempts` is a list of {method, count|error} for the caller's
	visibility. For mode='auto', tries iter → references → children
	in that order, taking the first non-empty result."""
	attempts = []

	def _try_iter():
		try:
			out = list(iter(item))
			attempts.append({"method": "iter", "count": len(out)})
			return out
		except Exception as e:
			attempts.append({"method": "iter", "error": str(e)})
			return None

	def _try_references():
		if not hasattr(item, "references"):
			attempts.append({"method": "references", "error": "attr missing"})
			return None
		try:
			out = list(item.references)
			attempts.append({"method": "references", "count": len(out)})
			return out
		except Exception as e:
			attempts.append({"method": "references", "error": str(e)})
			return None

	def _try_children():
		try:
			out = list(item.get_children(recursive=False))
			attempts.append({"method": "children", "count": len(out)})
			return out
		except Exception as e:
			attempts.append({"method": "children", "error": str(e)})
			return None

	if mode == "iter":
		return (_try_iter() or [], attempts)
	if mode == "references":
		return (_try_references() or [], attempts)
	if mode == "children":
		return (_try_children() or [], attempts)
	if mode == "auto":
		for fn in (_try_iter, _try_references, _try_children):
			result = fn()
			if result:
				return (result, attempts)
		return ([], attempts)
	attempts.append({"method": mode, "error": "unknown traverse mode"})
	return ([], attempts)


def _introspect_one(item, filter_re, want_methods, want_overloads):
	# type: (object, object, bool, bool) -> dict
	"""Dump one item — marker, py type, clr type, attrs (filtered),
	optionally method-call results, optionally CLR method overloads."""
	report = {}
	try:
		report["marker"] = str(item)
	except Exception as e:
		report["marker"] = "<str() failed: {0}>".format(e)
	try:
		report["name"] = item.get_name() if hasattr(item, "get_name") else None
	except Exception:
		report["name"] = None
	try:
		report["py_type"] = repr(type(item))
	except Exception:
		pass
	try:
		gt = getattr(item, "GetType", None)
		if callable(gt):
			report["clr_type"] = str(gt())
	except Exception:
		pass

	# Discover attribute names: dir(item) ∪ dir(type(item)) ∪
	# CLR property reflection. IronPython hides instance attrs on
	# wrappers, so the type-level dir is where the names live.
	names = set()
	for src in (item, type(item)):
		try:
			for a in dir(src):
				if not a.startswith("_"):
					names.add(a)
		except Exception:
			pass
	try:
		gt = getattr(item, "GetType", None)
		if callable(gt):
			for p in gt().GetProperties():
				try:
					if len(p.GetIndexParameters()) == 0:
						names.add(p.Name)
				except Exception:
					pass
	except Exception:
		pass

	attrs = {}
	methods = {}
	for attr in sorted(names):
		if filter_re is not None and not filter_re.search(attr):
			continue
		try:
			val = getattr(item, attr)
		except Exception as e:
			attrs[attr] = "<getattr raised: {0}>".format(e)
			continue
		if callable(val):
			if want_methods:
				try:
					resolved = val()
					methods[attr] = _coerce(resolved)
				except TypeError:
					attrs[attr] = "<callable, needs args>"
				except Exception as e:
					methods[attr] = "<call raised: {0}>".format(e)
			else:
				attrs[attr] = "<callable>"
		else:
			attrs[attr] = _coerce(val)
	report["attrs"] = attrs
	if want_methods:
		report["methods"] = methods

	if want_overloads:
		report["overloads"] = _list_overloads(item, filter_re)

	return report


def _list_overloads(item, filter_re):
	# type: (object, object) -> list
	"""Enumerate every CLR method on the item's type, optionally
	filtered. Each entry includes parameter types + return type so
	the caller can spot useful overloads (e.g. is there an
	`export_native` variant returning a string?)."""
	out = []
	try:
		gt = getattr(item, "GetType", None)
		if not callable(gt):
			return out
		clr_type = gt()
		for m in clr_type.GetMethods():
			if filter_re is not None and not filter_re.search(m.Name):
				continue
			try:
				params = m.GetParameters()
				sig = ", ".join(
					"{0} {1}".format(p.ParameterType.Name, p.Name) for p in params
				)
				out.append({
					"name": m.Name,
					"return": str(m.ReturnType),
					"signature": "({0})".format(sig),
				})
			except Exception:
				continue
	except Exception:
		pass
	return out


def _coerce(val):
	# type: (object) -> object
	"""Make sure the value is JSON-encodable."""
	if val is None or isinstance(val, (bool, int, float, str)):
		return val
	try:
		return str(val)
	except Exception:
		return "<coerce failed>"


# ─── /debug/project, /debug/flat, /debug/tree, /debug/item ──────────────
# Original tree-walking endpoints — kept because they enumerate the
# WHOLE project, which `/debug/inspect` doesn't try to do.


def handle_project(connection):
	# type: (object) -> dict
	def _do():
		proj = connection.get_project()
		if proj is None:
			return {"error": "scriptengine.projects.primary returned None"}
		return _introspect_tree(proj, include_children=False)
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
		out = [
			_introspect_tree(c, include_children=False, include_attrs=False)
			for c in children
		]
		return {"count": len(out), "items": out}
	return ui_thread.invoke_on_ui(_do)


def handle_tree(connection):
	# type: (object) -> dict
	def _do():
		proj = connection.get_project()
		if proj is None:
			return {"error": "scriptengine.projects.primary returned None"}
		return _introspect_tree(proj, include_children=True, depth=0)
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
		return _introspect_tree(item, include_children=True, depth=0)
	return ui_thread.invoke_on_ui(_do)


def _introspect_tree(item, include_children=False, include_attrs=True, depth=0):
	# type: (object, bool, bool, int) -> dict
	"""Tree-walk introspection — a thin variant of _introspect_one
	that's optimized for whole-project dumps (lighter per-node info,
	depth-limited recursion). Used by /debug/project/flat/tree/item."""
	info = {}
	try:
		info["type"] = str(item)
	except Exception as e:
		info["type"] = "<str() failed: {0}>".format(e)
	for attr in ("name", "path", "FilePath"):
		try:
			val = getattr(item, attr, None)
			if val is not None and not callable(val):
				info[attr] = _coerce(val)
		except Exception:
			pass
	for method in ("get_name",):
		fn = getattr(item, method, None)
		if callable(fn):
			try:
				info["{0}()".format(method)] = _coerce(fn())
			except Exception as e:
				info["{0}()".format(method)] = "<call failed: {0}>".format(e)
	td = getattr(item, "textual_declaration", None)
	if td is not None:
		try:
			text = td.text or ""
			info["decl_preview"] = text[:300]
			info["decl_len"] = len(text)
		except Exception as e:
			info["decl_preview"] = "<read failed: {0}>".format(e)
	ti = getattr(item, "textual_implementation", None)
	if ti is not None:
		try:
			text = ti.text or ""
			info["impl_preview"] = text[:200]
			info["impl_len"] = len(text)
		except Exception:
			pass
	if include_attrs:
		try:
			info["attrs"] = sorted([a for a in dir(item) if not a.startswith("_")])
		except Exception:
			pass
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
		info["children"] = [
			_introspect_tree(c, include_children=True, include_attrs=False, depth=depth + 1)
			for c in children
		]
	return info
