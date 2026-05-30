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
"""
# pyright: reportMissingImports=false
import hashlib

from . import log
from .helpers import block_type_mapper

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

	# ─── State ────────────────────────────────────────────────────

	@property
	def is_connected(self):
		# type: () -> bool
		return _SCRIPTENGINE_AVAILABLE

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
		Folders are walked through transparently.

		Returns a list (not a generator) so the caller can release the
		UI thread before iterating."""
		out = []
		proj = self.get_project()
		if proj is None:
			return out
		self._walk(proj, out)
		return out

	def _walk(self, node, out):
		try:
			children = node.get_children(recursive=False)
		except Exception:
			return
		for child in children:
			try:
				marker = str(child)
			except Exception:
				continue
			# Folder: recurse
			if block_type_mapper.MARKER_FOLDER in marker:
				self._walk(child, out)
				continue
			# Textual object: classify by first declaration keyword
			if block_type_mapper.MARKER_TEXTUAL_DECL in marker:
				try:
					decl = child.textual_declaration.text or ""
				except Exception:
					continue
				kind = block_type_mapper.classify_textual_pou(decl)
				if block_type_mapper.is_top_level(kind):
					try:
						name = child.get_name() if hasattr(child, "get_name") else None
					except Exception:
						continue
					if name:
						out.append((name, kind, child))

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

	# ─── Per-item version + project version ───────────────────────

	@staticmethod
	def compute_item_version(item):
		# type: (object) -> str
		"""SHA1 of the item's declaration + implementation + sorted
		child digests. Matches the C# `ComputeItemVersion` semantic
		(same hash inputs → same digest, sliced to 16 chars)."""
		h = hashlib.sha1()

		def _add(s):
			if s is None:
				s = ""
			if isinstance(s, bytes):
				h.update(s)
			else:
				h.update(s.encode("utf-8"))
			h.update(b"\x00")

		try:
			_add(item.textual_declaration.text)
		except Exception:
			_add("")
		try:
			_add(item.textual_implementation.text)
		except Exception:
			_add("")

		# Child digests — recurse children for stable nested hashing.
		try:
			child_digests = []
			for child in item.get_children(recursive=False):
				try:
					marker = str(child)
				except Exception:
					continue
				if block_type_mapper.MARKER_TEXTUAL_DECL not in marker:
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
				child_digests.append("{0}\x01{1}\x01{2}".format(cname, cdecl, cimpl))
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
