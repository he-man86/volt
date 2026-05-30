"""
Mirrors `packages/volt-bridges/beckhoff/BeckhoffBridge/Helpers/StSplitter.cs`.

Split a workspace `.st` / `.gvl` / `.dut` / `.itf` file into the
primitives the CODESYS Scripting Engine creates separately on the
project tree: one outer POU + N children (methods / actions /
properties / property accessors).

This is the inverse of StAssembler. The behavior MUST match the C#
implementation byte-for-byte — the wire contract assumes either bridge
produces the same split, so cross-bridge consumers see identical
results. The StSplitterTests ported to test_st_splitter.py are ground
truth.

Layout assumption (canonical workspace .st):
  {optional pragmas/comments}
  FUNCTION_BLOCK Name [EXTENDS B] [IMPLEMENTS I,J]
  VAR_INPUT … END_VAR
  VAR … END_VAR

  {impl body}

  END_FUNCTION_BLOCK

  {pragmas} METHOD … END_METHOD
  ACTION … END_ACTION
  PROPERTY … {GET … END_GET} {SET … END_SET} END_PROPERTY

Same format for PROGRAM (END_PROGRAM), FUNCTION (END_FUNCTION).
INTERFACE (END_INTERFACE) is special: signatures live INSIDE the
INTERFACE…END_INTERFACE block. GVL / DUT are simple single-block.
"""
# pyright: reportMissingImports=false
import re

from . import code_helper


# Standalone error class so callers don't reach into code_helper for it.
class StSplitterError(Exception):
	pass


_FOLDER_RE = re.compile(r"\(\*\s*folder\s*:\s*([^*]*?)\s*\*\)", re.IGNORECASE)

_RE_METHOD_SIG = re.compile(
	r"^METHOD\s+((?:(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|FINAL|ABSTRACT)\s+)*)(\w+)(?:\s*:\s*(.+?))?\s*;?\s*$",
	re.IGNORECASE,
)
_RE_ACTION_SIG = re.compile(r"^ACTION\s+(\w+)\s*$", re.IGNORECASE)
_RE_PROPERTY_SIG = re.compile(
	r"^PROPERTY\s+(?:(PUBLIC|PRIVATE|PROTECTED|INTERNAL)\s+)?(\w+)\s*:\s*(.+?)\s*;?\s*$",
	re.IGNORECASE,
)

_ACL_KEYWORDS = frozenset(["PUBLIC", "PRIVATE", "PROTECTED", "INTERNAL"])


class StAccessor(object):
	__slots__ = ("declaration", "implementation")

	def __init__(self, declaration, implementation):
		self.declaration = declaration
		self.implementation = implementation


class StChild(object):
	__slots__ = (
		"kind", "name", "declaration", "implementation",
		"getter", "setter", "folder", "access_modifier",
		"return_type", "data_type",
	)

	def __init__(self, kind, name, declaration, implementation,
		getter=None, setter=None, folder=None,
		access_modifier=None, return_type=None, data_type=None,
	):
		self.kind = kind
		self.name = name
		self.declaration = declaration
		self.implementation = implementation
		self.getter = getter
		self.setter = setter
		self.folder = folder
		self.access_modifier = access_modifier
		self.return_type = return_type
		self.data_type = data_type


class StSplitResult(object):
	__slots__ = ("pou_kind", "pou_name", "pou_declaration", "pou_implementation", "children")

	def __init__(self, pou_kind, pou_name, pou_declaration, pou_implementation, children):
		self.pou_kind = pou_kind
		self.pou_name = pou_name
		self.pou_declaration = pou_declaration
		self.pou_implementation = pou_implementation
		self.children = children


# ─── Top-level entry ─────────────────────────────────────────────────


def split_st(source_text):
	# type: (str) -> StSplitResult
	if source_text is None or not source_text.strip():
		raise StSplitterError("Empty .st source")

	lines = _normalize_lines(source_text)

	# 1. Outer POU header — kind + name via the shared code-header parser.
	try:
		header = code_helper.parse_code_header(source_text)
	except code_helper.CodeHeaderError as e:
		raise StSplitterError(str(e))
	kind = header.type

	# 2. Single-block kinds (gvl, structure, enumeration, union, alias)
	#    are simple text blobs — no child structure.
	if kind in ("gvl", "structure", "enumeration", "union", "alias"):
		return StSplitResult(kind, header.name, source_text.rstrip(), "", [])

	# 3. Composite POU — find outer END_X to split POU from children.
	outer_end = _outer_end_keyword(kind)
	pou_start, pou_end, children_start = _find_outer_block(lines, outer_end)
	pou_lines = lines[pou_start:pou_end]

	if kind == "interface":
		decl, children = _split_interface_body(pou_lines)
		return StSplitResult(kind, header.name, decl, "", children)

	pou_decl, pou_impl = _split_decl_impl(pou_lines, kind)
	children = _split_children(lines[children_start:])
	return StSplitResult(kind, header.name, pou_decl, pou_impl, children)


