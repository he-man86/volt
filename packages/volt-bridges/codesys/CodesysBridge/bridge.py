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
import sys
import threading
import time

# Make sibling packages importable when run as a top-level script.
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.dirname(_HERE))

from CodesysBridge import codesys_connection, ui_thread
from CodesysBridge.handlers import build as build_handler
from CodesysBridge.handlers import debug as debug_handler
from CodesysBridge.handlers import fetch as fetch_handler
from CodesysBridge.handlers import health as health_handler
from CodesysBridge.handlers import refs as refs_handler
from CodesysBridge.handlers import push as push_handler
from CodesysBridge.helpers import cross_bundle_state, json_lite, log
from CodesysBridge.helpers.compat import (
	BaseHTTPRequestHandler,
	HTTPServer,
	ThreadingMixIn,
	parse_qs,
	urlparse,
)


# ─── Version + port ───────────────────────────────────────────────────


def _read_bridge_version():
	# type: () -> str
	# Single-file bundle injects `_BUNDLED_VERSION` at module top — use
	# that if present so we don't need version.json on the filesystem.
	bundled = globals().get("_BUNDLED_VERSION")
	if bundled is not None:
		return bundled
	path = os.path.join(_HERE, "version.json")
	try:
		with open(path, "r") as fh:
			return json.load(fh)["version"]
	except Exception:
		return "0.0.0"


BRIDGE_VERSION = _read_bridge_version()
# Unique per-bundle id (timestamp + sha1 of module sources). Injected
# by `bundle.py`. Lets the user (and /debug/build-id) verify which
# bundle is actually running — vital when iterating during dev.
BRIDGE_BUILD_ID = globals().get("_BUNDLED_BUILD_ID", "dev")
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

	def _dispatch(self, method, path, body, query):
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
			# /debug/* — read-only introspection of the CODESYS API
			# surface. Not part of the agent's wire contract (no zod
			# schema), just for live diagnosis when a handler returns
			# unexpected emptiness or a feature seems missing.
			if path == "/debug/project" and method == "GET":
				return 200, debug_handler.handle_project(conn)
			if path == "/debug/flat" and method == "GET":
				return 200, debug_handler.handle_flat(conn)
			if path == "/debug/tree" and method == "GET":
				return 200, debug_handler.handle_tree(conn)
			if path == "/debug/item" and method == "GET":
				return 200, debug_handler.handle_item(conn, query)
			if path == "/debug/probe" and method == "GET":
				return 200, debug_handler.handle_probe(conn, query)
			if path == "/debug/build-id" and method == "GET":
				return 200, {"buildId": BRIDGE_BUILD_ID, "version": BRIDGE_VERSION}
			if path == "/debug/cross-bundle-state" and method == "GET":
				xs = cross_bundle_state.get_active_bridge()
				return 200, {
					"hasServer": xs.get("server") is not None,
					"hasThread": xs.get("thread") is not None,
					"buildId": xs.get("build_id"),
					"backing": cross_bundle_state.backing_description(),
				}
			# Admin: cooperative shutdown. Manual escape hatch so a user
			# can stop the bridge from a terminal (curl POST) without
			# restarting CODESYS. Normal re-execution flow uses the
			# AppDomain cross-bundle path instead, not this endpoint.
			if path == "/admin/shutdown" and method == "POST":
				_request_shutdown_async(self.server)
				return 200, {"status": "shutting_down"}
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
		parsed = urlparse(self.path)
		query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
		result = self._dispatch("GET", parsed.path, {}, query)
		if result is not None:
			self._send(result[0], result[1])

	def do_POST(self):
		parsed = urlparse(self.path)
		query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
		try:
			body = self._read_body()
		except ValueError as e:
			self._send_error(400, "BAD_REQUEST", str(e))
			return
		result = self._dispatch("POST", parsed.path, body, query)
		if result is not None:
			self._send(result[0], result[1])


# ─── Singletons ───────────────────────────────────────────────────────


_connection_singleton = codesys_connection.CodesysConnection()


# ─── Lifecycle ────────────────────────────────────────────────────────


