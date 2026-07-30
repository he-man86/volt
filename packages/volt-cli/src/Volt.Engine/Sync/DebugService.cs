using System;
using System.Collections.Generic;
using Volt.Engine.Ide;
using Volt.Engine.Workspace;

using Volt.Cli.Transport;

namespace Volt.Engine.Sync;

/// <summary>
/// The one bridge debug dump (diagnostic, STRICTLY READ-ONLY), driven by plain arguments — <c>name</c>,
/// <c>includeBodies</c>, <c>libSig</c>, <c>xmlOf</c>, <c>reflect</c>. The HTTP-era <c>GET /debug?name=ITEM&amp;xml=1</c>
/// went away with the HTTP wire, and no pipe op serves this today (recorded in openspec
/// <c>audit-volt-cli-src/arch-notes.md</c>: restore a <c>debug</c> op or delete it, don't leave it half-wired).
/// Returns <c>{ tree, [count, bodies] }</c>:
///   • <c>tree</c>: the raw IDE tree under <c>name</c> (whole PLC-project root if omitted) — each node's
///     name, kind code + kind string, type tags, and declaration/implementation text, recursively.
///   • <c>count</c> + <c>bodies</c> (only with <c>includeBodies</c>): every POU's raw PLCopen XML as a flat
///     <c>folder/name.ext → xml</c> map — the exact bytes the IDE emits, for corpus capture. This IS the
///     capture path (it folded in what used to be a separate <c>/raw</c> HTTP endpoint + harvest script).
///
/// Why a read-only dump: writing a bad COM op (e.g. an unsupported interface-accessor text write) can
/// HARD-CRASH TwinCAT, so "probe the create path by writing" is a destructive debug loop. Reading never
/// mutates the IDE: hand-author a correct structure in the IDE, dump its EXACT shape here, then make the
/// create path reproduce it. Every read is individually guarded so one unreadable node can't abort the
/// dump. Not part of pull/push.
/// </summary>
public static class DebugService
{
    public static Dictionary<string, object?> Handle(IIdeDriver ide, string? name, bool includeBodies, string? libSig = null, string? xmlOf = null, string? reflect = null)
    {
        // `reflect` = TARGET (project|objmgr|object) → the change-detection surface of that object-model member.
        if (!string.IsNullOrEmpty(reflect))
            return new Dictionary<string, object?> { ["reflect"] = ide.DebugReflect(reflect!) };
        // `xmlOf` = NAME → the raw item-metadata XML (e.g. to inspect how a property lists its accessors).
        if (!string.IsNullOrEmpty(xmlOf))
            return new Dictionary<string, object?> { ["xml"] = ide.DebugItemXml(xmlOf!) };
        // `libSig` = NAME (or `*` for all): introspect the library signatures instead of the tree — the
        // implemented interfaces + property values of each element, to see how a DUT (alias/struct/enum) is modeled.
        if (libSig != null)
        {
            var filter = libSig is "" or "*" ? null : libSig;
            return new Dictionary<string, object?> { ["libsig"] = ide.DebugLibrarySignatures(filter) };
        }
        ItemRef? found = string.IsNullOrEmpty(name) ? ide.GetPlcProjectRoot() : ide.Lookup(name!);
        if (found is not { } node)
            throw new BridgeException(BridgeErrorCodes.NotFound, $"no item named '{name}'");
        var result = new Dictionary<string, object?> { ["tree"] = Dump(ide, node) };
        if (includeBodies)
        {
            var bodies = RawBodies(ide);
            result["count"] = bodies.Count;
            result["bodies"] = bodies;
        }
        return result;
    }

    /// <summary>Every POU's raw PLCopen XML (graphical bodies) as a flat <c>folder/name.ext → xml</c> map,
    /// for corpus capture. Per-item guarded so one unexportable POU can't abort the sweep.</summary>
    private static Dictionary<string, string> RawBodies(IIdeDriver ide)
    {
        var bodies = new Dictionary<string, string>();
        foreach (var it in ide.WalkItems())
        {
            var kind = ItemKind.Map(it.KindCode);
            if (kind is not (ItemKind.Kinds.Program or ItemKind.Kinds.Function or ItemKind.Kinds.FunctionBlock)) continue; // only POUs carry graphical bodies
            string? raw;
            try { raw = ide.ReadXml(it.Item); } catch { raw = null; }
            if (string.IsNullOrEmpty(raw)) continue;
            // Name by KIND (.prg/.fun/.fb), same scheme as the workspace (ItemKind.ExtFor) — the raw XML's own
            // header carries the body language, so the filename doesn't need it. (Was body-language `?? "st"`,
            // the last vestige of the pre-kind-naming era.)
            var full = $"{it.Name}.{ItemKind.ExtFor(kind)}";
            bodies[string.IsNullOrEmpty(it.Folder) ? full : $"{it.Folder}/{full}"] = raw!;
        }
        return bodies;
    }

    private static Dictionary<string, object?> Dump(IIdeDriver ide, ItemRef node)
    {
        var kindCode = Safe(() => ide.KindCode(node), ItemKind.Unknown);

        // HARD SAFETY RULE — TwinCAT COM hard-crashes the whole IDE if you enumerate an interface property's
        // accessor children or read declaration/implementation text off an interface accessor (subtypes
        // 654/655). Mirror Materializer.CollectChildren: never descend into an interface property, and never
        // touch text on an interface accessor. A "read-only diagnostic" that crashes the IDE is worse than
        // useless, so these guards are non-negotiable.
        bool isIfaceProp = kindCode == ItemKind.PlcItfProp;
        bool isIfaceAccessor = kindCode is ItemKind.PlcItfPropGet or ItemKind.PlcItfPropSet;

        var children = new List<object?>();
        int count = isIfaceProp ? 0 : Safe(() => ide.ChildCount(node), 0);
        for (int i = 1; i <= count; i++)
        {
            ItemRef child;
            try { child = ide.ChildAt(node, i); } catch { continue; }
            children.Add(Dump(ide, child));
        }
        return new Dictionary<string, object?>
        {
            ["name"] = Safe(() => ide.Name(node), null),
            ["kindCode"] = kindCode,
            ["kind"] = ItemKind.Map(kindCode),
            // Vendor type identity (CODESYS IObject interface names) when the driver exposes it — the no-guess
            // basis for classifying a node that maps to Unknown. Null when the driver offers no introspection.
            ["typeTags"] = ide is IDebugIntrospect di ? Safe<object?>(() => di.TypeTags(node), null) : null,
            ["declaration"] = isIfaceAccessor ? "<skipped: interface accessor text crashes TC>" : SafeText(() => ide.ReadDeclaration(node)),
            ["implementation"] = isIfaceAccessor ? "<skipped>" : SafeText(() => ide.ReadImplementation(node)),
            ["childCount"] = count,
            ["note"] = isIfaceProp ? "interface property — accessors NOT enumerated (TC COM crashes on them)" : null,
            ["children"] = children,
        };
    }

    private static T Safe<T>(Func<T> read, T fallback) { try { return read(); } catch { return fallback; } }
    // Surface the read failure inline (rather than null) so "this node rejects DeclarationText" is visible
    // in the dump — that rejection is itself a key fact about how the kind must be created.
    private static string SafeText(Func<string> read) { try { return read(); } catch (Exception ex) { return $"<unreadable: {ex.Message}>"; } }

}
