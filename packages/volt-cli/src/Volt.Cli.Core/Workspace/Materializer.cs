using System;
using System.Collections.Generic;
using System.Xml.Linq;
using Volt.Cli.Core.Graphical;
using Volt.Cli.Core.Ide;
using Volt.Cli.Core.Workspace.SourceText;

namespace Volt.Cli.Core.Workspace;

public static class Materializer
{
    private static readonly HashSet<string> PouKinds =
        new() { "program", "function_block", "function", "interface" };

    public static WorkspaceItem Materialize(IIdeDriver ide, string name, string kind, ItemRef item)
    {
        if (ItemKind.IsSourceKind(kind))
        {
            var build = BuildSource(ide, name, item, kind);
            var text = PouToStText.Convert(build);
            var resolvedKind = build.Kind;
            return new WorkspaceItem(text, FullWireName(name, ItemKind.ExtFor(resolvedKind)));
        }
        return new WorkspaceItem(ide.ReadManifest(item, kind),
            FullWireName(name, ItemKind.ExtFor(kind)));
    }

    private static string FullWireName(string bareName, string ext) =>
        IsVerbatimKind(bareName, ext) ? bareName : $"{bareName}.{ext}";

    private static bool IsVerbatimKind(string name, string ext) =>
        name.EndsWith("." + ext, StringComparison.OrdinalIgnoreCase);

    public static string Bare(string wireName)
    {
        var dot = wireName.LastIndexOf('.');
        return dot > 0 ? wireName.Substring(0, dot) : wireName;
    }

    internal static string GraphicalBodyMarker(string language) => $"(* @volt-graphical: {language} *)";

    private static PouData BuildSource(IIdeDriver ide, string name, ItemRef item, string kind)
    {
        if (PouKinds.Contains(kind))
            return BuildPouFromXml(ide, name, item);

        var decl = ide.ReadDeclaration(item);
        var header = CodeHelper.ParseCodeHeader(decl);
        return new PouData(header.Type, decl.TrimEnd(), null, null, new());
    }

    private static PouData BuildPouFromXml(IIdeDriver ide, string name, ItemRef item)
    {
        var xml = ide.ReadXml(item);
        var parsed = PlcOpenPouParser.Parse(xml);
        var declaration = parsed.Declaration
            ?? ide.ReadDeclaration(item);
        var kind = CodeHelper.ParseCodeHeader(declaration).Type;

        var folderMap = BuildFolderMap(ide, item);

        var children = new List<ChildData>();
        foreach (var c in parsed.Children)
        {
            var impl = VgBodyOf(c.BodyLanguage, c.BodyElement);
            children.Add(new ChildData(
                Kind: c.PouType,
                Name: c.Name,
                Declaration: c.Declaration?.Trim()
                    ?? (c.PouType == "action" ? $"ACTION {c.Name}" : $"METHOD {c.Name}"),
                BodyLanguage: c.BodyLanguage,
                BodyText: impl,
                Folder: folderMap.TryGetValue(c.Name, out var f) && f is { Length: > 0 } ? f : null,
                GetterCode: null,
                SetterCode: null,
                GetterDeclaration: null,
                SetterDeclaration: null));
        }

        // Properties from COM
        children.AddRange(CollectPropertyChildren(ide, item));

        var body = VgBodyOf(parsed.BodyLanguage, parsed.BodyElement);
        return new PouData(kind, declaration.Trim(),
            parsed.BodyLanguage ?? "ST", body, children);
    }

    private static string? VgBodyOf(string? lang, XElement? bodyEl)
    {
        if (lang == null || bodyEl == null) return null;
        if (lang is "FBD" or "LD")
            return GraphicalCode.RenderBody(bodyEl, lang);
        if (lang is "CFC" or "SFC")
            return GraphicalBodyMarker(lang);
        var text = bodyEl.Value.Trim();
        return text.Length == 0 ? null : text;
    }

    // ── Property children (COM) ──────────────────────────────────────

    private static List<ChildData> CollectPropertyChildren(IIdeDriver ide, ItemRef parent, string folderPath = "")
    {
        var children = new List<ChildData>();
        int count = ide.ChildCount(parent);
        for (int i = 1; i <= count; i++)
        {
            var child = ide.ChildAt(parent, i);
            var childName = ide.Name(child);
            var itemType = ide.KindCode(child);

            if (itemType == ItemKind.PlcFolder)
            {
                children.AddRange(CollectPropertyChildren(ide, child, FolderPath.Append(folderPath, childName)));
                continue;
            }

            if (itemType is not (ItemKind.PlcProp or ItemKind.PlcItfProp)) continue;

            string? getterCode = null, setterCode = null;
            string? getterDecl = null, setterDecl = null;

            var isIfaceProp = ide.KindCode(parent) == ItemKind.PlcItf;
            if (isIfaceProp)
            {
                var (hasGet, hasSet) = ide.InterfacePropertyAccessors(child);
                if (hasGet) getterCode = "";
                if (hasSet) setterCode = "";
            }
            else
            {
                int accCount = ide.ChildCount(child);
                for (int j = 1; j <= accCount; j++)
                {
                    var accessor = ide.ChildAt(child, j);
                    var accName = ide.Name(accessor).ToLowerInvariant();
                    if (accName is "get" or "set")
                    {
                        if (accName == "get") getterCode = ide.ReadImplementation(accessor)?.Trim() ?? "";
                        else setterCode = ide.ReadImplementation(accessor)?.Trim() ?? "";
                        var accDecl = ide.ReadDeclaration(accessor)?.Trim() ?? "";
                        if (accDecl.Length > 0 && !IsEmptyVarBlock(accDecl))
                        {
                            if (accName == "get") getterDecl = accDecl;
                            else setterDecl = accDecl;
                        }
                    }
                }
            }

            var folder = string.IsNullOrEmpty(folderPath) ? null : folderPath;
            children.Add(new ChildData("property", childName,
                ide.ReadDeclaration(child).Trim(), null, null,
                folder, getterCode, setterCode, getterDecl, setterDecl));
        }
        return children;
    }

    private static bool IsEmptyVarBlock(string decl)
    {
        var trimmed = decl.Trim();
        var lines = trimmed.Split('\n');
        return lines.Length <= 2 && trimmed.StartsWith("VAR") && trimmed.EndsWith("END_VAR");
    }

    private static Dictionary<string, string?> BuildFolderMap(IIdeDriver ide, ItemRef parent, string basePath = "")
    {
        var map = new Dictionary<string, string?>(StringComparer.Ordinal);
        try
        {
            int count = ide.ChildCount(parent);
            for (int i = 1; i <= count; i++)
            {
                var child = ide.ChildAt(parent, i);
                var childName = ide.Name(child);
                var itemType = ide.KindCode(child);
                if (itemType == ItemKind.PlcFolder)
                {
                    foreach (var kv in BuildFolderMap(ide, child, FolderPath.Append(basePath, childName)))
                        map[kv.Key] = kv.Value;
                    continue;
                }
                map[childName] = string.IsNullOrEmpty(basePath) ? null : basePath;
            }
        }
        catch { }
        return map;
    }
}
