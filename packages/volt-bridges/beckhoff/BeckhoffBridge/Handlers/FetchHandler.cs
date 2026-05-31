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
		WalkAndCollect(root, "", knownItems, currentVersions, changed);

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
		string folderPath,
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
				// Recurse with the folder appended. Folder names compose with
				// `/` so the on-disk layout matches the IDE's tree exactly
				// (e.g. POUs/Motors/FB_Stepper.st).
				var nested = string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}";
				WalkAndCollect(child, nested, knownItems, currentVersions, changed);
				continue;
			}

			if (BlockTypeMapper.IsInlinedInPou(itemType))
			{
				// Methods/actions/properties — ride inline via parent POU.
				continue;
			}

			// Hybrid items (non-CRUD with children — RecipeManager + Recipes,
			// References + library refs, etc.): nest the PARENT's file inside
			// its own folder so VS Code shows ONE node per concept. So
			// instead of `Drives/RecipeManager.xml` + `Drives/RecipeManager/
			// Recipes.xml` side-by-side, we get `Drives/RecipeManager/
			// RecipeManager.xml` + `Drives/RecipeManager/Recipes.xml`
			// (component-folder convention, single tree entry per node).
			int childCount = 0;
			try { childCount = (int)child.ChildCount; } catch { }
			bool isHybrid = childCount > 0 && !BlockTypeMapper.IsTopLevelCrud(itemType);
			string emitFolder = isHybrid
				? (string.IsNullOrEmpty(folderPath) ? name : $"{folderPath}/{name}")
				: folderPath;

			if (BlockTypeMapper.IsTopLevelCrud(itemType))
			{
				EmitSourceItem(child, name, folderPath, knownItems, currentVersions, changed);
			}
			else
			{
				string configKind = BlockTypeMapper.ToConfigKind(itemType);
				EmitConfigItem(child, name, configKind, emitFolder, knownItems, currentVersions, changed);
			}

			// Recurse into hybrid items with the SAME nested folder path
			// (matches the parent's emitFolder above, so children land
			// alongside their parent's file inside the shared folder).
			if (isHybrid)
			{
				WalkAndCollect(child, emitFolder, knownItems, currentVersions, changed);
			}
		}
	}

	/// <summary>
	/// Emit a top-level CRUD item (POU / GVL / DUT / Interface) — the
	/// previous default path. SourceText is the StAssembler-produced
	/// `.st`/`.gvl`/`.dut`/`.itf` content; graphical POUs additionally
	/// carry `implementationXml` (PLCopenXML body block).
	/// </summary>
	private void EmitSourceItem(
		dynamic child,
		string name,
		string folderPath,
		Dictionary<string, string> knownItems,
		Dictionary<string, string> currentVersions,
		List<object> changed)
	{
		string version;
		try { version = BeckhoffConnection.ComputeItemVersion(child); }
		catch { return; }

		currentVersions[name] = version;
		if (knownItems.TryGetValue(name, out var clientVersion) && clientVersion == version)
			return;

		try
		{
			var result = GetHandler.BuildResult(_connection, name, child);
			var sourceText = StAssembler.Assemble(result);
			var slim = new Dictionary<string, object?>
			{
				["name"] = name,
				["version"] = version,
				["sourceText"] = sourceText,
			};
			if (result.TryGetValue("kind", out object? kindVal)) slim["kind"] = kindVal;
			// Prefer the walk-tracked folder (consistent across source +
			// config items). Fall back to whatever BuildResult inferred
			// only when our walk didn't pick anything up.
			if (!string.IsNullOrEmpty(folderPath))
				slim["folder"] = folderPath;
			else if (result.TryGetValue("folder", out object? folderVal))
				slim["folder"] = folderVal;
			if (result.TryGetValue("language", out object? langVal)) slim["language"] = langVal;
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

	/// <summary>
	/// Emit a non-CRUD item (Task / VisualizationManager / Visualization /
	/// LibraryManager / library ref / RecipeManager / ImagePool /
	/// GlobalTextList / ClassDiagram / TmcFile / etc.) as opaque config.
	/// SourceText is the universal `ITcSmTreeItem.ProduceXml()` output;
	/// constant version "config" matches the policy in RefsHandler.
	/// </summary>
	private void EmitConfigItem(
		dynamic child,
		string name,
		string configKind,
		string folderPath,
		Dictionary<string, string> knownItems,
		Dictionary<string, string> currentVersions,
		List<object> changed)
	{
		string version = configKind;
		currentVersions[name] = version;
		if (knownItems.TryGetValue(name, out var clientVersion) && clientVersion == version)
			return;

		try
		{
			string xml = _connection.ProduceItemXml(child, name);
			var slim = new Dictionary<string, object?>
			{
				["name"] = name,
				["kind"] = configKind,
				["version"] = version,
				["sourceText"] = xml,
			};
			if (!string.IsNullOrEmpty(folderPath))
				slim["folder"] = folderPath;
			changed.Add(slim);
		}
		catch
		{
			// best-effort — bad item shouldn't poison the walk.
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
