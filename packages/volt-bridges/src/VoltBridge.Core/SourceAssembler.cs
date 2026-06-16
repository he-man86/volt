using System.Collections.Generic;

namespace VoltBridge.Core;

/// <summary>An item's materialized workspace content: the exact text the CLI writes to the file, plus
/// the body language (drives the file extension) for source kinds.</summary>
public sealed record MaterializedItem(string Text, string? Language);

public static class SourceAssembler
{
    /// <summary>The single source of truth for an item's workspace file content — used for BOTH the
    /// content version (hashed) and the fetched source, so they can never diverge. Source kinds
    /// assemble declaration + implementation (+ children); non-source kinds (libraries, tasks, …) use
    /// their manifest text.</summary>
    public static MaterializedItem Materialize(IAdapter adapter, string name, string kind, object item)
    {
        if (IsSourceKind(kind))
        {
            var build = BuildSource(adapter, name, item, kind);
            var text = StAssembler.Assemble(build);
            var lang = build.TryGetValue("language", out var l) ? l as string : null;
            return new MaterializedItem(text, lang);
        }
        return new MaterializedItem(adapter.ReadManifestText(item, kind), null);
    }

    /// <summary>Materialize an item and hash it into its content version, in one resilient step — the
    /// shared basis for <c>/refs</c>, <c>/fetch</c>, and the push receipt (so all three agree). A
    /// failed read yields empty text (version = hash of folder only) rather than crashing the walk.</summary>
    public static (string Version, MaterializedItem Mat) VersionedMaterialize(
        IAdapter adapter, string name, string kind, object item, string folder)
    {
        MaterializedItem mat;
        try { mat = Materialize(adapter, name, kind, item); }
        catch { mat = new MaterializedItem("", null); }
        return (Hasher.ComputeItemVersion(folder, mat.Text), mat);
    }

    /// <summary>Kinds whose content is assembled source text (vs a manifest).</summary>
    public static bool IsSourceKind(string kind) => kind switch
    {
        "function_block" or "function" or "program" or "interface" or "gvl" or
        "structure" or "enumeration" or "union" or "alias" => true,
        _ => false,
    };

    public static Dictionary<string, object?> BuildSource(IAdapter adapter, string name, dynamic item, string kind)
    {
        Dictionary<string, object?> result;
        string resultKind;
        // POUs: read the graphical body FIRST. If it's graphical, its declaration comes from the SAME
        // PLCopen export (gb.Declaration) — so we never touch the object-model Interface aspect, which on
        // a just-reimported graphical POU (right after a push) damages the body we just read. Textual POUs
        // and all non-POUs use the (faster) aspect read; only graphical POUs go through the export.
        if (kind is "program" or "function_block" or "function")
        {
            var graphicalBody = adapter.ReadGraphicalBody(item);
            var declaration = graphicalBody?.Declaration ?? adapter.ReadDeclaration(item);
            result = BuildPou(adapter, name, item, declaration, graphicalBody);
            resultKind = CodeHelper.ParseCodeHeader(declaration).Type;
        }
        else
        {
            var declaration = adapter.ReadDeclaration(item);
            var header = CodeHelper.ParseCodeHeader(declaration);
            result = header.Type == "interface"
                ? BuildInterface(adapter, name, item, declaration)
                : BuildDeclOnly(declaration);   // gvl, DUTs (structure/enumeration/union/alias), …
            resultKind = header.Type;
        }

        result["name"] = name;
        result["kind"] = resultKind;
        return result;
    }

