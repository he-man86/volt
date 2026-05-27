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
		var root = _connection.GetPlcProjectRoot();
		CollectVersions(root, itemVersions);

		return new Dictionary<string, object?>
		{
			["projectVersion"] = BeckhoffConnection.ComputeProjectVersion(itemVersions),
			["structureVersion"] = BeckhoffConnection.ComputeStructureVersion(itemVersions),
			["items"] = itemVersions,
		};
	}

	private void CollectVersions(dynamic node, Dictionary<string, string> versions)
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
				// Recurse to find code items inside.
				CollectVersions(child, versions);
				continue;
			}

			if (!BlockTypeMapper.IsTopLevelCrud(itemType))
			{
				// Skip non-CRUD items (libraries, tasks, etc.).
				continue;
			}

			try
			{
				versions[name] = BeckhoffConnection.ComputeItemVersion(child);
			}
			catch
			{
				// One bad object shouldn't poison the whole refs walk.
			}
		}
	}
}
