using System;
using Volt.Engine.Item;
using Xunit;
using static Volt.Engine.Tests.OneToOne.OneToOneSteps;

namespace Volt.Engine.Tests.OneToOne;

/// <summary>
/// FINDING 5 — SFC TRANSITIONS ABSENT FROM THE TEXT (openspec <c>bridge-one-to-one</c> proposal 5, design §1.2
/// "Transitions", §2.2).
///
/// <para>A transition object under a POU is "inlined in a POU" (<c>ItemKind.IsInlinedInPou</c>) but no member
/// (<c>IsMember</c>): the walk skips it and no read takes it, so its owner pulls as if it had none — a migration loses
/// it without a word. The design REFUSES a standalone <c>TransitionObject</c> by name (0 in the corpora, "niche:
/// accepted loss (0 occurrences in the corpora)"), instead of task 1.2's member blocks; the embedded ones travel inside
/// the unsupported SFC body.</para>
///
/// <para>Red until 3.2/3.3 (the drivers read a transition child and refuse its owner by name — the FakeIde models the
/// drivers and changes with them).</para>
/// </summary>
public class TransitionRefusalTests
{
    [Fact]
    public void An_item_holding_a_standalone_transition_is_refused_by_name_on_pull()
    {
        ExpectRed.Until("3.2/3.3", "finding 5: a standalone transition is skipped silently", () =>
        {
            var ide = new FakeIde(
                new FakeIde.Item("SFC_Seq", ItemKind.PlcPou, "", true, "PROGRAM SFC_Seq\nVAR\nEND_VAR", null, "SFC", null,
                                 Children: new[] { "T_Go" }),
                new FakeIde.Item("T_Go", ItemKind.PlcTrans, "", false, null, "bStart", null, null));

            var ex = Assert.ThrowsAny<Exception>(() => Read(ide, "SFC_Seq", ItemKind.Kinds.Pou));
            Assert.Contains("T_Go", ex.Message);
            Assert.Contains("transition", ex.Message, StringComparison.OrdinalIgnoreCase);
        });
    }
}
