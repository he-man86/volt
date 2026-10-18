
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;
namespace Volt.Engine.Ide;

/// <summary>
/// Find a TOP-LEVEL item by its PATH — <c>&lt;folder&gt;/&lt;name&gt;.&lt;kind&gt;</c>, the identity the wire publishes: the
/// descent to its folder and a scan of that folder alone for the object of that name AND that kind, over the tree contract
/// every driver already implements. Never a search of the whole tree (openspec <c>multi-application-tree</c>, design §4):
/// two applications each holding <c>PLC_PRG</c> are two items, and only the folder tells which one an op names. The kind
/// is part of the identity (openspec <c>unreadable-name-carries-kind</c> 1.7): <c>X.dut</c> never resolves to an object
/// <c>X</c> of another kind, readable or not.
/// <list type="bullet">
/// <item><b>Case-insensitively</b>: IEC 61131-3 identifiers are case-insensitive and both IDEs treat them so —
/// pushing <c>fb_Motor</c> at an IDE holding <c>FB_Motor</c> must find it, not CREATE a second one.</item>
/// <item><b>Top-level CRUD kinds only</b>: the caller asks "does this item already exist", so a METHOD that shares a
/// POU's name must not answer.</item>
/// </list>
/// <para>Shared rather than per driver, so it runs against <c>FakeIde</c> in the offline suite. <see cref="Find"/> and
/// <see cref="All"/> are ONE walk (<see cref="Walk"/>) with two visitors, so the fault-is-not-absence rule exists
/// once.</para>
/// </summary>
public static class ItemLookup
{
    /// <summary>Depth guard against a cyclic or pathologically nested tree, not a limit any real project reaches.</summary>
    private const int MaxDepth = 14;

    /// <summary>The top-level item at <paramref name="path"/> — its wire path, the folder as the walk spells it — or
    /// null.
    /// <para>Descends from <see cref="IProjectTree.GetTreeRoot"/> — the same origin both driver walks use, and the one
    /// the push's paths are measured from, so lookup and placement agree about where the tree starts — matching each
    /// container by name as the push's placement does (<c>TreeNav</c>). A folder that is not there holds no item:
    /// null.</para></summary>
    public static ItemRef? Find(IProjectTree tree, string path)
    {
        var (item, untouchable) = Locate(tree, path);
        if (untouchable is { } u)
            throw new BridgeException(BridgeErrorCodes.Unreadable, $"'{u.Name}' is not read: {u.Reason}");
        return item;
    }

    /// <summary>A top-level item the driver names but must not open (<see cref="UnreadableItemException"/>), with the
    /// parent it sits under — the one handle through which it can still be deleted, by name, without being touched.</summary>
    public sealed record Untouchable(ItemRef Parent, string Name, string Reason, string Kind);

    /// <summary>Like <see cref="Find"/>, but an item the driver must not open is ANSWERED rather than refused: the
    /// handle, or the <see cref="Untouchable"/> it is, or neither (absent). For the push's forced ops, the only callers
    /// allowed past an unreadable item: they delete it through its parent, by name.</summary>
    public static (ItemRef? Item, Untouchable? Untouchable) Locate(IProjectTree tree, string path)
    {
        var file = ItemPath.FileOf(path);
        var kind = ItemKind.KindForWireName(path)
                   ?? throw new System.ArgumentException($"'{path}' is not a wire path: its extension names no kind", nameof(path));
        var doing = $"looking for '{path}'";
        var folderPath = ItemPath.FolderOf(path);
        if (Descend(tree, folderPath, doing) is not { } folder) return (null, null);
        ItemRef? hit = null;
        Untouchable? untouchable = null;
        Scan(tree, folder, doing, (item, itemName, code) =>
        {
            if (!ItemKind.IsAddressableItem(code) || ItemKind.Map(code) != kind || !Names(itemName, file)) return true;
            hit = item;
            return false;
        }, (parent, u) =>
        {
            if (u.Kind != kind || !Names(u.Name, file)) return true;
            untouchable = new Untouchable(parent, u.Name, u.Reason, u.Kind);
            return false;
        }, FolderPath.Segments(folderPath).Count());
        return (hit, untouchable);
    }

    /// <summary>Is the IDE's <paramref name="ideName"/> the object a wire <paramref name="file"/> names? Its bare name, or
    /// the file name itself for a kind the IDE names by its file (<c>Untitled2.tmc</c>) — the inverse of how the walk
    /// mints the path (<c>Versioning.PathOf</c>). Ignoring case, as the IDE resolves a name.</summary>
    private static bool Names(string ideName, string file) =>
        string.Equals(ideName, ItemPath.BareOf(file), System.StringComparison.OrdinalIgnoreCase)
        || string.Equals(ideName, file, System.StringComparison.OrdinalIgnoreCase);

