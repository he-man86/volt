using System;
using System.Collections.Generic;
using Volt.Engine.Item;

namespace Volt.Engine.Ide;

/// <summary>Where a POU's members live in the project tree.
///
/// <para><b>This existed twice, byte for byte.</b> The struct, the walk and their doc comments were duplicated
/// across <c>CodesysDriver.Content.cs</c> and <c>BeckhoffDriver.Content.cs</c> — two assemblies, one algorithm,
/// no differences. It only ever needed <c>ChildCount</c>, <c>ChildAt</c>, <c>Name</c> and <c>KindCode</c>, every
/// one of which is on <see cref="IProjectTree"/>, so it was never vendor code; it was shared code filed in two
/// places. Duplication like that does not stay identical — this repo has already lost data to exactly that drift
/// (the TwinCAT body write diverging from the CODESYS one), which is why it lives here now, beside the contract
/// it is written against.</para>
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

            if (!ItemKind.IsMember(code)) continue;

            yield return new Site(string.IsNullOrEmpty(basePath) ? null : basePath, child, name, code);
        }
    }
}
