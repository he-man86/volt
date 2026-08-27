
using Volt.Contracts;
using Volt.Engine.Vocabulary;
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
/// runs against <c>FakeIde</c> in the offline suite. Neither driver's copy was executed by a single C# test.</para>
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
    public static ItemRef? Find(IProjectTree tree, string name) =>
        Find(tree, tree.GetTreeRoot(), name, 0);

    private static ItemRef? Find(IProjectTree tree, ItemRef node, string name, int depth)
    {
        if (depth > MaxDepth) return null;
        int count;
        // An unreadable subtree is a leaf, not a crash. Both drivers guarded their ChildCount this way (TwinCAT
        // in the member itself, CODESYS at its call sites); doing it once here is why they no longer have to.
        // A fault is NOT absence. Null is this method's only channel and every caller reads it as "no such
        // item" — `PushService` reads it as "create one", so a swallowed read fault made a push CREATE an item
        // that already existed, which on a bare-name-keyed vendor is a duplicate or an overwrite, from a push
        // reporting success. Skipping is right for a WALK (one bad folder must not fail a pull, and that path
        // reports its incompleteness through WalkResult); a single-item lookup was asked one question and cannot
        // answer it.
        try { count = tree.ChildCount(node); }
        catch (System.Exception ex)
        {
            throw new BridgeException(BridgeErrorCodes.InternalError,
                $"could not read the project tree while looking for '{name}' — the IDE refused a child read " +
                $"({ex.Message}). Refusing to report it as absent.");
        }

        for (var i = 1; i <= count; i++)
        {
            ItemRef child;
            string childName;
            int kind;
            try
            {
                child = tree.ChildAt(node, i);
                childName = tree.Name(child);
                kind = tree.KindCode(child);   // one read, used by both tests below
            }
            catch (System.Exception ex)
            {
                // Same rule one level down: a child that cannot be READ is not a child that is not THERE, and
                // this loop is how `name` would have been recognised.
                throw new BridgeException(BridgeErrorCodes.InternalError,
                    $"could not read child {i} while looking for '{name}' — the IDE refused the read " +
                    $"({ex.Message}). Refusing to report it as absent.");
            }

            if (ItemKind.IsTopLevelCrud(kind) &&
                string.Equals(childName, name, System.StringComparison.OrdinalIgnoreCase))
                return child;

            // Recurse through everything that is NOT itself a top-level item: user folders, and the structural
            // spine a vendor puts above them (CODESYS's Device / Plc Logic / Application are plain nodes, not
            // folders, which is why "recurse only into folders" would never have found anything there).
            // Stopping AT a top-level item is what keeps this off a POU's methods — the walk that made TwinCAT's
            // version cheap, generalized.
            if (ItemKind.IsTopLevelCrud(kind)) continue;
            if (Find(tree, child, name, depth + 1) is { } hit) return hit;
        }
        return null;
    }
}