# ─── Outer-block boundary detection ──────────────────────────────────


_OUTER_END = {
	"function_block": "END_FUNCTION_BLOCK",
	"program": "END_PROGRAM",
	"function": "END_FUNCTION",
	"interface": "END_INTERFACE",
}


def _outer_end_keyword(kind):
	# type: (str) -> str
	if kind not in _OUTER_END:
		raise StSplitterError("Unexpected composite POU kind: {0}".format(kind))
	return _OUTER_END[kind]


def _find_outer_block(lines, outer_end):
	# type: (list, str) -> tuple
	pou_start = 0
	end_idx = None
	ctx = _ScanContext()
	for i, line in enumerate(lines):
		ctx.update(line)
		if ctx.inside_trivia:
			continue
		if _line_starts_with_kw(line, outer_end):
			end_idx = i
			break
	if end_idx is None:
		raise StSplitterError("Missing {0}".format(outer_end))

	children_start = end_idx + 1
	while children_start < len(lines) and not lines[children_start].strip():
		children_start += 1
	return pou_start, end_idx, children_start


# ─── INTERFACE body (children inside the block) ─────────────────────


def _split_interface_body(body_lines):
	# type: (list) -> tuple
	ctx = _ScanContext()
	header_idx = -1
	for i, line in enumerate(body_lines):
		ctx.update(line)
		if ctx.inside_trivia:
			continue
		header_idx = i
		break
	if header_idx < 0:
		return ("\n".join(body_lines).rstrip(), [])

	decl_lines = body_lines[: header_idx + 1]
	decl = "\n".join(decl_lines).rstrip()
	if header_idx + 1 >= len(body_lines):
		return (decl, [])
	children_region = body_lines[header_idx + 1:]
	children = _split_children(children_region)
	return (decl, children)


# ─── POU decl/impl split (non-interface) ─────────────────────────────


def _split_decl_impl(pou_lines, kind):
	# type: (list, str) -> tuple
	# Walk backward to find the LAST END_VAR — everything before is decl,
	# everything after is impl. If no END_VAR (FB with no VAR section),
	# declaration is just the first non-trivia line, rest is impl.
	ctx = _ScanContext()
	last_end_var = -1
	for i, line in enumerate(pou_lines):
		ctx.update(line)
		if ctx.inside_trivia:
			continue
		if _line_starts_with_kw(line, "END_VAR"):
			last_end_var = i

	if last_end_var < 0:
		ctx2 = _ScanContext()
		header_end = 0
		for i, line in enumerate(pou_lines):
			ctx2.update(line)
			if ctx2.inside_trivia:
				continue
			header_end = i
			break
		decl = "\n".join(pou_lines[: header_end + 1]).rstrip()
		impl = "\n".join(pou_lines[header_end + 1:]).strip()
		return (decl, impl)

	decl = "\n".join(pou_lines[: last_end_var + 1]).rstrip()
	impl = "\n".join(pou_lines[last_end_var + 1:]).strip()
	return (decl, impl)


# ─── Child blocks (METHOD / ACTION / PROPERTY siblings) ─────────────


def _split_children(after):
	# type: (list) -> list
	children = []
	n = len(after)
	i = 0
	while i < n:
		# Skip blank lines between children.
		while i < n and not after[i].strip():
			i += 1
		if i >= n:
			break

		block_start = i
		ctx = _ScanContext()
		while i < n:
			ctx.update(after[i])
			if not ctx.inside_trivia:
				if _line_starts_with_kw(after[i], "METHOD"):
					child = _read_method_or_action(after, i, block_start, "method", "END_METHOD")
					children.append(child[0])
					i = child[1]
					break
				if _line_starts_with_kw(after[i], "ACTION"):
					child = _read_method_or_action(after, i, block_start, "action", "END_ACTION")
					children.append(child[0])
					i = child[1]
					break
				if _line_starts_with_kw(after[i], "PROPERTY"):
					child = _read_property(after, i, block_start)
					children.append(child[0])
					i = child[1]
					break
				preview = after[i][:80] + ("..." if len(after[i]) > 80 else "")
				raise StSplitterError(
					"Expected METHOD/ACTION/PROPERTY at line {0}, got: {1}".format(i + 1, preview)
				)
			i += 1
	return children


