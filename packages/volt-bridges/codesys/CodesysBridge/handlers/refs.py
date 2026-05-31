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
		# iter_all_items returns BOTH source POUs (LSP-analyzable) and
		# non-source config items (tasks, visualizations, alarm configs,
		# etc.). Source items get SHA1(decl + impl) — content-drift
		# sensitive. Config items get a constant version because
		# CODESYS exposes no cheap content-hash on them (verified via
		# /debug/probe: only stable IDs like guid/handle/index exist,
		# no `modified` / `revision` property). Honest representation
		# is "no per-item version tracking"; structural add / remove /
		# rename still surface via structureVersion. Must match the
		# same branching in fetch.py so /refs and /fetch agree.
		for (name, kind, item, is_source) in connection.iter_all_items():
			try:
				if is_source:
					versions[name] = _conn_mod.CodesysConnection.compute_item_version(item)
				else:
					# Config items and folder markers: opaque. Use
					# the kind string as the version so it's stable
					# AND legible ("config" or "folder").
					versions[name] = kind
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
