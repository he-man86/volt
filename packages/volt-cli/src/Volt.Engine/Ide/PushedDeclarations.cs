using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Item;

namespace Volt.Engine.Ide;

/// <summary>
/// The declarations a push carries, as every write in that push sees them: each item's declaration by BARE name (the
/// key the resolver walks with — the IDE's own lookup key), and which of those items are global variable lists.
///
/// <para><b>A global variable list is one by its WIRE KIND</b> (<c>gvl</c>), the one place the push knows it — never by
/// its first code line (openspec <c>push-without-header-check</c> 5.Q.7). The bare-name map alone lost the kind, so
/// <see cref="ProjectDeclarations.Globals"/> took a pushed item as a GVL when its text opened with <c>VAR_GLOBAL</c>
/// while it took the IDE's own by class: a pushed <c>Variable_Configuration.gvl</c> (bakon-nano, it opens with
/// <c>VAR_CONFIG</c>) and any GVL whose text is broken fell out of the network scope the same list read from the IDE is
/// in. Both halves decide by kind now.</para>
/// </summary>
public sealed class PushedDeclarations
{
    /// <summary>What a pull pushes, and what a write outside any push sees: nothing.</summary>
    public static readonly PushedDeclarations None = new(new Dictionary<string, string>(), Array.Empty<string>());

    /// <summary>Each pushed item's declaration by bare name. A same-name collision keeps the FIRST.</summary>
    public IReadOnlyDictionary<string, string> ByName { get; }

    private readonly HashSet<string> _globalLists;

    private PushedDeclarations(IReadOnlyDictionary<string, string> byName, IEnumerable<string> globalLists)
    {
        ByName = byName;
        _globalLists = new HashSet<string>(globalLists, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Indexed from the push's own items in op order — each one's BARE name, its WIRE kind (the kind its
    /// extension names) and its declaration: keyed by bare name (the first of a name wins), and an item whose wire kind
    /// is <c>gvl</c> is a global variable list.</summary>
    public static PushedDeclarations FromWire(IEnumerable<(string Name, string? Kind, string Declaration)> items)
    {
        var byName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var globals = new List<string>();
        foreach (var (name, kind, declaration) in items)
        {
            if (byName.ContainsKey(name)) continue;
            byName[name] = declaration;
            if (kind == ItemKind.Kinds.Gvl) globals.Add(name);
        }
        return new PushedDeclarations(byName, globals);
    }

    /// <summary>The declaration of every pushed global variable list.</summary>
    public IEnumerable<string> Globals => ByName.Where(kv => _globalLists.Contains(kv.Key)).Select(kv => kv.Value);
}
