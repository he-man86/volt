using System.Collections.Generic;

namespace Volt.Engine.Ide;

/// <summary>What a project-tree walk found, AND whether it saw everything.
///
/// <para>Both drivers skip a subtree whose children cannot be enumerated rather than aborting the whole walk,
/// which is the right call — a transient COM fault on one folder should not fail a pull. What was missing is
/// that they never told the CALLER. <c>WalkItems()</c> returned a plain list, so a partial tree was
/// indistinguishable from a complete one, and `FetchService` computes deletions as "known to the client, absent
/// from this walk". A single faulting folder therefore reported every item beneath it as DELETED, and the pull
/// removed the engineer's files for POUs that were still in the IDE.</para>
///
/// <para>The evidence was there and unreachable: CODESYS logged the skip at Warn and TwinCAT at Debug — which is
/// off by default — and neither reached the code that had to act on it.</para>
/// </summary>
public sealed class WalkResult
{
    public WalkResult(IReadOnlyList<ProjectItem> items, IReadOnlyList<string> unwalkedFolders)
    {
        Items = items;
        UnwalkedFolders = unwalkedFolders;
    }

    /// <summary>The items the walk did see.</summary>
    public IReadOnlyList<ProjectItem> Items { get; }

    /// <summary>Folder paths whose contents could NOT be enumerated. Each one means "there may be items under
    /// here that this walk did not see" — never "these are gone".</summary>
    public IReadOnlyList<string> UnwalkedFolders { get; }

    /// <summary>True when the walk saw the whole tree, so absence from <see cref="Items"/> is meaningful.</summary>
    public bool Complete => UnwalkedFolders.Count == 0;

    /// <summary>A complete walk — the ordinary case, and what every fake and in-memory tree produces.</summary>
    public static WalkResult Whole(IReadOnlyList<ProjectItem> items) =>
        new WalkResult(items, System.Array.Empty<string>());
}
