"""
Structured logger — mirrors the Beckhoff bridge's C# `Log` class.
Constant-width category column so a pasted log scans cleanly for the
user / support triage.

Categories:
  STARTUP - version, port, banners
  IDE     - project loaded / closed events
  HTTP    - HTTP server lifecycle, request errors
  WARN    - non-fatal degradations
  ERROR   - fatal or unhandled

DUAL OUTPUT:
  * sys.stdout      - shows in CODESYS Messages panel for the user.
                      BUT writes from non-UI worker threads silently
                      fail / are dropped (UI marshalling) — so background
                      daemon logs never reach this channel.
  * File log        - %TEMP%/volt-codesys-bridge.log. Always works from
                      any thread; survives stdout being closed. Read it
                      from CMD with `type %TEMP%\volt-codesys-bridge.log`
                      or via curl /debug/recent-log.

Goal: when something breaks, both channels tell you which step failed
without a debugger attached.
"""
# pyright: reportMissingImports=false
import datetime
import os
import sys
import threading

_LOCK = threading.Lock()
_CATEGORY_WIDTH = 7

# File-log path. %TEMP% on Windows, /tmp elsewhere. Wraps at startup
# so the file always reflects ONE bridge session (not appended forever).
_LOG_PATH = os.path.join(
	os.environ.get("TEMP") or os.environ.get("TMP") or "/tmp",
	"volt-codesys-bridge.log",
)
# Truncate on import (each bundle exec = new session start).
try:
	with open(_LOG_PATH, "w") as _f:
		_f.write("# volt-codesys-bridge session started at {0}\n".format(
			datetime.datetime.now().isoformat()))
except Exception:
	pass


def _emit(category, message):
	# type: (str, object) -> None
	ts = datetime.datetime.now().strftime("%H:%M:%S")
	cat = category.ljust(_CATEGORY_WIDTH)
	tid = threading.current_thread().name
	line = "[{0}] {1} {2}".format(ts, cat, message)
	file_line = "[{0}] {1} [{2}] {3}".format(ts, cat, tid, message)
	with _LOCK:
		try:
			sys.stdout.write(line + "\n")
			sys.stdout.flush()
		except Exception:
			# Worker-thread writes silently fail in CODESYS (known UI
			# marshalling crash). File log catches the message.
			pass
		try:
			with open(_LOG_PATH, "a") as fh:
				fh.write(file_line + "\n")
		except Exception:
			pass


def startup(message): _emit("STARTUP", message)
def ide(message):     _emit("IDE", message)
def http(message):    _emit("HTTP", message)
def warn(message):    _emit("WARN", message)
def error(message):   _emit("ERROR", message)
