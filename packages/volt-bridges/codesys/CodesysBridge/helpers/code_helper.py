"""
Mirrors `packages/volt-bridges/beckhoff/BeckhoffBridge/Helpers/CodeHelper.cs`.

Parse the first meaningful line of IEC 61131-3 code to extract type
(function_block / function / program / interface / method / property /
action / gvl / structure / enumeration / union / alias) plus the name
and the metadata fields the splitter / create / update flows need
(return type for FUNCTION/METHOD, data type + access modifier for
PROPERTY, access modifier for METHOD).

Keeps regex shapes identical to the C# version so behavior matches
1:1. The C# tests in CodeHelperTests.cs (when ported here) are
ground truth.
"""
# pyright: reportMissingImports=false
import re


class CodeHeader(object):
	"""Parsed result. Slots-light for IronPython 2.7 friendliness."""
	__slots__ = ("type", "name", "return_type", "data_type", "access_modifier")

	def __init__(self, type, name, return_type=None, data_type=None, access_modifier=None):
		# type: (str, object, object, object, object) -> None
		self.type = type
		self.name = name
		self.return_type = return_type
		self.data_type = data_type
		self.access_modifier = access_modifier

	def __repr__(self):
		return "CodeHeader(type={0!r}, name={1!r}, return_type={2!r}, data_type={3!r}, acl={4!r})".format(
			self.type, self.name, self.return_type, self.data_type, self.access_modifier,
		)


class CodeHeaderError(Exception):
	"""Raised when parse_code_header can't recognize the input."""
	pass


# Regex shapes copy the C# originals one-for-one — see CodeHelper.cs.
_RE_VAR_GLOBAL = re.compile(r"^(VAR_GLOBAL|VAR_CONFIG)\b", re.IGNORECASE)
_RE_FB = re.compile(r"^FUNCTION_BLOCK\s+(\w+)", re.IGNORECASE)
_RE_PROGRAM = re.compile(r"^PROGRAM\s+(\w+)", re.IGNORECASE)
_RE_FUNCTION = re.compile(r"^FUNCTION\s+(\w+)(?:\s*:\s*(.+?))?\s*;?\s*$", re.IGNORECASE)
_RE_METHOD = re.compile(
	r"^METHOD\s+((?:(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|FINAL|ABSTRACT)\s+)*)(\w+)(?:\s*:\s*(.+?))?\s*;?\s*$",
	re.IGNORECASE,
)
_RE_PROPERTY = re.compile(
	r"^PROPERTY\s+(?:(PUBLIC|PRIVATE|PROTECTED|INTERNAL)\s+)?(\w+)\s*:\s*(.+?)\s*;?\s*$",
	re.IGNORECASE,
)
_RE_ACTION = re.compile(r"^ACTION\s+(\w+)", re.IGNORECASE)
_RE_INTERFACE = re.compile(r"^INTERFACE\s+(\w+)", re.IGNORECASE)
_RE_TYPE = re.compile(r"^TYPE\s+(\w+)\s*:", re.IGNORECASE)

_RE_STRUCT_KW = re.compile(r"\bSTRUCT\b", re.IGNORECASE)
_RE_UNION_KW = re.compile(r"\bUNION\b", re.IGNORECASE)
_RE_ENUM_BODY = re.compile(r":\s*\(")

_ACL_KEYWORDS = frozenset(["PUBLIC", "PRIVATE", "PROTECTED", "INTERNAL"])


def parse_code_header(code):
	# type: (str) -> CodeHeader
	if code is None or not code.strip():
		raise CodeHeaderError("Empty code — cannot parse header")

	lines = code.split("\n")
	header_line = ""
	header_idx = -1
	in_block_comment = False
	for i, raw in enumerate(lines):
		trimmed = raw.strip()
		if in_block_comment:
			if "*)" in trimmed:
				in_block_comment = False
			continue
		if len(trimmed) == 0:
			continue
		if trimmed.startswith("{"):
			# Skip {attribute ...} lines (and any other pragma).
			continue
		if trimmed.startswith("//"):
			continue
		if trimmed.startswith("(*"):
			if "*)" not in trimmed:
				in_block_comment = True
			continue
		header_line = trimmed
		header_idx = i
		break

	if not header_line:
		raise CodeHeaderError("No header line found in code")

	# VAR_GLOBAL / VAR_CONFIG → GVL (name not in source)
	if _RE_VAR_GLOBAL.match(header_line):
		return CodeHeader("gvl", None)

	m = _RE_FB.match(header_line)
	if m:
		return CodeHeader("function_block", m.group(1))

	m = _RE_PROGRAM.match(header_line)
	if m:
		return CodeHeader("program", m.group(1))

	m = _RE_FUNCTION.match(header_line)
	if m:
		rt = m.group(2).strip() if m.group(2) else None
		return CodeHeader("function", m.group(1), return_type=rt)

	m = _RE_METHOD.match(header_line)
	if m:
		rt = m.group(3).strip() if m.group(3) else None
		acl = _extract_acl_modifier(m.group(1))
		return CodeHeader("method", m.group(2), return_type=rt, access_modifier=acl)

	m = _RE_PROPERTY.match(header_line)
	if m:
		acl = m.group(1).upper() if m.group(1) else None
		return CodeHeader("property", m.group(2), data_type=m.group(3).strip(), access_modifier=acl)

	m = _RE_ACTION.match(header_line)
	if m:
		return CodeHeader("action", m.group(1))

	m = _RE_INTERFACE.match(header_line)
	if m:
		return CodeHeader("interface", m.group(1))

	m = _RE_TYPE.match(header_line)
	if m:
		type_name = m.group(1)
		rest_of_code = "\n".join(lines[header_idx:])
		sub = _detect_dut_subtype(rest_of_code)
		return CodeHeader(sub, type_name)

	# Match C# truncation behavior on the error message.
	preview = header_line if len(header_line) <= 80 else header_line[:80] + "..."
	raise CodeHeaderError("Unrecognized code header: {0}".format(preview))


def _extract_acl_modifier(modifier_list):
	# type: (str) -> object
	"""Pull PUBLIC/PRIVATE/PROTECTED/INTERNAL out of a modifier string
	like 'PROTECTED FINAL '. FINAL/ABSTRACT stay in the declaration —
	they're not vInfo access values."""
	if not modifier_list or not modifier_list.strip():
		return None
	for token in modifier_list.split():
		upper = token.upper()
		if upper in _ACL_KEYWORDS:
			return upper
	return None


def _detect_dut_subtype(type_block):
	# type: (str) -> str
	if _RE_STRUCT_KW.search(type_block):
		return "structure"
	if _RE_UNION_KW.search(type_block):
		return "union"
	if _RE_ENUM_BODY.search(type_block):
		return "enumeration"
	return "alias"
