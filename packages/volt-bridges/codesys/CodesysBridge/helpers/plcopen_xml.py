"""
PLCopenXML classification — the AUTHORITATIVE path for CODESYS item
typing. Replaces header-keyword guessing.

Every CODESYS Scripting object exposes `obj.export_xml()` returning a
PLCopenXML 2.01 document. That schema is the IEC standard — vendor-
neutral, structurally complete — so parsing it gives us:

  * POU kind (functionBlock / function / program / interface)
  * Implementation language (ST / IL / LD / FBD / SFC / CFC)
  * DUT subtype (struct / enum / union / alias)
  * Local variable declarations (always textual, even for graphical POUs)
  * Implementation body (textual for ST, structured XML for graphical)

This brings CODESYS to the same per-item type-safety the Beckhoff
bridge gets from TwinCAT's `ItemType` numeric enum — both authoritative,
both structurally rich, both first-class.

Discovered via /debug/probe against CODESYS V3.5 SP21 Patch 4 — see
`packages/volt-bridges/codesys/README.md` for the surface dump.
"""
# pyright: reportMissingImports=false
import xml.etree.ElementTree as _ET

from . import block_type_mapper, log

# PLCopen TC6 namespace — every element in the document is in here,
# so XPath queries need the {NS}tag form.
_NS = "http://www.plcopen.org/xml/tc6_0200"
_NS_PREFIX = "{" + _NS + "}"


def _tag(name):
	return _NS_PREFIX + name


# pouType attribute value → vendor-neutral kind string.
# Keep in sync with block_type_mapper.KIND_* (and the Beckhoff bridge's
# BlockTypeMapper.ToNodeType output).
_POU_TYPE_MAP = {
	"functionBlock": block_type_mapper.KIND_FUNCTION_BLOCK,
	"function":      block_type_mapper.KIND_FUNCTION,
	"program":       block_type_mapper.KIND_PROGRAM,
}

# baseType child element name → DUT subtype kind.
_DUT_SUBTYPE_MAP = {
	"struct":      block_type_mapper.KIND_STRUCTURE,
	"STRUCT":      block_type_mapper.KIND_STRUCTURE,
	"union":       block_type_mapper.KIND_UNION,
	"UNION":       block_type_mapper.KIND_UNION,
	"enum":        block_type_mapper.KIND_ENUMERATION,
}


def classify(item):
	# type: (object) -> dict
	"""Authoritative classification from PLCopenXML. Returns:

	    {
	        "kind":          one of block_type_mapper.KIND_*
	        "language":      "ST" | "IL" | "LD" | "FBD" | "SFC" | "CFC" | None
	        "is_textual":    bool — True if body is ST/IL, False for graphical
	        "xml_present":   bool — False if export_xml failed (caller may
	                                fall back to header parse)
	    }

	Returns kind=KIND_UNKNOWN if classification fails — caller decides
	whether to fall back to header-keyword parsing or skip the item.
	"""
	result = {
		"kind": block_type_mapper.KIND_UNKNOWN,
		"language": None,
		"is_textual": True,
		"xml_present": False,
	}
	try:
		xml_str = item.export_xml()
	except Exception as e:
		log.warn("[XML] export_xml failed for item: {0}".format(e))
		return result
	if not xml_str:
		return result
	try:
		# Strip BOM if present — IronPython's ElementTree is picky.
		if isinstance(xml_str, str) and xml_str.startswith("﻿"):
			xml_str = xml_str[1:]
		root = _ET.fromstring(xml_str)
	except Exception as e:
		log.warn("[XML] parse failed: {0}".format(e))
		return result
	result["xml_present"] = True

	# Look for <types><pous><pou ...> first (POU classification).
	pou = root.find(".//" + _tag("pou"))
	if pou is not None:
		pou_type = pou.get("pouType", "")
		mapped = _POU_TYPE_MAP.get(pou_type, block_type_mapper.KIND_UNKNOWN)
		result["kind"] = mapped
		# Body language is the first child element name under <body>.
		body = pou.find(_tag("body"))
		if body is not None and len(body) > 0:
			lang = body[0].tag
			if lang.startswith(_NS_PREFIX):
				lang = lang[len(_NS_PREFIX):]
			result["language"] = lang
			result["is_textual"] = lang in ("ST", "IL")
		return result

	# Then <types><dataTypes><dataType>... (DUT classification).
	dt = root.find(".//" + _tag("dataType"))
	if dt is not None:
		base = dt.find(_tag("baseType"))
		if base is None or len(base) == 0:
			# baseType empty → it's an alias to whatever's directly there
			result["kind"] = block_type_mapper.KIND_ALIAS
			return result
		# baseType has one child whose tag tells us the subtype.
		child = base[0]
		tag = child.tag
		if tag.startswith(_NS_PREFIX):
			tag = tag[len(_NS_PREFIX):]
		result["kind"] = _DUT_SUBTYPE_MAP.get(tag, block_type_mapper.KIND_ALIAS)
		return result

	# Then <interface ...> for an INTERFACE block. PLCopenXML 2.01 uses
	# <pou pouType="..."> for interfaces too but we keep this as a
	# fallback for older variants.
	itf = root.find(".//" + _tag("interface"))
	if itf is not None:
		# Without a <pou> wrapper, only candidate left is INTERFACE.
		result["kind"] = block_type_mapper.KIND_INTERFACE
		return result

	# Then <addData ... gvl ...> for a GVL — PLCopenXML doesn't have a
	# first-class GVL element; CODESYS encodes it via either a special
	# attribute or just leaves a <pou> with `pouType="program"` and
	# only declaration. Header parse is the safest fallback here.
	# Return KIND_UNKNOWN; caller falls back.
	return result


def extract_graphical_body(item):
	# type: (object) -> object
	"""For non-ST POUs, return the raw `<body>...</body>` XML fragment
	(as a string) for embedding in the wire payload. Returns None if
	export fails or the POU has no body."""
	try:
		xml_str = item.export_xml()
	except Exception:
		return None
	if not xml_str:
		return None
	try:
		if isinstance(xml_str, str) and xml_str.startswith("﻿"):
			xml_str = xml_str[1:]
		root = _ET.fromstring(xml_str)
	except Exception:
		return None
	pou = root.find(".//" + _tag("pou"))
	if pou is None:
		return None
	body = pou.find(_tag("body"))
	if body is None:
		return None
	# IronPython 2.7's tostring returns bytes and does NOT accept the
	# Py3 `encoding="unicode"` shortcut — that raises "unknown
	# encoding: unicode". Just take the bytes and decode.
	try:
		raw = _ET.tostring(body)
	except Exception as e:
		log.warn("[XML] tostring failed for graphical body: {0}".format(e))
		return None
	if isinstance(raw, bytes):
		try:
			return raw.decode("utf-8")
		except Exception:
			return raw.decode("utf-8", "replace")
	return raw
