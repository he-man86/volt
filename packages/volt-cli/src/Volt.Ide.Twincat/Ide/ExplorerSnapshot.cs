using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Ide;
using Volt.Engine.Item;

namespace Volt.Ide.Twincat;

/// <summary>
/// Which children of the PLC tree Volt must never touch, read WITHOUT touching any of them (DIALECT C2i).
///
/// <para>After a solution load, the first <c>Child(i)</c> or <c>LookupChild</c> on the tree item of a POU whose text the
/// IDE does not read as a POU kills TcXaeShell (access violation in <c>TwinCAT System Manager.dll</c>); a <c>try</c> in
/// Volt receives <c>0x800706BE</c> after XAE has died, so there is nothing to guard on this side. The Solution Explorer
/// hierarchy lists those items without harm, and its caption says whether the IDE parsed one: a <c>.TcPOU</c> node is
/// captioned <c>name (PRG|FB|FUN)</c> while it does, and its bare name otherwise (5 of 5 such POUs, 0 of 21 other
/// items; the caption follows a text write at once). Only the suffix's PRESENCE is read, never its spelling.</para>
///
/// <para>This is the only place the caption is read. Untested here and recorded as such: an XAE option or UI
/// language that shows no suffix on ANY POU would flag every POU — every op would then refuse loudly by name, and
/// nothing would crash.</para>
/// </summary>
internal sealed class ExplorerSnapshot
{
    private readonly Dictionary<string, Guarded> _guarded;
    private readonly Dictionary<string, int> _listed;
    private readonly HashSet<string> _pous;

    /// <summary>A folder holding at least one POU Volt must not touch: every child name in hierarchy order, and the
    /// names that are not to be opened.</summary>
    public sealed record Guarded(IReadOnlyList<string> Names, IReadOnlySet<string> Untouchable);

    private ExplorerSnapshot(Dictionary<string, Guarded> guarded, Dictionary<string, int> listed, HashSet<string> pous)
    { _guarded = guarded; _listed = listed; _pous = pous; }

    /// <summary>True when the project has no POU Volt must not touch — every real project measured — and the tree is
    /// read exactly as before, with no extra call.</summary>
    public bool Clean => _guarded.Count == 0;

    /// <summary>The guarded folder at <paramref name="relPath"/> (tree names below the PLC project, joined with
    /// <c>^</c>; <c>""</c> is the project itself), or null when that folder holds nothing to avoid.</summary>
    public Guarded? At(string relPath) => _guarded.TryGetValue(relPath, out var g) ? g : null;

    /// <summary>How many children the hierarchy lists for the node at <paramref name="relPath"/>; null when it lists no
    /// such node. Every node outside a POU is counted, so a folder the PLC tree has and the hierarchy does not — or holds
    /// more children than it lists — is visible as exactly that, and is never taken for a folder with nothing to avoid
    /// (the snapshot can only flag what it lists).</summary>
    public int? ListedChildren(string relPath) => _listed.TryGetValue(relPath, out var n) ? n : null;

    /// <summary>Is the node at <paramref name="relPath"/> inside (or itself) a POU? A POU's subtree holds its members,
    /// never a top-level POU, so nothing beneath one needs the hierarchy's word. A node the hierarchy LISTS outside a
    /// POU is not inside one, whatever its path: a folder beside a POU of its name has the POU's path, and was waved
    /// through the count check by it (5Qa review).</summary>
    public bool InsidePou(string relPath)
    {
        if (_listed.ContainsKey(relPath)) return false;
        for (var path = relPath; path.Length > 0; path = path.Substring(0, Math.Max(0, path.LastIndexOf('^'))))
            if (_pous.Contains(path)) return true;
        return false;
    }

    /// <summary>Every flagged POU, as its path below the PLC project (<c>folder^name</c>).</summary>
    public IEnumerable<string> UntouchablePaths =>
        _guarded.SelectMany(g => g.Value.Untouchable.Select(n => g.Key.Length == 0 ? n : g.Key + "^" + n));

