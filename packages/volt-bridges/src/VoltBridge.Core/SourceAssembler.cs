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
        var implementation = adapter.ReadImplementation(item)?.Trim() ?? "";
        var language = DetectLanguage(implementation);

        var children = CollectChildren(adapter, item);
        var textualChildren = children.Item1;
        var graphicalChildren = children.Item2;

        var result = new Dictionary<string, object?>
        {
            ["declaration"] = declaration.Trim(),
            ["language"] = language,
        };

        if (language == "ST" && !string.IsNullOrEmpty(implementation))
            result["implementation"] = implementation;

        if (textualChildren.Count > 0)
            result["children"] = textualChildren;

        if (graphicalChildren.Count > 0)
            result["graphicalChildren"] = graphicalChildren;

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
        var textualChildren = children.Item1;
        var graphicalChildren = children.Item2;
        var result = new Dictionary<string, object?> { ["declaration"] = declaration.Trim() };
        if (textualChildren.Count > 0) result["children"] = textualChildren;
        if (graphicalChildren.Count > 0) result["graphicalChildren"] = graphicalChildren;
        return result;
    }

    private static Dictionary<string, object?> BuildSimple(string name, string kind, string declaration)
    {
        return new Dictionary<string, object?> { ["declaration"] = declaration.TrimEnd() };
    }

    private static (
        List<Dictionary<string, object?>> textual,
        List<Dictionary<string, object?>> graphical)
        CollectChildren(IAdapter adapter, dynamic parent, bool parentIsInterface = false, string folderPath = "")
    {
        var textual = new List<Dictionary<string, object?>>();
        var graphical = new List<Dictionary<string, object?>>();

        int count;
        try { count = adapter.GetChildCount(parent); }
        catch { return (textual, graphical); }

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
                var children = CollectChildren(adapter, child, parentIsInterface, subPath);
                textual.AddRange(children.Item1);
                graphical.AddRange(children.Item2);
                continue;
            }

            // Only methods, actions, properties ride as children
            bool isMethod = itemType == 609 || itemType == 610;
            bool isAction = itemType == 608 || itemType == 616;
            bool isProperty = itemType == 611 || itemType == 612;
            if (!isMethod && !isAction && !isProperty) continue;

            var decl = adapter.ReadDeclaration(child);
            var impl = adapter.ReadImplementation(child);

            if (isMethod)
            {
                var methodLang = DetectLanguage(impl);
                if (IsGraphical(methodLang))
                {
                    var bodyXml = adapter.ExportItemBodyAsXml(child, childName);
                    if (!string.IsNullOrEmpty(bodyXml))
                    {
                        graphical.Add(new Dictionary<string, object?>
                        {
                            ["name"] = childName, ["kind"] = "method", ["language"] = methodLang,
                            ["declaration"] = decl.Trim(), ["implementationXml"] = bodyXml,
                        });
                    }
                }
                else
                {
                    var entry = new Dictionary<string, object?>
                    {
                        ["name"] = childName, ["kind"] = "method",
                        ["declaration"] = decl.Trim(), ["language"] = methodLang,
                    };
                    if (!string.IsNullOrEmpty(impl)) entry["implementation"] = impl.Trim();
                    if (!string.IsNullOrEmpty(folderPath)) entry["folder"] = folderPath;
                    textual.Add(entry);
                }
            }
            else if (isAction)
            {
                var actionLang = DetectLanguage(impl);
                if (IsGraphical(actionLang))
                {
                    var bodyXml = adapter.ExportItemBodyAsXml(child, childName);
                    if (!string.IsNullOrEmpty(bodyXml))
                    {
                        graphical.Add(new Dictionary<string, object?>
                        {
                            ["name"] = childName, ["kind"] = "action", ["language"] = actionLang,
                            ["declaration"] = $"ACTION {childName}", ["implementationXml"] = bodyXml,
                        });
                    }
                }
                else
                {
                    var entry = new Dictionary<string, object?>
                    {
                        ["name"] = childName, ["kind"] = "action",
                        ["declaration"] = $"ACTION {childName}", ["language"] = actionLang,
                    };
                    if (!string.IsNullOrEmpty(impl)) entry["implementation"] = impl.Trim();
                    if (!string.IsNullOrEmpty(folderPath)) entry["folder"] = folderPath;
                    textual.Add(entry);
                }
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

        return (textual, graphical);
    }

    private static string DetectLanguage(string? implementation)
    {
        if (string.IsNullOrWhiteSpace(implementation)) return "ST";
        var trimmed = implementation.TrimStart();
        foreach (var kw in new[] { "FBD", "LD", "SFC", "CFC" })
            if (trimmed.StartsWith(kw, System.StringComparison.OrdinalIgnoreCase))
                return kw;
        return "ST";
    }

    private static bool IsGraphical(string language) =>
        language is "FBD" or "LD" or "SFC" or "CFC";

    private static bool IsEmptyVarBlock(string decl)
    {
        var trimmed = decl.Trim();
        var lines = trimmed.Split('\n');
        return lines.Length <= 2 && trimmed.StartsWith("VAR") && trimmed.EndsWith("END_VAR");
    }
}
