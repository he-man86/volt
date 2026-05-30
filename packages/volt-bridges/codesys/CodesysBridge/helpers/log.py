"""
Structured stdout logger — mirrors the Beckhoff bridge's C# `Log`
class. Constant-width category column so a pasted log scans cleanly
for the user / support triage.

Categories:
  STARTUP - version, port, banners
  IDE     - project loaded / closed events
  HTTP    - HTTP server lifecycle, request errors
  WARN    - non-fatal degradations
  ERROR   - fatal or unhandled

Goal: when something breaks, the stdout transcript tells you which
step failed without a debugger attached.
"""
# pyright: reportMissingImports=false
import datetime
import sys
import threading

_LOCK = threading.Lock()
_CATEGORY_WIDTH = 7


def _emit(category, message):
	# type: (str, object) -> None
	ts = datetime.datetime.now().strftime("%H:%M:%S")
	cat = category.ljust(_CATEGORY_WIDTH)
	line = "[{0}] {1} {2}".format(ts, cat, message)
	with _LOCK:
		try:
			sys.stdout.write(line + "\n")
			sys.stdout.flush()
		except Exception:
			# IronPython inside CODESYS can fail stdout write when the
			# output window is closing. Don't let logging crash the
			# bridge — drop the line silently.
			pass


def startup(message): _emit("STARTUP", message)
def ide(message):     _emit("IDE", message)
def http(message):    _emit("HTTP", message)
def warn(message):    _emit("WARN", message)
def error(message):   _emit("ERROR", message)
