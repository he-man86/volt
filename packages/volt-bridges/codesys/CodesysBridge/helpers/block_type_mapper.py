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

# CODESYS Scripting Engine "type marker" SUBSTRINGS.
#
# `str(obj)` returns a composite of the form:
#   ScriptObject{Marker1, Marker2, ..., MarkerN}(Project=N, Name=X, guid=...)
# Each marker is either positive ("ScriptX") or negative ("NoX").
# To distinguish e.g. ScriptApplication from
# ScriptApplicationSymbolConfigExtension, we keep the trailing comma
# on positive markers — that's the field separator inside `{...}`.
#
# Verified via /debug/flat against a default CODESYS 3.5 SP21 project
# (Device → Plc Logic → Application tree with PLC_PRG).
MARKER_APPLICATION = "ScriptApplication,"
# Three distinct textual-item markers seen in /debug/flat against a
# CODESYS 3.5 SP21 default project:
#   ScriptTextualDeclarationImplementationObject  decl + impl
#                                                  (FB, FUNCTION, PROGRAM,
#                                                   method with body,
#                                                   property GET/SET body)
#   ScriptTextualDeclarationObject                decl only
#                                                  (TYPE/DUT, GVL,
#                                                   INTERFACE, PROPERTY
#                                                   signature, interface
#                                                   method signature)
#   ScriptTextualImplementationObject             impl only
#                                                  (ACTION, TRANSITION)
# We treat all three as "textual" — classify_textual_pou + is_top_level
# decide which actually surface at the top level of /refs.
MARKER_TEXTUAL_DECL_IMPL = "ScriptTextualDeclarationImplementationObject,"
MARKER_TEXTUAL_DECL_ONLY = "ScriptTextualDeclarationObject,"
MARKER_TEXTUAL_IMPL = "ScriptTextualImplementationObject,"
# Legacy alias — keep so existing call-sites (compute_item_version,
# fetch._build_get_result, etc.) keep working until they migrate to
# the broader `is_textual_item` predicate.
MARKER_TEXTUAL_DECL = MARKER_TEXTUAL_DECL_IMPL
MARKER_NON_TEXTUAL = "ScriptNonTextualObject,"
MARKER_TASK = "ScriptTaskConfigObject,"
MARKER_DEVICE = "ScriptDeviceObject,"
MARKER_FOLDER = "ScriptFolderObject,"
# Transient duplicates: visualization styles, runtime-generated copies
# of POUs, etc. Filter these out of /refs and /fetch — they'd produce
# phantom items with the same name as a real POU.
MARKER_TRANSIENT = "ScriptTransientObjectMarker,"


def is_textual_item(marker_string):
	# type: (str) -> bool
	"""True if `str(obj)` indicates the object carries textual ST source
	(any of decl, impl, or both). Use this instead of a single marker
	check — different POU kinds use different marker tokens."""
	return (
		MARKER_TEXTUAL_DECL_IMPL in marker_string
		or MARKER_TEXTUAL_DECL_ONLY in marker_string
		or MARKER_TEXTUAL_IMPL in marker_string
	)


def has_declaration(marker_string):
	# type: (str) -> bool
	"""True if the object exposes a `textual_declaration` document.
	False for ACTION / TRANSITION (impl-only)."""
	return (
		MARKER_TEXTUAL_DECL_IMPL in marker_string
		or MARKER_TEXTUAL_DECL_ONLY in marker_string
	)

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

# ─── Non-source / config kind ──────────────────────────────────────
#
# Items that aren't ST code (tasks, visualizations, alarm configs,
# library refs, device tree, etc.) are pulled as opaque XML files
# for source-control + visibility. We don't classify them per-kind
# on the wire — the agent writes a single `.xml` and the file's
# inner CODESYS-supplied PLCopenXML already says exactly what kind
# of element it is via the root element name and attributes.
#
# Trade-off: we lose per-kind file extensions (.tasks, .visu, etc.)
# but gain a much simpler pipeline + no marker-substring classifier
# to maintain across CODESYS SP versions. Users who need extension-
# level distinction can add it later via the XML root element's
# tag name.
KIND_CONFIG = "config"
KIND_FOLDER = "folder"
KIND_UNKNOWN = "unknown"

# Marker → vendor-neutral kind for CODESYS non-source items.
#
# Same kind vocabulary the TwinCAT bridge emits (see
# `Beckhoff/Helpers/BlockTypeMapper.cs::ToConfigKind`). Agent uses
# these strings to pick a dedicated extension (.visu / .recipes /
# .libraries / .textlist / .task / .imagepool / .device / .trace /
# .cam / .alarm, etc.); unmapped markers fall back to "config" →
# generic `.xml`.
#
# Boundary-aware matching: a positive marker like `ScriptTraceObject,`
# is preceded by `{` or `, ` (space-after-comma). The negative form
# `NoScriptTraceObject,` is preceded by `o`. Checking the char before
# the match avoids the substring trap (`No...` falsely matching the
# positive form).
_NONSOURCE_MARKER_KINDS = (
	# Tasks
	("ScriptTaskObject,", "task"),
	("ScriptTaskConfigObject,", "task"),
	# Visualizations
	("ScriptVisualObject,", "visualization"),
	("ScriptVisualObjectContainer,", "visualization_manager"),
	# Library refs
	("ScriptLibManObject,", "library_manager"),
	# Device tree
	("ScriptDeviceObject,", "device"),
	# Application (catch-all wrapper) — no nice ext, falls through
	# to .xml via the catch-all
	("ScriptApplication,", "config"),
	# Image pool
	("ScriptImagePoolObject,", "image_pool"),
	# Recipes
	("ScriptRecipeManObject,", "recipe_manager"),
	# Text lists
	("ScriptTextListObject,", "text_list"),
	# Trace / Cam / Alarms
	("ScriptTraceObject,", "trace"),
	("ScriptCamObject,", "cam"),
	("ScriptAlarmConfigObject,", "alarm_configuration"),
)


def classify_nonsource(marker_string):
	# type: (str) -> str
	"""Map a CODESYS object marker to its vendor-neutral kind string.

	Returns KIND_CONFIG when no specific marker matches — caller still
	gets a usable wire kind and the agent writes the file as `.xml`.

	Boundary-aware: requires the preceding char to be `{` or ` ` so the
	positive form (`ScriptTraceObject,`) doesn't false-match inside the
	negative form (`NoScriptTraceObject,`). CODESYS marker strings are
	a comma-separated list inside `{...}`; the positive form is always
	preceded by `{` or `, `, never by `o`.
	"""
	for token, kind in _NONSOURCE_MARKER_KINDS:
		idx = marker_string.find(token)
		while idx != -1:
			prev = marker_string[idx - 1] if idx > 0 else "{"
			if prev in ("{", " "):
				return kind
			idx = marker_string.find(token, idx + 1)
	return KIND_CONFIG

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
