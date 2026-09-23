using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Sync;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// THE PUSH PRE-FLIGHT DOES NOT PAY FOR WHAT NOTHING READS.
///
/// <para><c>Versioning.SafeVersion</c> MATERIALIZES an item — declaration plus implementation, assembled to ST —
/// and the pre-flight ran it over every item in the project before the first write. That is right when a version
/// is going to be compared. Under <c>--force</c> it is not: <c>PushConflicts</c> skips every per-item
/// <c>ifVersion</c> check, so the only consumer left is the project-level LEASE, and that runs only when the
/// caller quoted one. A plain <c>push --force</c> read the whole project to build two maps nothing looked at.</para>
///
/// <para>These count READS rather than measuring time, because the claim is structural: the work is provably
/// unused, not merely slow.</para>
/// </summary>
public class PushPreflightCostTests
{
    private static string Prg(string name) =>
        $"PROGRAM {name}\nVAR\nEND_VAR\n(* @volt-implementation *)\nn := 0;\n\nEND_PROGRAM\n";

    private static FakeIde Project()
    {
        var ide = new FakeIde();
        foreach (var n in new[] { "A", "B", "C" })
            PushService.Handle(ide, new PushRequest
            {
                Ops = new List<PushOp> { new SetItemOp { Name = $"{n}.prg", SourceText = Prg(n), IfVersion = null } },
            });
        return ide;
    }

    /// <summary>Push, counting the item reads that happen BEFORE the first write.
    ///
    /// <para>Scoped to the pre-flight on purpose: the post-apply RECEIPT walk re-reads the whole project, and it
    /// has to — it is what makes the receipt match the next `refs` exactly. Counting the whole call would just
    /// measure that. The `applying` frame is the boundary, and it is emitted before the first op is applied.</para></summary>
    private static (PushResponse Res, int Reads) PushCountingPreflight(FakeIde ide, PushRequest req)
    {
        var reads = 0;
        var inPreflight = true;
        ide.OnReadContent = (_, _) => { if (inPreflight) reads++; };
        var res = PushService.Handle(ide, req, f => { if (f.Phase == "applying") inPreflight = false; });
        ide.OnReadContent = null;
        return (res, reads);
    }

    /// <summary>A forced push with NO lease reads nothing it does not write. The apply still resolves its own
    /// op — the item cache comes from the walk, not from a read — so this is not "reads nothing at all".</summary>
    [Fact]
    public void A_forced_push_without_a_lease_does_not_materialize_the_project()
    {
        var (res, reads) = PushCountingPreflight(Project(), new PushRequest
        {
            Force = true,
            Ops = new List<PushOp> { new SetItemOp { Name = "A.prg", SourceText = Prg("A"), IfVersion = null } },
        });

        Assert.True(res.Accepted, res.Conflicts is null ? "" : string.Join(" | ", res.Conflicts.Select(c => c.Reason)));
        Assert.Equal(0, reads);
    }

    /// <summary>A forced push WITH a lease still reads: the lease is compared against a hash of every item's
    /// version, so the reads come back the moment someone will look at the result.</summary>
    [Fact]
    public void A_forced_push_with_a_lease_still_materializes_the_project()
    {
        var ide = Project();
        var lease = RefsService.Handle(ide).ProjectVersion;

        var (res, reads) = PushCountingPreflight(ide, new PushRequest
        {
            Force = true,
            ExpectedProjectVersion = lease,
            Ops = new List<PushOp> { new SetItemOp { Name = "A.prg", SourceText = Prg("A"), IfVersion = null } },
        });

        Assert.True(res.Accepted, res.Conflicts is null ? "" : string.Join(" | ", res.Conflicts.Select(c => c.Reason)));
        Assert.True(reads > 0, "the lease was checked against a project version nobody computed");
    }

    /// <summary>And a STALE lease under force is still refused — the skip must not become a way to slip past
    /// the one gate `--force` deliberately leaves standing.</summary>
    [Fact]
    public void A_forced_push_with_a_stale_lease_is_still_refused()
    {
        var res = PushService.Handle(Project(), new PushRequest
        {
            Force = true,
            ExpectedProjectVersion = "a-lease-from-another-lifetime",
            Ops = new List<PushOp> { new SetItemOp { Name = "A.prg", SourceText = Prg("A"), IfVersion = null } },
        });

        Assert.False(res.Accepted);
        Assert.Equal(ConflictCodes.StaleProjectVersion, Assert.Single(res.Conflicts!).Code);
    }

    /// <summary>THE PRE-FLIGHT ANNOUNCES ITSELF. It is the slow half of a push and it used to run in silence,
    /// so a client's bar sat on the bare title until `applying` — which on a real project is most of the wait.</summary>
    [Fact]
    public void The_preflight_emits_a_phase_before_the_first_write()
    {
        var frames = new List<ProgressFrame>();

        PushService.Handle(Project(), new PushRequest
        {
            Ops = new List<PushOp> { new SetItemOp { Name = "D.prg", SourceText = Prg("D"), IfVersion = null } },
        }, frames.Add);

        Assert.Equal("checking", frames[0].Phase);
        Assert.Contains(frames, f => f.Phase == "applying");
    }
}