def _read_method_or_action(lines, sig_line, block_start, kind, end_kw):
	# type: (list, int, int, str, str) -> tuple
	ctx = _ScanContext()
	for k in range(block_start, sig_line + 1):
		ctx.update(lines[k])

	end_line = None
	for j in range(sig_line + 1, len(lines)):
		ctx.update(lines[j])
		if ctx.inside_trivia:
			continue
		if _line_starts_with_kw(lines[j], end_kw):
			end_line = j
			break
	if end_line is None:
		raise StSplitterError(
			"Missing {0} for {1} starting at line {2}".format(end_kw, kind, sig_line + 1)
		)

	next_i = end_line + 1
	sig = lines[sig_line]
	name, acl, return_type, folder = _parse_method_or_action_signature(sig, kind)
	inner = lines[block_start: end_line]  # includes pragmas + sig
	decl, impl = _split_decl_impl_of_child(inner)
	child = StChild(
		kind=kind, name=name,
		declaration=decl, implementation=impl,
		folder=folder, access_modifier=acl, return_type=return_type,
	)
	return (child, next_i)


def _read_property(lines, sig_line, block_start):
	# type: (list, int, int) -> tuple
	ctx = _ScanContext()
	for k in range(block_start, sig_line + 1):
		ctx.update(lines[k])

	end_line = None
	accessor_boundaries = []
	current_start = None
	current_kind = None
	for j in range(sig_line + 1, len(lines)):
		ctx.update(lines[j])
		if ctx.inside_trivia:
			continue
		if _line_starts_with_kw(lines[j], "END_PROPERTY"):
			end_line = j
			break
		if _line_starts_with_kw(lines[j], "GET") and current_start is None:
			current_start = j
			current_kind = "get"
			continue
		if _line_starts_with_kw(lines[j], "SET") and current_start is None:
			current_start = j
			current_kind = "set"
			continue
		if _line_starts_with_kw(lines[j], "END_GET") or _line_starts_with_kw(lines[j], "END_SET"):
			if current_start is not None and current_kind is not None:
				accessor_boundaries.append((current_start, j, current_kind))
				current_start = None
				current_kind = None
	if end_line is None:
		raise StSplitterError(
			"Missing END_PROPERTY for property starting at line {0}".format(sig_line + 1)
		)

	next_i = end_line + 1
	sig = lines[sig_line]
	name, acl, data_type, folder = _parse_property_signature(sig)

	# Declaration: from block_start up to (but excluding) the first
	# accessor or END_PROPERTY — whichever comes first.
	decl_end = (accessor_boundaries[0][0] - 1) if accessor_boundaries else (end_line - 1)
	decl_slice = lines[block_start: decl_end + 1]
	prop_decl = "\n".join(decl_slice).rstrip()

	getter = None
	setter = None
	for (g_start, g_end, g_kind) in accessor_boundaries:
		inner = lines[g_start: g_end + 1]  # includes GET / END_GET
		acc = _parse_accessor(inner)
		if g_kind == "get":
			getter = acc
		else:
			setter = acc

	child = StChild(
		kind="property", name=name,
		declaration=prop_decl, implementation="",
		getter=getter, setter=setter,
		folder=folder, access_modifier=acl, data_type=data_type,
	)
	return (child, next_i)


def _parse_accessor(acc_lines):
	# type: (list) -> StAccessor
	# First line is GET / SET, last is END_GET / END_SET — strip both.
	inner = acc_lines[1: len(acc_lines) - 1]
	ctx = _ScanContext()
	last_end_var = -1
	for i, line in enumerate(inner):
		ctx.update(line)
		if ctx.inside_trivia:
			continue
		if _line_starts_with_kw(line, "END_VAR"):
			last_end_var = i
	if last_end_var < 0:
		return StAccessor("", "\n".join(inner).strip())
	decl = "\n".join(inner[: last_end_var + 1]).rstrip()
	impl = "\n".join(inner[last_end_var + 1:]).strip()
	return StAccessor(decl, impl)


