"""
Mirrors `packages/volt-bridges/beckhoff/BeckhoffBridge/BeckhoffConnection.cs`.

Wraps the CODESYS Scripting Engine: project access, item lookup,
tree walking, per-item version + project version computation.

Equivalent role to BeckhoffConnection but driven by the CODESYS
`scriptengine` module instead of TwinCAT's COM interfaces:

  scriptengine.projects.primary        — active project
  scriptengine.system                  — IDE-level access (messages, etc.)
  obj.get_children(recursive=False)    — tree iteration
  obj.find(name, recursive=True)       — direct lookup (SP19+; fallback walk)
  obj.textual_declaration.text         — POU declaration source
  obj.textual_implementation.text      — POU implementation source

The "degraded" state concept matches BeckhoffConnection — when the
Scripting API throws RPC-class exceptions we flip to degraded and
serve /health but refuse non-/health calls with 503. Cleared on the
next successful probe.

Structural contracts: `iter_all_items` below is the single walker
used by refs/fetch/push handlers — see
`packages/volt-bridges/INVARIANTS.md` for the rules (single walker,
post-push fetch invariant, itemCache through apply).
"""
# pyright: reportMissingImports=false
import hashlib
import threading
import time

from .helpers import block_type_mapper, log, plcopen_xml

# CODESYS Scripting Engine imports — only present inside the IDE.
_SCRIPTENGINE_AVAILABLE = False
projects = None
system = None
try:
	from scriptengine import projects, system  # type: ignore[import-not-found,no-redef]
	_SCRIPTENGINE_AVAILABLE = True
except ImportError:
	# Outside CODESYS — bridge will report unavailable in /health.
	pass


_WARNED_MARKERS = set()


def _warn_unmatched_marker(marker):
	# type: (str) -> None
	"""Log ONCE per distinct CODESYS object marker we walked into
	without a registered TypeExtension. Mirrors Beckhoff's
	`BlockTypeMapper.WarnUnknownCode` so adding new kinds is a
	bridge.log → register → done loop on either bridge."""
	try:
		key = str(marker)
	except Exception:
		return
	if key in _WARNED_MARKERS:
		return
	_WARNED_MARKERS.add(key)
	log.warn(
		"[extensions] unmatched marker — no TypeExtension claims this kind: {0}. "
		"Register one in handlers/extensions.py after probing via /debug/try-attrs.".format(key)
	)


def _walk_folder_path(item):
	# type: (object) -> str
	"""Walk an item's parent chain into a workspace-relative folder
	path (root → leaf). Stops at the project root (parent=None).

	Used by library-ref emission: refs don't expose `parent`
	cleanly, so iter_all_items resolves the folder at iteration
	time on the MANAGER and passes it down via the tuple's 5th
	slot. Source-item emission relies on the agent-side
	`_folder_path_for` helper which does the same walk in
	fetch.py.
	"""
	segments = []
	try:
		cursor = getattr(item, "parent", None)
		for _ in range(30):
			if cursor is None:
				break
			try:
				parent_name = cursor.get_name() if hasattr(cursor, "get_name") else None
			except Exception:
				break
			if not parent_name:
				break
			segments.append(parent_name)
			cursor = getattr(cursor, "parent", None)
	except Exception:
		return ""
	# Bottom-up walk; reverse so the path reads root → leaf.
	segments.reverse()
	return "/".join(segments)

# Host IDE auto-detect (CODESYS / Lenze PLC Designer / Schneider ME ...)
# Useful for triage when the same script runs across OEM variants.
_IDE_NAME = None
_IDE_VERSION = None
try:
	from System.Diagnostics import Process as _Process  # type: ignore[import-not-found]
	_proc = _Process.GetCurrentProcess()
	_fvi = _proc.MainModule.FileVersionInfo
	_IDE_NAME = _fvi.ProductName or _fvi.FileDescription
	_IDE_VERSION = _fvi.ProductVersion or _fvi.FileVersion
except Exception:
	pass


