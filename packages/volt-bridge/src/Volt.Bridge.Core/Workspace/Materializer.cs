using System;
using System.Collections.Generic;
using Volt.Bridge.Core.Graphical;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Workspace.SourceText;

namespace Volt.Bridge.Core.Workspace;

/// <summary>
/// Turns a project item into its canonical workspace text — the single source of truth used for BOTH
/// the content version (hashed) and the fetched source, so they can never diverge. Source kinds
/// assemble declaration + implementation (+ children) via <see cref="StAssembler"/>; non-source kinds
/// use their manifest. Reads go through the driver's two transports; graphical bodies through
/// <see cref="GraphicalCode"/>. No fallbacks — a read failure propagates to the HTTP boundary.
/// </summary>
public static class Materializer
{
    public static WorkspaceItem Materialize(IIdeDriver ide, string name, string kind, ItemRef item)
    {
        if (ItemKind.IsSourceKind(kind))
        {
            var build = BuildSource(ide, name, item, kind);
            var text = StAssembler.Assemble(build);
            var lang = build.TryGetValue("language", out var l) ? l as string : null;
            var ext = lang?.ToLowerInvariant() ?? ItemKind.ExtFor(kind);
            return new WorkspaceItem(text, FullWireName(name, ext));
        }
        return new WorkspaceItem(ide.ReadManifest(item, kind),
            FullWireName(name, ItemKind.ExtFor(kind)));
    }

    /// <summary>Append the extension to the name. For verbatim kinds (tmc_file), the IDE name
    /// already includes the extension — don't double it.</summary>
    private static string FullWireName(string bareName, string ext) =>
        IsVerbatimKind(bareName, ext) ? bareName : $"{bareName}.{ext}";

    private static bool IsVerbatimKind(string name, string ext) =>
        name.EndsWith("." + ext, StringComparison.OrdinalIgnoreCase);

    private static Dictionary<string, object?> BuildSource(IIdeDriver ide, string name, ItemRef item, string kind)
    {
        Dictionary<string, object?> result;
        string resultKind;
        // POUs: ask GraphicalCode first. A graphical POU comes back with its body AND its real
        // declaration (from the same export), so we never touch the object-model aspect — which on a
        // just-reimported graphical POU damages the body we just read. A textual POU comes back null,
        // and its declaration is the aspect read.
        if (kind is "program" or "function_block" or "function")
        {
            var graphical = GraphicalCode.Read(ide, item);
            var declaration = graphical is not null ? graphical.Declaration : ide.ReadDeclaration(item);
            result = BuildPou(ide, item, declaration, graphical);
            resultKind = CodeHelper.ParseCodeHeader(declaration).Type;
        }
        else
        {
            var declaration = ide.ReadDeclaration(item);
            var header = CodeHelper.ParseCodeHeader(declaration);
            result = header.Type == "interface"
                ? BuildInterface(ide, item, declaration)
                : BuildDeclOnly(declaration);   // gvl, DUTs (structure/enumeration/union/alias)
            resultKind = header.Type;
        }

        result["name"] = name;
        result["kind"] = resultKind;
        return result;
    }

    private static Dictionary<string, object?> BuildPou(IIdeDriver ide, ItemRef item, string declaration, GraphicalBody? graphical)
    {
        var children = CollectChildren(ide, item);
        var result = new Dictionary<string, object?> { ["declaration"] = declaration.Trim() };

        // The POU's OWN body may be graphical. Its LANGUAGE travels as a field (→ the CLI's
        // .fbd/.ld/.cfc/.sfc extension). FBD/LD bodies lead with the NETWORK marker; CFC/SFC come back
        // empty. A null graphical means the gate found a textual body — never a missed graphical one.
        if (graphical is not null)
        {
            if (!string.IsNullOrEmpty(graphical.Body)) result["implementation"] = graphical.Body;
            result["language"] = graphical.Language;
        }
        else
        {
            result["language"] = "ST";
            var implementation = ide.ReadImplementation(item)?.Trim() ?? "";
            if (!string.IsNullOrEmpty(implementation)) result["implementation"] = implementation;
        }

        if (children.Count > 0) result["children"] = children;
        return result;
    }

    private static Dictionary<string, object?> BuildInterface(IIdeDriver ide, ItemRef item, string declaration)
    {
        var children = CollectChildren(ide, item);
        var result = new Dictionary<string, object?> { ["declaration"] = declaration.Trim() };
        if (children.Count > 0) result["children"] = children;
        return result;
    }

    /// <summary>GVL, DUTs and other leaf kinds carry only a declaration (no body, no children).</summary>
    private static Dictionary<string, object?> BuildDeclOnly(string declaration) =>
        new() { ["declaration"] = declaration.TrimEnd() };

