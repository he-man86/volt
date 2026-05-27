using System.Collections.Generic;
using System.Text.Json.Nodes;
using BeckhoffBridge.Helpers;

namespace BeckhoffBridge.Handlers;

/// <summary>
/// POST /fetch — Return only the items the client doesn't already have at
/// the current version. The wire equivalent of `git fetch` over a small,
/// negotiated payload.
///
/// Request shape:
///   {
///     "knownItems": { "FB_RateLimiter": "<sha1>", ... }   // optional, empty = "I have nothing"
///   }
///
/// Response shape:
///   {
///     "projectVersion": "<sha1>",                          // current bridge state
///     "changed": [ AIGetResult, ... ],                     // items new or changed since client's known versions
///     "removed": [ "name1", "name2" ],                     // items the client knows about but no longer exist
///     "items":   { "name": "version" }                      // full ref map (so client can replace its cache wholesale)
///   }
///
/// Walk identical to RefsHandler — but for items whose version differs
/// from (or is absent from) the client's known map, we additionally
/// emit the full content via BuildResult.
/// </summary>
internal sealed class FetchHandler
{
	private readonly BeckhoffConnection _connection;

	public FetchHandler(BeckhoffConnection connection)
	{
		_connection = connection;
	}

	public object Handle(JsonObject body)
	{
		if (!_connection.IsConnected) throw BridgeException.NotConnected();

		var knownItems = ParseKnownItems(body);

		var currentVersions = new Dictionary<string, string>();
		var changed = new List<object>();
		var root = _connection.GetPlcProjectRoot();
		WalkAndCollect(root, knownItems, currentVersions, changed);

		var removed = new List<string>();
		foreach (var name in knownItems.Keys)
		{
			if (!currentVersions.ContainsKey(name))
				removed.Add(name);
		}

		return new Dictionary<string, object?>
		{
			["projectVersion"] = BeckhoffConnection.ComputeProjectVersion(currentVersions),
			["structureVersion"] = BeckhoffConnection.ComputeStructureVersion(currentVersions),
			["changed"] = changed,
			["removed"] = removed,
			["items"] = currentVersions,
		};
	}

	private void WalkAndCollect(
		dynamic node,
		Dictionary<string, string> knownItems,
		Dictionary<string, string> currentVersions,
		List<object> changed)
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
				WalkAndCollect(child, knownItems, currentVersions, changed);
				continue;
			}

			if (!BlockTypeMapper.IsTopLevelCrud(itemType))
			{
				continue;
			}

			string version;
			try { version = BeckhoffConnection.ComputeItemVersion(child); }
			catch { continue; }

			currentVersions[name] = version;

			// Emit full content only when client's known version doesn't match.
			if (!knownItems.TryGetValue(name, out var clientVersion) || clientVersion != version)
			{
				try
				{
					var result = GetHandler.BuildResult(_connection, name, child);
					// Annotate with the current version so the client can cache it.
					result["version"] = version;
					changed.Add(result);
				}
				catch
				{
					// Skip bad items — they'll show up in `removed` next round.
				}
			}
		}
	}

	private static Dictionary<string, string> ParseKnownItems(JsonObject body)
	{
		var result = new Dictionary<string, string>();
		if (body.TryGetPropertyValue("knownItems", out var knownNode) && knownNode is JsonObject obj)
		{
			foreach (var kvp in obj)
			{
				if (kvp.Value is JsonValue v && v.TryGetValue<string>(out var s))
					result[kvp.Key] = s;
			}
		}
		return result;
	}
}
