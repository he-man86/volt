using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Volt.Wire;
using Xunit;
using Volt.Contracts;

namespace Volt.Cli.Connector.Tests;

/// <summary>The RESTORE path: `wanted.json` survives a connector restart so an auto-update does not strand a
/// bridge serving a project no live session has re-declared, and the 20 s startup grace hold keeps that project
/// alive while clients come back.
///
/// <para>Audit batch 11 found this whole path had ZERO tests — no test anywhere constructed a
/// <see cref="ConnectionManager"/> over a pre-populated wanted file, so nothing pinned the behaviour the file
/// exists for. These are that pin. `wantedFile` is injectable precisely so a test never reads or writes the
/// machine's real desired set.</para></summary>
public class ConnectionManagerRestoreTests : IDisposable
{
    private readonly string _wantedFile =
        Path.Combine(Path.GetTempPath(), "volt-wanted-" + Guid.NewGuid().ToString("N") + ".json");

    public void Dispose() { try { File.Delete(_wantedFile); } catch { } }

    private void SeedWanted(params string[] ids) => File.WriteAllText(_wantedFile, JsonSerializer.Serialize(ids));

    private string[] ReadWanted() =>
        File.Exists(_wantedFile) ? JsonSerializer.Deserialize<string[]>(File.ReadAllText(_wantedFile)) ?? Array.Empty<string>() : Array.Empty<string>();

    /// <summary>The restored project must NOT be gated on the first reconcile — that is the entire purpose of the
    /// grace hold. A serving bridge whose client has not re-declared yet is exactly the state a connector restart
    /// leaves behind.</summary>
    [Fact]
    public async Task A_restored_project_is_not_gated_during_the_startup_grace_window()
    {
        var src = new FakeProjectSource(Vendors.Codesys, Vendors.CodesysDisplay);
        var p = src.Add("MyMachine", serving: true);
        SeedWanted(p.Id);

        var cm = new ConnectionManager(new[] { (IProjectSource)src }, wantedFile: _wantedFile);
        await cm.RefreshAsync();

        Assert.Empty(src.Unbound); // held by the grace window, not gated
    }

    /// <summary>One client claiming ONE project must not disarm the hold protecting ANOTHER.
    /// <para>The disarm read "if any restored id exists and this client declared any non-empty interest, empty
    /// the whole restored set". So with two projects restored after a connector restart, the first client back —
    /// say the VS Code extension, which declares only the workspace it has open — released the hold for BOTH,
    /// and the second project was gated on the next reconcile although nobody had come back for it. That is the
    /// stranded-client half of the same incident the hold exists to prevent, arriving from the other side.</para>
    /// <para>The hold is per-project, so releasing it is too: a restored id is released when a session claims
    /// THAT id, which is knowable only once interests have been resolved against the detected projects.</para></summary>
    [Fact]
    public async Task Claiming_one_restored_project_does_not_release_the_hold_on_another()
    {
        var src = new FakeProjectSource(Vendors.Codesys, Vendors.CodesysDisplay);
        var mine = src.Add("MyMachine", serving: true);
        var other = src.Add("OtherMachine", serving: true);
        SeedWanted(mine.Id, other.Id);

        var cm = new ConnectionManager(new[] { (IProjectSource)src }, wantedFile: _wantedFile);
        var (sessionId, _) = await cm.OpenSessionAsync();

        // ONE client comes back, and claims only its own project.
        await cm.SyncAsync(sessionId, new[] { new Interest(Vendors.Codesys, "MyMachine") });

        Assert.DoesNotContain(src.Unbound, u => u.Id == other.Id);
        Assert.DoesNotContain(src.Unbound, u => u.Id == mine.Id);
    }

    /// <summary>THE ONE THAT MATTERS. The hold must not consume the edge: if the first reconcile drops the
    /// restored id from the desired set (and truncates the file), then on every later pass `previouslyWanted` is
    /// empty, so the leave-edge is gone and the project can NEVER be gated — it serves forever with no client.
    /// That is the stranded-bridge incident the restore exists to prevent, reinstated by the fix for it.</summary>
    [Fact]
    public async Task The_startup_hold_does_not_DESTROY_the_restored_edge()
    {
        var src = new FakeProjectSource(Vendors.Codesys, Vendors.CodesysDisplay);
        var p = src.Add("MyMachine", serving: true);
        SeedWanted(p.Id);

        var cm = new ConnectionManager(new[] { (IProjectSource)src }, wantedFile: _wantedFile);
        await cm.RefreshAsync();   // the first pass: holds the unbind

        // The edge must survive BOTH in memory and on disk. On disk matters independently: a second restart
        // inside the window has only the file to restore from.
        Assert.Contains(p.Id, ReadWanted());
    }

    /// <summary>A sync that declares NOTHING must not disarm the hold for everyone else. The live clients do
    /// exactly this: volt-desktop and volt-vscode start the connector feed before any workspace has declared, and
    /// volt-control's session sync posts unconditionally — with an empty interest array.</summary>
    [Fact]
    public async Task An_EMPTY_sync_does_not_disarm_the_grace_hold()
    {
        var src = new FakeProjectSource(Vendors.Codesys, Vendors.CodesysDisplay);
        var p = src.Add("MyMachine", serving: true);
        SeedWanted(p.Id);

        var cm = new ConnectionManager(new[] { (IProjectSource)src }, wantedFile: _wantedFile);
        var (id, _) = await cm.OpenSessionAsync();
        await cm.SyncAsync(id, Array.Empty<Interest>());   // a client polled, declaring nothing
        await cm.RefreshAsync();

        Assert.Empty(src.Unbound); // still held — nobody has actually claimed or released this project
    }
}
