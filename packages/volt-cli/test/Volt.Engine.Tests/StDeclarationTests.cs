using Volt.Engine.Format.St;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// Resolving a variable's declared TYPE — the one fact a graphical body write needs and the body cannot carry.
///
/// <para>Network text names a function-block call once: `t1(IN := a, PT := pt)`. Both IDEs need two names — the
/// box's TYPE, which is what they resolve the call's signature from, and its INSTANCE. Writing the instance name
/// into the type slot produces a box the IDE cannot resolve: it comes back with NO formal parameter names, so
/// the next pull renders `t1( := a,  := pt)` and that text no longer parses. The type is in the declaration the
/// same push writes.</para>
/// </summary>
public class StDeclarationTests
{
    [Theory]
    [InlineData("VAR\n\tt1 : TON;\nEND_VAR", "t1", "TON")]
    [InlineData("VAR\n\tt1:TON;\nEND_VAR", "t1", "TON")]                       // no spaces
    [InlineData("VAR\n\tt1 : TON := (PT := T#1S);\nEND_VAR", "t1", "TON")]     // initializer is not the type
    [InlineData("VAR\n\ta, t1, b : TON;\nEND_VAR", "t1", "TON")]               // several names, one type
    [InlineData("VAR\n\tT1 : TON;\nEND_VAR", "t1", "TON")]                     // IEC is case-insensitive
    [InlineData("VAR_INPUT\n\tt1 : TON;\nEND_VAR", "t1", "TON")]               // any VAR block
    [InlineData("VAR\n\ts : STRING(80);\nEND_VAR", "s", "STRING")]             // length is not the type
    public void Finds_the_declared_type(string declaration, string name, string expected) =>
        Assert.Equal(expected, StDeclaration.TypeOfVariable(declaration, name));

    /// <summary>A COMMENTED-OUT declaration must not answer for a live one — otherwise a box gets the type of a
    /// variable that no longer exists, and the IDE resolves nothing.</summary>
    [Theory]
    [InlineData("VAR\n\t// t1 : TON;\nEND_VAR")]
    [InlineData("VAR\n\t(* t1 : TON; *)\nEND_VAR")]
    public void Ignores_a_commented_out_declaration(string declaration) =>
        Assert.Null(StDeclaration.TypeOfVariable(declaration, "t1"));

    [Theory]
    [InlineData("VAR\n\tother : TON;\nEND_VAR", "t1")]
    [InlineData("", "t1")]
    [InlineData(null, "t1")]
    public void Answers_null_when_it_is_not_declared(string? declaration, string name) =>
        Assert.Null(StDeclaration.TypeOfVariable(declaration, name));
}