    private static List<Dictionary<string, object?>> CollectChildren(IIdeDriver ide, ItemRef parent, string folderPath = "")
    {
        var children = new List<Dictionary<string, object?>>();

        // No swallow: the tree primitives return sentinels for genuine leaves (count 0) and throw only
        // on real IDE failure — which must surface, not silently drop a child (that would mis-hash the
        // parent's version).
        int count = ide.ChildCount(parent);
        for (int i = 1; i <= count; i++)
        {
            var child = ide.ChildAt(parent, i);
            var childName = ide.Name(child);
            var itemType = ide.KindCode(child);

            if (itemType == ItemKind.PlcFolder)
            {
                var subPath = string.IsNullOrEmpty(folderPath) ? childName : $"{folderPath}/{childName}";
                children.AddRange(CollectChildren(ide, child, subPath));
                continue;
            }

            bool isMethod = itemType is ItemKind.PlcMethod or ItemKind.PlcItfMeth;
            bool isAction = itemType is ItemKind.PlcAction or ItemKind.PlcTrans;
            bool isProperty = itemType is ItemKind.PlcProp or ItemKind.PlcItfProp;
            if (!isMethod && !isAction && !isProperty) continue;

            if (isMethod || isAction)
            {
                var graphical = GraphicalCode.Read(ide, child);
                string? implementation = graphical is not null
                    ? GraphicalImpl(graphical)
                    : NullIfEmpty(ide.ReadImplementation(child)?.Trim());

                // Actions synthesize their signature; a method needs its real declaration.
                var declText = isAction
                    ? $"ACTION {childName}"
                    : (graphical is not null ? graphical.Declaration : ide.ReadDeclaration(child)).Trim();

                var entry = new Dictionary<string, object?>
                {
                    ["name"] = childName,
                    ["kind"] = isMethod ? "method" : "action",
                    ["declaration"] = declText,
                };
                if (implementation is not null) entry["implementation"] = implementation;
                if (!string.IsNullOrEmpty(folderPath)) entry["folder"] = folderPath;
                children.Add(entry);
            }
            else // property
            {
                var entry = new Dictionary<string, object?>
                {
                    ["name"] = childName,
                    ["kind"] = "property",
                    ["declaration"] = ide.ReadDeclaration(child).Trim(),
                };

                // Interface property accessor children (subtypes 654/655) crash TwinCAT COM
                // if you try to enumerate their children or read their implementation.
                // Only note which accessors exist — skip implementation reads entirely.
                var isIfaceProp = ide.KindCode(parent) == ItemKind.PlcItf;
                int accCount = isIfaceProp ? 0 : ide.ChildCount(child);
                for (int j = 1; j <= accCount; j++)
                {
                    var accessor = ide.ChildAt(child, j);
                    var accName = ide.Name(accessor).ToLowerInvariant();
                    if (accName is "get" or "set")
                    {
                        entry[accName == "get" ? "getterCode" : "setterCode"] = ide.ReadImplementation(accessor)?.Trim() ?? "";
                        var accDecl = ide.ReadDeclaration(accessor)?.Trim() ?? "";
                        if (!string.IsNullOrEmpty(accDecl) && !IsEmptyVarBlock(accDecl))
                            entry[accName == "get" ? "getterDeclaration" : "setterDeclaration"] = accDecl;
                    }
                }
                if (isIfaceProp)
                {
                    // Signal existence without touching COM — TC interface accessor
                    // children crash on enumeration.
                    entry["getterCode"] = entry.ContainsKey("getterCode") ? "" : null;
                    entry["setterCode"] = entry.ContainsKey("setterCode") ? "" : null;
                }

                if (!string.IsNullOrEmpty(folderPath)) entry["folder"] = folderPath;
                children.Add(entry);
            }
        }

        return children;
    }

    /// <summary>A graphical child's implementation text: the VG (leading NETWORK marker) for editable
    /// FBD/LD, or a bare <c>%LANG &lt;lang&gt;</c> placeholder for a read-only CFC/SFC view.</summary>
    private static string GraphicalImpl(GraphicalBody gb) =>
        string.IsNullOrEmpty(gb.Body) ? $"%LANG {gb.Language}" : gb.Body;

    private static string? NullIfEmpty(string? s) => string.IsNullOrEmpty(s) ? null : s;

    private static bool IsEmptyVarBlock(string decl)
    {
        var trimmed = decl.Trim();
        var lines = trimmed.Split('\n');
        return lines.Length <= 2 && trimmed.StartsWith("VAR") && trimmed.EndsWith("END_VAR");
    }
}