class CodesysConnection(object):
	"""Holds the bridge's view of the CODESYS IDE. Singleton — one
	instance per bridge process. All methods marked `# UI` MUST be
	called via `ui_thread.invoke_on_ui` from the HTTP handler."""

	def __init__(self):
		self._degraded = False
		self._degraded_reason = None
		self._connected_initial = _SCRIPTENGINE_AVAILABLE
		# ─── IDE-state cache ─────────────────────────────────────────
		# /health reads from this snapshot WITHOUT invoking COM. Without
		# the cache, /health called invoke_on_ui directly and serialized
		# behind any in-flight /refs walk on the single CODESYS UI thread.
		# A 2s client-side timeout on /health then spuriously flipped the
		# extension's connection state to "unreachable" during the COM-
		# thread recovery window after a long /refs walk, clobbering a
		# clean post-pull tree state.
		#
		# Pattern: stale-while-revalidate. /health returns whatever is
		# cached and triggers `trigger_async_probe()` when the cache is
		# older than ~5s. The probe runs on a daemon thread that marshals
		# to the UI thread — if COM is busy, the probe sits queued; if
		# not, it updates the cache in a few ms. Either way, /health
		# itself never blocks.
		self._cache_lock = threading.Lock()
		self._cached_ide_alive = False
		self._cached_project_name = None
		self._cached_plc_project_name = None
		self._cached_project_dirty = None
		self._cached_at_ms = 0  # 0 = never populated
		self._probe_in_flight = False  # collapses bursts of probe requests

	# ─── State ────────────────────────────────────────────────────

	@property
	def is_connected(self):
		# type: () -> bool
		"""Cheap, off-UI-thread capability check: was the CODESYS
		scriptengine module importable at startup? True does NOT mean
		a project is currently loaded — that requires `probe_ide_alive`
		(which has to run on the UI thread). Used as a quick "is the
		bridge even capable of talking to CODESYS at all?" gate."""
		return _SCRIPTENGINE_AVAILABLE

	# UI
	def probe_ide_alive(self):
		# type: () -> bool
		"""Active liveness probe — mirrors BeckhoffConnection.ProbeIdeAlive.
		Returns True only when a primary project is currently accessible.
		MUST be called on the UI thread (touches scriptengine.projects).

		Used by the HTTP request gate in bridge.py so that /refs, /fetch,
		/push, /build can't return 200-OK empty responses when no project
		is loaded. Without this, the walker would iterate zero items and
		look like "engineer deleted everything" to volt-agent."""
		if not _SCRIPTENGINE_AVAILABLE:
			return False
		try:
			# Touching projects.primary is the cheapest valid scriptengine
			# call and reliably returns None / faults if no project is
			# loaded.
			return projects.primary is not None
		except Exception:
			return False

	@property
	def is_degraded(self):
		# type: () -> bool
		return self._degraded

	@property
	def degraded_reason(self):
		# type: () -> object
		return self._degraded_reason

	def mark_degraded(self, reason):
		# type: (str) -> None
		self._degraded = True
		self._degraded_reason = reason
		log.warn("[CONN] degraded: {0}".format(reason))

	def clear_degraded(self):
		# type: () -> None
		if self._degraded:
			log.ide("[CONN] degraded cleared")
		self._degraded = False
		self._degraded_reason = None

	@property
	def ide_name(self):
		return _IDE_NAME

	@property
	def ide_version(self):
		return _IDE_VERSION

	# ─── IDE-state cache ──────────────────────────────────────────

	def get_cache_snapshot(self):
		# type: () -> dict
		"""Thread-safe snapshot of the cached IDE state. Returns dict
		with keys ide_alive, project_name, plc_project_name,
		project_dirty, age_ms. `age_ms` is None when no probe has ever
		populated the cache."""
		with self._cache_lock:
			if self._cached_at_ms == 0:
				age_ms = None
			else:
				age_ms = int(time.time() * 1000) - self._cached_at_ms
			return {
				"ide_alive": self._cached_ide_alive,
				"project_name": self._cached_project_name,
				"plc_project_name": self._cached_plc_project_name,
				"project_dirty": self._cached_project_dirty,
				"age_ms": age_ms,
			}

	def _replace_cache(self, ide_alive, project_name, plc_project_name, project_dirty):
		# type: (bool, object, object, object) -> None
		"""Atomically write a new cache snapshot. Called only from the
		async probe."""
		with self._cache_lock:
			self._cached_ide_alive = bool(ide_alive)
			self._cached_project_name = project_name
			self._cached_plc_project_name = plc_project_name
			self._cached_project_dirty = project_dirty
			self._cached_at_ms = int(time.time() * 1000)

	def trigger_async_probe(self):
		# type: () -> None
		"""Fire a one-shot background probe that updates the cache.
		No-op if a probe is already in flight (collapses bursts of
		/health calls into a single COM round-trip). Called by /health
		on stale-cache reads and once at bridge startup to warm the
		cache before the first user request."""
		with self._cache_lock:
			if self._probe_in_flight:
				return
			self._probe_in_flight = True
		t = threading.Thread(target=self._run_async_probe, name="codesys-cache-probe")
		t.daemon = True
		t.start()

	def _run_async_probe(self):
		# type: () -> None
		"""Body of the async probe. Marshals to the CODESYS UI thread.
		If COM is busy (e.g. /refs walk in progress), the probe sits
		queued on the UI-thread message pump — doesn't affect /health
		response times, which read the previously-cached state. When
		COM frees, the probe completes and the cache reflects the new
		state on the next /health call."""
		# Local import to dodge a potential circular at module load:
		# bridge.py imports both modules.
		from . import ui_thread
		ide_alive = False
		project_name = None
		plc_project_name = None
		project_dirty = None
		try:
			ide_alive = ui_thread.invoke_on_ui(self.probe_ide_alive)
			if ide_alive:
				project_name = ui_thread.invoke_on_ui(self.get_project_name)
				plc_project_name = project_name
				project_dirty = ui_thread.invoke_on_ui(self.get_project_dirty)
				self.clear_degraded()
		except ui_thread.UiThreadUnavailable as e:
			self.mark_degraded(str(e))
		except Exception as e:
			self.mark_degraded("async probe failed: {0}".format(e))
		finally:
			self._replace_cache(ide_alive, project_name, plc_project_name, project_dirty)
			with self._cache_lock:
				self._probe_in_flight = False

	# ─── Project access (UI THREAD ONLY) ──────────────────────────

	def get_project(self):
		# type: () -> object
		"""Return scriptengine.projects.primary or None when no project
		is loaded. Must be called on UI thread."""
		if not _SCRIPTENGINE_AVAILABLE:
			return None
		try:
			return projects.primary
		except Exception:
			return None

	def get_project_name(self):
		# type: () -> object
		proj = self.get_project()
		if proj is None:
			return None
		try:
			# `.path` on a ScriptProject returns the filesystem path;
			# basename minus extension is the conventional project name.
			path = getattr(proj, "path", None)
			if path:
				import os
				return os.path.splitext(os.path.basename(path))[0]
			return proj.get_name() if hasattr(proj, "get_name") else None
		except Exception:
			return None

	def get_project_dirty(self):
		# type: () -> object
		"""Return the project's dirty flag (True / False) or None when
		the SP doesn't expose one. ScriptProject in 3.5.21+ documents a
		`dirty` read-only property; older SPs and some OEM rebrands
		don't. We probe via getattr and return None on absence so the
		health response can say "unknown" honestly instead of faking a
		false (which a downstream consumer might trust as "engineer has
		saved everything")."""
		proj = self.get_project()
		if proj is None:
			return None
		try:
			val = getattr(proj, "dirty", None)
		except Exception:
			return None
		if val is None:
			return None
		try:
			return bool(val)
		except Exception:
			return None

	def get_application(self):
		# type: () -> object
		"""Find the first child with a `build` method — that's the
		Application. CODESYS projects can have multiple devices; we
		drive the first one and surface multi-app projects as a
		discovery later if it comes up."""
		proj = self.get_project()
		if proj is None:
			return None
		try:
			for child in proj.get_children(recursive=True):
				if hasattr(child, "build"):
					return child
		except Exception:
			pass
		return None

	# ─── Tree walking (UI THREAD ONLY) ────────────────────────────

	def iter_top_level(self):
		# type: () -> list
		"""Walk the project tree and yield (name, kind, item) for
		every top-level CRUD-addressable object (POU/GVL/DUT/Interface).

		Uses CODESYS's built-in recursive walk so we transparently
		descend into Device -> PLC Logic -> Application -> POUs without
		hard-coding the intermediate container types. We filter the
		flat enumeration: keep only items whose str() marker says
		ScriptTextualDeclaration AND whose first declaration keyword
		classifies to one of our top-level kinds. Methods / actions /
		properties (nested under their parent POU) classify as
		KIND_UNKNOWN here (no FUNCTION_BLOCK / FUNCTION / etc. lead
		keyword) and get filtered out — they ride inline via
		StAssembler when /fetch emits their parent.

		Returns a list (not a generator) so the caller can release the
		UI thread before iterating."""
		out = []
		proj = self.get_project()
		if proj is None:
			return out
		try:
			all_children = proj.get_children(recursive=True)
		except Exception:
			return out
		for child in all_children:
			try:
				marker = str(child)
			except Exception:
				continue
			# Accept any textual marker (decl+impl, decl-only, or impl-only).
			if not block_type_mapper.is_textual_item(marker):
				continue
			# Skip transient duplicates (visualization runtime copies).
			if block_type_mapper.MARKER_TRANSIENT in marker:
				continue
			# Only items with a declaration are top-level candidates.
			# ACTION / TRANSITION (impl-only) ride inline under their
			# parent POU — handled in fetch.py.
			if not block_type_mapper.has_declaration(marker):
				continue
			# Two-step classification:
			#  (1) HEADER PARSE — gate which items are even ELIGIBLE
			#      for top-level enumeration. Methods / actions /
			#      properties / accessors all return KIND_UNKNOWN
			#      from classify_textual_pou and get skipped here.
			#      This is the FILTER step.
			#  (2) PLCopenXML — once we know it's a top-level POU
			#      candidate, refine the kind authoritatively (this
			#      is the Beckhoff-parity step — see plcopen_xml.py).
			# Doing XML-only would falsely classify methods as their
			# parent FB's kind, because `obj.export_xml()` on a method
			# returns the parent POU's full XML wrapper.
			try:
				decl = child.textual_declaration.text or ""
			except Exception:
				continue
			header_kind = block_type_mapper.classify_textual_pou(decl)
			if not block_type_mapper.is_top_level(header_kind):
				continue
			# Refine with PLCopenXML when available.
			cls = plcopen_xml.classify(child)
			kind = cls["kind"] if cls["kind"] != block_type_mapper.KIND_UNKNOWN else header_kind
			try:
				name = child.get_name() if hasattr(child, "get_name") else None
			except Exception:
				continue
			if name:
				out.append((name, kind, child))
		return out

	def iter_all_items(self):
		# type: () -> list
		"""Walk the project tree ONCE and yield (name, kind, item,
		is_source, folder_override) tuples for every meaningful item.

		`folder_override` is None for items whose folder is naturally
		derivable from the parent-walk (i.e. nearly everything). For
		library refs, the libref objects don't expose a `parent`
		attribute we can walk, so we capture the resolved folder
		(parent-of-manager + "/" + manager-name) at iteration time
		and pass it down. Callers fall back to `_folder_path_for(item)`
		when this is None.

		Single-pass design: we previously called iter_top_level() AND
		walked proj.get_children() separately, doubling COM calls on
		large projects and turning /refs into a 60s wedge. This version
		walks the recursive children once and routes per-marker.

		Categories produced:
		  - is_source=True:   POU/GVL/DUT/Interface — textual code the
		                      LSP can analyze. Kind classified via
		                      PLCopenXML (or header parse fallback).
		  - kind from TypeExtension registry:
		                      tasks / library refs / project info /
		                      visualizations / recipe manager / image
		                      pools / text lists / devices / symbol
		                      config / trace / etc. Routed via
		                      `handlers/extensions.py::matching_for_marker`
		                      — each registered kind has a typed
		                      formatter producing a deterministic text
		                      manifest. SHA1 of the manifest is the
		                      content-aware version /refs reports.
		  - folder markers:   empty engineer-created folders.

		Markers without a matching TypeExtension entry are dropped —
		see the comment in the fall-through branch for the per-kind
		reasoning when something new shows up.

		Also dropped:
		  - Library Manager itself — we emit its children as `library`
		    items; the manager wrapper has no engineer-meaningful
		    content beyond pointing at them.
		  - Transient duplicates (visualization runtime copies)
		  - Top-level wrappers (Application/Plc Logic/Device)
		  - Methods/actions/properties (ride inline with parent POU)
		  - Items lacking a name
		"""
		# Lazy import — the single-file bundle loads handlers AFTER
		# connection, so top-level `from .handlers import extensions`
		# would fail at boot. Resolving inside the method lets the
		# handlers package register first.
		from .handlers import extensions
		out = []
		proj = self.get_project()
		if proj is None:
			return out
		try:
			all_children = list(proj.get_children(recursive=True))
		except Exception:
			return out
		seen_names = set()
		SKIP_WRAPPER_NAMES = ("Application", "Plc Logic", "Device")
		for child in all_children:
			try:
				marker = str(child)
			except Exception:
				continue
			if block_type_mapper.MARKER_TRANSIENT in marker:
				continue
			try:
				name = child.get_name() if hasattr(child, "get_name") else None
			except Exception:
				continue
			if not name or name in seen_names:
				continue

			# Folder branch: only emit folders that are EMPTY (no
			# non-folder descendants anywhere below). Non-empty folders
			# show up naturally via their children's parent-walk paths,
			# so emitting them here would just sprinkle redundant
			# .gitkeep markers inside already-populated directories.
			try:
				if getattr(child, "is_folder", False):
					has_items = False
					try:
						for d in child.get_children(recursive=True):
							if not getattr(d, "is_folder", False):
								has_items = True
								break
					except Exception:
						pass
					if not has_items and name not in SKIP_WRAPPER_NAMES:
						seen_names.add(name)
						out.append((name, "folder", child, False, None))
					continue
			except Exception:
				pass

			if not block_type_mapper.is_textual_item(marker):
				# Non-source item — route through the TypeExtension
				# registry. Each entry there declares its marker
				# token plus an optional drill function for container
				# patterns (Library Manager, Task Configuration).
				ext = extensions.matching_for_marker(marker)
				if ext is None:
					# Not a tracked kind. Log ONCE per distinct marker
					# so a new CODESYS object class surfaces in
					# bridge.log instead of vanishing silently — mirrors
					# Beckhoff's `WarnUnknownCode` in BlockTypeMapper.
					# If a future SP exposes typed wrappers (the
					# IronPython surface for tasks/visus is generic-only
					# in 3.5.21.40; only `export_native` reads content,
					# which is per-item file IO triggering an
					# interactive dialog), register a TypeExtension here.
					_warn_unmatched_marker(marker)
					continue
				if ext.drill is not None:
					# Container kind — emit each typed child the drill
					# function returns. Folder = parent-of-container +
					# container-name so workspace mirrors the IDE tree.
					parent_folder = _walk_folder_path(child)
					child_folder = parent_folder + "/" + name if parent_folder else name
					for child_name, child_obj in ext.drill(child):
						if not child_name or child_name in seen_names:
							continue
						seen_names.add(child_name)
						out.append((child_name, ext.kind, child_obj, False, child_folder))
				else:
					# Self-typed item — emit the item itself with the
					# kind the extension claims. Folder is derived
					# naturally from the agent-side parent walk.
					seen_names.add(name)
					out.append((name, ext.kind, child, False, None))
				continue

			# Source POU branch — only top-level items survive
			# (methods/actions/properties classify as UNKNOWN
			# from the first-keyword scan and get filtered out;
			# they ride inline via st_assembler).
			if not block_type_mapper.has_declaration(marker):
				continue
			try:
				decl = child.textual_declaration.text or ""
			except Exception:
				continue
			header_kind = block_type_mapper.classify_textual_pou(decl)
			if not block_type_mapper.is_top_level(header_kind):
				continue
			cls = plcopen_xml.classify(child)
			kind = cls["kind"] if cls["kind"] != block_type_mapper.KIND_UNKNOWN else header_kind
			seen_names.add(name)
			out.append((name, kind, child, True, None))
		return out

	def iter_top_level_from_all(self, all_items=None):
		# type: (object) -> list
		"""Returns (name, kind, item) for source items only. Wrapper
		that builds on `iter_all_items` for callers that don't care
		about config items (push handler, hash recompute)."""
		if all_items is None:
			all_items = self.iter_all_items()
		return [(n, k, it) for (n, k, it, src, _f) in all_items if src]

	def find_by_name(self, name):
		# type: (str) -> object
		"""Look up an item by name. Tries the SP19+ `find` fast path
		first; falls back to a manual walk for older SPs or when
		`find` returns nothing."""
		proj = self.get_project()
		if proj is None:
			return None
		if hasattr(proj, "find"):
			try:
				res = proj.find(name, recursive=True)
				# `find` may return a single object or a list — coerce.
				if res is None:
					pass
				elif hasattr(res, "__iter__") and not isinstance(res, str):
					for item in res:
						return item
				else:
					return res
			except Exception:
				pass
		# Fallback walk
		for (n, _kind, item) in self.iter_top_level():
			if n == name:
				return item
		return None

	# ─── Folder path resolution ───────────────────────────────────

	@staticmethod
	def folder_path_for(item):
		# type: (object) -> str
		"""Walk up parents to compute the CODESYS folder path for an
		item — used for BOTH source POUs and non-source config items
		so the workspace layout mirrors the IDE tree exactly. Stops
		at the project root (returns empty string for items at the
		root). Also drives the per-item version hash so MOVES in the
		IDE produce a version bump that the agent detects on /refs.
		"""
		segments = []
		try:
			cursor = getattr(item, "parent", None)
			# Sanity bound — even deep trees don't reach 30.
			for _ in range(30):
				if cursor is None:
					break
				try:
					cname = cursor.get_name() if hasattr(cursor, "get_name") else None
				except Exception:
					cname = None
				if cname in (None, "", "/"):
					break
				# Stop at the project node itself (its parent is None).
				parent_of_cursor = None
				try:
					parent_of_cursor = getattr(cursor, "parent", None)
				except Exception:
					pass
				if parent_of_cursor is None:
					break
				segments.append(cname)
				cursor = parent_of_cursor
		except Exception:
			return ""
		segments.reverse()
		return "/".join(segments)

	# ─── Per-item version + project version ───────────────────────

	@staticmethod
	def compute_item_version(item):
		# type: (object) -> str
		"""SHA1 of the item's declaration + implementation + folder
		path + sorted child digests. Folder path is included so a
		MOVE in the IDE (same content, new folder) bumps the version
		— the agent's drift loop then refetches and the materializer
		writes at the new location, sweeping the old path.

		Foundation principle: per-item version = SHA1(everything the
		materializer needs). Content + location + structure all
		participate in the hash; the wire stays simple (no /move
		verb, no parallel folder map on /refs).
		"""
		h = hashlib.sha1()

		def _add(s):
			if s is None:
				s = ""
			if isinstance(s, bytes):
				h.update(s)
			else:
				h.update(s.encode("utf-8"))
			h.update(b"\x00")

		# Folder path FIRST — so a move (same content, new folder)
		# produces a different hash and the agent's drift loop kicks
		# in. Prefix with "folder=" so the input is unambiguous if
		# the path happens to look like declaration text.
		try:
			_add("folder=" + CodesysConnection.folder_path_for(item))
		except Exception:
			_add("folder=")

		# For SOURCE items (POU/GVL/DUT/Interface) hash decl + impl.
		# For NON-SOURCE items these attributes don't exist — the
		# /refs/_do special-cases them with the GUID directly (no
		# SHA1, no children walk) so /refs stays fast on large
		# projects. compute_item_version is only called for source
		# items in the current code path.
		try:
			_add(item.textual_declaration.text)
		except Exception:
			_add("")
		try:
			_add(item.textual_implementation.text)
		except Exception:
			_add("")

		# Late import to avoid circular dep at module load — shared
		# by the parent-body block and the child-body loop below.
		try:
			from .helpers import plcopen_xml as _plcopen_xml  # noqa: WPS433
		except Exception:
			_plcopen_xml = None  # type: ignore[assignment]

		# Hash the parent POU's PLCopenXML body too. For graphical
		# top-level POUs (CFC/SFC/FBD/LD) `textual_implementation` is
		# empty — the actual content lives in the <body> element. Two
		# wins:
		#   (a) editing a CFC body in the IDE now bumps the parent's
		#       version → agent refetches on next /refs
		#   (b) this algorithm change itself produces a different
		#       hash than the prior version-computation, forcing a
		#       one-shot refetch of every source item after the
		#       bundle is upgraded (otherwise the agent never sees
		#       the new language=CFC / graphicalChildren payload for
		#       items whose surface text didn't change)
		if _plcopen_xml is not None:
			try:
				parent_body_xml = _plcopen_xml.extract_graphical_body(item) or ""
				_add(parent_body_xml)
			except Exception:
				_add("")

		# Child digests — recurse children for stable nested hashing.
		# For graphical children (FBD/LD/SFC/CFC action/method bodies)
		# the `textual_implementation` is empty; their actual content
		# lives in the PLCopenXML <body> element. Hash that too, or a
		# body edit in the IDE won't bump the parent's version and the
		# agent won't refetch.
		try:
			if _plcopen_xml is None:
				raise RuntimeError("plcopen_xml unavailable")
			child_digests = []
			for child in item.get_children(recursive=False):
				try:
					marker = str(child)
				except Exception:
					continue
				if not block_type_mapper.is_textual_item(marker):
					continue
				try:
					cname = child.get_name() if hasattr(child, "get_name") else ""
				except Exception:
					continue
				try:
					cdecl = child.textual_declaration.text or ""
				except Exception:
					cdecl = ""
				try:
					cimpl = child.textual_implementation.text or ""
				except Exception:
					cimpl = ""
				# Hash the graphical body too, when present — covers
				# the case where textual_implementation is empty but
				# the body is FBD/LD/SFC/CFC XML.
				try:
					child_body_xml = _plcopen_xml.extract_graphical_body(child) or ""
				except Exception:
					child_body_xml = ""
				child_digests.append("{0}\x01{1}\x01{2}\x01{3}".format(cname, cdecl, cimpl, child_body_xml))
			child_digests.sort()
			for d in child_digests:
				_add(d)
		except Exception:
			pass

		return h.hexdigest()[:16]

	@staticmethod
	def compute_project_version(versions):
		# type: (dict) -> str
		"""SHA1 of the sorted (name → version) map. Matches the C#
		bridge's projectVersion shape."""
		h = hashlib.sha1()
		for name in sorted(versions.keys()):
			h.update(name.encode("utf-8"))
			h.update(b"=")
			h.update(versions[name].encode("utf-8"))
			h.update(b"\x00")
		return h.hexdigest()[:16]

	@staticmethod
	def compute_structure_version(versions):
		# type: (dict) -> str
		"""SHA1 of sorted names only — stable across content edits,
		changes only on add/rename/delete."""
		h = hashlib.sha1()
		for name in sorted(versions.keys()):
			h.update(name.encode("utf-8"))
			h.update(b"\x00")
		return h.hexdigest()[:16]
