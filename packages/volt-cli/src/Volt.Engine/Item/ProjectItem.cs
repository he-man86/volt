namespace Volt.Engine.Item;

/// <summary>One item discovered by <see cref="IProjectTree.WalkItems"/>: its stable wire identity
/// (<paramref name="Name"/>), the handle to reach it (<paramref name="Item"/>), its raw vendor-neutral
/// kind code (mapped to a wire string via <c>ItemKind.Map</c>), and its folder path within the project.
/// Whether it is a top-level CRUD source item is <c>ItemKind.IsTopLevelCrud(KindCode)</c> — derived at the
/// consumer, not stored. Exclude-from-build is NOT modeled: an excluded object is synced as an ordinary file
/// like any other — the bridge draws no distinction.</summary>
public sealed record ProjectItem(
    string Name,
    ItemRef Item,
    int KindCode,
    string Folder);
