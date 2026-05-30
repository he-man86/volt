"""
Mirrors `packages/volt-bridges/beckhoff/BeckhoffBridge/Helpers/StAssembler.cs`.

Inverse of StSplitter: takes a per-item "GetResult" dict (the same
shape FetchHandler builds via BuildResult) and produces the assembled
`.st` / `.gvl` / `.dut` / `.itf` source text the agent writes to its
workspace.

Layout (CANONICAL — must match the C# output byte-for-byte so that
   wire consumers don't see any deviation depending on which bridge
   produced the response):

  {pou.declaration}

  {pou.implementation}     # only if non-empty

  END_X

  {child block 1}          # sorted: methods → actions → properties,

  {child block 2}          # alphabetical within each kind
  ...
  (trailing newline)

Children:
  METHOD / ACTION → "{decl}\n{impl}\nEND_X"  (impl omitted if empty)
  PROPERTY       → "{decl}\nGET … END_GET\nSET … END_SET\nEND_PROPERTY"
"""
# pyright: reportMissingImports=false
import re


_SINGLE_BLOCK_KINDS = frozenset(["gvl", "structure", "enumeration", "union", "alias"])

_END_KW = {
	"function_block": "END_FUNCTION_BLOCK",
	"program": "END_PROGRAM",
	"function": "END_FUNCTION",
	"interface": "END_INTERFACE",
}

# methods → actions → properties, anything else last.
_KIND_ORDER = {"method": 0, "action": 1, "property": 2}

_FOLDER_RE = re.compile(r"\(\*\s*folder\s*:\s*[^*]*?\*\)", re.IGNORECASE)


def assemble(result):
	# type: (dict) -> str
	"""Render a fetched-item dict to assembled `.st` source text."""
	kind = result.get("kind") or ""
	declaration = result.get("declaration") or ""
	implementation = result.get("implementation") or ""
	children_raw = result.get("children")

	if kind in _SINGLE_BLOCK_KINDS:
		return declaration.rstrip() + "\n"

	parts = [declaration.rstrip()]
	impl_trim = implementation.strip()
	if impl_trim:
		parts.append("")  # blank line
		parts.append(impl_trim)
	parts.append("")  # blank line
	parts.append(_end_kw(kind))

	children = _normalize_children(children_raw)
	children.sort(key=lambda ch: (_KIND_ORDER.get(ch["kind"], 3), ch["name"]))
	for child in children:
		parts.append("")  # blank line between blocks
		parts.append(_assemble_child(child))

	return "\n".join(parts) + "\n"


def _end_kw(kind):
	# type: (str) -> str
	return _END_KW.get(kind, "END_{0}".format(kind.upper()))


def _normalize_children(raw):
	# type: (object) -> list
	"""Coerce raw children list (could be None, list-of-dict, etc.) into
	a list of normalized dicts with the expected keys present."""
	if raw is None:
		return []
	out = []
	for entry in raw:
		if not isinstance(entry, dict):
			continue
		out.append({
			"kind": entry.get("kind") or "",
			"name": entry.get("name") or "",
			"declaration": entry.get("declaration") or "",
			"implementation": entry.get("implementation") or "",
			"getterCode": entry.get("getterCode"),
			"setterCode": entry.get("setterCode"),
			"getterDeclaration": entry.get("getterDeclaration"),
			"setterDeclaration": entry.get("setterDeclaration"),
			"folder": entry.get("folder"),
		})
	return out


def _assemble_child(child):
	# type: (dict) -> str
	if child["kind"] == "property":
		return _assemble_property(child)
	decl = _with_folder_annotation(child["declaration"], child.get("folder")).rstrip()
	impl = (child.get("implementation") or "").strip()
	end_kw = "END_METHOD" if child["kind"] == "method" else "END_ACTION"
	if not impl:
		return "{0}\n{1}".format(decl, end_kw)
	return "{0}\n{1}\n{2}".format(decl, impl, end_kw)


def _assemble_property(child):
	# type: (dict) -> str
	parts = [_with_folder_annotation(child["declaration"], child.get("folder")).rstrip()]
	if child.get("getterCode") is not None or child.get("getterDeclaration") is not None:
		parts.append(_assemble_accessor("GET", child.get("getterDeclaration"), child.get("getterCode")))
	if child.get("setterCode") is not None or child.get("setterDeclaration") is not None:
		parts.append(_assemble_accessor("SET", child.get("setterDeclaration"), child.get("setterCode")))
	parts.append("END_PROPERTY")
	return "\n".join(parts)


def _assemble_accessor(keyword, decl, impl):
	# type: (str, object, object) -> str
	d = (decl or "").strip()
	i = (impl or "").strip()
	lines = [keyword]
	if d:
		lines.append(d)
	if i:
		lines.append(i)
	lines.append("END_{0}".format(keyword))
	return "\n".join(lines)


def _with_folder_annotation(declaration, folder):
	# type: (str, object) -> str
	"""Inject `(* folder: X *)` on the signature line. Idempotent —
	strips an existing annotation before re-adding."""
	trimmed = (declaration or "").rstrip()
	if not folder:
		return trimmed
	lines = trimmed.split("\n")
	if not lines:
		return trimmed
	cleaned = _FOLDER_RE.sub("", lines[0]).rstrip()
	lines[0] = "{0}    (* folder: {1} *)".format(cleaned, folder)
	return "\n".join(lines)
