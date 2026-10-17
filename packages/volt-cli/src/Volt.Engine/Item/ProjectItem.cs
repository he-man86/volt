namespace Volt.Engine.Item;

/// <summary>One item discovered by <see cref="IProjectTree.WalkItems"/>: its BARE name (<paramref name="Name"/>, the IDE's
/// lookup key inside <paramref name="Folder"/>; the wire identity is the path, <c>Versioning.VersionedItem.Identity</c>), the handle to reach it (<paramref name="Item"/>), its raw vendor-neutral
/// kind code (mapped to a wire string via <c>ItemKind.Map</c>), and its folder path within the project.
/// Whether it is a top-level CRUD source item is <c>ItemKind.IsTopLevelCrud(KindCode)</c> — derived at the
/// consumer, not stored. An object excluded from build syncs as an ordinary file; its exclusion is one of its
/// properties (<c>ObjectProperties.ExcludeFromBuild</c>, the <c>%EXCLUDE_FROM_BUILD</c> line).</summary>
public sealed record ProjectItem(
    string Name,
    ItemRef Item,
    int KindCode,
    string Folder);
