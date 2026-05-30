#!/usr/bin/env python
"""
Volt CODESYS Bridge — entry point.

Mirrors `packages/volt-bridges/beckhoff/BeckhoffBridge/Program.cs` +
`HttpBridge.cs` in role: HTTP server on background daemon thread that
serves the 5-endpoint wire contract (/health /refs /fetch /push /build)
the Volt agent expects. Every CODESYS-API call inside a handler is
marshaled to the IDE's UI thread via `ui_thread.invoke_on_ui`.

Usage:
  1. Open your project in CODESYS V3.5 SP19+
  2. Tools → Scripting → Execute Script File → select bridge.py
  3. Connect from the Volt agent at http://127.0.0.1:8556
  4. Close CODESYS to stop the bridge.

Wire shape: see `packages/volt-agent/src/bridge/types.ts`. Every
response is zod-validated with `.strict()` on the agent side —
any deviation surfaces as MALFORMED_RESPONSE.

Distinct port from Beckhoff (8555) so both bridges can run side by
side for differential testing.
"""
# pyright: reportMissingImports=false
import json
import os
import socket
import sys
import threading
import time

# Make sibling packages importable when run as a top-level script.
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.dirname(_HERE))

from CodesysBridge import codesys_connection, log, ui_thread
from CodesysBridge.handlers import build as build_handler
from CodesysBridge.handlers import fetch as fetch_handler
from CodesysBridge.handlers import health as health_handler
from CodesysBridge.handlers import refs as refs_handler
from CodesysBridge.handlers import push as push_handler
from CodesysBridge.helpers import json_lite
from CodesysBridge.helpers.compat import (
	BaseHTTPRequestHandler,
	HTTPServer,
	urlparse,
)


# ─── Version + port ───────────────────────────────────────────────────


def _read_bridge_version():
	# type: () -> str
	path = os.path.join(_HERE, "version.json")
	try:
		with open(path, "r") as fh:
			return json.load(fh)["version"]
	except Exception:
		return "0.0.0"


BRIDGE_VERSION = _read_bridge_version()
BRIDGE_PORT = int(os.environ.get("VOLT_BRIDGE_PORT", "8556"))


# ─── HTTP handler ─────────────────────────────────────────────────────


class _BridgeHandler(BaseHTTPRequestHandler):
	# Suppress the default per-request log line — our `log` module
	# already records what we care about.
	def log_message(self, format, *args):
		return

	def _send(self, status, body):
		try:
			raw = json_lite.dumps(body).encode("utf-8")
			self.send_response(status)
			self.send_header("Content-Type", "application/json; charset=utf-8")
			self.send_header("Content-Length", str(len(raw)))
			self.send_header("Connection", "close")
			self.end_headers()
			self.wfile.write(raw)
		except Exception as e:
			log.warn("[HTTP] failed to write response: {0}".format(e))

	def _send_error(self, status, code, message):
		self._send(status, {"error": {"code": code, "message": message}})

	def _read_body(self):
		length = int(self.headers.get("Content-Length", "0") or "0")
		if length <= 0:
			return {}
		raw = self.rfile.read(length)
		if not raw:
			return {}
		try:
			return json_lite.loads(raw)
		except Exception:
			raise ValueError("Invalid JSON body")

	def _dispatch(self, method, path, body):
		conn = _connection_singleton
		try:
			if path == "/health" and method == "GET":
				return 200, health_handler.handle(conn, BRIDGE_VERSION)
			if path == "/refs" and method == "GET":
				return 200, refs_handler.handle(conn)
			if path == "/fetch" and method == "POST":
				return 200, fetch_handler.handle(conn, body)
			if path == "/push" and method == "POST":
				return 200, push_handler.handle(conn, body)
			if path == "/build" and method == "POST":
				return 200, build_handler.handle(conn, body)
			self._send_error(404, "NOT_FOUND", "{0} {1}".format(method, path))
			return None
		except ui_thread.UiThreadUnavailable as e:
			self._send_error(503, "PLC_UI_UNAVAILABLE", str(e))
			return None
		except ValueError as e:
			self._send_error(400, "BAD_REQUEST", str(e))
			return None
		except RuntimeError as e:
			self._send_error(503, "PLC_UNAVAILABLE", str(e))
			return None
		except Exception as e:
			log.error("[HTTP] handler crashed: {0}".format(e))
			self._send_error(500, "INTERNAL_ERROR", str(e))
			return None

	def do_GET(self):
		path = urlparse(self.path).path
		result = self._dispatch("GET", path, {})
		if result is not None:
			self._send(result[0], result[1])

	def do_POST(self):
		path = urlparse(self.path).path
		try:
			body = self._read_body()
		except ValueError as e:
			self._send_error(400, "BAD_REQUEST", str(e))
			return
		result = self._dispatch("POST", path, body)
		if result is not None:
			self._send(result[0], result[1])


# ─── Singletons ───────────────────────────────────────────────────────


_connection_singleton = codesys_connection.CodesysConnection()
_server_singleton = None  # type: object


# ─── Lifecycle ────────────────────────────────────────────────────────


def _port_is_free(port):
	# type: (int) -> bool
	s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
	try:
		s.bind(("127.0.0.1", port))
		s.close()
		return True
	except Exception:
		try:
			s.close()
		except Exception:
			pass
		return False


def _stop_existing_bridge_if_any():
	"""If a previous bridge instance is bound to our port (re-running
	the script in the same CODESYS session), poke /health and warn —
	don't try to kill it. The user can restart CODESYS to fully reset."""
	if _port_is_free(BRIDGE_PORT):
		return
	log.warn("[STARTUP] Port {0} already in use — earlier bridge may still be alive".format(BRIDGE_PORT))


def _run_server():
	global _server_singleton
	server = HTTPServer(("127.0.0.1", BRIDGE_PORT), _BridgeHandler)
	_server_singleton = server
	log.startup("Bridge listening on http://127.0.0.1:{0} (version {1})".format(BRIDGE_PORT, BRIDGE_VERSION))
	try:
		server.serve_forever()
	except Exception as e:
		log.error("[HTTP] server loop crashed: {0}".format(e))


def main():
	log.startup("=" * 60)
	log.startup("Volt CODESYS Bridge {0} starting".format(BRIDGE_VERSION))
	log.startup("IDE: {0} {1}".format(_connection_singleton.ide_name, _connection_singleton.ide_version))
	if not _connection_singleton.is_connected:
		log.warn("[STARTUP] scriptengine import failed — bridge will serve /health but every other call returns 503")
	_stop_existing_bridge_if_any()

	t = threading.Thread(target=_run_server, name="volt-bridge-http")
	t.setDaemon(True)
	t.start()
	log.startup("Ready. Connect Volt agent at http://127.0.0.1:{0}".format(BRIDGE_PORT))
	log.startup("=" * 60)

	# Block the script's main thread forever — CODESYS Scripting's
	# `Execute Script File` exits the script once the top-level call
	# returns, which would also stop the daemon HTTP thread. The sleep
	# loop keeps us alive without consuming CPU.
	try:
		while True:
			time.sleep(60)
	except (KeyboardInterrupt, SystemExit):
		log.startup("Bridge stopping (interrupt)")


if __name__ == "__main__":
	main()
