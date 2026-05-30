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
/// Response shape (wire v2 — sourceText-on-the-wire):
///   {
///     "projectVersion": "<sha1>",                          // current bridge state
///     "changed": [ FetchedItem, ... ],                     // items new or changed since client's known versions
///     "removed": [ "name1", "name2" ],                     // items the client knows about but no longer exist
///     "items":   { "name": "version" }                      // full ref map (client can adopt wholesale)
///   }
///
/// Each FetchedItem carries:
///   { name, kind, folder?, sourceText, language?, version }
/// where sourceText is the assembled `.st`/`.gvl`/`.dut`/`.itf` file
/// content (POU + children, produced by StAssembler).
///
/// Walk identical to RefsHandler — but for items whose version differs
/// from (or is absent from) the client's known map, we additionally
/// emit the assembled file content via GetHandler.BuildResult + StAssembler.
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
					// Wire-shape v2: assemble per-child fields into a single
					// `sourceText` blob — the agent drops it straight into
					// the workspace file without per-child reassembly.
					var sourceText = StAssembler.Assemble(result);
					var slim = new Dictionary<string, object?>
					{
						["name"] = name,
						["version"] = version,
						["sourceText"] = sourceText,
					};
					if (result.TryGetValue("kind", out object? kindVal)) slim["kind"] = kindVal;
					if (result.TryGetValue("folder", out object? folderVal)) slim["folder"] = folderVal;
					if (result.TryGetValue("language", out object? langVal)) slim["language"] = langVal;
					// Graphical POU bodies (FBD/LD/SFC/CFC): export as
					// PLCopenXML so the agent can write a faithful .fbd
					// file with the body XML preserved verbatim (matches
					// what the CODESYS bridge sends). ST bodies skip
					// this entirely — `sourceText` carries everything
					// for textual languages. Note: we check the language
					// TAG ("FBD"/"LD"/"SFC"/"CFC") directly; don't call
					// LanguageDetector.IsGraphical(string) — that sniffs
					// XML markers in body TEXT, not language tags.
					if (langVal is string langStr && IsGraphicalLanguage(langStr))
					{
						string? bodyXml = _connection.ExportItemBodyAsXml(child, name);
						if (!string.IsNullOrEmpty(bodyXml))
						{
							slim["implementationXml"] = bodyXml;
						}
					}
					changed.Add(slim);
				}
				catch
				{
					// Skip bad items — they'll show up in `removed` next round.
				}
			}
		}
	}

	/// <summary>
	/// True when the language tag indicates a graphical body (FBD / LD /
	/// SFC / CFC). Plain string match — don't confuse with
	/// LanguageDetector.IsGraphical(string), which expects implementation
	/// TEXT and sniffs XML markers inside it.
	/// </summary>
	private static bool IsGraphicalLanguage(string lang) =>
		lang is "FBD" or "LD" or "SFC" or "CFC";

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