    /// <summary>The snapshot of the PLC project whose hierarchy node is <paramref name="plcProject"/>.</summary>
    /// <param name="stillUntouchable">POU paths flagged earlier in this session and not since replaced by Volt: they stay
    /// flagged whatever their caption says now (<c>TcObjectModel.Explorer</c> says why).</param>
    /// <param name="inThisLoad">Asked only of a bare-captioned POU (by its path below the PLC project): is it a tree item
    /// of THIS load, which XAE survives a touch of? Answered by the system manager's path lookup
    /// (<c>TcObjectModel.Explorer</c>); without it every bare-captioned POU is untouchable.</param>
    public static ExplorerSnapshot From(ExplorerNode plcProject, IReadOnlyCollection<string>? stillUntouchable = null,
                                        Func<string, bool>? inThisLoad = null)
    {
        var guarded = new Dictionary<string, Guarded>(StringComparer.Ordinal);
        var listed = new Dictionary<string, int>(StringComparer.Ordinal);
        var pous = new HashSet<string>(StringComparer.Ordinal);
        Collect(plcProject, "", guarded, listed, pous,
                new HashSet<string>(stillUntouchable ?? Array.Empty<string>(), StringComparer.OrdinalIgnoreCase),
                inThisLoad ?? (_ => false));
        return new ExplorerSnapshot(guarded, listed, pous);
    }

    private static void Collect(ExplorerNode node, string path, Dictionary<string, Guarded> guarded,
                                Dictionary<string, int> listed, HashSet<string> pous, HashSet<string> still,
                                Func<string, bool> inThisLoad)
    {
        // A NODE THAT WAS NOT FULLY READ CANNOT BE VOUCHED FOR: a caption read as "" would pass a broken POU for a
        // parsed one, and a child list cut short would hide one. Refused, named — never read as "nothing to avoid".
        if (node.Unread is { } unread)
            throw new BridgeException(ConflictCodes.ItemUnverified,
                $"the Solution Explorer did not read '{(path.Length == 0 ? node.Name : path)}' in full ({unread}); Volt does " +
                "not walk the TwinCAT tree on a hierarchy that cannot vouch for every POU (DIALECT C2i)");
        listed[path] = node.Children.Count;
        var untouchable = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var child in node.Children)
        {
            var childPath = path.Length == 0 ? child.Name : path + "^" + child.Name;
            if (child.Unread is not null) Collect(child, childPath, guarded, listed, pous, still, inThisLoad);   // refuses it, named
            // Whether it is a POU at all is read from its canonical name: unread, it cannot be classified.
            if (child.Canonical is null)
                throw new BridgeException(ConflictCodes.ItemUnverified,
                    $"the Solution Explorer did not read the canonical name of '{childPath}'; Volt cannot tell whether it is " +
                    "a POU that crashes TcXaeShell, so it does not walk the TwinCAT tree (DIALECT C2i)");
            if ((IsPou(child) && still.Contains(childPath)) || (IsUnparsedPou(child) && !inThisLoad(childPath)))
            { untouchable.Add(child.Name); pous.Add(childPath); continue; }
            // A POU's own children are its members, which the tree reaches only through the POU itself.
            if (IsPou(child)) pous.Add(childPath);
            // A DUT and a folder may share a name (DIALECT D34), so two nodes have one path. A childless one (the DUT,
            // a GVL) states nothing a folder's count needs and must not overwrite it: it hid the folder's POUs (5Qa e2e).
            else if (child.Children.Count > 0 || !listed.ContainsKey(childPath)) Collect(child, childPath, guarded, listed, pous, still, inThisLoad);
        }
        if (untouchable.Count > 0)
            guarded[path] = new Guarded(node.Children.Select(c => c.Name).ToList(), untouchable);
    }

    private static bool IsPou(ExplorerNode n) =>
        n.Canonical!.EndsWith(".TcPOU", StringComparison.OrdinalIgnoreCase);

    /// <summary>A <c>.TcPOU</c> node captioned with its bare name: the IDE does not read its text as a POU.</summary>
    private static bool IsUnparsedPou(ExplorerNode n) =>
        IsPou(n) && string.Equals(n.Caption, n.Name, StringComparison.Ordinal);

    /// <summary>What a walk and a refusal say about such a POU — the FACT, and no client instruction: the same words
    /// reach a refusal raised inside a push's apply loop, which can now arrive on an accepted push, and the CLI adds its
    /// own advice from the code (openspec <c>push-keeps-what-landed</c> 2.5; "Push the fixed text with --force" was
    /// here).</summary>
    public static string Reason(string name) =>
        $"TwinCAT does not read '{name}' as a POU; touching its tree item crashes TcXaeShell after a load " +
        "(DIALECT C2i), so Volt does not read it.";

    /// <summary>The wire kind a <c>.TcPOU</c> is, known without opening it: a POU is ONE kind, <c>X.pou</c> (openspec
    /// <c>push-without-header-check</c> 5.Q), so an untouchable POU is named by its path like every item.</summary>
    public const string PouKind = ItemKind.Kinds.Pou;
}
