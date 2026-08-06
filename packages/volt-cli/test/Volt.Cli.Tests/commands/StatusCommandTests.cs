using System.IO;
using Volt.Cli.Sync;
using Xunit;
using static Volt.Cli.Tests.CommandHarness;

namespace Volt.Cli.Tests;

/// <summary>`volt status` at the CLI layer — the drift summary + recommendation through <see cref="Commands.Status"/>
/// (not the model directly), across in-sync / outgoing / incoming / mismatch / merging / offline.</summary>
public class StatusCommandTests
{
    private static FakeIde.Item Prg(string impl = "x := 1;") =>
        FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", impl);

    private static string PrgPath(string root) => Path.Combine(root, "src", "PLC_PRG.prg");

    [Fact]
    public void Status_shows_a_local_edit_as_outgoing_and_recommends_push()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(PrgPath(root), "PROGRAM PLC_PRG\n(* edited locally *)\n");

            var s = Commands.Status(root, client);
            Assert.Contains("PLC_PRG.prg", s.Outgoing.Modified);
            Assert.Equal("volt push", s.Recommend);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Status_shows_an_IDE_edit_as_incoming_and_recommends_pull()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            ide.MutateImplementation("PLC_PRG", "x := 99;");

            var s = Commands.Status(root, client);
            Assert.Contains("PLC_PRG.prg", s.Incoming.Modified);
            Assert.Equal("volt pull", s.Recommend);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Status_reports_a_project_mismatch()
    {
        var ide = new FakeIde(Prg())
        { HealthConnected = true, HealthPlatform = "codesys", HealthProjectName = "SomethingElse" };
        var (root, host, client) = Bound(ide); // bound to "Demo"
        try
        {
            var s = Commands.Status(root, client);
            Assert.NotNull(s.ProjectMismatch);
            Assert.Equal("project mismatch — open the bound project in the IDE", s.Summary);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>REGRESSION — the mismatch verdict must come from the LIVE bridge, not from the throttled health
    /// snapshot. `refs` used to be the ONE project-touching op carrying no identity on the wire, so `volt status`
    /// answered "is the bridge on my project?" for itself out of `health` — a per-vendor cache (~5s on TwinCAT) that
    /// still names the OLD project right after a rebind. Inside that window status walked the OTHER project and
    /// rendered every foreign item as incoming-added (and every tracked one as incoming-removed) while `volt pull`,
    /// guarded in-op, refused WRONG_PROJECT in the same second.</summary>
    [Fact]
    public void Status_refuses_instead_of_walking_the_other_project_when_the_live_served_name_differs_from_the_binding()
    {
        var ide = new FakeIde(Prg())
        {
            HealthConnected = true, HealthPlatform = "codesys",
            HealthProjectName = "SomethingElse",      // what the bridge is LIVE serving
            HealthSnapshotProjectName = "Demo",       // ...while the cached health row still says the bound one
        };
        var (root, host, client) = Bound(ide); // bound to "Demo"
        try
        {
            Assert.Null(Config.ProjectMismatch(Config.LoadConfig(root), client.GetHealth())); // the snapshot agrees…

            var s = Commands.Status(root, client);

            Assert.NotNull(s.ProjectMismatch);                                   // …the live bridge does not
            Assert.Equal("project mismatch — open the bound project in the IDE", s.Summary);
            Assert.True(s.Online);                   // a mismatch is not an outage — it must not read as offline
            Assert.Empty(s.Incoming.Added);          // and NOT one phantom incoming-add per foreign item
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Status_reports_merging_after_a_conflicted_pull()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            File.WriteAllText(PrgPath(root), File.ReadAllText(PrgPath(root)).Replace("x := 1;", "x := 2;"));
            ide.MutateImplementation("PLC_PRG", "x := 99;");
            Commands.Pull(root, client); // → conflict, leaves a merge in progress

            var s = Commands.Status(root, client);
            Assert.NotNull(s.Merging);
            Assert.Contains("merging", s.Summary);
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }

    [Fact]
    public void Status_reports_offline_when_the_bridge_is_down()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        var down = false;
        try
        {
            Commands.Pull(root, client); // seed while online
            host.Dispose(); down = true; // the bridge goes away

            var s = Commands.Status(root, client);
            Assert.False(s.Online);
        }
        finally { if (!down) host.Dispose(); TestUtil.ForceDelete(root); }
    }

    /// <summary>`--local` exists to keep a LOCAL edit from freezing the IDE. `/refs` walks the entire project on
    /// the IDE's single STA thread — seconds of frozen CODESYS on a real project — and it answers exactly one
    /// question: what is INCOMING. Outgoing and merge state are pure git, so a status triggered by saving a file
    /// has no reason to touch the IDE at all.
    /// <para>The contract that makes it safe: an un-computed Incoming must not read as an EMPTY one, or every save
    /// would tell the user the IDE has nothing for them. IncomingStale says which it is.</para></summary>
    [Fact]
    public void Local_status_reports_outgoing_without_walking_the_IDE()
    {
        var ide = ConnectedIde(Prg());
        var (root, host, client) = Bound(ide);
        try
        {
            Commands.Pull(root, client);
            ide.MutateImplementation("PLC_PRG", "x := 42;");        // the IDE moves → a real INCOMING change
            File.WriteAllText(Path.Combine(root, "src", "PLC_PRG.prg"),
                File.ReadAllText(Path.Combine(root, "src", "PLC_PRG.prg")) + "\n// local edit\n");

            var full = Commands.Status(root, client);
            Assert.False(full.IncomingStale);
            Assert.NotEmpty(full.Incoming.Modified);                 // the walk saw the IDE-side edit
            Assert.NotEmpty(full.Outgoing.Modified);

            var local = Commands.Status(root, client, localOnly: true);

            Assert.True(local.Online);                               // health still ran (it is cheap)
            Assert.NotEmpty(local.Outgoing.Modified);                // outgoing is pure git — still correct
            Assert.True(local.IncomingStale);                        // ...and it SAYS incoming wasn't computed,
            Assert.Empty(local.Incoming.Modified);                   // which is why empty here is not a claim
        }
        finally { host.Dispose(); TestUtil.ForceDelete(root); }
    }
}