def _shutdown_server(server, label):
	# type: (object, str) -> None
	"""Cleanly tear down an HTTPServer. Three steps because IronPython
	2.7's BaseHTTPServer doesn't fully release sockets on its own:

	  1. server.shutdown()      - stops the serve_forever loop
	  2. server.server_close()  - closes server's view of the socket
	  3. raw socket.close()     - force-close the underlying socket
	     (netstat-confirmed: step 2 alone leaves the socket in
	     LISTENING state on Windows, so we belt-and-braces it)

	All steps swallow exceptions and log per-step so a single failure
	doesn't block the rest of the teardown.
	"""
	try:
		server.shutdown()
	except Exception as e:
		log.warn("[STARTUP] {0} server.shutdown() raised: {1}".format(label, e))
	try:
		server.server_close()
	except Exception as e:
		log.warn("[STARTUP] {0} server.server_close() raised: {1}".format(label, e))
	try:
		raw_sock = getattr(server, "socket", None)
		if raw_sock is not None:
			raw_sock.close()
	except Exception as e:
		log.warn("[STARTUP] {0} raw socket close raised: {1}".format(label, e))


def _request_shutdown_async(server):
	# type: (object) -> None
	"""Tear down `server` on a side thread. Called from the request
	handler context (POST /admin/shutdown), so we MUST NOT call
	server.shutdown() inline — that would deadlock (shutdown waits for
	serve_forever to return, but serve_forever is waiting for THIS
	request to finish). The side thread sleeps briefly so the 200
	response flushes first, then tears the server down."""
	def _do():
		time.sleep(0.1)
		_shutdown_server(server, "admin-shutdown")
		cross_bundle_state.clear()
	t = threading.Thread(target=_do, name="volt-bridge-shutdown")
	t.daemon = True
	t.start()


def _stop_existing_bridge_if_any():
	"""Re-run safety. CODESYS keeps the IronPython interpreter alive
	across script executions; the previous bundle's HTTPServer is
	still bound to port 8556 in this same process. Find it via the
	AppDomain-backed cross-bundle store and shut it down before the
	new daemon thread tries to bind.

	This is THE handoff mechanism. Module-level globals don't survive
	across script runs (each Execute Script File gets a fresh
	namespace) AND CODESYS doesn't actually share `sys` attributes
	across runs despite IronPython docs implying otherwise. AppDomain
	is process-wide and is the only persistence that works reliably.
	"""
	state = cross_bundle_state.get_active_bridge()
	x_server = state.get("server")
	log.startup("[STARTUP] Cross-bundle state: server={0}, build_id={1!r}".format(
		"<present>" if x_server is not None else "<none>",
		state.get("build_id")))
	if x_server is None:
		return  # Fresh CODESYS or no prior bundle — nothing to clean.
	log.startup(
		"[STARTUP] Previous bridge from build {0!r} detected -- shutting down".format(
			state.get("build_id")))
	_shutdown_server(x_server, "cross-bundle")
	x_thread = state.get("thread")
	if x_thread is not None:
		try:
			x_thread.join(timeout=5)
		except Exception:
			pass
	cross_bundle_state.clear()
	log.startup("[STARTUP] Previous bridge stopped")


class _ReusableHTTPServer(ThreadingMixIn, HTTPServer):
	"""HTTPServer with SO_REUSEADDR + threaded request handling.

	IronPython 2.7's stock HTTPServer is BOTH single-threaded AND
	non-reusing. Both bite us in CODESYS:

	  * `allow_reuse_address = False` by default → bind fails on a
	    port in TIME_WAIT (WinError 10048) even after the previous
	    server closed cleanly.

	  * Single-threaded → if a handler blocks on the UI thread
	    (ui_thread.invoke_on_ui), serve_forever ALSO blocks — can't
	    even accept new connections. Catastrophic when a new bundle
	    tries to POST /admin/shutdown to the old bridge but the old
	    bridge's serve_forever is stuck mid-/health waiting for the
	    UI thread that the new bundle now holds. Diagnosed live:
	    `/admin/shutdown to foreign bridge failed: [Errno 10060]
	    timeout` while the foreign bridge's TCP accept queue still
	    accepted the connection.

	ThreadingMixIn spawns a thread per request so a stuck handler
	can't paralyze the server. daemon_threads=True ensures those
	per-request threads don't keep the IronPython interpreter alive
	past CODESYS exit.
	"""
	allow_reuse_address = True
	daemon_threads = True


