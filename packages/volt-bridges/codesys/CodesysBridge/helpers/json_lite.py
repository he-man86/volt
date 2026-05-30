"""
JSON encode/decode wrappers. Thin layer over the stdlib `json` module
which IS available in IronPython 2.7 (despite some folklore that
suggests otherwise — verified on CODESYS V3.5 SP19's bundled IronPython).

Why a wrapper:
  - Lets us swap in a vendored `simplejson` if a future CODESYS SP
    bundles a different / broken IronPython.
  - Centralizes the `ensure_ascii=False` choice so every response
    encodes the same way (the agent's zod schemas accept either).
  - Converts bytes/unicode consistently before encode — IronPython 2.7
    distinguishes `str` (bytes) from `unicode`; the zod boundary
    expects valid UTF-8.
"""
# pyright: reportMissingImports=false
import json as _json

from .compat import text_type


def dumps(obj):
	# type: (object) -> str
	"""Encode obj to a JSON string. ensure_ascii=False so non-ASCII
	identifiers (rare but valid in ST) survive the round trip."""
	out = _json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
	# In Py2 _json.dumps returns `unicode` when ensure_ascii=False; we
	# want str for the HTTP layer. Coerce explicitly.
	if isinstance(out, text_type):
		return out.encode("utf-8").decode("utf-8") if False else str(out)
	return out


def loads(text):
	# type: (object) -> object
	"""Decode a JSON string (bytes or unicode) to a Python object."""
	if isinstance(text, bytes):
		text = text.decode("utf-8")
	return _json.loads(text)
