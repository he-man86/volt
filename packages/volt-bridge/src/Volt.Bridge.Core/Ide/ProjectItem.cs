namespace Volt.Bridge.Core.Ide;

/// <summary>One item discovered by <see cref="IProjectTree.WalkItems"/>: its stable wire identity
/// (<paramref name="Name"/>), the handle to reach it (<paramref name="Item"/>), its raw vendor-neutral
/// kind code (mapped to a wire string via <c>ItemKind.Map</c>), whether it is a top-level CRUD source
/// item, and its folder path within the project.</summary>
public sealed record ProjectItem(
    string Name,
    ItemRef Item,
    int KindCode,
    bool IsTopLevelCrud,
    string Folder);
