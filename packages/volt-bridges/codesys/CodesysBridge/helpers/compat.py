"""
Cross-Python compat shims.

Production path: IronPython 2.7 inside CODESYS. Test path: CPython 3
for offline unit tests of the pure helpers (st_splitter, code_helper,
block_type_mapper). The same .py files run in both environments —
this module isolates the per-version differences in one place.

Imports re-exported from here:
  HTTPServer, BaseHTTPRequestHandler   - http.server (Py3) / BaseHTTPServer (Py2)
  urlparse, unquote, parse_qs          - urllib.parse (Py3) / urlparse + urllib (Py2)
  text_type                            - str (Py3) / unicode (Py2)
  IS_PY2                               - True under IronPython 2.7
"""
# pyright: reportMissingImports=false
import sys

IS_PY2 = sys.version_info[0] == 2

try:
	from BaseHTTPServer import HTTPServer, BaseHTTPRequestHandler  # type: ignore[import-not-found]
	from SocketServer import ThreadingMixIn  # type: ignore[import-not-found]
	from urlparse import urlparse, parse_qs  # type: ignore[import-not-found]
	from urllib import unquote  # type: ignore[import-not-found]
	text_type = unicode  # type: ignore[name-defined,used-before-def] # noqa: F821
except ImportError:
	from http.server import HTTPServer, BaseHTTPRequestHandler  # type: ignore[no-redef]
	from socketserver import ThreadingMixIn  # type: ignore[no-redef]
	from urllib.parse import urlparse, unquote, parse_qs  # type: ignore[no-redef]
	text_type = str  # type: ignore[misc,assignment]

__all__ = [
	"HTTPServer",
	"BaseHTTPRequestHandler",
	"ThreadingMixIn",
	"urlparse",
	"unquote",
	"parse_qs",
	"text_type",
	"IS_PY2",
]
