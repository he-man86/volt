using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// EVERY PATH A PUSH OP CARRIES IS ONE <c>refs</c> COULD PUBLISH (volt-cli-rework 2.4, the public-API lens: requests our
/// CLI never sends). Two shapes were accepted that name no item <c>refs</c> could ever name:
/// <list type="bullet">
/// <item>a <c>to</c> of another kind than its <c>name</c> — <c>POUs/P.pou</c> → <c>POUs/P.gvl</c> answered ACCEPTED and
/// changed nothing (the bare name and folder are unchanged, so the apply saw no rename and no move), and
/// <c>POUs/P.pou</c> → <c>POUs/Q.gvl</c> renamed the POU to <c>Q.pou</c>: a lost write either way, reported landed;</item>
/// <item>a path not in the encoded form the walk mints — <c>/POUs/Z.pou</c> created <c>POUs/Z.pou</c>,
/// <c>POUs/../Z.pou</c> a folder <c>..</c> that <c>refs</c> names <c>POUs/%2E%2E/Z.pou</c>, <c>POUs//Z.pou</c> a folder
/// with no name, <c>POUs/.pou</c> an object with no name: the item landed under an identity other than the one the
/// client pushed, so its next push of that name is a create again.</item>
/// </list>
/// Both are BAD_REQUEST before anything is read or written, forced or not.
/// </summary>
public class PushPathIsAWirePathTests
{
    private const string Prg = "PROGRAM {0}\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\n\nEND_PROGRAM\n";

    private static FakeIde Ide() => new(
        FakeIde.Item.TextualPou("P", "PROGRAM P\nVAR\nEND_VAR", "x := 1;", "POUs"));

    private static PushResponse Push(FakeIde ide, bool force, params PushOp[] ops) =>
        BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Force = force,
            Ops = ops.ToList(),
        });

    private static void AssertRefusedUntouched(FakeIde ide, PushResponse res, string named, string because)
    {
        Assert.False(res.Landed());
        var c = Assert.Single(res.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, c.Code);
        Assert.Contains(named, c.Reason);
        Assert.Contains(because, c.Reason);
        Assert.Empty(ide.Recorded);
        Assert.Equal(new[] { "POUs/P.pou" }, RefsService.Handle(ide).Items.Keys.ToArray());
    }

    [Theory]
    [InlineData("POUs/P.gvl")]
    [InlineData("POUs/Q.gvl")]
    [InlineData("Other/P.dut")]
    public void A_to_of_another_kind_than_its_name_is_refused_naming_both(string to)
    {
        foreach (var force in new[] { false, true })
        {
            var ide = Ide();
            var v = RefsService.Handle(ide).Items["POUs/P.pou"];

            var res = Push(ide, force, new SetItemOp { Name = "POUs/P.pou", To = to, IfVersion = v });

            AssertRefusedUntouched(ide, res, to, "cannot re-type an object by its NAME");
        }
    }

    [Fact]
    public void A_create_whose_to_names_another_kind_is_refused()
    {
        var ide = Ide();

        var res = Push(ide, false, new SetItemOp { Name = "POUs/Z.pou", To = "POUs/Z.gvl", SourceText = "VAR_GLOBAL\nEND_VAR\n" });

        AssertRefusedUntouched(ide, res, "POUs/Z.gvl", "cannot re-type an object by its NAME");
    }

    [Theory]
    [InlineData("/POUs/Z.pou")]
    [InlineData("POUs//Z.pou")]
    [InlineData("POUs/")]
    [InlineData("POUs/../Z.pou")]
    [InlineData("POUs /Z.pou")]
    [InlineData("POUs/.pou")]
    [InlineData("A/B%/Z.pou")]
    [InlineData("A%2fB/Z.pou")]
    [InlineData("%41/Z.pou")]
    public void A_path_refs_could_not_publish_is_refused_as_a_create_a_to_and_a_delete(string path)
    {
        var shapes = new (string Label, PushOp Op)[]
        {
            ("create", new SetItemOp { Name = path, SourceText = string.Format(Prg, "Z") }),
            ("to", new SetItemOp { Name = "POUs/P.pou", To = path }),
            ("delete", new DeleteItemOp { Name = path }),
        };
        foreach (var (label, op) in shapes)
            foreach (var force in new[] { false, true })
            {
                var ide = Ide();
                if (op is SetItemOp { To: not null } set) set.IfVersion = RefsService.Handle(ide).Items["POUs/P.pou"];

                var res = Push(ide, force, op);

                Assert.False(res.Landed(), $"{label} of '{path}' (force {force}) was accepted");
                AssertRefusedUntouched(ide, res, path, "refs");
            }
    }

    /// <summary>The control: a path in the minted form lands at exactly that path — an encoded segment included — and a
    /// path addressed in another letter case still finds the IDE's folder.</summary>
    [Theory]
    [InlineData("A%2FB/Z.pou", "A%2FB/Z.pou")]
    [InlineData("%2EHidden/Z.pou", "%2EHidden/Z.pou")]
    [InlineData("pous/Z.pou", "POUs/Z.pou")]
    public void A_path_in_the_minted_form_is_created_at_exactly_that_path(string pushed, string published)
    {
        var ide = Ide();

        var res = Push(ide, false, new SetItemOp { Name = pushed, SourceText = string.Format(Prg, "Z") });

        Assert.True(res.Landed(), res.Conflicts is null ? "" : string.Join(" | ", res.Conflicts.Select(c => c.Reason)));
        Assert.Contains(published, RefsService.Handle(ide).Items.Keys);
    }
}
