using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A WORD AFTER A MEMBER'S NAME RENAMES IT ON PUSH — AN ACCEPTED LOSS (openspec <c>bridge-refusal-review</c> 2.5, D10
/// option 3; review 1+2d's case, gate 2).
///
/// <para>The member's name is the LAST word before the colon (<c>StReader.ParseSignature</c>, no modifier vocabulary).
/// Over an existing method <c>Run</c>, the header <c>METHOD Run Walk : BOOL</c> reads as member <c>Walk</c>, so
/// <c>ReconcileMembers</c> renames <c>Run</c> to <c>Walk</c> — one method dropped and one added is that method renamed,
/// through the vendor's rename (openspec <c>bridge-one-to-one</c> task 3.4; it was a delete and a create) — and writes it
/// the text that was Run's: nothing is refused before it lands. Both IDEs read the FIRST word as the name instead (<c>sig_unknown_word</c>, CODESYS SP21 and
/// TwinCAT: "The name used in the signature is not identical to the object name"), so on this input Volt's answer differs
/// from the vendor's. Known divergence <c>MEMBER_HEADER_NAMED_BY_ITS_LAST_WORD</c>, niche: 0 such lines in the six corpora
/// (1,420 of 1,420 signatures with modifiers carry them BEFORE the name). This test pins the rename so the loss is
/// explicit: a change to it is a design decision, not a drift (the rename IS one: bridge-one-to-one §3).</para>
/// </summary>
public class MemberHeaderLastWordTests
{
    [Fact]
    public void A_second_word_after_an_existing_members_name_renames_it_to_the_last_word()
    {
        var ide = new FakeIde(
            new FakeIde.Item("K", ItemKind.PlcPou, "", true, "FUNCTION_BLOCK K\nVAR\nEND_VAR", ";", null, null,
                             Children: new[] { "Run" }),
            new FakeIde.Item("Run", ItemKind.PlcMethod, "", false, "METHOD Run : BOOL\nVAR\nEND_VAR", "Run := TRUE;", null, null));
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp
                {
                    Name = "K.pou",
                    IfVersion = refs.Items.GetValueOrDefault("K.pou"),
                    SourceText = "FUNCTION_BLOCK K\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n\n" +
                                 "METHOD Run Walk : BOOL\nVAR\nEND_VAR\nIMPLEMENTATION ST\nRun := TRUE;\nEND_METHOD\n",
                },
            },
        });

        Assert.True(resp.Accepted, resp.Conflicts?.FirstOrDefault()?.Reason);
        Assert.Contains("rename:Run->Walk", ide.Recorded);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("delete:", System.StringComparison.Ordinal));
        Assert.False(ide.Exists("Run"));
        var walk = Assert.Single(ide.WrittenContent["K"].Members, m => m.Name == "Walk");
        Assert.StartsWith("METHOD Run Walk : BOOL", walk.Declaration);
        Assert.DoesNotContain(ide.WrittenContent["K"].Members, m => m.Name == "Run");
    }
}
