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
}
