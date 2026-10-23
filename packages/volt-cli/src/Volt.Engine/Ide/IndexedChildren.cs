using System;
using System.Collections;
using System.Collections.Generic;
using Volt.Engine.Item;

namespace Volt.Engine.Ide;

/// <summary>A node's children (<c>IVendorTree.Children</c>) for a host that reads them by count and index: each child
/// is read only when the engine indexes it, so a child
/// the host names but must not open throws its <see cref="UnreadableItemException"/> at its index, and a fault reading one
/// child is that child's.</summary>
public sealed class IndexedChildren : IReadOnlyList<ItemRef>
{
    private readonly Func<int, ItemRef> _at;

    /// <param name="at">The child at a ONE-based index.</param>
    public IndexedChildren(int count, Func<int, ItemRef> at) { Count = count; _at = at; }

    public int Count { get; }
    public ItemRef this[int index] => _at(index + 1);
    public IEnumerator<ItemRef> GetEnumerator() { for (var i = 0; i < Count; i++) yield return this[i]; }
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}
