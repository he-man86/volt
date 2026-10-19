using System.Linq;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Tests.Shared
{
    /// <summary>
    /// ONE TREE NODE IS AT MOST ONE <c>unreadableNodes</c> ENTRY (openspec <c>library-manager-one-node-entry</c>). A
    /// container holding several facts no text spells joins them into one reason; listed once per fact, the node took
    /// a version slot per fact. A test gate, not a runtime check: every offline CODESYS and TwinCAT walk passes through
    /// it. Two objects of one name and different kinds stay two entries (item kinds, and a kind-less object, are not
    /// folders).
    /// </summary>
    public static class OneEntryPerNode
    {
        /// <summary>Assert no node path appears twice as a folder-kind entry of <paramref name="walk"/>; return it.</summary>
        public static WalkResult Gated(this WalkResult walk)
        {
            var twice = walk.UnreadableObjects
                .Where(o => o.Kind == ItemKind.Kinds.Folder)
                .GroupBy(o => FolderPath.Append(o.Folder, o.Name), System.StringComparer.Ordinal)
                .Where(g => g.Count() > 1)
                .Select(g => $"{g.Key} ({g.Count()}×: {string.Join(" | ", g.Select(o => o.Reason))})")
                .ToList();
            Assert.True(twice.Count == 0, "a node is listed more than once in unreadableNodes: " + string.Join("; ", twice));
            return walk;
        }
    }
}
