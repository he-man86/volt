using System.Collections.Generic;

namespace VoltBridge.Core;

public static class SourceAssembler
{
    public static Dictionary<string, object?> BuildSource(IAdapter adapter, string name, dynamic item)
    {
        var declaration = adapter.ReadDeclaration(item);
        var header = CodeHelper.ParseCodeHeader(declaration);

        var result = header.Type switch
        {
            "function_block" or "function" or "program" => BuildPou(adapter, name, item, declaration),
            "interface" => BuildInterface(adapter, name, item, declaration),
            // gvl, DUTs (structure/enumeration/union/alias) and anything else are declaration-only.
            _ => BuildDeclOnly(declaration),
        };

        result["name"] = name;
        result["kind"] = header.Type;
        return result;
    }

    private static Dictionary<string, object?> BuildPou(IAdapter adapter, string name, dynamic item, string declaration)
    {
        var children = CollectChildren(adapter, item);
        var result = new Dictionary<string, object?> { ["declaration"] = declaration.Trim() };

        // The POU's OWN body may be graphical (a root FBD/LD/CFC/SFC function/FB). The body's
        // LANGUAGE travels as a field (→ the CLI's .fbd/.ld/.cfc/.sfc extension), so a root body
        // carries NO (* @volt-graphical *) marker — that marker is only for graphical CHILDREN
        // embedded in a file whose root language differs. Editable FBD/LD bodies are the VG text
        // (starts with %LANG); CFC/SFC come back empty (read-only view, extension says the rest).
        var graphicalBody = adapter.ReadGraphicalBody(item);
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

            var decl = adapter.ReadDeclaration(child);
            var impl = adapter.ReadImplementation(child);

            if (isMethod || isAction)
            {
                // Graphical (FBD/LD/SFC/CFC) children are rendered to READ-ONLY ST and
                // tagged with a marker the LSP and PushHandler recognise — instead of
                // being dropped. Textual (ST) children carry their source as-is.
                var graphicalBody = adapter.ReadGraphicalBody(child);
                string? implementation;
                if (graphicalBody is not null)
                {
                    implementation = GraphicalImpl(graphicalBody);
                }
                else
                {
                    var trimmed = impl?.Trim();
                    var graphicalLang = GraphicalLangOrNull(trimmed);
                    // Never emit a graphical serialization as if it were ST (no-fallback guard).
                    implementation = graphicalLang is not null
                        ? GraphicalImpl(new GraphicalBody(graphicalLang, "", "st"))
                        : string.IsNullOrEmpty(trimmed) ? null : trimmed;
                }

                var entry = new Dictionary<string, object?>
                {
                    ["name"] = childName,
                    ["kind"] = isMethod ? "method" : "action",
                    ["declaration"] = isAction ? $"ACTION {childName}" : decl.Trim(),
                };
                if (implementation is not null) entry["implementation"] = implementation;
                if (!string.IsNullOrEmpty(folderPath)) entry["folder"] = folderPath;
                textual.Add(entry);
            }
            else if (isProperty)
            {
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

    /// <summary>A graphical child's implementation text: the VG body, whose first line is its
    /// `%LANG &lt;lang&gt;` header (see <see cref="VgBody"/>). Editable FBD/LD bodies already carry the
    /// header; a read-only CFC/SFC view has no body, so emit a bare `%LANG &lt;lang&gt;`.</summary>
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
