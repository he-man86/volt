using Volt.Engine.Format.St;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// Resolving the TYPE of a call target that a POU's own declaration cannot answer for.
///
/// <para>Both shapes here were MEASURED in the live IDE against a real customer project (Lenze MID-S100), and
/// both were refused by a push before this existed — "names a function-block instance that is not declared in
/// this POU", advice pointing at a declaration the engineer had already written somewhere else. Nine POUs
/// could be pulled and never pushed back.</para>
/// </summary>
public class StCallTargetTests
{
    // The project as three declarations: a GVL holding a struct holding the timer. Trimmed from the real ones,
    // but the shapes are the project's own — no space before the colon, a TYPE/STRUCT wrapper, a lowercase
    // `TOf` (the vendor answered `BoxType = 'TOF'`; the declaration is where the spelling comes from).
    private const string Gvl =
        "VAR_GLOBAL\n\tIEC_TIMERS: cUDT_MachAuxData_Timers;\n\tEdge: cUDT_MachAuxData_Edge;\nEND_VAR";

    private const string Struct =
        "TYPE cUDT_MachAuxData_Timers :\nSTRUCT\n\tTON_MainDriveBlocked : TON;\n\tOffDelayLockDrives : TOf;\n" +
        "END_STRUCT\nEND_TYPE";

    private static string? Project(string name) => name switch
    {
        "Mach1_AuxData" => Gvl,
        "cUDT_MachAuxData_Timers" => Struct,
        _ => null,
    };

    /// <summary>The measured case: `Instance = 'Mach1_AuxData.IEC_TIMERS.OffDelayLockDrives'`,
    /// `BoxType = 'TOF'`. Three declarations, two of them in other items.</summary>
    [Fact]
    public void Walks_a_qualified_path_through_the_project() =>
        Assert.Equal("TOf", StDeclaration.TypeOfCallTarget(
            "VAR\n\tlocal : TON;\nEND_VAR", "Mach1_AuxData.IEC_TIMERS.OffDelayLockDrives", Project));

    /// <summary>A LOCAL instance still resolves from the POU alone, and asks the project NOTHING — which is
    /// what keeps the ordinary case free of a project walk per box. The lookup throws if it is reached.</summary>
    [Fact]
    public void A_local_instance_needs_no_project_walk() =>
        Assert.Equal("TON", StDeclaration.TypeOfCallTarget(
            "VAR\n\tt1 : TON;\nEND_VAR", "t1",
            _ => throw new Xunit.Sdk.XunitException("a bare local name must not reach for the project")));

    /// <summary>An inner name SHADOWS a global, exactly as IEC says: the local scope is consulted first.</summary>
    [Fact]
    public void A_local_name_shadows_a_global_one() =>
        Assert.Equal("TOf", StDeclaration.TypeOfCallTarget(
            "VAR\n\tMach1_AuxData : cUDT_MachAuxData_Timers;\nEND_VAR",
            "Mach1_AuxData.OffDelayLockDrives", Project));

    /// <summary>The other measured case: `Instance = 'SUPER^'`, `BoxType = 'ATD_FQI'` — the EXTENDS clause,
    /// which is not a variable and so could never be found by a variable lookup.</summary>
    [Theory]
    [InlineData("FUNCTION_BLOCK ATD_TorqueControl EXTENDS ATD_FQI\nVAR_INPUT\nEND_VAR")]
    [InlineData("FUNCTION_BLOCK ATD_TorqueControl\nEXTENDS ATD_FQI\nVAR_INPUT\nEND_VAR")]  // the header wraps
    [InlineData("FUNCTION_BLOCK ATD_TorqueControl extends ATD_FQI")]                       // keywords fold
    [InlineData("FUNCTION_BLOCK B EXTENDS NS.FB_Base\nVAR\nEND_VAR")]                      // namespaced base
    public void Resolves_SUPER_to_the_extends_clause(string declaration) =>
        Assert.NotNull(StDeclaration.TypeOfCallTarget(declaration, "SUPER^", Project));

    [Fact]
    public void The_base_type_is_the_name_after_EXTENDS() =>
        Assert.Equal("ATD_FQI", StDeclaration.TypeOfCallTarget(
            "FUNCTION_BLOCK ATD_TorqueControl EXTENDS ATD_FQI\nVAR_INPUT\nEND_VAR", "SUPER^", Project));

    /// <summary>In a MEMBER's scope — its own declaration, then its owner's (<c>SourceScopes.Scope</c>) — <c>SUPER^</c>
    /// is the owner's base: the method has no EXTENDS of its own, and the owner's header comes after the method's VAR
    /// block. The scan that stopped at the first VAR block answered nothing here, while the scope's own inheritance
    /// walk (<c>WithInherited</c>) found the same clause: one question, two scanners, two answers.</summary>
    [Fact]
    public void SUPER_in_a_member_is_its_owners_base() =>
        Assert.Equal("B", StDeclaration.TypeOfCallTarget(
            "METHOD M\nVAR_INPUT x : INT; END_VAR\nFUNCTION_BLOCK D EXTENDS B\nVAR END_VAR", "SUPER^", Project));

    /// <summary>Nothing BELOW the header may answer for it. The scan stops at the first VAR block, so a
    /// variable whose type merely contains the word cannot be read as a base class.</summary>
    [Fact]
    public void SUPER_in_a_POU_that_extends_nothing_is_unresolved() =>
        Assert.Null(StDeclaration.TypeOfCallTarget(
            "FUNCTION_BLOCK Plain\nVAR\n\tx : Thing_EXTENDS_Other;\nEND_VAR", "SUPER^", Project));

    /// <summary>REFUSED, not guessed. A path that runs out has no answer, and both writers turn null into a
    /// refusal. Answering with the last name walked would put a non-type in `BoxType` — the uncompilable POU
    /// this whole resolver exists to prevent.</summary>
    [Theory]
    [InlineData("NoSuchGvl.IEC_TIMERS.OffDelayLockDrives")]   // the head names nothing
    [InlineData("Mach1_AuxData.IEC_TIMERS.NotAMember")]       // the last hop is not in the struct
    [InlineData("Mach1_AuxData.NotAMember.Whatever")]         // a middle hop is not in the GVL
    [InlineData("Mach1_AuxData.Edge.OSN_Gluepump")]           // the struct itself is not in the project
    [InlineData("Mach1_AuxData")]                             // a GVL is not something a box can call
    public void An_unwalkable_path_has_no_answer(string target) =>
        Assert.Null(StDeclaration.TypeOfCallTarget("VAR\nEND_VAR", target, Project));
}
