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
///     "projectVersion": "<sha1 short>",
///     "items": { "FB_RateLimiter": "<sha1>", "PLC_PRG": "<sha1>", ... }
///   }
///
/// Walks NestedProject and picks out top-level CRUD items (POU / GVL /
/// DUT / Interface) via <see cref="BlockTypeMapper.IsTopLevelCrud"/>.
/// Each item's version is the sha1 of its full content (recursive — see
/// <see cref="BeckhoffConnection.ComputeItemVersion"/>).
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

		var itemVersions = new Dictionary<string, string>();
		var itemKinds = new Dictionary<string, string>();
		var root = _connection.GetPlcProjectRoot();
		CollectVersions(root, itemVersions, itemKinds);

		return new Dictionary<string, object?>
		{
			["projectVersion"] = BeckhoffConnection.ComputeProjectVersion(itemVersions),
			["structureVersion"] = BeckhoffConnection.ComputeStructureVersion(itemVersions),
			["items"] = itemVersions,
			// Per-item vendor-neutral kind string ("function_block", "gvl",
			// "interface", etc.), parallel to `items`. Lets clients route
			// per kind (extension picking, future per-type content
			// handling) without re-inferring from declaration text. Every
			// bridge implementation translates its native type code to
			// this same canonical vocabulary.
			["kinds"] = itemKinds,
		};
	}

	private void CollectVersions(dynamic node, Dictionary<string, string> versions, Dictionary<string, string> kinds)
	{
		int count;
		try { count = (int)node.ChildCount; }
		catch { return; }

		for (int i = 1; i <= count; i++)
		{
			dynamic child;
			try { child = node.Child[i]; }
			catch { continue; }

			string name;
			try { name = (string)child.Name; }
			catch { continue; }

			int itemType = BeckhoffConnection.GetItemType(child);

			if (itemType == BlockTypeMapper.FolderSubType)
			{
				// Recurse to find items inside.
				CollectVersions(child, versions, kinds);
				continue;
			}

			if (BlockTypeMapper.IsInlinedInPou(itemType))
			{
				// Methods/actions/properties/transitions ride inline via
				// StAssembler — emitting them here would duplicate content
				// the parent POU's sourceText already carries.
				continue;
			}

			try
			{
				if (BlockTypeMapper.IsTopLevelCrud(itemType))
				{
					versions[name] = BeckhoffConnection.ComputeItemVersion(child);
					kinds[name] = BlockTypeMapper.ToNodeType(itemType);
				}
				else
				{
					// Non-CRUD items get vendor-neutral kind strings the agent
					// recognizes (visualization → .visu, recipe_manager →
					// .recipes, task → .task, library_manager → .libraries,
					// library → .library, tmc_file → .tmc, etc.). Unknown
					// codes fall through to "config" → generic `.xml`.
					// Version is the kind itself — constant per item, so
					// /refs is fast and structureVersion still flips on
					// add/remove/rename.
					string configKind = BlockTypeMapper.ToConfigKind(itemType);
					versions[name] = configKind;
					kinds[name] = configKind;
				}
			}
			catch
			{
				// One bad object shouldn't poison the whole refs walk.
			}
		}
	}
}