    private static Dictionary<string, object?> BuildPou(
        IAdapter adapter, string name, dynamic item, string declaration, GraphicalBody? graphicalBody)
    {
        var children = CollectChildren(adapter, item);
        var result = new Dictionary<string, object?> { ["declaration"] = declaration.Trim() };

        // The POU's OWN body may be graphical (a root FBD/LD/CFC/SFC function/FB). The body's LANGUAGE
        // travels as a field (→ the CLI's .fbd/.ld/.cfc/.sfc extension). The body was already read by the
        // caller (graphical-first, so its declaration came from the same export without touching the
        // poisoning aspect); editable FBD/LD bodies lead with the NETWORK marker, CFC/SFC come back empty.
        if (graphicalBody is not null)
        {
            if (!string.IsNullOrEmpty(graphicalBody.Body)) result["implementation"] = graphicalBody.Body;
            result["language"] = graphicalBody.Language;
        }
        else
        {
            var implementation = adapter.ReadImplementation(item)?.Trim() ?? "";
            var graphicalLang = GraphicalLangOrNull(implementation);
            if (graphicalLang is not null)
            {
                // A graphical body we couldn't transpile (e.g. body file unreadable) — emit a
                // read-only marker, NEVER the raw XML serialization as if it were ST.
                result["implementation"] = GraphicalImpl(new GraphicalBody(graphicalLang, "", "st"));
                result["language"] = graphicalLang;
            }
            else
            {
                result["language"] = "ST";
                if (!string.IsNullOrEmpty(implementation)) result["implementation"] = implementation;
            }
        }

        if (children.Count > 0)
            result["children"] = children;

        return result;
    }

    private static Dictionary<string, object?> BuildInterface(IAdapter adapter, string name, dynamic item, string declaration)
    {
        var children = CollectChildren(adapter, item, parentIsInterface: true);
        var result = new Dictionary<string, object?> { ["declaration"] = declaration.Trim() };
        if (children.Count > 0) result["children"] = children;
        return result;
    }

    /// <summary>GVL, DUTs and other leaf kinds carry only a declaration (no body, no children).</summary>
    private static Dictionary<string, object?> BuildDeclOnly(string declaration) =>
        new() { ["declaration"] = declaration.TrimEnd() };

    private static List<Dictionary<string, object?>>
        CollectChildren(IAdapter adapter, dynamic parent, bool parentIsInterface = false, string folderPath = "")
    {
        var textual = new List<Dictionary<string, object?>>();

        int count;
        try { count = adapter.GetChildCount(parent); }
        catch { return textual; }

        for (int i = 1; i <= count; i++)
        {
            dynamic child;
            try { child = adapter.GetChildAt(parent, i); } catch { continue; }

            string childName;
            try { childName = adapter.GetItemName(child); } catch { continue; }

            int itemType = adapter.GetItemType(child);

            // Folder within POU — recurse
            if (itemType == ItemKind.Folder)
            {
                var subPath = string.IsNullOrEmpty(folderPath) ? childName : $"{folderPath}/{childName}";
                textual.AddRange(CollectChildren(adapter, child, parentIsInterface, subPath));
                continue;
            }

            // Only methods, actions, properties ride as children.
            // NOTE: transitions are folded in with actions (emitted as kind "action").
            bool isMethod = itemType is ItemKind.Method or ItemKind.InterfaceMethod;
            bool isAction = itemType is ItemKind.Action or ItemKind.Transition;
            bool isProperty = itemType is ItemKind.Property or ItemKind.InterfaceProperty;
            if (!isMethod && !isAction && !isProperty) continue;

            if (isMethod || isAction)
            {
                // Graphical (FBD/LD/SFC/CFC) children are rendered to READ-ONLY ST and tagged with a
                // marker the LSP and PushHandler recognise — instead of being dropped; textual (ST)
                // children carry their source as-is. Read the graphical body FIRST: its declaration
                // comes from the same export, so we don't touch the object-model aspect before exporting
                // — doing so poisons a just-reimported graphical child's in-session body.
                var graphicalBody = adapter.ReadGraphicalBody(child);
                string? implementation;
                if (graphicalBody is not null)
                {
                    implementation = GraphicalImpl(graphicalBody);
                }
                else
                {
                    var trimmed = adapter.ReadImplementation(child)?.Trim();
                    var graphicalLang = GraphicalLangOrNull(trimmed);
                    // Never emit a graphical serialization as if it were ST (no-fallback guard).
                    implementation = graphicalLang is not null
                        ? GraphicalImpl(new GraphicalBody(graphicalLang, "", "st"))
                        : string.IsNullOrEmpty(trimmed) ? null : trimmed;
                }

                // Actions synthesize their signature; a method needs its real declaration (from the
                // graphical export when graphical, else the aspect).
                var declText = isAction
                    ? $"ACTION {childName}"
                    : (graphicalBody?.Declaration ?? adapter.ReadDeclaration(child)).Trim();

                var entry = new Dictionary<string, object?>
                {
                    ["name"] = childName,
                    ["kind"] = isMethod ? "method" : "action",
                    ["declaration"] = declText,
                };
                if (implementation is not null) entry["implementation"] = implementation;
                if (!string.IsNullOrEmpty(folderPath)) entry["folder"] = folderPath;
                textual.Add(entry);
            }
            else if (isProperty)
            {
                var decl = adapter.ReadDeclaration(child);   // properties have no graphical body
                var entry = new Dictionary<string, object?>
                {
                    ["name"] = childName, ["kind"] = "property",
                    ["declaration"] = decl.Trim(),
                };

                // Walk accessor children (Get/Set)
                try
                {
                    int accCount = adapter.GetChildCount(child);
                    for (int j = 1; j <= accCount; j++)
                    {
                        dynamic accessor;
                        try { accessor = adapter.GetChildAt(child, j); } catch { continue; }
                        string accName;
                        try { accName = adapter.GetItemName(accessor).ToLowerInvariant(); } catch { continue; }
                        if (accName is "get" or "set")
                        {
                            var accImpl = adapter.ReadImplementation(accessor)?.Trim() ?? "";
                            entry[accName == "get" ? "getterCode" : "setterCode"] = accImpl;
                            try
                            {
                                var accDecl = adapter.ReadDeclaration(accessor)?.Trim() ?? "";
                                if (!string.IsNullOrEmpty(accDecl) && !IsEmptyVarBlock(accDecl))
                                    entry[accName == "get" ? "getterDeclaration" : "setterDeclaration"] = accDecl;
                            }
                            catch { }
                        }
                    }
                }
                catch { }

                if (!string.IsNullOrEmpty(folderPath)) entry["folder"] = folderPath;
                textual.Add(entry);
            }
        }

        return textual;
    }

