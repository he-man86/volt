using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A REFS REPORTS ITS WALK (openspec <c>twincat-large-solution-refs</c> 1). On an 18-PLC-project TwinCAT solution the
/// walk alone outlasted the relay's 60 s budget and sent nothing, so the relay counted no progress (<c>progressCount
/// 0</c>) and could not tell a working bridge from a hung one: the first frame came only once every item had been
/// found. Each application now sends one frame as its walk finishes — <c>phase: "walking"</c>, applications done of
/// applications total — before the item frames, and the walk's time per application lands in the refs log line.
/// </summary>
public class RefsWalkProgressTests
{
    private const string Line1 = "Line1/Plc Logic/App";
    private const string Line2 = "Line2/Plc Logic/App";

    private static FakeIde TwoApplications()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "a := 1;", Line1),
            FakeIde.Item.TextualPou("PLC_PRG", "PROGRAM PLC_PRG\nVAR\nEND_VAR", "b := 2;", Line2));
        foreach (var device in new[] { "Line1", "Line2" })
        {
            ide.ContainerKinds[device] = ItemKind.Device;
            ide.ContainerKinds[device + "/Plc Logic"] = ItemKind.PlcLogic;
        }
        ide.ContainerKinds[Line1] = ItemKind.Application;
        ide.ContainerKinds[Line2] = ItemKind.Application;
        return ide;
    }

    [Fact]
    public void Each_application_walked_is_one_frame_before_the_item_frames()
    {
        var frames = new List<ProgressFrame>();

        RefsService.Handle(TwoApplications(), onProgress: frames.Add);

        var walking = frames.TakeWhile(f => f.Phase == ProgressFrame.WalkingPhase).ToList();
        Assert.Equal(new[] { (1, (int?)2), (2, (int?)2) }, walking.Select(f => (f.Done, f.Total)));
        Assert.All(walking, f => Assert.Equal(Ops.Refs, f.Operation));
        // Then the item frames, as before: the first states the phase and the item total.
        var first = frames[walking.Count];
        Assert.Equal(("reading", 0, (int?)2), (first.Phase, first.Done, first.Total));
    }

    [Fact]
    public void The_refs_log_line_names_each_application_walked_and_read()
    {
        var clock = new SnapshotClock();

        ProjectSnapshot.Walk(TwoApplications(), clock: clock);

        var line = clock.ToString();
        Assert.Contains("walk ", line);
        Assert.Contains("per application: " + Line1 + " ", line);
        Assert.Contains(Line2 + " ", line);
        Assert.Contains("materialize ", line);
        Assert.Contains("2 items", line);
        Assert.Equal("done", clock.Doing);
    }

    /// <summary>A refs that fails says what it was doing — the item it was reading — so a fault in the field is named by
    /// its place. The item the fake refuses to read is not such a fault (it is listed unreadable); a driver throw from
    /// the item read loop is.</summary>
    [Fact]
    public void A_snapshot_stopped_by_a_fault_says_what_it_was_doing()
    {
        var ide = TwoApplications();
        var clock = new SnapshotClock();
        ide.OnWalkItems = () => throw new System.InvalidOperationException("boom");

        Assert.Throws<System.InvalidOperationException>(() => ProjectSnapshot.Walk(ide, clock: clock));

        Assert.Equal("walking", clock.Doing);
    }
}
