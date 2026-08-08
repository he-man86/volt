using System;
using System.Collections.Generic;
using System.Xml.Linq;
using Volt.Engine.Body;
using Volt.Engine.Ide;
using Volt.Engine.Text;
using Volt.Engine.Item;
using Volt.Engine.PlcOpen;

namespace Volt.Engine.Workspace;

public static class Materializer
{
    private static readonly HashSet<string> PouKinds =
        new() { ItemKind.Kinds.Program, ItemKind.Kinds.FunctionBlock, ItemKind.Kinds.Function, ItemKind.Kinds.Interface };

    public static WorkspaceItem Materialize(IIdeDriver ide, string name, string kind, ItemRef item)
    {
        if (ItemKind.IsSourceKind(kind))
        {
            var build = BuildSource(ide, item, kind);
            var text = StWriter.Write(build);
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

    private const string MarkerPrefix = "(* @volt-graphical:";

    // internal to the assembly so the read-only body codecs can produce the same marker the reader expects.
    internal static string GraphicalBodyMarker(string language) => $"{MarkerPrefix} {language} *)";

    /// <summary>Is this body text the informational CFC/SFC marker rather than real source? A read-only graphical
    /// body has no text form, so <see cref="GraphicalBodyMarker"/> is what materializes for it — and pushing that
    /// text BACK must never reach the IDE, or it replaces the engineer's graphical body with a comment. A prefix
    /// test against the same literal the writer uses, so reader and writer cannot drift apart.</summary>
    internal static bool IsGraphicalBodyMarker(string? impl) =>
        impl != null && impl.TrimStart().StartsWith(MarkerPrefix, System.StringComparison.Ordinal);

    /// <summary>Items WITH a body or children (POU, interface) are read through the PLCopen export — only it can
    /// carry those. DECLARATION-ONLY kinds (DUT, GVL) are read through the declaration aspect.
    /// <para><b>This split is a vendor limit, not a preference, and it was measured.</b> Routing DUT/GVL through
    /// the export was implemented and run against both live bridges: CODESYS served them fine, but TwinCAT's
    /// <c>PlcOpenExport</c> REJECTS a DUT or a GVL outright — <c>E_FAIL</c> from the COM component for every one
    /// of them (`GVL_PackML`, and all five e2e DUT kinds), because the export is POU-shaped and a DUT has no POU
    /// to name. So PLCopen cannot be the single read transport while TwinCAT is supported. Do not re-attempt
    /// without first proving TwinCAT can export a non-POU item; the CODESYS half works and is not the blocker.
    /// (Cost, for the record, was also against it: ~20 ms per export vs ~1 ms for the aspect, ~17-22x per item
    /// on the walk `volt status` pays every call.)</para>
    /// <para>The split is SAFE precisely because these kinds are declaration-only: with no body, no body
    /// language and no children, a read and a write have nothing to disagree about — which is what the
    /// read/write representation split DID cause on POUs (the graphical-child flattening, the document-scoping
    /// bug). Keep it that way: if a kind ever gains a body, it belongs on the export path.</para></summary>
    private static ItemContent BuildSource(IIdeDriver ide, ItemRef item, string kind)
    {
        if (PouKinds.Contains(kind))
            return BuildPouFromXml(ide, item);

        var decl = ide.ReadDeclaration(item);
        var header = CodeHelper.ParseCodeHeader(decl);
        return new ItemContent(header.Type, decl.TrimEnd(), null, new());
    }

    private static ItemContent BuildPouFromXml(IIdeDriver ide, ItemRef item)
    {
        var xml = ide.ReadXml(item);
        var parsed = PouReader.Parse(xml);
        var declaration = parsed.Declaration
            ?? ide.ReadDeclaration(item);
        var kind = CodeHelper.ParseCodeHeader(declaration).Type;

        var folderMap = BuildFolderMap(ide, item);

        var members = new List<Member>();
        foreach (var c in parsed.Children)
        {
            var impl = BodyTextOf(c.BodyLanguage, c.BodyElement);
            members.Add(new Member(
                Kind: c.PouType,
                Name: c.Name,
                Declaration: c.Declaration?.Trim()
                    ?? (c.PouType == ItemKind.Kinds.Action ? $"ACTION {c.Name}" : $"METHOD {c.Name}"),
                Body: impl,
                Folder: FolderOf(folderMap, c.Name)));
        }

        // Properties from the SAME export as everything else — no per-accessor COM walk. Both vendors carry
        // <Property>/<GetAccessor|SetAccessor> with the accessor's body AND its declaration (verified live on
        // each). Folder membership still comes from `folderMap`: PLCopen carries no folder information at all,
        // which is the same reason WriteXml has to re-import into the original parent.
        foreach (var p in parsed.Properties)
            members.Add(new Member(
                Kind: ItemKind.Kinds.Property,
                Name: p.Name,
                Declaration: p.Declaration?.Trim() ?? $"PROPERTY {p.Name}",
                Body: null,
                Folder: FolderOf(folderMap, p.Name),
                Getter: AccessorOf(p.GetterCode, p.GetterDeclaration),
                Setter: AccessorOf(p.SetterCode, p.SetterDeclaration)));

        var body = BodyTextOf(parsed.BodyLanguage, parsed.BodyElement);
        return new ItemContent(Kind: kind, Declaration: declaration.Trim(), Body: body, Members: members);
    }

    private static string? FolderOf(Dictionary<string, string?> map, string name) =>
        map.TryGetValue(name, out var f) && f is { Length: > 0 } ? f : null;

    /// <summary>The accessor, or null when the property has none. This decision used to be spread across the two
    /// fields it produced and re-made by every reader of the record ("a getter exists if its code OR its
    /// declaration is non-null"); it is made ONCE here now, and the answer is an object.
    /// <para>A null <paramref name="code"/> with a real declaration still yields an accessor — that is the
    /// bodiless case, not an absent one.</para></summary>
    private static Item.Accessor? AccessorOf(string? code, string? declaration)
    {
        var decl = KeepDecl(declaration);
        return code is null && decl is null ? null : new Item.Accessor(decl, code);
    }

    private static string? BodyTextOf(string? lang, XElement? bodyEl)
    {
        if (lang == null || bodyEl == null) return null;
        if (lang is "FBD" or "LD")
            return NetworkCode.RenderBody(bodyEl);
        if (lang is "CFC" or "SFC")
            return GraphicalBodyMarker(lang);
        var text = bodyEl.Value.Trim();
        return text.Length == 0 ? null : text;
    }

    /// <summary>An accessor declaration worth keeping: null/blank, or a bare empty VAR block, carries nothing.</summary>
    private static string? KeepDecl(string? decl)
    {
        var d = decl?.Trim();
        return string.IsNullOrEmpty(d) || IsEmptyVarBlock(d!) ? null : d;
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
