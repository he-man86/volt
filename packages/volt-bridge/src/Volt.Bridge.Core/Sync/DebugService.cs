using System;
using System.Collections.Generic;
using Volt.Bridge.Core.Ide;
using Volt.Bridge.Core.Workspace;

namespace Volt.Bridge.Core.Sync;

/// <summary>
/// <c>/debug?name=ITEM</c> (diagnostic, STRICTLY READ-ONLY): the raw IDE tree under a named item — each
/// node's name, kind code + kind string, and its declaration/implementation text, recursively. With no
/// <c>name</c> it dumps the whole PLC-project root.
///
/// Why this exists: writing a bad COM op (e.g. an unsupported interface-accessor text write) can HARD-CRASH
/// TwinCAT, which makes "probe the create path by writing" a destructive debug loop. Reading never mutates
/// the IDE, so this endpoint is the safe alternative: hand-author a correct structure in the IDE (an
/// INTERFACE with a method + property + get/set), dump its EXACT shape here, then make the create path
/// reproduce it. Every read is individually guarded so one unreadable node can't abort the dump.
/// Not part of pull/push.
/// </summary>
public static class DebugService
{
    public static Dictionary<string, object?> Handle(IIdeDriver ide, string? name)
    {
        ItemRef? found = string.IsNullOrEmpty(name) ? ide.GetPlcProjectRoot() : ide.Lookup(name!);
        if (found is not { } node)
            throw new BridgeException(404, "NOT_FOUND", $"no item named '{name}'");
        return Dump(ide, node);
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