    /// <summary>The node at the encoded <paramref name="folder"/>, descended from the tree root one container per
    /// segment (a structural node, a container-manager, a user folder — anything that is not a top-level item, as the
    /// push's placement matches them), or null when a segment is not there. A read the IDE refuses is not absence:
    /// <c>ITEM_UNVERIFIED</c>, as for every lookup here.</summary>
    private static ItemRef? Descend(IProjectTree tree, string folder, string doing)
    {
        var node = tree.GetTreeRoot();
        var depth = 0;
        foreach (var segment in FolderPath.Segments(folder))
        {
            ItemRef? next = null;
            Scan(tree, node, doing, (child, childName, kind) =>
            {
                if (ItemKind.IsTopLevelCrud(kind) || !string.Equals(childName, segment, System.StringComparison.OrdinalIgnoreCase))
                    return true;
                next = child;
                return false;
            }, (_, _) => true, depth);
            if (next is not { } found) return null;
            node = found;
            depth++;
        }
        return node;
    }

    /// <summary>Visit every DIRECT child of <paramref name="node"/> with its name and kind until <paramref name="visit"/>
    /// answers false — the one child scan the descent and the lookup share, with <see cref="Walk"/>'s fault rules.</summary>
    private static void Scan(IProjectTree tree, ItemRef node, string doing, System.Func<ItemRef, string, int, bool> visit,
                             System.Func<ItemRef, UnreadableItemException, bool> visitUntouchable, int depth = 1)
    {
        int count;
        try { count = tree.ChildCount(node); }
        catch (System.Exception ex) when (ex is not ICodedError)
        {
            throw new BridgeException(ConflictCodes.ItemUnverified,
                $"could not read the children of {Place(tree, node, depth)} while {doing} — the IDE refused the read " +
                $"({ex.Message}). Refusing to report it as absent.", ex);
        }
        for (var i = 1; i <= count; i++)
        {
            ItemRef child;
            int kind;
            try
            {
                child = tree.ChildAt(node, i);
                kind = tree.KindCode(child);
            }
            catch (UnreadableItemException untouchable)
            {
                if (!visitUntouchable(node, untouchable)) return;
                continue;
            }
            catch (System.Exception ex) when (ex is not ICodedError)
            {
                throw new BridgeException(ConflictCodes.ItemUnverified,
                    $"could not read child {i} of {Place(tree, node, depth)} while {doing} — the IDE refused the read " +
                    $"({ex.Message}). Refusing to report it as absent.", ex);
            }
            string name;
            try { name = tree.Name(child); }
            catch (System.Exception ex) when (ex is not ICodedError)
            {
                throw new BridgeException(ConflictCodes.ItemUnverified,
                    $"could not read the name of child {i} of {Place(tree, node, depth)} while {doing} — the IDE refused " +
                    $"the read ({ex.Message}). Refusing to report it as absent.", ex);
            }
            if (!visit(child, name, kind)) return;
        }
    }

    /// <summary>Every top-level item in the whole tree — its handle, name and tree kind — in ONE walk. For a caller asking
    /// about many names (the declarations index, <see cref="ProjectDeclarations"/>), where a <see cref="Find"/> per name
    /// is a descent per name.</summary>
    public static IReadOnlyList<(ItemRef Item, string Name, int Kind)> All(IProjectTree tree)
    {
        var found = new List<(ItemRef, string, int)>();
        Walk(tree, tree.GetTreeRoot(), "listing the project's items", 0, (item, name, kind) =>
        {
            found.Add((item, name, kind));
            return true;
        },
        // An item the driver must not open is not listed: nothing can be read from it, and every walk names it in
        // `unreadable` already. It is a POU, never a folder, so nothing is hidden beneath it.
        (_, _) => true);
        return found;
    }

