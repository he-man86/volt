using System;
using System.Collections.Generic;
using Volt.Engine.Item;

namespace Volt.Engine.Ide;

/// <summary>Where a POU's members live in the project tree.
///
/// <para>Shared, not vendor code: it needs only <c>ChildCount</c>, <c>ChildAt</c>, <c>Name</c> and <c>KindCode</c>, all
/// on <see cref="IProjectTree"/>, and a per-driver copy is how the two drivers drift apart.</para>
///
/// <para>Public rather than internal because both drivers are separate assemblies. <c>TreeNav</c> next door is
/// internal and stays that way — nothing outside the engine navigates the tree.</para>
/// </summary>
public static class MemberSites
{
    /// <summary>A member and the POU-internal folder it sits in.</summary>
    public readonly struct Site
    {
        public Site(string? folder, ItemRef itemRef, string name, int code)
        { Folder = folder; Ref = itemRef; Name = name; Code = code; }

        /// <summary>The POU-internal folder path, or null at the POU root. NULL AND EMPTY ARE DIFFERENT here:
        /// null means "no folder", and the writer emits no <c>%FOLDER</c> directive for it.</summary>
        public string? Folder { get; }
        public ItemRef Ref { get; }
        public string Name { get; }
        public int Code { get; }
    }

    /// <summary>Every member of a POU and the folder it sits in, walked off the project TREE.
    ///
    /// <para><b>No catch, deliberately.</b> A swallowed fault here does not degrade gracefully — it MUTATES the
    /// project on the next push. A member the walk failed to reach materializes with a null folder, the writer
    /// emits no <c>%FOLDER</c> directive, the pulled file looks legitimately folder-less, and the next push
    /// resolves that null to the POU ROOT and creates a DUPLICATE beside the real member. Because the version
    /// hash is taken over the folder-less text, <c>volt status</c> reports clean the whole way through. A partial
    /// map is not a degraded answer, it is a wrong one. The isolation boundary is one level up, in
    /// <see cref="Sync.Versioning"/>, which catches per item and logs which one.</para>
    ///
    /// <para>Accessors are NOT members: a property's GET/SET are read with the property. Neither is a transition
    /// — it is inlined in the POU, no reader models one, so it can never appear in a pushed member set, and
    /// yielding it here would put it in the reconciliation where a push would then DELETE it.</para></summary>
    public static IEnumerable<Site> Of(IProjectTree tree, ItemRef parent, string basePath = "")
    {
        int count = tree.ChildCount(parent);
        for (int i = 1; i <= count; i++)
        {
            var child = tree.ChildAt(parent, i);
            var name = tree.Name(child);
            var code = tree.KindCode(child);

            if (code == ItemKind.PlcFolder)
            {
                foreach (var nested in Of(tree, child, FolderPath.Append(basePath, name))) yield return nested;
                continue;
            }

            // A STANDALONE TRANSITION IS REFUSED BY NAME (openspec bridge-one-to-one §1.2 "Transitions"): no text form
            // carries one, and skipping it silently made its owner pull as if it had none — a migration lost it without
            // a word. 0 in the six corpora (niche: accepted loss); an SFC body's embedded transitions travel inside the
            // unsupported body.
            if (code == ItemKind.PlcTrans)
                throw new BridgeException(Volt.Contracts.BridgeErrorCodes.Unsupported,
                    $"'{tree.Name(parent)}' holds the transition '{name}' as an object of its own — Volt has no text form for " +
                    "a standalone SFC transition (refused by name: niche, accepted loss, 0 occurrences in the corpora), so " +
                    "the item is not pulled rather than pulled without it.");
            if (!ItemKind.IsMember(code)) continue;

            yield return new Site(string.IsNullOrEmpty(basePath) ? null : basePath, child, name, code);
        }
    }

    /// <summary>A member's declaration, from the member's OWN declaration aspect (<paramref name="read"/>, the vendor's).
    /// <para><b>An ACTION is the one member with no declaration to read</b>, in any IDE: IEC gives an action a name and a
    /// body and nothing else. Its header is COMPOSED here rather than read — that is not a fallback for a missing value,
    /// it is the whole of what an action's header is.</para></summary>
    public static string Declaration(Site site, Func<ItemRef, string?> read)
    {
        if (site.Code == ItemKind.PlcAction) return $"ACTION {site.Name}";

        var decl = read(site.Ref);
        // UNREADABLE: the IDE holds the item and Volt cannot read it whole — fix it in the IDE, or push with force. It was
        // INTERNAL_ERROR, a Volt bug, for a broken item in the project (openspec bridge-refusal-review V.1).
        if (string.IsNullOrWhiteSpace(decl))
            throw new BridgeException(Volt.Contracts.BridgeErrorCodes.Unreadable,
                $"'{site.Name}': the IDE reports no declaration for this member — that is a broken item, not a " +
                "transport gap");
        return decl!;   // verbatim (bridge-one-to-one §1.1, every character)
    }
}