def _split_decl_impl_of_child(inner_lines):
	# type: (list) -> tuple
	ctx = _ScanContext()
	last_end_var = -1
	sig_line = -1
	for i, line in enumerate(inner_lines):
		ctx.update(line)
		if ctx.inside_trivia:
			continue
		if sig_line < 0:
			sig_line = i
		if _line_starts_with_kw(line, "END_VAR"):
			last_end_var = i
	if last_end_var < 0:
		decl = "\n".join(inner_lines[: sig_line + 1]).rstrip()
		impl = "\n".join(inner_lines[sig_line + 1:]).strip()
		return (decl, impl)
	decl = "\n".join(inner_lines[: last_end_var + 1]).rstrip()
	impl = "\n".join(inner_lines[last_end_var + 1:]).strip()
	return (decl, impl)


# ─── Signature parsing helpers ───────────────────────────────────────


def _parse_method_or_action_signature(sig, kind):
	# type: (str, str) -> tuple
	folder = _extract_folder(sig)
	clean = _FOLDER_RE.sub("", sig).rstrip()
	if kind == "method":
		m = _RE_METHOD_SIG.match(clean)
		if not m:
			preview = sig[:80] + ("..." if len(sig) > 80 else "")
			raise StSplitterError("Cannot parse METHOD signature: {0}".format(preview))
		name = m.group(2)
		acl = _extract_acl(m.group(1))
		rt = m.group(3).strip() if m.group(3) else None
		return (name, acl, rt, folder)
	# action
	m = _RE_ACTION_SIG.match(clean)
	if not m:
		preview = sig[:80] + ("..." if len(sig) > 80 else "")
		raise StSplitterError("Cannot parse ACTION signature: {0}".format(preview))
	return (m.group(1), None, None, folder)


def _parse_property_signature(sig):
	# type: (str) -> tuple
	folder = _extract_folder(sig)
	clean = _FOLDER_RE.sub("", sig).rstrip()
	m = _RE_PROPERTY_SIG.match(clean)
	if not m:
		preview = sig[:80] + ("..." if len(sig) > 80 else "")
		raise StSplitterError("Cannot parse PROPERTY signature: {0}".format(preview))
	name = m.group(2)
	acl = m.group(1).upper() if m.group(1) else None
	dt = m.group(3).strip()
	return (name, acl, dt, folder)


def _extract_folder(line):
	# type: (str) -> object
	m = _FOLDER_RE.search(line)
	if not m:
		return None
	f = m.group(1).strip()
	return f if f else None


def _extract_acl(modifier_list):
	# type: (str) -> object
	if not modifier_list or not modifier_list.strip():
		return None
	for token in modifier_list.split():
		upper = token.upper()
		if upper in _ACL_KEYWORDS:
			return upper
	return None


# ─── Line scanning helpers ───────────────────────────────────────────


class _ScanContext(object):
	"""Track whether the next characters are inside `(* block comment *)`
	since block comments span lines. Single-line `// ...` and pragma
	`{ ... }` reset per line. String literals don't cross lines in
	well-formed ST."""
	__slots__ = ("_in_block_comment", "inside_trivia")

	def __init__(self):
		self._in_block_comment = False
		self.inside_trivia = False

	def update(self, line):
		# type: (str) -> None
		self.inside_trivia = False
		trimmed = line.lstrip()
		if self._in_block_comment:
			close = line.find("*)")
			if close < 0:
				self.inside_trivia = True
				return
			self._in_block_comment = False
			# If close is at end of trimmed line, still trivia.
			tclose = trimmed.find("*)")
			if tclose >= 0 and tclose + 2 >= len(trimmed):
				self.inside_trivia = True
			return
		if not trimmed:
			self.inside_trivia = True
			return
		if trimmed.startswith("//"):
			self.inside_trivia = True
			return
		if trimmed.startswith("{"):
			self.inside_trivia = True
			return
		if trimmed.startswith("(*"):
			close = trimmed.find("*)")
			if close < 0:
				self._in_block_comment = True
				self.inside_trivia = True
				return
			if close + 2 >= len(trimmed):
				self.inside_trivia = True
				return
			# Otherwise: tail after */) is real source.
			return


def _line_starts_with_kw(line, keyword):
	# type: (str, str) -> bool
	trimmed = line.lstrip()
	if not trimmed.lower().startswith(keyword.lower()):
		return False
	if len(trimmed) == len(keyword):
		return True
	after = trimmed[len(keyword)]
	return not (after.isalnum() or after == "_")


def _normalize_lines(source):
	# type: (str) -> list
	return source.replace("\r\n", "\n").replace("\r", "\n").split("\n")