    /// <summary>
    /// Visit every top-level item under <paramref name="node"/> until <paramref name="visit"/> answers false; whether
    /// the walk was stopped.
    ///
    /// <para><b>A fault is NOT absence.</b> Every caller reads a missing answer as "no such item" — <c>PushService</c>
    /// reads Find's null as "create one", so a swallowed read fault made a push CREATE an item that already existed,
    /// which on a bare-name-keyed vendor is a duplicate or an overwrite, from a push reporting success; and a list
    /// that silently missed a folder answers "no such global" for one that exists. Skipping is right for a WALK of
    /// the project (one bad folder must not fail a pull, and that path reports its incompleteness through
    /// <c>WalkResult</c>); a lookup was asked a question and cannot answer it. So an unreadable child count, child or
    /// name throws.</para>
    ///
    /// <para><b>It recurses through everything that is NOT itself a top-level item</b>: user folders, and the
    /// structural spine a vendor puts above them (CODESYS's Device / Plc Logic / Application are plain nodes, not
    /// folders, which is why "recurse only into folders" would never have found anything there). Stopping AT a
    /// top-level item is what keeps this off a POU's methods — the walk that made TwinCAT's version cheap,
    /// generalized.</para>
    ///
    /// <para><b>A CODED refusal passes through with its code.</b> A driver that already said what is wrong — TwinCAT's
    /// C2i guard refusing a folder the hierarchy does not vouch for (<c>ITEM_UNVERIFIED</c>) — was re-coded
    /// <c>INTERNAL_ERROR</c> here, so the push's conflict blamed Volt for an IDE state (openspec
    /// <c>bridge-refusal-review</c> 7.1). Its message already names the folder.</para>
    ///
    /// <para><b>An UNCODED fault (a raw COM or binder throw) is <c>ITEM_UNVERIFIED</c> too</b> — the same situation met
    /// another way: the IDE refused a read the lookup needed, so the push could not read where the item lives, and the
    /// remedy is the IDE's, not a Volt bug report (it was <c>INTERNAL_ERROR</c>; openspec <c>bridge-refusal-review</c>
    /// V.1). The message names the item looked for, the FOLDER whose read the IDE refused (the remedy is that folder's,
    /// and a lookup's folder is never in a walk's <c>unwalkedFolders</c>), and the IDE's own words; the IDE's exception
    /// travels as the inner one, so a vendor that degrades its session on a dead channel (TwinCAT's RPC faults,
    /// <c>BeckhoffDriver.IsRpcFault</c> walks the inner chain) still sees it (review of step V).</para>
    /// </summary>
    private static bool Walk(IProjectTree tree, ItemRef node, string doing, int depth, System.Func<ItemRef, string, int, bool> visit,
                             System.Func<ItemRef, UnreadableItemException, bool> visitUntouchable)
    {
        if (depth > MaxDepth) return true;
        int count;
        try { count = tree.ChildCount(node); }
        catch (System.Exception ex) when (ex is not ICodedError)
        {
            throw new BridgeException(ConflictCodes.ItemUnverified,
                $"could not read the children of {Place(tree, node, depth)} while {doing} — the IDE refused the read " +
                $"({ex.Message}). Refusing to report it as absent.", ex);
        }

        for (var i = 1; i <= count; i++)
        {
            ItemRef child;
            int kind;
            try
            {
                child = tree.ChildAt(node, i);
                kind = tree.KindCode(child);
            }
            // NOT a read fault: the driver named a child it must not open (DIALECT C2i) and made no call. It is known to
            // exist and to be a top-level item, so the lookup does not refuse over it: it is the answer when it is the
            // name asked for, and skipped otherwise, so the items beside it stay reachable.
            catch (UnreadableItemException untouchable)
            {
                if (!visitUntouchable(node, untouchable)) return false;
                continue;
            }
            catch (System.Exception ex) when (ex is not ICodedError)
            {
                throw new BridgeException(ConflictCodes.ItemUnverified,
                    $"could not read child {i} of {Place(tree, node, depth)} while {doing} — the IDE refused the read " +
                    $"({ex.Message}). Refusing to report it as absent.", ex);
            }

            if (!ItemKind.IsAddressableItem(kind))
            {
                if (!Walk(tree, child, doing, depth + 1, visit, visitUntouchable)) return false;
                continue;
            }

            string name;
            try { name = tree.Name(child); }
            catch (System.Exception ex) when (ex is not ICodedError)
            {
                throw new BridgeException(ConflictCodes.ItemUnverified,
                    $"could not read the name of child {i} of {Place(tree, node, depth)} while {doing} — the IDE refused " +
                    $"the read ({ex.Message}). Refusing to report it as absent.", ex);
            }
            if (!visit(child, name, kind)) return false;
        }
        return true;
    }

    /// <summary>The folder a refused read was IN, for the refusal's message. Read only after a read has already failed,
    /// so a lookup that succeeds pays nothing for it. The walk's root is the project root; a folder whose name the IDE
    /// refuses too is said to be exactly that, with the IDE's words.</summary>
    private static string Place(IProjectTree tree, ItemRef node, int depth)
    {
        if (depth == 0) return "the project root";
        try { return $"the folder '{tree.Name(node)}'"; }
        catch (System.Exception ex) when (ex is not ICodedError)
        {
            return $"a folder whose name the IDE refused to read too ({ex.Message})";
        }
    }
}
