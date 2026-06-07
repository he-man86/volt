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

		// Flush before reading — same rationale as RefsHandler. The
		// fetched items' versions must agree with what /refs reported
		// to the client and what the next /push pre-flight will see.
		// All three handlers compute hashes from POST-flush state so
		// the client never observes a phantom drift between calls.
		_connection.FlushPendingWrites();

		var knownItems = ParseKnownItems(body);
		var onlyItems = ParseOnlyItems(body);  // null = no filter, fetch all

		var currentVersions = new Dictionary<string, string>();
		var changed = new List<object>();

		// Single shared walker — same item set as RefsHandler / PushHandler.
		// projectVersion derived from `currentVersions` is therefore
		// guaranteed to agree across all three handlers; refs ↔ fetch ↔
		// push drift is structurally impossible.
		_connection.WalkProjectTree((visit) =>
		{
			// Allowlist short-circuit — skip COM work entirely for items
			// outside the requested set. Used by the agent's
			// `peekBridgeItem` so a SCM-tree preview click materializes
			// one item instead of every item in the project (saves ~5s
			// on a 243-item TwinCAT solution).
			if (onlyItems is not null && !onlyItems.Contains(visit.Name)) return;

			if (visit.IsTopLevelCrud)
			{
				EmitSourceItem(visit.Item, visit.Name, visit.FolderPath, knownItems, currentVersions, changed);
			}
			else
			{
				string? configKind = BlockTypeMapper.ToConfigKind(visit.ItemType);
				if (configKind is null)
				{
					Log.Warn($"[fetch] skipping {visit.Name}: ItemType {visit.ItemType} unmapped in BlockTypeMapper.ToConfigKind");
					return;
				}
				EmitConfigItem(visit.Item, visit.Name, configKind, visit.FolderPath, knownItems, currentVersions, changed);
			}
		});

		// I/O devices live in a parallel COM subtree (TIID, not the PLC
		// NestedProject). Walked separately and emitted with the fixed
		// kind "device" — DeviceExtractor enumerates child boxes inline.
		_connection.WalkIoDevices((visit) =>
		{
			if (onlyItems is not null && !onlyItems.Contains(visit.Name)) return;
			EmitConfigItem(visit.Item, visit.Name, "device", visit.FolderPath, knownItems, currentVersions, changed);
		});

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
		try { version = BeckhoffConnection.ComputeItemVersion(child, folderPath ?? ""); }
		catch (Exception ex)
		{
			// One bad CRUD item shouldn't poison the whole fetch — the
			// agent will see it as `removed` next round, which is the
			// correct user-visible signal. But LOG so the bridge.log
			// captures which item + why, instead of the previous silent
			// swallow that left no trail.
			Log.Warn($"[fetch] ComputeItemVersion({name}) threw — item will be reported as removed: {ex.GetType().Name}: {ex.Message}");
			return;
		}

		currentVersions[name] = version;
		if (knownItems.TryGetValue(name, out var clientVersion) && clientVersion == version)
			return;

		Dictionary<string, object?> result;
		string sourceText;
		try
		{
			result = GetHandler.BuildResult(_connection, name, child);
			sourceText = StAssembler.Assemble(result);
		}
		catch (Exception ex)
		{
			// BuildResult / StAssembler failed — log loudly and skip.
			// Same rationale as above: the agent will treat the item as
			// removed; we just need to leave a forensic trail.
			Log.Warn($"[fetch] BuildResult/Assemble({name}) threw — emitting as removed: {ex.GetType().Name}: {ex.Message}");
			currentVersions.Remove(name);
			return;
		}

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
		object? langVal = null;
		if (result.TryGetValue("language", out var langOut))
		{
			langVal = langOut;
			slim["language"] = langVal;
		}
		if (langVal is string langStr && IsGraphicalLanguage(langStr))
		{
			string? bodyXml = _connection.ExportItemBodyAsXml(child, name);
			if (!string.IsNullOrEmpty(bodyXml))
			{
				slim["implementationXml"] = bodyXml;
			}
		}
		// Non-textual children (FBD/LD/SFC/CFC actions or methods nested
		// in an otherwise-ST parent) ride on the wire as a separate
		// list. The agent materializes each as a read-only sibling
		// file `<parent>/<child>.<lang_ext>`. Parity with the CODESYS
		// bridge — see `feedback_bridges_must_stay_at_parity`.
		if (result.TryGetValue("graphicalChildren", out object? gcVal) && gcVal is not null)
		{
			slim["graphicalChildren"] = gcVal;
		}
		changed.Add(slim);
	}

	/// <summary>
	/// Emit a non-CRUD item (Task / VisualizationManager / Visualization /
	/// LibraryManager / library ref / RecipeManager / ImagePool /
	/// GlobalTextList / ClassDiagram / TmcFile / Device / etc.) via the
	/// typed extractor registered for its kind. SourceText is the
	/// deterministic text manifest the extractor produces; version is
	/// SHA1 of that manifest — content-aware, fixing the prior bug
	/// where every task version was the constant string "task".
	///
	/// Items whose kind has no registered extractor are SKIPPED with a
	/// warning (no opaque-XML fallback — see
	/// <see cref="BeckhoffConnection.BuildConfigManifest"/> for the
	/// rationale).
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
		// BuildConfigManifest takes a `dynamic child` arg so the call is
		// late-bound — C# returns `dynamic`, not the declared nullable tuple.
		// At runtime Nullable<ValueTuple> auto-unboxes, so .Value would fail.
		// Access named members directly on the dynamic to bypass that.
		var manifest = _connection.BuildConfigManifest(child, configKind, name, folderPath ?? "");
		if (manifest is null) return;  // no extractor registered → skip with log

		string version = (string)manifest.Version;
		currentVersions[name] = version;
		if (knownItems.TryGetValue(name, out var clientVersion) && clientVersion == version)
			return;

		var slim = new Dictionary<string, object?>
		{
			["name"] = name,
			["kind"] = configKind,
			["version"] = version,
			["sourceText"] = (string)manifest.SourceText,
		};
		if (!string.IsNullOrEmpty(folderPath))
			slim["folder"] = folderPath;
		changed.Add(slim);
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

	/// <summary>
	/// Parse the optional `onlyItems` allowlist. Returns null when absent
	/// or empty (= no filter, fetch everything). Used by the agent's
	/// `peekBridgeItem` to confine SCM-tree preview clicks to one item.
	/// </summary>
	private static HashSet<string>? ParseOnlyItems(JsonObject body)
	{
		if (!body.TryGetPropertyValue("onlyItems", out var node) || node is not JsonArray arr) return null;
		var result = new HashSet<string>();
		foreach (var entry in arr)
		{
			if (entry is JsonValue v && v.TryGetValue<string>(out var s)) result.Add(s);
		}
		return result.Count == 0 ? null : result;
	}
}
