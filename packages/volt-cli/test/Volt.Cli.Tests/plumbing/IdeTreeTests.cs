using System;
using System.Collections.Generic;
using System.Text;
using Volt.Cli.Sync;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>
/// The correctness-critical merge engine (<see cref="IdeTree.BuildVoltIdeTree"/>). These pin the invariant whose
/// violation is silent data loss: an UNCHANGED IDE item is carried from the PARENT volt/ide tree, never from HEAD,
/// so the user's un-pushed local edits are neither stranded nor folded into the IDE baseline.
/// </summary>
public class IdeTreeTests
{
    private static string Blob(string root, string treeish, string path) =>
        Encoding.UTF8.GetString(Git.GitShowBytes(root, treeish, path) ?? throw new Xunit.Sdk.XunitException($"{path} not in {treeish}"));

    private static bool Has(string root, string treeish, string path) => Git.GitShowBytes(root, treeish, path) is not null;

    [Fact]
    public void Unchanged_items_come_from_the_parent_ide_tree_not_HEAD()
    {
        var root = TestUtil.NewRepo();
        try
        {
            var gitDir = Git.ResolveGitDir(root);

            // PARENT volt/ide = the IDE's last-known state.
            var parentTree = Git.BuildTree(gitDir, new[]
            {
                new IndexEntry("100644", Git.WriteBlob(gitDir, "ide-A-v1"), "src/A.fb"),
                new IndexEntry("100644", Git.WriteBlob(gitDir, "ide-B"), "src/B.fb"),
                new IndexEntry("100644", Git.WriteBlob(gitDir, "readme"), "README.md"),
            });
            var parent = Git.CommitTree(gitDir, parentTree, Array.Empty<string>(), "parent ide");

            // HEAD = the user's branch: A and B BOTH edited locally (un-pushed), plus a new local C, plus scaffold.
            var headTree = Git.BuildTree(gitDir, new[]
            {
                new IndexEntry("100644", Git.WriteBlob(gitDir, "user-edited-A"), "src/A.fb"),
                new IndexEntry("100644", Git.WriteBlob(gitDir, "user-edited-B"), "src/B.fb"),
                new IndexEntry("100644", Git.WriteBlob(gitDir, "new-local-C"), "src/C.fb"),
                new IndexEntry("100644", Git.WriteBlob(gitDir, "readme"), "README.md"),
            });
            var head = Git.CommitTree(gitDir, headTree, Array.Empty<string>(), "head");

            // The IDE changed only A. B unchanged, C never existed IDE-side.
            var ideFiles = new List<MaterializedFile> { new("A.fb", "ide-A-v2") };
            var tree = IdeTree.BuildVoltIdeTree(gitDir, head, parent, ideFiles, Array.Empty<string>(), librariesRefreshed: false);

            Assert.Equal("ide-A-v2", Blob(root, tree, "src/A.fb"));   // changed item → fresh fetch content
            Assert.Equal("ide-B", Blob(root, tree, "src/B.fb"));       // UNCHANGED → parent's, NOT "user-edited-B"
            Assert.False(Has(root, tree, "src/C.fb"));                 // user-added, not IDE-side → left out (outgoing)
            Assert.Equal("readme", Blob(root, tree, "README.md"));     // scaffold from HEAD, untouched
        }
        finally { TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Removed_items_are_dropped_from_the_new_tree()
    {
        var root = TestUtil.NewRepo();
        try
        {
            var gitDir = Git.ResolveGitDir(root);
            var parent = Git.CommitTree(gitDir, Git.BuildTree(gitDir, new[]
            {
                new IndexEntry("100644", Git.WriteBlob(gitDir, "A"), "src/A.fb"),
                new IndexEntry("100644", Git.WriteBlob(gitDir, "B"), "src/B.fb"),
            }), Array.Empty<string>(), "parent");

            // The IDE deleted B; A untouched.
            var tree = IdeTree.BuildVoltIdeTree(gitDir, null, parent,
                Array.Empty<MaterializedFile>(), new[] { "B.fb" }, librariesRefreshed: false);

            Assert.True(Has(root, tree, "src/A.fb"));  // carried from parent
            Assert.False(Has(root, tree, "src/B.fb")); // removed → dropped
        }
        finally { TestUtil.ForceDelete(root); }
    }

    /// <summary>The same thing for an item in a FOLDER — which is the case that mattered and the one the test
    /// above could not see. `removedNames` carries bare wire NAMES (`B.fb`), while the tree walk compares against
    /// src-relative PATHS (`Machine/B.fb`), so a folder made the two never match and the deleted item stayed in
    /// the workspace forever. The root-level test passes precisely because a root item's name IS its path.</summary>
    [Fact]
    public void Removed_items_are_dropped_even_when_they_live_in_a_folder()
    {
        var root = TestUtil.NewRepo();
        try
        {
            var gitDir = Git.ResolveGitDir(root);
            var parent = Git.CommitTree(gitDir, Git.BuildTree(gitDir, new[]
            {
                new IndexEntry("100644", Git.WriteBlob(gitDir, "A"), "src/Machine/A.fb"),
                new IndexEntry("100644", Git.WriteBlob(gitDir, "B"), "src/Machine/Deep/B.fb"),
            }), Array.Empty<string>(), "parent");

            // The IDE deleted B, which lives two folders down. The wire reports the bare name.
            var tree = IdeTree.BuildVoltIdeTree(gitDir, null, parent,
                Array.Empty<MaterializedFile>(), new[] { "B.fb" }, librariesRefreshed: false);

            Assert.True(Has(root, tree, "src/Machine/A.fb"));       // untouched, carried from parent
            Assert.False(Has(root, tree, "src/Machine/Deep/B.fb")); // removed → dropped, folder or not
        }
        finally { TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Paths_with_spaces_round_trip_into_the_tree()
    {
        // Real projects nest under folders with spaces (e.g. "Plc Logic/Application/010 PC01/pgPC01.prg").
        // The tree entry's path field must carry them verbatim — a rewrite of the blob/tree writer (e.g. via
        // `git fast-import`, whose `M <mode> <ref> <path>` field is space-sensitive) MUST keep this working.
        var root = TestUtil.NewRepo();
        try
        {
            var gitDir = Git.ResolveGitDir(root);
            var head = Git.CommitTree(gitDir, Git.BuildTree(gitDir, Array.Empty<IndexEntry>()), Array.Empty<string>(), "empty");
            var tree = IdeTree.BuildVoltIdeTree(gitDir, head, null,
                new List<MaterializedFile>
                {
                    new("Plc Logic/Application/010 PC01/pgPC01.prg", "PROGRAM pgPC01\nEND_PROGRAM\n"),
                    new("Global Vars/GVL Constants.gvl", "VAR_GLOBAL CONSTANT\nEND_VAR\n"),
                },
                Array.Empty<string>(), librariesRefreshed: false);

            Assert.Equal("PROGRAM pgPC01\nEND_PROGRAM\n", Blob(root, tree, "src/Plc Logic/Application/010 PC01/pgPC01.prg"));
            Assert.Equal("VAR_GLOBAL CONSTANT\nEND_VAR\n", Blob(root, tree, "src/Global Vars/GVL Constants.gvl"));
        }
        finally { TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Init_seeds_the_whole_ide_with_no_parent()
    {
        var root = TestUtil.NewRepo();
        try
        {
            var gitDir = Git.ResolveGitDir(root);
            // init: no parent, ideFiles is everything, and any HEAD scaffold rides along.
            var head = Git.CommitTree(gitDir, Git.BuildTree(gitDir, new[]
            {
                new IndexEntry("100644", Git.WriteBlob(gitDir, "readme"), "README.md"),
            }), Array.Empty<string>(), "scaffold");

            var tree = IdeTree.BuildVoltIdeTree(gitDir, head, null,
                new List<MaterializedFile> { new("A.fb", "ide-A"), new("POUs/B.fb", "ide-B") },
                Array.Empty<string>(), librariesRefreshed: false);

            Assert.Equal("ide-A", Blob(root, tree, "src/A.fb"));
            Assert.Equal("ide-B", Blob(root, tree, "src/POUs/B.fb")); // nested path lands correctly
            Assert.Equal("readme", Blob(root, tree, "README.md"));
        }
        finally { TestUtil.ForceDelete(root); }
    }

    /// <summary>Removal is keyed by bare NAME (identity is the item name), so the sweep matched that name against
    /// EVERY path in the tree — and a referenced library's rendered element signatures carry ordinary source
    /// extensions. Deleting the project's own `ERROR.dut` therefore also deleted
    /// `Library Manager/CAA/ERROR.dut`, which nothing regenerates until that library's version changes: silent
    /// loss of content the workspace cannot rebuild. Library files have no item and are exempt by LOCATION.</summary>
    [Fact]
    public void A_removed_project_item_never_sweeps_a_same_named_library_signature()
    {
        var root = TestUtil.NewRepo();
        try
        {
            var gitDir = Git.ResolveGitDir(root);
            var parent = Git.CommitTree(gitDir, Git.BuildTree(gitDir, new[]
            {
                new IndexEntry("100644", Git.WriteBlob(gitDir, "P"), "src/POUs/ERROR.dut"),
                new IndexEntry("100644", Git.WriteBlob(gitDir, "L"), "src/Library Manager/CAA/CAA.library"),
                new IndexEntry("100644", Git.WriteBlob(gitDir, "S"), "src/Library Manager/CAA/ERROR.dut"),
            }), Array.Empty<string>(), "parent");

            // The IDE deleted the PROJECT's ERROR.dut. The library's same-named signature must survive.
            var tree = IdeTree.BuildVoltIdeTree(gitDir, null, parent,
                Array.Empty<MaterializedFile>(), new[] { "ERROR.dut" }, librariesRefreshed: false);

            Assert.False(Has(root, tree, "src/POUs/ERROR.dut"));                  // the real deletion lands
            Assert.True(Has(root, tree, "src/Library Manager/CAA/ERROR.dut"));    // the collateral one does not
            Assert.True(Has(root, tree, "src/Library Manager/CAA/CAA.library"));
        }
        finally { TestUtil.ForceDelete(root); }
    }
    
    /// <summary>A library signature whose element no longer exists must be DROPPED when the fetch re-rendered
    /// the signatures — and kept when it did not.
    /// <para>Signature files are PATH-identified, not name-identified (two libraries may export the same short
    /// name), so they never appear in `Items` and `Removed` can never name one. That left them immortal: a
    /// library upgraded or de-referenced kept its old signatures in the workspace, still resolving in the LSP.
    /// `librariesRefreshed` is their only removal signal — when it is set, `Changed` carries the COMPLETE set for
    /// every library folder, so whatever is not in it is gone.</para></summary>
    [Theory]
    [InlineData(true,  false)]   // refreshed → the stale signature is dropped
    [InlineData(false, true)]    // not refreshed → no signatures in the response at all, so keep what we have
    public void A_stale_library_signature_is_dropped_only_when_the_signatures_were_refreshed(
        bool librariesRefreshed, bool expectStaleKept)
    {
        var root = TestUtil.NewRepo();
        try
        {
            var gitDir = Git.ResolveGitDir(root);
            var parent = Git.CommitTree(gitDir, Git.BuildTree(gitDir, new[]
            {
                new IndexEntry("100644", Git.WriteBlob(gitDir, "P"), "src/POUs/PLC_PRG.prg"),
                new IndexEntry("100644", Git.WriteBlob(gitDir, "L"), "src/Library Manager/CAA/CAA.library"),
                new IndexEntry("100644", Git.WriteBlob(gitDir, "K"), "src/Library Manager/CAA/StillThere.fb"),
                new IndexEntry("100644", Git.WriteBlob(gitDir, "G"), "src/Library Manager/CAA/Gone.fb"),
            }), Array.Empty<string>(), "parent");

            // The fetch carries the library folder's CURRENT contents: the stub and StillThere, but not Gone.
            var ideFiles = new[]
            {
                new MaterializedFile("Library Manager/CAA/CAA.library", "L"),
                new MaterializedFile("Library Manager/CAA/StillThere.fb", "K"),
            };

            var tree = IdeTree.BuildVoltIdeTree(gitDir, null, parent, ideFiles, Array.Empty<string>(),
                                                librariesRefreshed: librariesRefreshed);

            Assert.True(Has(root, tree, "src/Library Manager/CAA/StillThere.fb"));  // carried either way
            Assert.True(Has(root, tree, "src/POUs/PLC_PRG.prg"));                   // project items untouched
            Assert.Equal(expectStaleKept, Has(root, tree, "src/Library Manager/CAA/Gone.fb"));
        }
        finally { TestUtil.ForceDelete(root); }
    }
}
