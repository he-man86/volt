using System;
using System.Collections.Generic;
using System.IO;
using Volt.Cli.Sync;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>The drift model: incoming = bridge-vs-baseline, outgoing = worktree-vs-volt/ide. C# port coverage of
/// volt-git's status-model.</summary>
public class StatusModelTests
{
    [Fact]
    public void ComputeIncoming_classifies_added_modified_removed_sorted()
    {
        var bridge = new Dictionary<string, string> { ["A.fb"] = "v2", ["B.fb"] = "v1", ["C.fb"] = "v1" };
        var baseMap = new Dictionary<string, string> { ["A.fb"] = "v1", ["C.fb"] = "v1", ["D.fb"] = "v1" };
        var inc = StatusModel.ComputeIncoming(bridge, baseMap);
        Assert.Equal(new[] { "B.fb" }, inc.Added);      // in bridge, not baseline
        Assert.Equal(new[] { "A.fb" }, inc.Modified);   // version differs
        Assert.Equal(new[] { "D.fb" }, inc.Removed);    // in baseline, gone from bridge
    }

    [Fact]
    public void BuildStatusData_reports_incoming_and_outgoing_against_the_volt_ide_ref()
    {
        var root = TestUtil.NewRepo();
        try
        {
            var gitDir = Git.ResolveGitDir(root);
            // Make it an initialized workspace with a sidecar baseline + a volt/ide ref.
            Config.SaveConfig(root, new WorkspaceConfig { Bridge = new() { Vendor = "codesys" }, Project = new() { Platform = "codesys", ProjectName = "P" }, LinkedAt = "t" });
            Sidecar.SaveIdeRefs(root, new IdeRefs { ProjectVersion = "v1", Items = new() { ["A.fb"] = "h1" }, Folders = new() });
            var ide = Git.CommitTree(gitDir, Git.BuildTree(gitDir, new[] { new IndexEntry("100644", Git.WriteBlob(gitDir, "A"), "src/A.fb") }), Array.Empty<string>(), "ide");
            Git.UpdateRef(gitDir, IdeTree.Range, ide);

            // Local edit → outgoing; bridge reports a NEW item B → incoming.
            Directory.CreateDirectory(Path.Combine(root, "src"));
            File.WriteAllText(Path.Combine(root, "src", "A.fb"), "A-edited");

            var snap = new BridgeSnapshot
            {
                Online = true,
                Detail = "codesys/P",
                Items = new() { ["A.fb"] = "h1", ["B.fb"] = "h2" }, // A unchanged vs baseline; B is new
                Folders = new() { ["B.fb"] = "POUs" },
                ProjectVersion = "v2",
            };
            var s = StatusModel.BuildStatusData(root, snap);

            Assert.True(s.Initialized);
            Assert.Contains("B.fb", s.Incoming.Added);           // new IDE item
            Assert.Contains("A.fb", s.Outgoing.Modified);        // local edit vs volt/ide
            Assert.Equal("POUs/B.fb", s.PathByName["B.fb"]);     // folder placement for an incoming-only item
            Assert.Equal("1 incoming, 1 outgoing", s.Summary);
            Assert.Equal("volt pull", s.Recommend);              // incoming wins the recommendation
        }
        finally { TestUtil.ForceDelete(root); }
    }

    /// <summary>AN UNREADABLE ITEM REACHES THE USER. It exists in the IDE, it has no file here, and nothing else
    /// in the status model mentions it — so until the name is carried onto <c>StatusData</c> the only evidence
    /// is a debug line nobody reads. The bridge has published `unreadable` since one box whose `En` pin read as
    /// a boolean made a body unreadable and a whole POU vanished from git, silently (DIALECT C7). This is the
    /// half that makes it observable.
    ///
    /// <para>Both partial signals also OUTRANK the ordinary "volt pull": a partial view is exactly the state
    /// where the counts that advice rests on are the ones that cannot be trusted.</para></summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void A_partial_view_is_carried_into_the_status_and_outranks_the_usual_advice(bool unreadable)
    {
        var root = TestUtil.NewRepo();
        try
        {
            Config.SaveConfig(root, new WorkspaceConfig { Bridge = new() { Vendor = "codesys" }, Project = new() { Platform = "codesys", ProjectName = "P" }, LinkedAt = "t" });
            var snap = new BridgeSnapshot
            {
                Online = true,
                Items = new() { ["A.fb"] = "h1" },
                Unreadable = unreadable ? new List<string> { "Broken" } : new List<string>(),
                UnwalkedFolders = unreadable ? new List<string>() : new List<string> { "Machine" },
            };

            var s = StatusModel.BuildStatusData(root, snap);

            Assert.Equal(unreadable ? new[] { "Broken" } : System.Array.Empty<string>(), s.Unreadable);
            Assert.Equal(unreadable ? System.Array.Empty<string>() : new[] { "Machine" }, s.UnwalkedFolders);
            Assert.Contains("INCOMPLETE", s.Recommend);
        }
        finally { TestUtil.ForceDelete(root); }
    }

    /// <summary>A COMPLETE view reports neither, so neither field can become noise a reader learns to skip.</summary>
    [Fact]
    public void A_complete_view_reports_neither()
    {
        var root = TestUtil.NewRepo();
        try
        {
            Config.SaveConfig(root, new WorkspaceConfig { Bridge = new() { Vendor = "codesys" }, Project = new() { Platform = "codesys", ProjectName = "P" }, LinkedAt = "t" });

            var s = StatusModel.BuildStatusData(root, new BridgeSnapshot { Online = true, Items = new() { ["A.fb"] = "h1" } });

            Assert.Empty(s.Unreadable);
            Assert.Empty(s.UnwalkedFolders);
            Assert.DoesNotContain("INCOMPLETE", s.Recommend ?? "");
        }
        finally { TestUtil.ForceDelete(root); }
    }
}
