using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;

namespace Volt.Bridge.Core.Workspace.SourceText;

/// <summary>
/// Render a fetched item back to its assembled `.st` / `.gvl` / `.dut`
/// / `.itf` source text — the inverse of <see cref="StSplitter"/>.
///
/// Used by FetchHandler to ship `sourceText` on the wire so the agent
/// can drop the file directly into the workspace without any
/// per-child reassembly on its side.
///
/// Format (canonical workspace .st layout — inverse of StSplitter):
///
///   {pou.declaration}
///
///   {pou.implementation}
///
///   END_X
///
///   {child blocks, sorted: methods, then actions, then properties,
///    alphabetical within each kind}
///
/// Children:
///   METHOD/ACTION → {declaration}\n{impl}\nEND_X (impl omitted if empty)
///   PROPERTY     → {declaration}\nGET … END_GET\nSET … END_SET\nEND_PROPERTY
/// </summary>
public static class StAssembler
{
	/// <summary>
	/// Assemble a GetHandler.BuildResult-shaped dictionary into the
	/// canonical workspace .st text. Returns null if the input shape
	/// is incompatible (e.g. a graphical POU whose body was masked).
	/// </summary>
	public static string Assemble(IDictionary<string, object?> result)
	{
		var kind = (result.TryGetValue("kind", out var k) ? k as string : null) ?? "";
		var declaration = (result.TryGetValue("declaration", out var d) ? d as string : null) ?? "";
		var implementation = (result.TryGetValue("implementation", out var i) ? i as string : null) ?? "";
		var childrenRaw = result.TryGetValue("children", out var c) ? c : null;

		// Simple single-block kinds: just hand back the declaration as-is.
		if (kind is "gvl" or "structure" or "enumeration" or "union" or "alias")
			return declaration.TrimEnd() + "\n";

		// Composite POUs.
		var sb = new StringBuilder();
		sb.Append(declaration.TrimEnd());
		var implTrim = implementation.Trim();
		if (implTrim.Length > 0)
		{
			sb.Append('\n').Append('\n').Append(implTrim);
		}
		sb.Append('\n').Append('\n').Append(EndKeyword(kind));

		var children = NormalizeChildren(childrenRaw);
		var sorted = children
			.OrderBy(ch => KindOrder(ch.Kind))
			.ThenBy(ch => ch.Name, StringComparer.Ordinal)
			.ToList();

		foreach (var child in sorted)
		{
			sb.Append('\n').Append('\n');
			sb.Append(AssembleChild(child));
		}

		sb.Append('\n'); // trailing newline
		return sb.ToString();
	}

	private static string EndKeyword(string kind) => kind switch
	{
		"function_block" => "END_FUNCTION_BLOCK",
		"program"        => "END_PROGRAM",
		"function"       => "END_FUNCTION",
		"interface"      => "END_INTERFACE",
		_ => $"END_{kind.ToUpperInvariant()}",
	};

	private static int KindOrder(string kind) => kind switch
	{
		"method"   => 0,
		"action"   => 1,
		"property" => 2,
		_          => 3,
	};

	private record ChildSnapshot(
		string Kind,
		string Name,
		string Declaration,
		string Implementation,
		string? GetterCode,
		string? SetterCode,
		string? GetterDeclaration,
		string? SetterDeclaration,
		string? Folder);

	private static List<ChildSnapshot> NormalizeChildren(object? raw)
	{
		var list = new List<ChildSnapshot>();
		if (raw is null) return list;

		// raw is either JsonArray (during FetchHandler use) or a List<object>
		// (when called with a deserialized dict). Normalize both.
		IEnumerable<IDictionary<string, object?>>? entries = raw switch
		{
			JsonArray arr => arr.OfType<JsonObject>().Select(o => (IDictionary<string, object?>)JsonObjectToDict(o)),
			IEnumerable<object?> seq => seq.OfType<IDictionary<string, object?>>(),
			_ => null,
		};
		if (entries is null) return list;

		foreach (var e in entries)
		{
			string GetS(string key) => (e.TryGetValue(key, out var v) ? v as string : null) ?? "";
			string? GetSn(string key) => e.TryGetValue(key, out var v) ? v as string : null;
			list.Add(new ChildSnapshot(
				Kind: GetS("kind"),
				Name: GetS("name"),
				Declaration: GetS("declaration"),
				Implementation: GetS("implementation"),
				GetterCode: GetSn("getterCode"),
				SetterCode: GetSn("setterCode"),
				GetterDeclaration: GetSn("getterDeclaration"),
				SetterDeclaration: GetSn("setterDeclaration"),
				Folder: GetSn("folder")));
		}
		return list;
	}

	private static Dictionary<string, object?> JsonObjectToDict(JsonObject obj)
	{
		var dict = new Dictionary<string, object?>();
		foreach (var kvp in obj)
		{
			dict[kvp.Key] = kvp.Value switch
			{
				JsonValue v when v.TryGetValue<string>(out var s) => s,
				JsonArray a => a,
				JsonObject nested => JsonObjectToDict(nested),
				_ => kvp.Value?.ToString(),
			};
		}
		return dict;
	}

	private static string AssembleChild(ChildSnapshot child)
	{
		if (child.Kind == "property") return AssembleProperty(child);
		var decl = child.Declaration.TrimEnd();
		var impl = PrependFolderDirective(child.Folder, (child.Implementation ?? "").Trim());
		var endKw = child.Kind == "method" ? "END_METHOD" : "END_ACTION";
		return impl.Length == 0 ? $"{decl}\n{endKw}" : $"{decl}\n{impl}\n{endKw}";
	}

	private static string AssembleProperty(ChildSnapshot child)
	{
		var parts = new List<string> { child.Declaration.TrimEnd() };
		if (!string.IsNullOrEmpty(child.Folder)) parts.Add($"%FOLDER {child.Folder}");
		if (child.GetterCode is not null || child.GetterDeclaration is not null)
			parts.Add(AssembleAccessor("GET", child.GetterDeclaration, child.GetterCode));
		if (child.SetterCode is not null || child.SetterDeclaration is not null)
			parts.Add(AssembleAccessor("SET", child.SetterDeclaration, child.SetterCode));
		parts.Add("END_PROPERTY");
		return string.Join("\n", parts);
	}

	private static string AssembleAccessor(string keyword, string? decl, string? impl)
	{
		var d = (decl ?? "").Trim();
		var i = (impl ?? "").Trim();
		var lines = new List<string> { keyword };
		if (d.Length > 0) lines.Add(d);
		if (i.Length > 0) lines.Add(i);
		lines.Add($"END_{keyword}");
		return string.Join("\n", lines);
	}

	/// <summary>Prepend a `%FOLDER &lt;path&gt;` directive to a child body — the child's sub-folder
	/// within the POU. The signature line stays a clean identifier; this `%FOLDER` line sits at the top
	/// of the body, ahead of its graphical content (the `NETWORK` marker, or `%LANG` for CFC/SFC).</summary>
	private static string PrependFolderDirective(string? folder, string impl)
	{
		if (string.IsNullOrEmpty(folder)) return impl;
		var dir = $"%FOLDER {folder}";
		return impl.Length == 0 ? dir : $"{dir}\n{impl}";
	}
}
