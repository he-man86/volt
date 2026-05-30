"""
JSON encode/decode wrappers. Thin layer over the stdlib `json` module
which IS available in IronPython 2.7 (despite some folklore that
suggests otherwise — verified on CODESYS V3.5 SP19's bundled IronPython).

Why a wrapper:
  - Lets us swap in a vendored `simplejson` if a future CODESYS SP
    bundles a different / broken IronPython.
  - Centralizes the `ensure_ascii=False` choice so every response
    encodes the same way (the agent's zod schemas accept either).
  - Always returns TEXT (`unicode` in Py2, `str` in Py3) so the caller
    can `.encode("utf-8")` to bytes for the HTTP wire identically in
    both runtimes.
"""
# pyright: reportMissingImports=false
import json as _json


def dumps(obj):
	# type: (object) -> object
	"""Encode obj to a JSON string. ensure_ascii=False so non-ASCII
	identifiers (rare but valid in ST) survive the round trip.

	Returns text:
	  - IronPython 2.7  → `unicode`
	  - CPython 3       → `str`
	Caller `.encode("utf-8")` to get bytes for the HTTP layer (works
	identically in both runtimes)."""
	return _json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def loads(text):
	# type: (object) -> object
	"""Decode a JSON string (bytes or text) to a Python object."""
	if isinstance(text, bytes):
		text = text.decode("utf-8")
	return _json.loads(text)
