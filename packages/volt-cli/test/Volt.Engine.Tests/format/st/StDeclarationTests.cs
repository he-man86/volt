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
    /// <summary>Nothing but this declaration — these cases are all about the SCAN, not the walk.</summary>
    private static string? NoProject(string name) => null;

    [Theory]
    [InlineData("VAR\n\tt1 : TON;\nEND_VAR", "t1", "TON")]
    [InlineData("VAR\n\tt1:TON;\nEND_VAR", "t1", "TON")]                       // no spaces
    [InlineData("VAR\n\tt1 : TON := (PT := T#1S);\nEND_VAR", "t1", "TON")]     // initializer is not the type
    [InlineData("VAR\n\ta, t1, b : TON;\nEND_VAR", "t1", "TON")]               // several names, one type
    [InlineData("VAR\n\tT1 : TON;\nEND_VAR", "t1", "TON")]                     // IEC is case-insensitive
    [InlineData("VAR_INPUT\n\tt1 : TON;\nEND_VAR", "t1", "TON")]               // any VAR block
    [InlineData("VAR\n\ts : STRING(80);\nEND_VAR", "s", "STRING")]             // length is not the type
    public void Finds_the_declared_type(string declaration, string name, string expected) =>
        Assert.Equal(expected, StDeclaration.TypeOfCallTarget(declaration, name, NoProject));

    /// <summary>A COMMENTED-OUT declaration must not answer for a live one — otherwise a box gets the type of a
    /// variable that no longer exists, and the IDE resolves nothing.</summary>
    [Theory]
    [InlineData("VAR\n\t// t1 : TON;\nEND_VAR")]
    [InlineData("VAR\n\t(* t1 : TON; *)\nEND_VAR")]
    public void Ignores_a_commented_out_declaration(string declaration) =>
        Assert.Null(StDeclaration.TypeOfCallTarget(declaration, "t1", NoProject));

    [Theory]
    [InlineData("VAR\n\tother : TON;\nEND_VAR", "t1")]
    [InlineData("", "t1")]
    [InlineData(null, "t1")]
    public void Answers_null_when_it_is_not_declared(string? declaration, string name) =>
        Assert.Null(StDeclaration.TypeOfCallTarget(declaration, name, NoProject));

    // ── D5 (openspec bridge-refusal-review 4.5): the declaration is read by STATEMENT, not by line ──────────

    /// <summary>A declaration is read up to each <c>;</c>, comments and pragmas blanked, so the three shapes the
    /// one-line rule lost are names with their types: a list wrapped over lines (<c>a,</c> / <c>t2 : TON;</c> — the
    /// first name was lost, and <c>a(IN := b)</c> silently became a FUNCTION box <c>a</c>), a located variable
    /// (<c>g5 AT %IX0.0 : BOOL;</c>), and a one-line block (<c>VAR_INPUT x : BOOL; END_VAR</c>). A trailing comment
    /// or pragma on a line is no part of the next statement.</summary>
    [Theory]
    [InlineData("VAR\n\ta,\n\tt2 : TON;\nEND_VAR", "a", "TON")]
    [InlineData("VAR\n\ta,\n\tt2 : TON;\nEND_VAR", "t2", "TON")]
    [InlineData("VAR\n\tg5 AT %IX0.0 : BOOL;\nEND_VAR", "g5", "BOOL")]
    [InlineData("VAR\n\tq AT %Q* : BOOL;\nEND_VAR", "q", "BOOL")]
    [InlineData("FUNCTION_BLOCK FB\nVAR_INPUT x : BOOL; END_VAR\nVAR t1 : TON; END_VAR", "x", "BOOL")]
    [InlineData("FUNCTION_BLOCK FB\nVAR_INPUT x : BOOL; END_VAR\nVAR t1 : TON; END_VAR", "t1", "TON")]
    [InlineData("VAR\n\tx : INT; // the count\n\tt1 : TON;\nEND_VAR", "t1", "TON")]
    [InlineData("VAR\n\tx : INT; (* doc *)\n\tt1 : TON;\nEND_VAR", "t1", "TON")]
    [InlineData("VAR\n\t{attribute 'hide'} t1 : TON;\nEND_VAR", "t1", "TON")]
    [InlineData("VAR CONSTANT\n\tt1 : TON;\nEND_VAR", "t1", "TON")]
    [InlineData("VAR RETAIN PERSISTENT t1 : TON; END_VAR", "t1", "TON")]
    [InlineData("VAR\n\ts : STRING := 'a;b';\n\tt1 : TON;\nEND_VAR", "t1", "TON")]
    [InlineData("TYPE ST_T :\nSTRUCT\n\toff : TOF;\nEND_STRUCT\nEND_TYPE", "off", "TOF")]
    [InlineData("VAR\n\tvariable : TON;\nEND_VAR", "variable", "TON")]
    public void Reads_the_declaration_by_statement(string declaration, string name, string expected) =>
        Assert.Equal(expected, StDeclaration.TypeOfCallTarget(declaration, name, NoProject));

    /// <summary>A header is no statement that declares: <c>METHOD Run : BOOL</c>, <c>FUNCTION F : INT</c>,
    /// <c>PROPERTY P : INT</c> and <c>TYPE A : INT;</c> name no variable.</summary>
    [Theory]
    [InlineData("METHOD Run : BOOL\nVAR_INPUT\n\tx : INT;\nEND_VAR", "Run")]
    [InlineData("FUNCTION F : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR", "F")]
    [InlineData("PROPERTY P : INT", "P")]
    [InlineData("TYPE A : INT;\nEND_TYPE", "A")]
    public void A_header_declares_no_variable(string declaration, string name) =>
        Assert.Null(StDeclaration.TypeOfCallTarget(declaration, name, NoProject));

    /// <summary>The names and the types are one rule: every name <see cref="StDeclaration.DeclaredNames"/> gives,
    /// the type read resolves.</summary>
    [Fact]
    public void Declared_names_are_the_statement_rule()
    {
        const string decl = "FUNCTION_BLOCK FB\nVAR_INPUT x : BOOL; END_VAR\nVAR\n\ta,\n\tt2 : TON;\n\tg5 AT %IX0.0 : BOOL; // in\nEND_VAR";
        Assert.Equal(new[] { "x", "a", "t2", "g5" }, StDeclaration.DeclaredNames(decl));
    }
}