    /// <summary>A graphical child's implementation text (see <see cref="VgBody"/>). Editable FBD/LD
    /// bodies are the VG text, which leads with its `NETWORK &lt;n&gt; &lt;LANG&gt;` marker; a read-only
    /// CFC/SFC view has no body, so emit a bare `%LANG &lt;lang&gt;` placeholder.</summary>
    private static string GraphicalImpl(GraphicalBody gb) =>
        string.IsNullOrEmpty(gb.Body) ? $"%LANG {gb.Language}" : gb.Body;

    /// <summary>If <paramref name="impl"/> is a graphical body serialization (a TwinCAT
    /// <c>&lt;NWL&gt;</c>/<c>&lt;CFC&gt;</c>/… archive) rather than ST text, the graphical language
    /// it represents; otherwise null. Used to refuse dumping raw graphical XML as if it were ST.</summary>
    internal static string? GraphicalLangOrNull(string? impl)
    {
        if (string.IsNullOrEmpty(impl)) return null;
        var t = impl!.TrimStart();
        if (t.StartsWith("<NWL", System.StringComparison.Ordinal)) return "FBD";   // NWL = FBD/LD
        if (t.StartsWith("<FBD", System.StringComparison.Ordinal)) return "FBD";
        if (t.StartsWith("<LD", System.StringComparison.Ordinal)) return "LD";
        if (t.StartsWith("<CFC", System.StringComparison.Ordinal)) return "CFC";
        if (t.StartsWith("<SFC", System.StringComparison.Ordinal)) return "SFC";
        return null;
    }

    private static bool IsEmptyVarBlock(string decl)
    {
        var trimmed = decl.Trim();
        var lines = trimmed.Split('\n');
        return lines.Length <= 2 && trimmed.StartsWith("VAR") && trimmed.EndsWith("END_VAR");
    }
}
