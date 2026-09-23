using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A DELETE RE-CHECKS THE VERSION AT THE LAST MOMENT, the way a write does.
///
/// <para>The per-item <c>ifVersion</c> gate runs ONCE, in the walk before the batch. A real push then hashes
/// every item in the project, resolves conflicts and applies every earlier op before it reaches this one —
/// and on TwinCAT the IDE stays interactive the whole time. The set arm has closed that window for a while
/// (<c>PushService.RequireUnchanged</c>); the delete arm took no <c>ifVersion</c> at all, so the caller sent
/// the strongest guard the wire offers and it was compared against a snapshot stale by the length of the
/// batch.</para>
///
/// <para>The cost of that is the worst shape available: a delete cannot be undone, so an edit landing in the
/// window is gone for good — and the receipt reports the item cleanly deleted while status says in sync.</para>
///
/// <para><b>The race needs a seam to be testable at all</b>, which is why <c>FakeIde.OnReadContent</c> exists:
/// nothing offline can otherwise express "the engineer edited it after the walk and before the write", so the
/// guards written for exactly that could not be exercised.</para>
/// </summary>
public class PushDeleteGuardTests
{
    private static string Prg(string name, string body = "n := 0;") =>
        $"PROGRAM {name}\nVAR\nEND_VAR\n(* @volt-implementation *)\n{body}\n\nEND_PROGRAM\n";

    private static FakeIde WithItem(string name)
    {
        var ide = new FakeIde();
        PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = $"{name}.prg", SourceText = Prg(name), IfVersion = null } },
        });
        return ide;
    }

    /// <summary>Delete with an explicitly supplied lease, so a test can capture the project version BEFORE
    /// arming a race hook. Taking it inside would make the helper's own `refs` walk trip the hook — which it
    /// did: the edit landed during that walk, the push then failed the LEASE, and a test meant to prove the
    /// delete guard was passing on an unrelated refusal.</summary>
    private static PushResponse Delete(FakeIde ide, string wire, string? ifVersion, string lease, bool force = false) =>
        PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = lease,
            Force = force,
            Ops = new List<PushOp> { new DeleteItemOp { Name = wire, IfVersion = ifVersion } },
        });

    /// <summary>The ordinary case still works — the guard must not make every delete a conflict.</summary>
    [Fact]
    public void A_delete_with_the_current_version_succeeds()
    {
        var ide = WithItem("Gone");
        var refs = RefsService.Handle(ide);

        var res = Delete(ide, "Gone.prg", refs.Items["Gone.prg"], refs.ProjectVersion);

        Assert.True(res.Accepted, res.Conflicts is null ? "" : string.Join(" | ", res.Conflicts.Select(c => c.Reason)));
        Assert.DoesNotContain("Gone.prg", RefsService.Handle(ide).Items.Keys);
    }

    /// <summary>THE RACE, and the reason this file needs a seam at all. The version is current when the push
    /// starts; the item is edited AFTER the pre-apply walk has hashed it — exactly the window the set arm
    /// already guards. The delete must refuse rather than destroy the edit.
    ///
    /// <para>The lease is captured before the hook is armed, so the only thing that can refuse this push is
    /// the delete guard itself. Without that care the test passed on a project-version mismatch instead, which
    /// is the failure mode a race test is most likely to have.</para></summary>
    [Fact]
    public void An_edit_landing_after_the_walk_stops_the_delete()
    {
        var ide = WithItem("Racy");
        var refs = RefsService.Handle(ide);

        // The push's own walk reads the target once; the delete guard reads it again. Firing on the SECOND
        // read puts the edit inside the window and nowhere else. The hook runs at the top of ReadContent, so
        // the guard's read returns the edited text.
        var reads = 0;
        ide.OnReadContent = (fake, item) =>
        {
            if (fake.Name(item) != "Racy" || ++reads != 2) return;
            fake.OnReadContent = null;              // once is the race; re-entering here would recurse
            fake.EditImplementation("Racy", "n := 999;   // the engineer's edit");
        };

        var res = Delete(ide, "Racy.prg", refs.Items["Racy.prg"], refs.ProjectVersion);

        Assert.False(res.Accepted, "the delete destroyed an edit made while the push was running");
        var conflict = Assert.Single(res.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, conflict.Code);
        Assert.Contains("Racy.prg", RefsService.Handle(ide).Items.Keys);
    }

    /// <summary>`--force` is the caller saying "I know, do it anyway", so the guard is skipped exactly as it is
    /// on the write path — a stale `ifVersion` no longer refuses. Without this the flag would stop meaning
    /// anything for a delete, which is the obvious way to over-correct this change.</summary>
    [Fact]
    public void Force_deletes_despite_a_stale_version()
    {
        var ide = WithItem("Forced");
        var lease = RefsService.Handle(ide).ProjectVersion;

        var res = Delete(ide, "Forced.prg", "a-version-that-is-long-gone", lease, force: true);

        Assert.True(res.Accepted, res.Conflicts is null ? "" : string.Join(" | ", res.Conflicts.Select(c => c.Reason)));
        Assert.DoesNotContain("Forced.prg", RefsService.Handle(ide).Items.Keys);
    }
}
