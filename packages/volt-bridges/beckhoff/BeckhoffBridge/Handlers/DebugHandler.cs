using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;

namespace BeckhoffBridge.Handlers;

/// <summary>
/// POST /debug — Dump everything we can learn about a TwinCAT tree item.
///
/// Diagnostic-only. Use to figure out which COM property to consult when
/// the bridge needs to distinguish item kinds it can't currently tell
/// apart (the empty-folder-vs-empty-action case being the immediate
/// motivation).
///
/// Probes a fixed list of candidate property names — anything ITcSmTreeItem
/// or a subclass might expose. For each: tries to read it, reports the
/// value or the COM exception. Also dumps ProduceXml() (truncated) since
/// the root element name often discriminates kinds even when no single
/// property does.
///
/// Request:  { "name": "<item name>" }
/// Response: {
///   "name": "...",
///   "clrType": "System.__ComObject",
///   "properties": { "ItemSubType": {ok, value}, "Disabled": {ok, error}, ... },
///   "produceXml": "<...>" or {ok:false, error}
/// }
/// </summary>
internal sealed class DebugHandler
{
	private readonly BeckhoffConnection _connection;

	public DebugHandler(BeckhoffConnection connection)
	{
		_connection = connection;
	}

	// Candidate COM members to probe on every item. Add to this list as we
	// discover new properties worth checking. ITcSmTreeItem + common TwinCAT
	// subclasses. Mix of "definitely exists" (Name, ChildCount) and
	// "might exist on some items" (IsFolder, Kind, Category).
	private static readonly string[] CandidateProperties = new[]
	{
		// Always-present (sanity check)
		"Name", "ChildCount",
		// Documented ITcSmTreeItem
		"ItemSubType", "PathName", "Disabled", "ConsistencyState",
		// Speculative — names worth probing for the folder/action question
		"ItemType", "Kind", "Category", "IsFolder",
		"Visible", "Modified", "IsModified",
		// Code-item specific
		"DeclarationText", "ImplementationText",
		"ProgrammingLanguage", "IsCompiled",
	};

	public object Handle(JsonObject body)
	{
		if (!_connection.IsConnected) throw BridgeException.NotConnected();

		var name = body["name"]?.GetValue<string>();
		var path = body["path"]?.GetValue<string>();
		if (string.IsNullOrEmpty(name) && string.IsNullOrEmpty(path))
			throw BridgeException.BadRequest("Provide either 'name' (PLC-tree search) or 'path' (LookupTreeItem, e.g. 'TIID^Device 1^Box 1')");

		// `path` wins when both are given — it's the more specific selector
		// (LookupTreeItem-addressable items live anywhere in the TwinCAT
		// system tree, not just the PLC subtree FindItemOrThrow walks).
		dynamic item;
		if (!string.IsNullOrEmpty(path))
		{
			try { item = _connection.LookupTreeItem(path); }
			catch (Exception ex) { throw BridgeException.NotFound("tree item", $"{path} ({ex.Message})"); }
		}
		else
		{
			item = _connection.FindItemOrThrow(name!, "item");
		}

		var result = new Dictionary<string, object?>
		{
			["name"] = name ?? TryReadName(item),
			["path"] = path,
		};

		// CLR type (always System.__ComObject for COM proxies, but useful sanity)
		try { result["clrType"] = ((object)item).GetType().FullName; }
		catch (Exception ex) { result["clrType"] = $"<error: {ex.Message}>"; }

		// Probe each candidate property — record ok+value or ok=false+error.
		var properties = new Dictionary<string, object?>();
		foreach (var prop in CandidateProperties)
		{
			try
			{
				object? value = ReadMember(item, prop);
				properties[prop] = new { ok = true, value = SafeValue(value) };
			}
			catch (Exception ex)
			{
				properties[prop] = new { ok = false, error = ex.Message };
			}
		}
		result["properties"] = properties;

		// ProduceXml() — the root element name often discriminates kinds.
		try
		{
			string xml = (string)item.ProduceXml();
			result["produceXml"] = xml.Length > 8000
				? xml.Substring(0, 8000) + "...[truncated]"
				: xml;
		}
		catch (Exception ex)
		{
			result["produceXml"] = new { ok = false, error = ex.Message };
		}

		return result;
	}

	// COM dynamic dispatch — accessing a missing member throws. The big
	// switch is the price of typed access; without it we'd be reading
	// everything as object which loses type-fidelity in the JSON output.
	private static object? ReadMember(dynamic item, string name)
	{
		return name switch
		{
			"Name" => (string?)item.Name,
			"ItemSubType" => (int?)item.ItemSubType,
			"ItemType" => (object?)item.ItemType,
			"DeclarationText" => (string?)item.DeclarationText,
			"ImplementationText" => (string?)item.ImplementationText,
			"ChildCount" => (int?)item.ChildCount,
			"PathName" => (string?)item.PathName,
			"ConsistencyState" => (object?)item.ConsistencyState,
			"Disabled" => (object?)item.Disabled,
			"Visible" => (object?)item.Visible,
			"Modified" => (object?)item.Modified,
			"IsModified" => (object?)item.IsModified,
			"Category" => (object?)item.Category,
			"Kind" => (object?)item.Kind,
			"IsFolder" => (object?)item.IsFolder,
			"ProgrammingLanguage" => (object?)item.ProgrammingLanguage,
			"IsCompiled" => (object?)item.IsCompiled,
			_ => throw new ArgumentException($"Unknown candidate: {name}"),
		};
	}

	// Normalize tricky values for JSON serialization. String properties
	// pass through unchanged — debug is the one endpoint we want to be
	// honest about size, since callers (humans + the schema-discovery
	// scripts that map undocumented formats like NWL/CFC/STBody) need
	// the full body to do their work.
	private static object? SafeValue(object? value)
	{
		return value;
	}

	private static string TryReadName(dynamic item)
	{
		try { return (string)item.Name; } catch { return "<unknown>"; }
	}
}
