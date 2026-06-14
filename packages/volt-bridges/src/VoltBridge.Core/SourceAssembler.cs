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
            "gvl" => BuildGvl(name, declaration),
            "structure" or "enumeration" or "union" or "alias" => BuildDut(name, declaration, header.Type),
            "interface" => BuildInterface(adapter, name, item, declaration),
            _ => BuildSimple(name, header.Type, declaration),
        };

        result["name"] = name;
        result["kind"] = header.Type;
        return result;
    }

    private static Dictionary<string, object?> BuildPou(IAdapter adapter, string name, dynamic item, string declaration)
    {
        var children = CollectChildren(adapter, item);
        var result = new Dictionary<string, object?> { ["declaration"] = declaration.Trim() };

        // The POU's OWN body may be graphical (a root FBD/LD/CFC/SFC function/FB) — render it
        // read-only with the (* @volt-graphical: LANG *) marker, exactly like graphical children.
        var graphicalBody = adapter.ReadGraphicalBody(item);
        if (graphicalBody is not null)
        {
            var marker = $"(* @volt-graphical: {graphicalBody.Language} *)";
            result["implementation"] = string.IsNullOrEmpty(graphicalBody.St) ? marker : marker + "\n" + graphicalBody.St;
            result["language"] = graphicalBody.Language;
        }
        else
        {
            var implementation = adapter.ReadImplementation(item)?.Trim() ?? "";
            result["language"] = "ST";
            if (!string.IsNullOrEmpty(implementation)) result["implementation"] = implementation;
        }

        if (children.Count > 0)
            result["children"] = children;

        return result;
    }

    private static Dictionary<string, object?> BuildGvl(string name, string declaration)
    {
        return new Dictionary<string, object?> { ["declaration"] = declaration.TrimEnd() };
    }

    private static Dictionary<string, object?> BuildDut(string name, string declaration, string kind)
    {
        return new Dictionary<string, object?> { ["declaration"] = declaration.TrimEnd() };
    }

    private static Dictionary<string, object?> BuildInterface(IAdapter adapter, string name, dynamic item, string declaration)
    {
        var children = CollectChildren(adapter, item, parentIsInterface: true);
        var result = new Dictionary<string, object?> { ["declaration"] = declaration.Trim() };
        if (children.Count > 0) result["children"] = children;
        return result;
    }

    private static Dictionary<string, object?> BuildSimple(string name, string kind, string declaration)
    {
        return new Dictionary<string, object?> { ["declaration"] = declaration.TrimEnd() };
    }

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
            if (itemType == 601)
            {
                var subPath = string.IsNullOrEmpty(folderPath) ? childName : $"{folderPath}/{childName}";
                textual.AddRange(CollectChildren(adapter, child, parentIsInterface, subPath));
                continue;
            }

            // Only methods, actions, properties ride as children
            bool isMethod = itemType == 609 || itemType == 610;
            bool isAction = itemType == 608 || itemType == 616;
            bool isProperty = itemType == 611 || itemType == 612;
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
                    var marker = $"(* @volt-graphical: {graphicalBody.Language} *)";
                    implementation = string.IsNullOrEmpty(graphicalBody.St)
                        ? marker : marker + "\n" + graphicalBody.St;
                }
                else
                {
                    implementation = string.IsNullOrEmpty(impl) ? null : impl.Trim();
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

    private static bool IsEmptyVarBlock(string decl)
    {
        var trimmed = decl.Trim();
        var lines = trimmed.Split('\n');
        return lines.Length <= 2 && trimmed.StartsWith("VAR") && trimmed.EndsWith("END_VAR");
    }
}
