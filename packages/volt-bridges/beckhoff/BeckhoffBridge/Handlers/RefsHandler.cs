using System.Collections.Generic;
using BeckhoffBridge.Helpers;

namespace BeckhoffBridge.Handlers;

/// <summary>
/// GET /refs — Return the project's current "refs": a project-wide
/// version plus a per-item version map. Conceptually equivalent to
/// `git ls-remote` — small payload, no item content, lets the client
/// decide what (if anything) it needs to fetch.
///
/// Response shape:
///   {
///     "projectVersion": "&lt;sha1 short&gt;",
///     "items": { "FB_RateLimiter": "&lt;sha1&gt;", "PLC_PRG": "&lt;sha1&gt;", ... }
///   }
///
/// Walks the PLC project tree via <see cref="BeckhoffConnection.WalkProjectTree"/>
/// — the SAME walker FetchHandler and PushHandler use. Three handlers,
/// one walker, one item set: <c>projectVersion</c> is structurally
/// guaranteed to agree across them, so the client's push pre-flight
/// check can never reject with phantom drift between a pull and the
/// next push.
/// </summary>
internal sealed class RefsHandler
{
	private readonly BeckhoffConnection _connection;

	public RefsHandler(BeckhoffConnection connection)
	{
		_connection = connection;
	}

	public object Handle()
	{
		if (!_connection.IsConnected) throw BridgeException.NotConnected();

		// Flush BEFORE walking. TC keeps editor edits in in-memory
		// document buffers; reading without flushing first returns a
		// hash of the buffer state, which then differs from the hash
		// the next PushHandler / BuildHandler (both of which flush)
		// computes — surfacing as phantom drift on the client's next
		// push. The cost is one SaveAll per /refs (idempotent when
		// nothing's dirty), in exchange for hash stability across the
		// three handlers that compute item versions.
		_connection.FlushPendingWrites();

		var itemVersions = new Dictionary<string, string>();
		var itemKinds = new Dictionary<string, string>();
		_connection.WalkProjectTree((visit) =>
		{
			if (visit.IsTopLevelCrud)
			{
				itemVersions[visit.Name] = BeckhoffConnection.ComputeItemVersion(visit.Item, visit.FolderPath ?? "");
				itemKinds[visit.Name] = BlockTypeMapper.ToNodeType(visit.ItemType);
			}
			else
			{
				// Non-CRUD items (tasks / libraries / visualizations /
				// recipes / etc.) get a vendor-neutral kind string the
				// agent recognizes. The version is SHA1 of the typed
				// extractor's manifest — content-aware, agrees with the
				// hash FetchHandler computes for the same item.
				string? configKind = BlockTypeMapper.ToConfigKind(visit.ItemType);
				if (configKind is null)
				{
					Log.Warn($"[refs] skipping {visit.Name}: ItemType {visit.ItemType} unmapped in BlockTypeMapper.ToConfigKind");
					return;
				}
				// `visit.Item` is dynamic → BuildConfigManifest call is late-bound,
				// return type degrades to dynamic. The DLR auto-unboxes the
				// Nullable<ValueTuple>, so .Value fails — read named members directly.
				var manifest = _connection.BuildConfigManifest(visit.Item, configKind, visit.Name, visit.FolderPath ?? "");
				if (manifest is null) return;  // no extractor → skip with log
				itemVersions[visit.Name] = (string)manifest.Version;
				itemKinds[visit.Name] = configKind;
			}
		});

		// I/O devices (TIID subtree) — parallel walk, emitted as kind
		// "device". Same versioning path as PLC config items so
		// /refs ↔ /fetch hashes agree.
		_connection.WalkIoDevices((visit) =>
		{
			var manifest = _connection.BuildConfigManifest(visit.Item, "device", visit.Name, visit.FolderPath ?? "");
			if (manifest is null) return;
			itemVersions[visit.Name] = (string)manifest.Version;
			itemKinds[visit.Name] = "device";
		});

		return new Dictionary<string, object?>
		{
			["projectVersion"] = BeckhoffConnection.ComputeProjectVersion(itemVersions),
			["structureVersion"] = BeckhoffConnection.ComputeStructureVersion(itemVersions),
			["items"] = itemVersions,
			// Per-item vendor-neutral kind string ("function_block", "gvl",
			// "interface", etc.), parallel to `items`. Lets clients route
			// per kind (extension picking, future per-type content
			// handling) without re-inferring from declaration text.
			["kinds"] = itemKinds,
		};
	}
}
