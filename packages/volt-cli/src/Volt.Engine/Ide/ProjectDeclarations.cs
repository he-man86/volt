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
/// <para><b>The IDE half is read once and cached for the life of this instance</b>, and a driver keeps an instance for
/// ONE operation — it drops it at the start of every project walk (<c>WalkItems</c>), so an item created since the
/// last operation is seen. The project is indexed in ONE walk (<see cref="ItemLookup.All"/>), the first time a body asks about a name its own declarations
/// do not hold — a call head (every function a body calls is such a name), a name shaped like a wire — and each
/// declaration is read the first time it is asked for. A walk per name, which the drivers' <c>ItemLookup.Find</c>
/// copies cost, is a walk per function a project calls.</para>
/// </summary>
public sealed class ProjectDeclarations
{
    private readonly IProjectTree _tree;
    private readonly Func<ItemRef, string?> _read;
    private readonly Func<string, bool> _isRefusedPouName;
    private readonly Dictionary<string, string?> _declarationOf = new(StringComparer.OrdinalIgnoreCase);
    private Dictionary<string, (ItemRef Item, int Kind)>? _index;
    private List<(string Name, string Declaration)>? _globals;

    /// <summary>The project's top-level SOURCE items by name — the items a body can name (POU, DUT, GVL, interface) —
    /// the first of a name winning, as <see cref="ItemLookup.Find"/>'s walk order has it. A descriptor (a task) declares
    /// nothing a body calls and is left out: walked first, a task <c>Motor</c> made <see cref="KindOf"/> answer
    /// <c>task</c> for the function block <c>Motor</c>, and <c>m : Motor;</c> stopped being an instance (review of
    /// <c>bridge-refusal-review</c> 4a). The push's own index skips tasks for the same reason.</summary>
    private Dictionary<string, (ItemRef Item, int Kind)> Index
    {
        get
        {
            if (_index is not null) return _index;
            IReadOnlyList<(ItemRef Item, string Name, int Kind)> all;
            // A folder ANYWHERE that the driver will not read (TwinCAT's C2i guard: ITEM_UNVERIFIED) stops the index, and
            // must: skipping it would resolve a name it holds as unknown. But the refusal lands on the OP's item, which
            // may well have been read, so it says why this op needed the folder — the code stays (the bridge is
            // impaired, the remedy is the folder's), the reason is added (review of bridge-refusal-review 7).
            try { all = ItemLookup.All(_tree); }
            catch (Exception ex) when (ex is Volt.Contracts.ICodedError coded && coded.ErrorCode == Volt.Contracts.ConflictCodes.ItemUnverified)
            {
                throw new BridgeException(coded.ErrorCode,
                    "resolving the body's names needs every declaration of the project, and this folder could not be read " +
                    $"— the refusal is the folder's, not the item's: {ex.Message}", ex);
            }
            _index = new Dictionary<string, (ItemRef, int)>(StringComparer.OrdinalIgnoreCase);
            foreach (var (item, name, kind) in all)
                if (ItemKind.IsTopLevelCrud(kind) && !_index.ContainsKey(name)) _index[name] = (item, kind);
            return _index;
        }
    }

    /// <param name="tree">The project tree the items are found in.</param>
    /// <param name="readDeclaration">The vendor's read of one item's declaration text.</param>
    /// <param name="isRefusedPouName">Whether the vendor refuses a word as a POU's name — its measured list
    /// (<c>ICodeStore.RefusedName</c>): a word no POU can be named is no FB type a body calls (openspec
    /// <c>bridge-refusal-review</c> D4).</param>
    public ProjectDeclarations(IProjectTree tree, Func<ItemRef, string?> readDeclaration, Func<string, bool> isRefusedPouName)
    {
        _tree = tree ?? throw new ArgumentNullException(nameof(tree));
        _read = readDeclaration ?? throw new ArgumentNullException(nameof(readDeclaration));
        _isRefusedPouName = isRefusedPouName ?? throw new ArgumentNullException(nameof(isRefusedPouName));
    }

    /// <summary>The WIRE KIND of the top-level item named <paramref name="name"/> — the pushed one's, else the IDE's
    /// class (<see cref="ItemKind.Map"/>) — or null when neither holds such an item. By kind, never by the item's text
    /// (openspec <c>bridge-refusal-review</c> D3).</summary>
    public string? KindOf(PushedDeclarations pushed, string name) =>
        pushed.KindOf(name) ?? (Index.TryGetValue(name, out var hit) ? ItemKind.Map(hit.Kind) : null);

    /// <summary>The declaration of the top-level item named <paramref name="name"/> — the pushed one first, else
    /// the IDE's — or null when neither has such an item.</summary>
    public string? Of(PushedDeclarations pushed, string name)
    {
        if (pushed.ByName.TryGetValue(name, out var incoming) && !string.IsNullOrWhiteSpace(incoming)) return incoming;
        if (_declarationOf.TryGetValue(name, out var cached)) return cached;

        var declaration = Index.TryGetValue(name, out var hit) ? _read(hit.Item) : null;
        return _declarationOf[name] = string.IsNullOrWhiteSpace(declaration) ? null : declaration;
    }

    /// <summary>Every global variable list's declaration: each the push carries, and each the IDE holds that the
    /// push does not replace. Both are taken by KIND — the IDE's by class, the push's by
    /// wire kind (<see cref="PushedDeclarations"/>) — never by a first code line (openspec <c>push-without-header-check</c>
    /// 5.Q.7).</summary>
    public IEnumerable<string> Globals(PushedDeclarations pushed)
    {
        _globals ??= Index.Where(kv => kv.Value.Kind == ItemKind.PlcGvl)
            .Select(kv => (kv.Key, Of(NoPush, kv.Key) ?? ""))
            .ToList();
        foreach (var declaration in pushed.Globals) yield return declaration;
        foreach (var (name, declaration) in _globals)
            if (!pushed.ByName.ContainsKey(name)) yield return declaration;
    }

    /// <summary>What a pull pushes: nothing. The IDE's own globals are read as no push would replace them, and a pulled
    /// body is written against the IDE's declarations alone (<see cref="ScopeForPull"/>).</summary>
    private static readonly PushedDeclarations NoPush = PushedDeclarations.None;

    /// <summary>The scope of a body whose own declarations are <paramref name="declaration"/> (innermost first:
    /// <see cref="SourceScopes.Scope"/>), seeing <paramref name="pushed"/> before the IDE's items.</summary>
    public NetworkScope ScopeFor(string? declaration, PushedDeclarations pushed) =>
        NetworkScope.FromDeclarations(declaration, n => Of(pushed, n), () => Globals(pushed), n => KindOf(pushed, n),
                                      _isRefusedPouName);

    /// <summary>The scope a PULL writes a body against: the IDE's declarations alone, since a pull pushes nothing.</summary>
    public NetworkScope ScopeForPull(string? declaration) => ScopeFor(declaration, NoPush);
}
