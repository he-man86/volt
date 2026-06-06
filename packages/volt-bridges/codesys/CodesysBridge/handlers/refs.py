"""
GET /refs — project + per-item content versions. Wire equivalent of
`git ls-remote`.

Wire shape mirrors RefsResponse in
`packages/volt-agent/src/bridge/types.ts`:
  {
    projectVersion: <sha1>,
    structureVersion: <sha1>,
    items: { name → version },
    kinds: { name → vendor-neutral-kind }
  }

Per-item version is a real CONTENT hash:
  * source items  → SHA1(decl + impl + children)         (cheap)
  * non-source    → SHA1(item.export_native output)      (1-2s/item)
  * folders       → constant marker "folder"             (no content)

The non-source path was previously "use the kind string" (= constant
"task"/"cam"/etc.), which made content drift invisible to pull. That
hid every Project-Settings / Task / Cam edit. See memory
`feedback_no_fallbacks` and the rationale at the rewrite.
"""
# pyright: reportMissingImports=false
from .. import codesys_connection as _conn_mod
from .. import ui_thread


def handle(connection):
	# type: (object) -> dict
	if not connection.is_connected:
		raise RuntimeError("CODESYS Scripting Engine not available")

	# Imported lazily — the single-file bundle loads handlers in the
	# order listed in bundle.MODULES, and `refs` sits before `fetch`.
	# Top-level `from . import fetch` would fail at bundle boot time;
	# resolving inside `handle()` lets the module register first.
	from . import fetch as _fetch_mod

	def _do():
		versions = {}
		kinds = {}
		for (name, kind, item, is_source, _folder) in connection.iter_all_items():
			try:
				# Single source of truth for "version of this item".
				# Lives in fetch.py because /fetch also needs it.
				versions[name] = _fetch_mod.compute_item_version(
					item, name, kind, is_source
				)
				kinds[name] = kind
			except Exception:
				continue
		return versions, kinds

	versions, kinds = ui_thread.invoke_on_ui(_do)
	return {
		"projectVersion": _conn_mod.CodesysConnection.compute_project_version(versions),
		"structureVersion": _conn_mod.CodesysConnection.compute_structure_version(versions),
		"items": versions,
		"kinds": kinds,
	}
