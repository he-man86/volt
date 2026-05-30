"""
CODESYS item-type classification.

Mirrors `packages/volt-bridges/beckhoff/BeckhoffBridge/Helpers/
BlockTypeMapper.cs` in role: classify a tree item into the vendor-
neutral kind string the wire contract uses
(function_block / function / program / interface / gvl / structure /
enumeration / union / alias). The MECHANISM differs from TC's:

  TwinCAT: numeric ItemType codes (600-range), looked up by table.
  CODESYS: `str(obj)` gives "ScriptApplication,", "ScriptTextual-
           Declaration,", etc. — high-level marker. The POU kind
           refines via the FIRST IEC keyword in textual_declaration.text
           (FUNCTION_BLOCK / FUNCTION / PROGRAM / INTERFACE / VAR_GLOBAL
           / TYPE) — same way StSplitter does it.

The canonical kind vocabulary MATCHES what BlockTypeMapper.ToNodeType
emits in the C# bridge, so wire consumers see identical strings
regardless of which bridge they're talking to.
"""
# pyright: reportMissingImports=false
import re

# CODESYS Scripting Engine "type marker" strings — what `str(obj)` returns.
# These let us classify high-level container kinds without parsing source.
MARKER_APPLICATION = "ScriptApplication,"
MARKER_TEXTUAL_DECL = "ScriptTextualDeclaration,"
MARKER_NON_TEXTUAL = "ScriptNonTextualObject,"
MARKER_TASK = "ScriptTaskConfigObject,"
MARKER_DEVICE = "ScriptDeviceObject,"
MARKER_FOLDER = "ScriptFolderObject,"

# Vendor-neutral kinds we emit on the wire — must match
# `BlockTypeMapper.ToNodeType` output strings in the C# bridge.
KIND_FUNCTION_BLOCK = "function_block"
KIND_FUNCTION = "function"
KIND_PROGRAM = "program"
KIND_INTERFACE = "interface"
KIND_GVL = "gvl"
KIND_STRUCTURE = "structure"
KIND_ENUMERATION = "enumeration"
KIND_UNION = "union"
KIND_ALIAS = "alias"
KIND_METHOD = "method"
KIND_ACTION = "action"
KIND_PROPERTY = "property"
KIND_GETTER = "getter"
KIND_SETTER = "setter"
KIND_FOLDER = "folder"
KIND_UNKNOWN = "unknown"

# Top-level CRUD kinds — what /refs and /fetch enumerate. Methods,
# properties, actions, getters, setters live INSIDE their parent POU
# and are emitted inline via StAssembler, NOT as separate top-level
# items.
TOP_LEVEL_KINDS = frozenset([
	KIND_FUNCTION_BLOCK,
	KIND_FUNCTION,
	KIND_PROGRAM,
	KIND_INTERFACE,
	KIND_GVL,
	KIND_STRUCTURE,
	KIND_ENUMERATION,
	KIND_UNION,
	KIND_ALIAS,
])


def strip_leading_trivia(text):
	# type: (str) -> str
	"""Skip pragma blocks `{...}`, block comments `(* ... *)`, line
	comments `// ...`, and whitespace before the first real keyword."""
	pos = 0
	n = len(text)
	while pos < n:
		c = text[pos]
		if c.isspace():
			pos += 1
			continue
		if c == "{":
			end = text.find("}", pos)
			if end < 0:
				return text[pos:]
			pos = end + 1
			continue
		if c == "(" and pos + 1 < n and text[pos + 1] == "*":
			end = text.find("*)", pos + 2)
			if end < 0:
				return text[pos:]
			pos = end + 2
			continue
		if c == "/" and pos + 1 < n and text[pos + 1] == "/":
			end = text.find("\n", pos)
			if end < 0:
				return ""
			pos = end + 1
			continue
		break
	return text[pos:]


# Detect the IEC keyword that opens the declaration. Word-boundary
# match so e.g. `FUNCTION_BLOCK` doesn't false-match on `FUNCTION`.
_KEYWORD_RE = re.compile(
	r"^\s*(FUNCTION_BLOCK|FUNCTION|PROGRAM|INTERFACE|VAR_GLOBAL|VAR_CONFIG|TYPE)\b",
	re.IGNORECASE,
)


def classify_textual_pou(declaration_text):
	# type: (str) -> str
	"""Inspect the first IEC keyword of a textual declaration and map
	to a vendor-neutral kind string. Returns KIND_UNKNOWN if no
	recognized keyword.

	For TYPE declarations, refines into structure / enumeration /
	union / alias by scanning the body — same logic StSplitter uses.
	"""
	stripped = strip_leading_trivia(declaration_text)
	m = _KEYWORD_RE.match(stripped)
	if not m:
		return KIND_UNKNOWN
	kw = m.group(1).upper()
	if kw == "FUNCTION_BLOCK":
		return KIND_FUNCTION_BLOCK
	if kw == "FUNCTION":
		return KIND_FUNCTION
	if kw == "PROGRAM":
		return KIND_PROGRAM
	if kw == "INTERFACE":
		return KIND_INTERFACE
	if kw == "VAR_GLOBAL" or kw == "VAR_CONFIG":
		return KIND_GVL
	if kw == "TYPE":
		return _classify_type_body(stripped)
	return KIND_UNKNOWN


def _classify_type_body(text):
	# type: (str) -> str
	"""For `TYPE Name : <body> END_TYPE` declarations, the body shape
	determines the kind. Mirrors the StSplitter classification logic."""
	# Look for STRUCT, UNION, enum tuple `(`, or alias-form `: ScalarType`
	if re.search(r"\bSTRUCT\b", text, re.IGNORECASE):
		return KIND_STRUCTURE
	if re.search(r"\bUNION\b", text, re.IGNORECASE):
		return KIND_UNION
	# Enum is `TYPE Name : ( A, B, C ) [:= A]; END_TYPE`
	if re.search(r":\s*\(", text):
		return KIND_ENUMERATION
	# Otherwise: alias (TYPE Name : INT; / TYPE Name : INT(0..100); / etc.)
	return KIND_ALIAS


def is_top_level(kind):
	# type: (str) -> bool
	"""True when the kind is enumerated by /refs and /fetch (vs nested
	children like methods/properties/actions which ride inline)."""
	return kind in TOP_LEVEL_KINDS
