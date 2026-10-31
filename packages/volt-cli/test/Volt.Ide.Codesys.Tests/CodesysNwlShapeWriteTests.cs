using System.Linq;
using Volt.Engine.Format.Network;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// THE SHAPES THE NWL COMPLETENESS GATE SPELLED (openspec <c>nwl-schema-completeness-gate</c>, 2026-10-31), through the
/// CODESYS driver: each text is built into a live network by the writer's rebuild and read back by the reader to the same
/// text — the operand comment (<c>Operand.Comment</c>) and every flag stored where the text puts it.
/// </summary>
public class CodesysNwlShapeWriteTests
{
    /// <summary>A live network holding something else, so the change gate opens and the rebuild runs.</summary>
    private static Nwl.Network Elsewhere()
    {
        var assign = new Nwl.BoxTreeAssign { RValue = new Nwl.BoxTreeOperand { Operand = new Nwl.Operand { OperandExpr = "TRUE" } } };
        assign.Outputs.List.Add(new Nwl.Operand { OperandExpr = "elsewhere", IsLValue = true });
        return new Nwl.Network().With(assign);
    }

    private static (string Text, Nwl.Network Live) Rebuilt(string language, string code)
    {
        var text = $"%LANGUAGE {language}\n%NETWORK\n{code}\n";
        var lang = language == "LD" ? BodyLanguage.Ld : BodyLanguage.Fbd;
        var scope = NetworkModelScopes.ScopeOf(StNetworkReader.Read(text, NetworkScope.Empty));
        var model = StNetworkReader.Read(text, scope);
        var live = Elsewhere();
        CodesysNetworkWriter.WriteNetwork(new Nwl.NWLImplementationObject(), live, model.Networks[0], lang, scope);
        var back = new NetworkBody(lang, new[] { CodesysNetworkReader.ReadNetwork(live, 0) });
        return (StNetworkWriter.Write(back, scope), live);
    }

    [Theory]
    [InlineData("LD", "a;")]                                          // #1
    [InlineData("FBD", "NOT AND(a, b);")]                             // #2
    [InlineData("LD", "y := NOT := a;")]                              // #7a
    [InlineData("LD", "y := x := RISING NOT := a;")]                  // #7a, stacked, last in the chain
    [InlineData("LD", "NOT JMP.l := a;")]                             // #8
    [InlineData("LD", "BRANCH(FEED := start, a, b);")]                // #11
    [InlineData("LD", "RAIL();")]                                     // #12
    [InlineData("LD", "y := NOT EXECUTE(EN := go, 'n := TRUE;').ENO;")] // #16
    [InlineData("LD", "y := BRANCH(FEED := RAIL(), a, b);")]          // #18
    [InlineData("LD", "y := NOT COMMENT(a, 'why');")]                 // a value's comment
    [InlineData("LD", "COMMENT(y, 'it$'s $$5') S= a;")]               // a coil's
    [InlineData("FBD", "MOVE(COMMENT(a, 'why'), OUT => COMMENT(x, 'why'));")] // a pin's and an output's
    public void A_spelled_shape_is_built_and_read_back_as_its_text(string language, string code) =>
        Assert.Equal($"%LANGUAGE {language}\n%NETWORK\n{code}\n", Rebuilt(language, code).Text);

    [Fact]
    public void The_operand_comment_is_stored_on_the_operand_and_the_item_mark_on_the_item()
    {
        var (_, live) = Rebuilt("LD", "COMMENT(y, 'why') := NOT := a;");
        var assign = Assert.IsType<Nwl.BoxTreeAssign>(live.GetTree(live.NetworkItemCount - 1));
        Assert.Equal("why", Assert.IsType<Nwl.Operand>(Assert.Single(assign.Outputs.List)).Comment);
        Assert.True(Assert.IsType<Nwl.Flags>(assign.Flags).Negation);
        Assert.False(Assert.IsType<Nwl.Flags>(Assert.IsType<Nwl.Operand>(assign.Outputs.List.Single()).Flags).Negation);
    }
}