def _run_server():
	"""Bind + serve. Runs on the daemon thread started by main().

	Bind retry exists as defence-in-depth: in clean re-execution flow
	the cross-bundle shutdown frees the port before we get here, so
	the first attempt succeeds. But if TIME_WAIT briefly holds the
	port, the retry loop + SO_REUSEADDR get us in within a few
	seconds. After 10s total we give up and surface the error.
	"""
	server = None
	last_err = None
	for attempt in range(20):  # ~10s total
		try:
			server = _ReusableHTTPServer(("127.0.0.1", BRIDGE_PORT), _BridgeHandler)
			if attempt > 0:
				log.startup("[HTTP] bind succeeded on attempt {0}".format(attempt + 1))
			break
		except Exception as e:
			last_err = e
			# Log every 5th attempt so we see progress in CODESYS log
			# without spamming.
			if attempt == 0 or attempt % 5 == 4:
				log.warn("[HTTP] bind attempt {0}/20 failed: {1}".format(attempt + 1, e))
			time.sleep(0.5)
	if server is None:
		log.error("[HTTP] failed to bind port {0} after 10s: {1}".format(BRIDGE_PORT, last_err))
		log.error("[HTTP] another process is holding the port -- close all CODESYS instances and retry")
		return
	# Register in AppDomain so the NEXT bundle exec can find us and
	# shut us down cleanly without restarting CODESYS. We pass
	# threading.current_thread() so the next bundle can join() it,
	# avoiding a race where the daemon outlives its server.
	cross_bundle_state.register_bridge(server, threading.current_thread(), BRIDGE_BUILD_ID)
	log.startup("Bridge listening on http://127.0.0.1:{0} (version {1}, build {2})".format(
		BRIDGE_PORT, BRIDGE_VERSION, BRIDGE_BUILD_ID))
	try:
		server.serve_forever()
	except Exception as e:
		log.error("[HTTP] server loop crashed: {0}".format(e))


def main():
	log.startup("=" * 60)
	log.startup("Volt CODESYS Bridge {0} starting".format(BRIDGE_VERSION))
	log.startup("Build ID: {0}".format(BRIDGE_BUILD_ID))
	log.startup("IDE: {0} {1}".format(_connection_singleton.ide_name, _connection_singleton.ide_version))
	if not _connection_singleton.is_connected:
		log.warn("[STARTUP] scriptengine import failed -- bridge will serve /health but every other call returns 503")
	_stop_existing_bridge_if_any()

	t = threading.Thread(target=_run_server, name="volt-bridge-http")
	t.daemon = True  # property works in both IronPython 2.7 and CPython 3+
	t.start()
	log.startup("Ready. Connect Volt agent at http://127.0.0.1:{0}".format(BRIDGE_PORT))
	log.startup("Close CODESYS to stop the bridge.")
	log.startup("=" * 60)

	# CRITICAL: do NOT block here. Inside CODESYS, `Tools > Scripting >
	# Execute Script File` runs this script ON THE IDE'S UI THREAD.
	# Any blocking call here (sleep loop, server.serve_forever, etc.)
	# freezes the CODESYS UI and — more importantly — prevents
	# ui_thread.invoke_on_ui from EVER getting the UI thread to
	# dispatch CODESYS-API work.
	#
	# We return immediately. The script's globals (and the daemon
	# thread we just started) stay alive in IronPython's interpreter
	# for the lifetime of the CODESYS process. When CODESYS shuts
	# down, the daemon dies with the interpreter.
	#
	# For non-CODESYS smoke tests (CPython direct run), the
	# `if __name__ == "__main__"` block below keeps the process alive
	# instead — needed there because no host event loop is keeping
	# the daemon thread's owner alive.


if __name__ == "__main__":
	main()
	# Inside CODESYS: scriptengine is importable. We MUST NOT block
	# here — the script runs on the IDE's UI thread, so any sleep
	# would freeze CODESYS and prevent ui_thread.invoke_on_ui from
	# ever dispatching CODESYS-API work. CODESYS itself keeps the
	# IronPython interpreter (and our daemon thread) alive for the
	# lifetime of the process.
	#
	# Outside CODESYS (CPython smoke-test): scriptengine is missing.
	# We DO block, because nothing else is keeping the daemon thread's
	# parent process alive — if main() returned, the process would
	# exit and the daemon would die with it.
	try:
		import scriptengine  # type: ignore[import-not-found]  # noqa: F401
		# CODESYS path — fall through, let main() return.
	except ImportError:
		# CPython smoke-test path — keep the process alive.
		try:
			while True:
				time.sleep(60)
		except (KeyboardInterrupt, SystemExit):
			log.startup("Bridge stopping (interrupt)")
