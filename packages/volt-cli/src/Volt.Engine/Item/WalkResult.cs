using System.Collections.Generic;
using System.Linq;

namespace Volt.Engine.Item;

/// <summary>What a project-tree walk found, AND whether it saw everything.
///
/// <para>Both drivers skip a subtree whose children cannot be enumerated rather than aborting the whole walk — a
/// transient COM fault on one folder should not fail a pull — and say so HERE, to the caller. `FetchService` computes
/// deletions as "known to the client, absent from this walk", so a partial tree read as complete would report every
/// item beneath a faulting folder as DELETED, and the pull would remove files for POUs still in the IDE. A log line
/// does not reach the code that has to act on it; this result does.</para>
///
/// <para><b>One object the walk cannot even CLASSIFY never fails the walk</b> (openspec
/// <c>codesys-refs-guid-int32</c>). The CODESYS walk read every child's object to learn its kind with no guard, so
/// one failed read threw out of <c>WalkItems</c> and <c>refs</c> answered <c>INTERNAL_ERROR</c> for the whole
/// project. Such an object is <see cref="UnreadableObjects"/> with no kind, and its folder counts as not fully read
/// (<see cref="UnwalkedFolders"/>): its kind is unknown, so neither its own file nor, if it is a container, anything
/// beneath it may be read as deleted.</para>
/// </summary>
public sealed class WalkResult
{
    public WalkResult(IReadOnlyList<ProjectItem> items, IReadOnlyList<string> unwalkedFolders,
                      IReadOnlyList<UnreadableObject> unreadableObjects, IReadOnlyList<string> applications)
    {
        Items = items;
        UnreadableObjects = unreadableObjects;
        Applications = applications;
        // DERIVED here, once, for both drivers: a driver that records an object of unknown kind cannot forget its folder
        // — nor its OWN subtree, which the walk never entered (its kind is unknown, so it may be a container: CODESYS's
        // root children are the Device node(s)). The parent alone is not enough at the root: for a root-level object
        // that is "", and the subtree is named explicitly so the unwalked list says where the walk stopped.
        // NOT for an object whose kind the vendor stated (<see cref="UnreadableObject.Kind"/>): an item's folder was
        // walked whole and absence beside it still means deleted; a container that stops the walk states its own
        // subtree unwalked where it stops it.
        UnwalkedFolders = unwalkedFolders
            .Concat(unreadableObjects.Where(o => o.Kind is null).SelectMany(o => new[] { o.Folder, FolderPath.Append(o.Folder, o.Name) }))
            .Distinct().ToList();
    }

    /// <summary>The items the walk did see.</summary>
    public IReadOnlyList<ProjectItem> Items { get; }

    /// <summary>Folder paths whose contents could NOT be enumerated — or held an object whose kind could not be
    /// read. Each one means "there may be items under here that this walk did not see" — never "these are
    /// gone".</summary>
    public IReadOnlyList<string> UnwalkedFolders { get; }

    /// <summary>Objects the walk SAW and did not read: an item of known kind it could not or must not read (the read ops
    /// publish it in <c>unreadable</c> by its path), or a tree node with no file — a container holding what no text
    /// spells, or an object whose kind is unknown (<c>unreadableNodes</c>, by its node path).</summary>
    public IReadOnlyList<UnreadableObject> UnreadableObjects { get; }

    /// <summary>The root folder of every APPLICATION the walk passed (CODESYS: each <c>IApplicationObject</c>; TwinCAT:
    /// each PLC project), as the walk spells folders — stated by the driver, which knows its vendor's node kinds, so no
    /// layer above it parses a vendor segment such as <c>Plc Logic</c> (openspec <c>multi-application-tree</c>, design
    /// §3). An item belongs to the application whose root is the longest prefix of its path (<see cref="ItemPath.ApplicationOf"/>);
    /// one under none (the CODESYS POU pool) to the pool.</summary>
    public IReadOnlyList<string> Applications { get; }

    /// <summary>True when the walk saw the whole tree, so absence from <see cref="Items"/> is meaningful.</summary>
    public bool Complete => UnwalkedFolders.Count == 0;

    /// <summary>This walk in the contract's words, its kinds as strings. An unmapped code and a container manager (a library,
    /// recipe or visualization manager: a folder, never an item) become no <see cref="Seam.WalkedItem"/>; unwalked,
    /// unreadable and applications unchanged.</summary>
    public Seam.HostWalk ToHostWalk()
    {
        var items = new List<Seam.WalkedItem>(Items.Count);
        foreach (var it in Items)
        {
            if (ItemKind.Map(it.KindCode) is not { } kind)
            {
                Volt.Contracts.VoltLog.Debug($"walk skip: unmapped-kind '{it.Name}' (kindCode={it.KindCode})");
                continue;
            }
            if (ItemKind.IsContainerManager(it.KindCode)) continue;
            items.Add(new Seam.WalkedItem(it.Name, it.Item, kind, it.Folder));
        }
        return new Seam.HostWalk(items, UnwalkedFolders, UnreadableObjects, Applications);
    }
}

/// <summary>An object the walk found at <paramref name="Folder"/> and did not read, and why.
/// <para><paramref name="Kind"/> is what the object IS, as the IDE's tree states it: an item's kind (<see cref="ItemKind.Kinds"/>),
/// whose path is then <c>&lt;folder&gt;/&lt;name&gt;.&lt;kind&gt;</c> like every item's; <see cref="ItemKind.Kinds.Folder"/>
/// for a container node, which has no file; or null when the IDE failed to answer what its own object is — then nothing
/// is known of it (it may even be a container) and its folder and subtree count as unwalked.</para></summary>
public sealed record UnreadableObject(string Name, string Folder, string Reason, string? Kind);
