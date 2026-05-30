"""
GET /refs — project + per-item content versions. Cheap (no source
payload). Wire equivalent of `git ls-remote`.

Wire shape mirrors RefsResponse in
`packages/volt-agent/src/bridge/types.ts`:
  {
    projectVersion: <sha1>,
    structureVersion: <sha1>,
    items: { name → version },
    kinds: { name → vendor-neutral-kind }
  }
"""
# pyright: reportMissingImports=false
from .. import codesys_connection as _conn_mod
from .. import ui_thread


def handle(connection):
	# type: (object) -> dict
	if not connection.is_connected:
		raise RuntimeError("CODESYS Scripting Engine not available")

	def _do():
		versions = {}
		kinds = {}
		for (name, kind, item) in connection.iter_top_level():
			try:
				versions[name] = _conn_mod.CodesysConnection.compute_item_version(item)
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
