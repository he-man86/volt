using System;
using System.Collections.Generic;
using System.Xml.Linq;
using Volt.Engine.Source;
using Volt.Engine.Ide;
using Volt.Engine.Library;
using Volt.Engine.Source.Body.St;
using Volt.Engine.Source.Body;
using Volt.Engine.Item;

namespace Volt.Engine.Sync;

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
        // ONE source, and it is the IDE — not the document.
        //
        // `InterfaceAsPlainText` is NOT part of PLCopen. It is a vendor `addData` block, and the TC6 XSD defines
        // addData as "application specific data defined in external schemata" with a REQUIRED `handleUnknown`
        // attribute enumerating preserve / discard / implementation. The standard has a vocabulary for DISMISSING
        // vendor data, so requiring one such block requires something the specification says a processor may drop.
        //
        // This used to read `parsed.Declaration ?? throw`, on the measurement that a document without the block
        // "does not occur" — 8/8 recorded exports carried it, and instrumenting the arm produced zero hits across
        // 195 live e2e tests. MEASURED AGAIN 2026-08-27 and FALSIFIED: live TwinCAT stopped emitting the block
        // while still emitting objectid, projectstructure, fbdcalltype and implementationattributes, and EVERY
        // POU of both fixture projects became unreadable — `refs` answered with libraries, DUTs, GVLs and no POUs
        // at all. Reproduced through the COM interface and the IDE's own export alike.
        //
        // The declaration was never lost; only its verbatim copy in the document was. The aspect is the object
        // model rather than a serialisation, so it cannot be omitted by an exporter, and it is the engineer's own
        // text — which the typed <interface> is not: 45 typed variables reproduce names and types, never the
        // alignment or the blank line before END_VAR. See openspec/changes/declaration-from-the-aspect.
        //
        // The throw MOVES rather than going away: an item whose ASPECT has no declaration is still a hard
        // failure, because that genuinely cannot happen.
        var declaration = ide.ReadDeclaration(item);
        if (string.IsNullOrEmpty(declaration))
            throw new InvalidOperationException(
                $"'{ide.Name(item)}': the IDE reports no declaration for this POU — that is a broken item, " +
                "not a transport gap");
        var kind = CodeHelper.ParseCodeHeader(declaration).Type;

        var memberMap = BuildMemberMap(ide, item);

        var members = new List<Member>();
        foreach (var c in parsed.Children)
        {
            var impl = BodyTextOf(c.BodyLanguage, c.BodyElement);
            members.Add(new Member(
                Kind: c.PouType,
                Name: c.Name,
                Declaration: MemberDeclaration(ide, memberMap, c.Name, c.PouType),
                Body: impl,
                Folder: FolderOf(memberMap, c.Name)));
        }

        // Property BODIES come from the same export as everything else — no per-accessor COM walk. Both vendors
        // carry <Property>/<GetAccessor|SetAccessor> with the accessor's body. The property's own DECLARATION
        // comes from its aspect, for the same reason a method's does. Folder membership still comes from the
        // walked map: PLCopen carries no folder information at all, which is the same reason WriteXml has to
        // re-import into the original parent.
        foreach (var p in parsed.Properties)
            members.Add(new Member(
                Kind: ItemKind.Kinds.Property,
                Name: p.Name,
                Declaration: MemberDeclaration(ide, memberMap, p.Name, ItemKind.Kinds.Property),
                Body: null,
                Folder: FolderOf(memberMap, p.Name),
                Getter: AccessorOf(p.GetterCode, p.GetterDeclaration),
                Setter: AccessorOf(p.SetterCode, p.SetterDeclaration)));

        var body = BodyTextOf(parsed.BodyLanguage, parsed.BodyElement);
        return new ItemContent(Kind: kind, Declaration: declaration.Trim(), Body: body, Members: members);
    }

    /// <summary>Where a member sits in the POU, and the handle to read it by. Walked off the scripting tree in
    /// ONE pass, because both answers come from the same enumeration and a second walk would double the COM
    /// traffic of every fetch.</summary>
    private readonly record struct MemberSite(string? Folder, ItemRef Ref);

    private static string? FolderOf(Dictionary<string, MemberSite> map, string name) =>
        map.TryGetValue(name, out var site) && site.Folder is { Length: > 0 } ? site.Folder : null;

    /// <summary>A member's declaration, from the member's OWN declaration aspect — the same single source the
    /// root POU uses, one level down.
    ///
    /// <para>It used to come from the document, with <c>?? $"METHOD {name}"</c> behind it. On a TwinCAT install
    /// whose export omits the verbatim block that fallback is not a safety net, it is the bug: a method declared
    /// <c>METHOD Compute : INT / VAR_INPUT / d : INT; / END_VAR</c> materialized as bare <c>METHOD Compute</c>,
    /// losing the return type and every parameter, and the push then wrote that back. Measured on this install:
    /// the export carries ZERO <c>interfaceasplaintext</c> blocks and the string <c>VAR_INPUT</c> appears
    /// nowhere in it at all — not even in typed form — while the member's aspect has the text exactly.</para>
    ///
    /// <para><b>An ACTION is the one member with no declaration to read</b>, in any IDE: IEC gives an action a
    /// name and a body and nothing else, and Beckhoff's own object model says so — <c>_ITcPlcImplementation</c>
    /// exposes <c>ImplementationText</c> and no <c>DeclarationText</c>. Its header is therefore COMPOSED here
    /// rather than read. That is not a fallback for a missing value; it is the whole of what an action's header
    /// is, and there is no source that could carry more.</para></summary>
    private static string MemberDeclaration(IIdeDriver ide, Dictionary<string, MemberSite> map, string name, string pouType)
    {
        if (pouType == ItemKind.Kinds.Action) return $"ACTION {name}";

        if (!map.TryGetValue(name, out var site))
            throw new InvalidOperationException(
                $"'{name}': the export declares this member but the project tree has no such child — the two " +
                "views of the POU disagree, and materializing either one of them would be a guess");

        var decl = ide.ReadDeclaration(site.Ref);
        if (string.IsNullOrWhiteSpace(decl))
            throw new InvalidOperationException(
                $"'{name}': the IDE reports no declaration for this member — that is a broken item, not a " +
                "transport gap");
        return decl.Trim();
    }

    /// <summary>The accessor, or null when the property has none. This decision used to be spread across the two
    /// fields it produced and re-made by every reader of the record ("a getter exists if its code OR its
    /// declaration is non-null"); it is made ONCE here now, and the answer is an object.
    /// <para>A null <paramref name="code"/> with a real declaration still yields an accessor — that is the
    /// bodiless case, not an absent one.</para></summary>
    private static Source.Accessor? AccessorOf(string? code, string? declaration)
    {
        var decl = KeepDecl(declaration);
        return code is null && decl is null ? null : new Source.Accessor(decl, code);
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
        // No Unsupported branch: an unsupported codec DECODES to its marker, so one uniform call serves every
        // language. Branching here meant the caller had to know which languages have a text form — the exact
        // knowledge the codec registry exists to hold.
        var text = BodyCodec.For(lang).Decode(bodyEl).Trim();
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

    /// <summary>Member name → where it sits and how to read it, walked off the SCRIPTING tree because PLCopen carries no
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
    private static Dictionary<string, MemberSite> BuildMemberMap(IIdeDriver ide, ItemRef parent, string basePath = "")
    {
        var map = new Dictionary<string, MemberSite>(StringComparer.Ordinal);
        int count = ide.ChildCount(parent);
        for (int i = 1; i <= count; i++)
        {
            var child = ide.ChildAt(parent, i);
            var childName = ide.Name(child);
            var itemType = ide.KindCode(child);
            if (itemType == ItemKind.PlcFolder)
            {
                foreach (var kv in BuildMemberMap(ide, child, FolderPath.Append(basePath, childName)))
                    map[kv.Key] = kv.Value;
                continue;
            }
            map[childName] = new MemberSite(string.IsNullOrEmpty(basePath) ? null : basePath, child);
        }
        return map;
    }
}
