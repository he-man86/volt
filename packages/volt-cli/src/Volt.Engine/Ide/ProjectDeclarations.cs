using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;
using Volt.Engine.Item;

namespace Volt.Engine.Ide;

/// <summary>
/// The project's declarations as a body sees them: another item's declaration by name, every global variable
/// list, and from those the <see cref="NetworkScope"/> a graphical body is written and read against.
///
/// <para><b>One of these per driver, shared by pull and push.</b> Network text v2's writer (pull) and reader
/// (push) must see ONE scope, or the writer keeps a wire name the reader refuses (spec, "reserved names are one
/// case-insensitive set on write and read", task 3.9). Both drivers carried a member-for-member copy of the
/// by-name lookup (<c>DeclarationOfName</c>); it lives here now, beside the global list it was missing.</para>
///
/// <para><b>THE PUSH IS ASKED FIRST.</b> The IDE can only answer for items it ALREADY holds, so on a push that
/// creates a whole project the answer would depend on op order — and the push is the newer truth for an item it
/// is updating anyway. The IDE answers for every item the push does not carry.</para>
///
/// <para><b>The IDE half is read once and cached for the life of this instance</b> — a driver makes a new one per
/// operation (each project walk), so an item created since the last is seen: the project
/// is indexed in ONE walk (<see cref="ItemLookup.All"/>), the first time a body asks about a name its own declarations
/// do not hold — a call head (every function a body calls is such a name), a name shaped like a wire — and each
/// declaration is read the first time it is asked for. A walk per name, which the drivers' <c>ItemLookup.Find</c>
/// copies cost, is a walk per function a project calls.</para>
/// </summary>
public sealed class ProjectDeclarations
{
    private readonly IProjectTree _tree;
    private readonly Func<ItemRef, string?> _read;
    private readonly Dictionary<string, string?> _declarationOf = new(StringComparer.OrdinalIgnoreCase);
    private Dictionary<string, (ItemRef Item, int Kind)>? _index;
    private List<(string Name, string Declaration)>? _globals;

    /// <summary>The project's top-level items by name — the first of a name wins, as <see cref="ItemLookup.Find"/>'s
    /// walk order has it.</summary>
    private Dictionary<string, (ItemRef Item, int Kind)> Index
    {
        get
        {
            if (_index is not null) return _index;
            _index = new Dictionary<string, (ItemRef, int)>(StringComparer.OrdinalIgnoreCase);
            foreach (var (item, name, kind) in ItemLookup.All(_tree))
                if (!_index.ContainsKey(name)) _index[name] = (item, kind);
            return _index;
        }
    }

    /// <param name="tree">The project tree the items are found in.</param>
    /// <param name="readDeclaration">The vendor's read of one item's declaration text.</param>
    public ProjectDeclarations(IProjectTree tree, Func<ItemRef, string?> readDeclaration)
    {
        _tree = tree ?? throw new ArgumentNullException(nameof(tree));
        _read = readDeclaration ?? throw new ArgumentNullException(nameof(readDeclaration));
    }

    /// <summary>The declaration of the top-level item named <paramref name="name"/> — the pushed one first, else
    /// the IDE's — or null when neither has such an item.</summary>
    public string? Of(IReadOnlyDictionary<string, string> pushed, string name)
    {
        if (pushed.TryGetValue(name, out var incoming) && !string.IsNullOrWhiteSpace(incoming)) return incoming;
        if (_declarationOf.TryGetValue(name, out var cached)) return cached;

        var declaration = Index.TryGetValue(name, out var hit) ? _read(hit.Item) : null;
        return _declarationOf[name] = string.IsNullOrWhiteSpace(declaration) ? null : declaration;
    }

    /// <summary>Every global variable list's declaration: each the push carries, and each the IDE holds that the
    /// push does not replace.</summary>
    public IEnumerable<string> Globals(IReadOnlyDictionary<string, string> pushed)
    {
        _globals ??= Index.Where(kv => kv.Value.Kind == ItemKind.PlcGvl)
            .Select(kv => (kv.Key, Of(NoPush, kv.Key) ?? ""))
            .ToList();
        foreach (var kv in pushed)
            if (IsGlobalList(kv.Value)) yield return kv.Value;
        foreach (var (name, declaration) in _globals)
            if (!pushed.ContainsKey(name)) yield return declaration;
    }

    /// <summary>The scope of a body whose own declarations are <paramref name="declaration"/> (innermost first:
    /// <see cref="SourceScopes.Scope"/>).</summary>
    private static readonly IReadOnlyDictionary<string, string> NoPush = new Dictionary<string, string>();

    public NetworkScope ScopeFor(string? declaration, IReadOnlyDictionary<string, string> pushed) =>
        NetworkScope.FromDeclarations(declaration, n => Of(pushed, n), () => Globals(pushed));

    private static bool IsGlobalList(string declaration) =>
        declaration.Split('\n').Select(l => l.Trim())
            .FirstOrDefault(l => l.Length > 0 && !l.StartsWith("{", StringComparison.Ordinal)
                                  && !l.StartsWith("(*", StringComparison.Ordinal) && !l.StartsWith("//", StringComparison.Ordinal))
            is { } first && first.StartsWith("VAR_GLOBAL", StringComparison.OrdinalIgnoreCase);
}
