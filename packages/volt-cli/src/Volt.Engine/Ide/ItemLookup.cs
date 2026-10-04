
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;
namespace Volt.Engine.Ide;

/// <summary>
/// Find a TOP-LEVEL item by name — one walk, over the tree contract every driver already implements.
/// <para>It was two walks with two different answers, neither of them tested, and the differences were not
/// choices anybody made:</para>
/// <list type="bullet">
/// <item>CODESYS matched <b>case-sensitively</b>; TwinCAT case-insensitively. IEC 61131-3 identifiers are
/// case-insensitive and both IDEs treat them so, and every other name comparison on this wire already uses
/// <c>OrdinalIgnoreCase</c> — the push's own child reconciliation does. So the sensitive one was simply wrong:
/// pushing <c>fb_Motor</c> at an IDE holding <c>FB_Motor</c> found nothing and tried to CREATE it.</item>
/// <item>CODESYS matched <b>any</b> non-transient node at any depth; TwinCAT only the six top-level CRUD kinds.
/// The only caller is the push's "does this item already exist" question, which is about top-level items — so
/// the broad one could answer with a METHOD that happens to share a POU's name.</item>
/// </list>
/// <para>Both semantics live here now, taken from whichever side had it right, and — the actual point — this
/// runs against <c>FakeIde</c> in the offline suite. Neither driver's copy was executed by a single C# test.
/// <see cref="Find"/> and <see cref="All"/> are ONE walk (<see cref="Walk"/>) with two visitors: when they were two
/// copies of the descent, each carried its own copy of the fault-is-not-absence rule, which is how the drivers' copies
/// drifted before.</para>
/// </summary>
public static class ItemLookup
{
    /// <summary>Depth guard against a cyclic or pathologically nested tree, not a limit any real project reaches.
    /// CODESYS's walk carried it; TwinCAT's did not, and gains it here.</summary>
    private const int MaxDepth = 14;

    /// <summary>The top-level item named <paramref name="name"/>, or null.
    /// <para>Descends from <see cref="IProjectTree.GetTreeRoot"/> — the same origin both driver walks used, and
    /// the one the push's <c>toFolder</c> paths are measured from, so lookup and placement agree about where the
    /// tree starts.</para></summary>
    public static ItemRef? Find(IProjectTree tree, string name)
    {
        var (item, untouchable) = Locate(tree, name);
        if (untouchable is { } u)
            throw new BridgeException(BridgeErrorCodes.Unreadable, $"'{u.Name}' is not read: {u.Reason}");
        return item;
    }

    /// <summary>A top-level item the driver names but must not open (<see cref="UnreadableItemException"/>), with the
    /// parent it sits under — the one handle through which it can still be deleted, by name, without being touched.</summary>
    public sealed record Untouchable(ItemRef Parent, string Name, string Reason, System.Collections.Generic.IReadOnlyList<string> Kinds);

    /// <summary>Like <see cref="Find"/>, but an item the driver must not open is ANSWERED rather than refused: the
    /// handle, or the <see cref="Untouchable"/> it is, or neither (absent). For the push's forced ops, the only callers
    /// allowed past an unreadable item: they delete it through its parent, by name.</summary>
    public static (ItemRef? Item, Untouchable? Untouchable) Locate(IProjectTree tree, string name)
    {
        ItemRef? hit = null;
        Untouchable? untouchable = null;
        Walk(tree, tree.GetTreeRoot(), $"looking for '{name}'", 0, (item, itemName, _) =>
        {
            if (!string.Equals(itemName, name, System.StringComparison.OrdinalIgnoreCase)) return true;
            hit = item;
            return false;
        }, (parent, u) =>
        {
            if (!string.Equals(u.Name, name, System.StringComparison.OrdinalIgnoreCase)) return true;
            untouchable = new Untouchable(parent, u.Name, u.Reason, u.Kinds);
            return false;
        });
        return (hit, untouchable);
    }

    /// <summary>Every top-level item — its handle, name and tree kind — in ONE walk. For a caller asking about many
    /// names, where a <see cref="Find"/> per name is a walk per name.</summary>
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
    /// <para><b>A CODED refusal passes through with its code.</b> Only an UNCODED fault (a raw COM or binder throw) is
    /// wrapped as <c>INTERNAL_ERROR</c>. A driver that already said what is wrong — TwinCAT's C2i guard refusing a folder
    /// the hierarchy does not vouch for (<c>ITEM_UNVERIFIED</c>) — was re-coded <c>INTERNAL_ERROR</c> here, so the push's
    /// conflict blamed Volt for an IDE state (openspec <c>bridge-refusal-review</c> 7.1). Its message already names the
    /// folder.</para>
    /// </summary>
    private static bool Walk(IProjectTree tree, ItemRef node, string doing, int depth, System.Func<ItemRef, string, int, bool> visit,
                             System.Func<ItemRef, UnreadableItemException, bool> visitUntouchable)
    {
        if (depth > MaxDepth) return true;
        int count;
        try { count = tree.ChildCount(node); }
        catch (System.Exception ex) when (ex is not ICodedError)
        {
            throw new BridgeException(BridgeErrorCodes.InternalError,
                $"could not read the project tree while {doing} — the IDE refused a child read ({ex.Message}). " +
                "Refusing to report it as absent.");
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
                throw new BridgeException(BridgeErrorCodes.InternalError,
                    $"could not read child {i} while {doing} — the IDE refused the read ({ex.Message}). " +
                    "Refusing to report it as absent.");
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
                throw new BridgeException(BridgeErrorCodes.InternalError,
                    $"could not read the name of child {i} while {doing} — the IDE refused the read ({ex.Message}). " +
                    "Refusing to report it as absent.");
            }
            if (!visit(child, name, kind)) return false;
        }
        return true;
    }
}
