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
        $"PROGRAM {name}\nVAR\nEND_VAR\n%LANGUAGE ST\nn := 0;\n\nEND_PROGRAM\n";

    private static FakeIde Project()
    {
        var ide = new FakeIde();
        foreach (var n in new[] { "A", "B", "C" })
            BoundWrite.Push(ide, new PushRequest
            {
                Ops = new List<PushOp> { new SetItemOp { Name = $"{n}.pou", SourceText = Prg(n), IfVersion = null } },
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
        var res = BoundWrite.Push(ide, req, f => { if (f.Phase == "applying") inPreflight = false; });
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
            Ops = new List<PushOp> { new SetItemOp { Name = "A.pou", SourceText = Prg("A"), IfVersion = null } },
        });

        Assert.True(res.Landed(), res.Conflicts is null ? "" : string.Join(" | ", res.Conflicts.Select(c => c.Reason)));
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
            Ops = new List<PushOp> { new SetItemOp { Name = "A.pou", SourceText = Prg("A"), IfVersion = null } },
        });

        Assert.True(res.Landed(), res.Conflicts is null ? "" : string.Join(" | ", res.Conflicts.Select(c => c.Reason)));
        Assert.True(reads > 0, "the lease was checked against a project version nobody computed");
    }

    /// <summary>And a STALE lease under force is still refused — the skip must not become a way to slip past
    /// the one gate `--force` deliberately leaves standing.</summary>
    [Fact]
    public void A_forced_push_with_a_stale_lease_is_still_refused()
    {
        var refused = Assert.Throws<BridgeException>(() => BoundWrite.Push(Project(), new PushRequest
        {
            Force = true,
            ExpectedProjectVersion = "a-lease-from-another-lifetime",
            Ops = new List<PushOp> { new SetItemOp { Name = "A.pou", SourceText = Prg("A"), IfVersion = null } },
        }));

        Assert.Equal(BridgeErrorCodes.StaleProjectVersion, refused.ErrorCode);
    }

    /// <summary>THE PRE-FLIGHT ANNOUNCES ITSELF. It is the slow half of a push and it used to run in silence,
    /// so a client's bar sat on the bare title until `applying` — which on a real project is most of the wait.</summary>
    [Fact]
    public void The_preflight_emits_a_phase_before_the_first_write()
    {
        var frames = new List<ProgressFrame>();

        BoundWrite.Push(Project(), new PushRequest
        {
            Ops = new List<PushOp> { new SetItemOp { Name = "D.pou", SourceText = Prg("D"), IfVersion = null } },
        }, frames.Add);

        Assert.Equal("checking", frames[0].Phase);
        Assert.Contains(frames, f => f.Phase == "applying");
    }

    /// <summary>A PUSH OF NO OPS IS ONE READ (e2e `stability/latency`: "a no-op push is not more expensive than a read";
    /// TwinCAT MultiProject measured it at about twice a refs): the project is walked once, for the lease. Nothing landed,
    /// so the answer has no <c>newProjectVersion</c> and an empty receipt (wire-final-shape, design §5).</summary>
    [Fact]
    public void A_push_of_no_ops_walks_the_project_once_and_lands_nothing()
    {
        var ide = Project();
        var refs = RefsService.Handle(ide);
        var before = ide.WalkCalls;

        var res = BoundWrite.Push(ide, new PushRequest { ExpectedProjectVersion = refs.ProjectVersion, Ops = new List<PushOp>() });

        Assert.Equal(1, ide.WalkCalls - before);
        Assert.Null(res.NewProjectVersion);
        Assert.Empty(res.NewItems);
        Assert.Empty(res.Removed);
        Assert.Empty(res.Conflicts);
    }

    /// <summary>…and a stale lease is still STALE_PROJECT_VERSION, from that one walk.</summary>
    [Fact]
    public void A_push_of_no_ops_with_a_stale_lease_is_refused()
    {
        var ide = Project();

        var refused = Assert.Throws<BridgeException>(() =>
            BoundWrite.Push(ide, new PushRequest { ExpectedProjectVersion = "0000000000000000", Ops = new List<PushOp>() }));

        Assert.Equal(BridgeErrorCodes.StaleProjectVersion, refused.ErrorCode);
        Assert.Equal(RefsService.Handle(ide).ProjectVersion,
            Assert.IsType<StaleProjectVersionData>(refused.ErrorData).CurrentProjectVersion);
    }
}
