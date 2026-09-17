using System.Collections.Generic;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// EVERY DECLARATION IN THE PUSH REACHES EVERY WRITE IN IT — the half of the call-target resolver that only the
/// engine can supply.
///
/// <para>A graphical box can call through a name its own POU does not declare:
/// `Mach1_AuxData.IEC_TIMERS.OffDelayLockDrives(...)` walks a GVL, then a struct, to reach the timer, and the
/// driver needs the TYPE to write into the box. It resolved that by asking the live IDE, which can only answer
/// for items that are ALREADY there — so pushing Lenze's MID-S100 into an EMPTY project failed on
/// `Mach1_Drives`: the struct it walks through was hundreds of ops further down the same push. Op order is not
/// a contract and cannot be made one (two items may reference each other), so the push carries its own
/// declarations instead. <c>StCallTargetTests</c> covers the walk; this covers what it walks over.</para>
/// </summary>
public class PushSiblingDeclarationsTests
{
    private const string GvlDecl = "VAR_GLOBAL\n\tIEC_TIMERS : cUDT_Timers;\nEND_VAR";
    private const string FbDecl = "FUNCTION_BLOCK Caller\nVAR\nEND_VAR";

    private static FakeIde TwoItems() => new(
        new FakeIde.Item("Mach1_AuxData", ItemKind.PlcGvl, "", true, "VAR_GLOBAL\nEND_VAR", null, null, null),
        new FakeIde.Item("Caller", ItemKind.PlcPouFb, "", true, FbDecl, "n := 1;", null, null));

    private static PushResponse PushBoth(FakeIde ide)
    {
        var refs = RefsService.Handle(ide);
        return PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new()
            {
                // THE CALLER FIRST, deliberately. This is the failing order — the item that needs a sibling's
                // declaration is written before the sibling's own op runs — and it is the order the bug lived in.
                new SetItemOp
                {
                    Name = "Caller.fb", IfVersion = refs.Items["Caller.fb"],
                    SourceText = FbDecl + "\n(* @volt-implementation *)\nn := 2;\n\nEND_FUNCTION_BLOCK\n",
                },
                new SetItemOp
                {
                    Name = "Mach1_AuxData.gvl", IfVersion = refs.Items["Mach1_AuxData.gvl"],
                    SourceText = GvlDecl + "\n",
                },
            },
        });
    }

    [Fact]
    public void A_write_sees_a_sibling_whose_own_op_has_not_run_yet()
    {
        var ide = TwoItems();
        var resp = PushBoth(ide);
        Assert.True(resp.Accepted);

        var seen = ide.PushedDeclarations["Caller"];
        Assert.True(seen.ContainsKey("Mach1_AuxData"),
                    "the GVL's declaration did not reach the write that runs before its own op");
        Assert.Contains("IEC_TIMERS", seen["Mach1_AuxData"]);
    }

    /// <summary>Keyed BARE, because that is the key the resolver walks with — the IDE's own lookup key. The wire
    /// carries FULL names (`Mach1_AuxData.gvl`), and indexing under one would make every lookup miss.</summary>
    [Fact]
    public void The_index_is_keyed_by_bare_name()
    {
        var ide = TwoItems();
        PushBoth(ide);

        var seen = ide.PushedDeclarations["Caller"];
        Assert.False(seen.ContainsKey("Mach1_AuxData.gvl"), "the index is keyed by the WIRE name, not the IDE's");
    }

    /// <summary>The item's OWN declaration is in there too. It costs nothing and it is what makes the index a
    /// straight answer to "what does this project say?" rather than a special case with a hole in it.</summary>
    [Fact]
    public void An_item_is_in_the_index_alongside_its_siblings()
    {
        var ide = TwoItems();
        PushBoth(ide);

        Assert.Contains("Caller", ide.PushedDeclarations["Caller"].Keys);
    }
}
