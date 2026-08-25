using System;
using System.Collections.Generic;
using System.Xml.Linq;
using Volt.Engine.Document;
using Volt.Engine.Ide;
using Volt.Engine.Model;
using Volt.Engine.Text;
using Volt.Engine.Vocabulary;

namespace Volt.Engine.Materialize;

public static class Materializer
{
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
        if (ItemKind.TravelsAsDocument(kind))
            return BuildPouFromXml(ide, item);

        var decl = ide.ReadDeclaration(item);
        var header = CodeHelper.ParseCodeHeader(decl);
        return new ItemContent(header.Type, decl.TrimEnd(), null, new());
    }

    private static ItemContent BuildPouFromXml(IIdeDriver ide, ItemRef item)
    {
        var xml = ide.ReadXml(item);
        var parsed = PouReader.Parse(xml);
        // ONE source. A POU's declaration is its DOCUMENT's — there is no second transport here, and the COM
        // aspect is not consulted. This used to be `?? ide.ReadDeclaration(item)`, justified as covering a
        // TwinCAT FB that carries a structured <interface><localVars> and no plaintext of its own. MEASURED: that
        // shape does not occur. All 8 recorded TwinCAT exports carry a POU-level <InterfaceAsPlainText>
        // (including FB_TcMembers, whose POU-level <interface/> IS empty), CODESYS was measured to export one for
        // even a freshly created POU (§3.3), and instrumenting the arm to throw produced ZERO hits across 195
        // live e2e tests on both vendors plus the whole offline suite. The only thing asserting that shape was
        // one hand-written test that TOLERATED null rather than demonstrating it.
        //
        // So a document without a declaration is a broken export, not a case to paper over: the fallback made a
        // POU whose declaration failed to parse silently materialize with the COM text instead, and any
        // divergence between the two representations became invisible.
        var declaration = parsed.Declaration
            ?? throw new InvalidOperationException(
                $"'{ide.Name(item)}': its PLCopen export carries no <InterfaceAsPlainText> — a POU document " +
                "without a declaration is a broken export");
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
    private static Model.Accessor? AccessorOf(string? code, string? declaration)
    {
        var decl = KeepDecl(declaration);
        return code is null && decl is null ? null : new Model.Accessor(decl, code);
    }

    /// <summary>The workspace text for a body, dispatched through the LANGUAGE's codec — the same registry the
    /// write side uses, so read and write cannot disagree about what a language is.
    /// <para>This used to hand-roll a second dispatch: FBD/LD, then CFC/SFC, then "anything else is text". That
    /// else-arm was the bug. <b>IL fell through it</b> and materialized as its raw body text, indistinguishable
    /// from ST source — so an engineer got an editable-looking file for a language Volt cannot write, and the
    /// push then rewrote their IL body as ST. IL is UNSUPPORTED, exactly like CFC and SFC: it materializes as the
    /// marker and a push leaves it alone. Asking the codec means a language added to the registry can never
    /// silently acquire a fake text form again.</para></summary>
    private static string? BodyTextOf(string? lang, XElement? bodyEl)
    {
        if (lang == null || bodyEl == null) return null;
        // No ReadOnly branch: a read-only codec DECODES to its marker, so one uniform call serves every
        // language. Branching here meant the caller had to know which languages have a text form — the exact
        // knowledge the codec registry exists to hold.
        var text = Document.BodyCodec.For(lang).Decode(bodyEl).Trim();
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

    /// <summary>Member name → in-POU folder path, walked off the SCRIPTING tree because PLCopen carries no
    /// folder information at all (the same reason <c>WriteXml</c> has to re-import into the original parent).
    /// <para><b>No catch, deliberately.</b> A swallowed fault here does not degrade gracefully — it MUTATES the
    /// project on the next push. Every member the walk failed to reach materializes with a null folder, so the
    /// writer emits no <c>%FOLDER</c> directive and the pulled file looks legitimately folder-less. Then a push
    /// resolves that null to the POU ROOT and creates a DUPLICATE beside the real member — and because the
    /// version hash is taken over the folder-less text, <c>volt status</c> reports clean the whole way through.
    /// A partial map is not a degraded answer, it is a wrong one.</para>
    /// <para>The isolation boundary already exists ONE LEVEL UP, in <c>Versioning.SafeVersion</c>, which catches
    /// per item, LOGS the item's name, and lets the rest of the walk continue — so a genuinely unreadable POU
    /// still cannot crash a refs/fetch, and now says which one it was.</para></summary>
    private static Dictionary<string, string?> BuildFolderMap(IIdeDriver ide, ItemRef parent, string basePath = "")
    {
        var map = new Dictionary<string, string?>(StringComparer.Ordinal);
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
        return map;
    }
}
