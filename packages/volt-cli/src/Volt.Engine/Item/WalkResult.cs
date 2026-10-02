using System.Collections.Generic;
using System.Linq;

namespace Volt.Engine.Item;

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
///
/// <para><b>One object the walk cannot even CLASSIFY never fails the walk</b> (openspec
/// <c>codesys-refs-guid-int32</c>). The CODESYS walk read every child's object to learn its kind with no guard, so
/// one failed read threw out of <c>WalkItems</c> and <c>refs</c> answered <c>INTERNAL_ERROR</c> for the whole
/// project. Such an object is <see cref="UnreadableObjects"/> — by NAME, so <c>refs</c>/<c>fetch</c> can list it
/// as unreadable — and its folder counts as not fully read (<see cref="UnwalkedFolders"/>): its kind is unknown,
/// so neither its own file nor, if it is a container, anything beneath it may be read as deleted.</para>
/// </summary>
public sealed class WalkResult
{
    public WalkResult(IReadOnlyList<ProjectItem> items, IReadOnlyList<string> unwalkedFolders,
                      IReadOnlyList<UnreadableObject> unreadableObjects)
    {
        Items = items;
        UnreadableObjects = unreadableObjects;
        // DERIVED here, once, for both drivers: a driver that records the object cannot forget its folder — nor its
        // OWN subtree, which the walk never entered (its kind is unknown, so it may be a container: CODESYS's root
        // children are the Device node(s)). The parent alone is not enough at the root: for a root-level object
        // that is "", and the subtree is named explicitly so the unwalked list says where the walk stopped.
        // NOT for an object whose kind FAMILY the vendor stated without it being read (<see cref="UnreadableObject.Kinds"/>):
        // it is no container, so its folder was walked whole and absence beside it still means deleted; its own known
        // name is kept by the removal pass, which matches it by those kinds.
        UnwalkedFolders = unwalkedFolders
            .Concat(unreadableObjects.Where(o => o.Kinds is null).SelectMany(o => new[] { o.Folder, FolderPath.Append(o.Folder, o.Name) }))
            .Distinct().ToList();
    }

    /// <summary>The items the walk did see.</summary>
    public IReadOnlyList<ProjectItem> Items { get; }

    /// <summary>Folder paths whose contents could NOT be enumerated — or held an object whose kind could not be
    /// read. Each one means "there may be items under here that this walk did not see" — never "these are
    /// gone".</summary>
    public IReadOnlyList<string> UnwalkedFolders { get; }

    /// <summary>Objects the walk SAW and could not classify — their kind is unknown, so they are in no version map
    /// under a full name; the read ops publish them in <c>unreadable</c> by bare name.</summary>
    public IReadOnlyList<UnreadableObject> UnreadableObjects { get; }

    /// <summary>True when the walk saw the whole tree, so absence from <see cref="Items"/> is meaningful.</summary>
    public bool Complete => UnwalkedFolders.Count == 0;

}

/// <summary>An object the walk found at <paramref name="Folder"/> and could not read the kind of, and why.
/// <para><paramref name="Kinds"/>: null when nothing is known of what it is (it may even be a container). Set when the
/// vendor names the object's kind family WITHOUT the object being read — a TwinCAT POU Volt must not touch (DIALECT
/// C2i) is a program, a function block or a function. Then its folder counts as walked, and a known name of one of
/// these kinds is kept, never read as deleted (<c>Removal</c>).</para></summary>
public sealed record UnreadableObject(string Name, string Folder, string Reason, IReadOnlyList<string>? Kinds = null);
