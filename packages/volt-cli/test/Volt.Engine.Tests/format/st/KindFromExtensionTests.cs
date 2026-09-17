using Xunit;
using Volt.Engine;
using Volt.Engine.Format.St;
using Volt.Engine.Item;

namespace Volt.Engine.Tests;

/// <summary>
/// THE EXTENSION IS THE KIND. It is on the wire name, `KindForWireName` reads it off, and that is a lookup
/// rather than an inference — so the pushed TEXT does not get to decide what object exists.
///
/// It used to. `StReader.Read` took the source alone and called `CodeHelper.ParseCodeHeader` on it, and
/// `PushService` created the object from that (`PouKindToCode(split.Kind)`). Measured against live SP21
/// (2026-09-17): pushing an item named `KindTest.fb` whose text said `PROGRAM` was ACCEPTED and produced
/// `KindTest.prg`. The file changes identity behind the engineer — and because the wire is keyed by the FULL
/// name, the next `ifVersion` gate names an item that no longer exists, so the same file can be pulled and
/// never pushed back.
///
/// The sibling rule is the same one CODESYS enforces for NAMES: an object called one thing holding a signature
/// calling itself another is an error ("The name used in the signature is not identical to the object name"),
/// not a rename. Kind is no different; it is simply the half nothing was checking.
/// </summary>
public class KindFromExtensionTests
{
    private const string ProgramText = "PROGRAM KindTest\nVAR\n\tn : INT;\nEND_VAR\n(* @volt-implementation *)\nn := n + 1;\nEND_PROGRAM";
    private const string FbText = "FUNCTION_BLOCK KindTest\nVAR\n\tn : INT;\nEND_VAR\n(* @volt-implementation *)\nn := n + 1;\nEND_FUNCTION_BLOCK";

    [Fact]
    public void The_wire_name_decides_the_kind_not_the_text()
    {
        Assert.Equal(ItemKind.Kinds.Program, StReader.Read(ProgramText, ItemKind.KindForWireName("KindTest.prg")).Kind);
        Assert.Equal(ItemKind.Kinds.FunctionBlock, StReader.Read(FbText, ItemKind.KindForWireName("KindTest.fb")).Kind);
    }

    [Fact]
    public void A_text_that_disagrees_with_the_extension_is_REFUSED_not_followed()
    {
        var ex = Assert.Throws<BridgeException>(() => StReader.Read(ProgramText, ItemKind.Kinds.FunctionBlock));
        Assert.Contains("function_block", ex.Message);
        Assert.Contains("program", ex.Message);
    }

    [Fact]
    public void A_DUT_agrees_at_the_WIRE_kind_whichever_file_extension_it_came_from()
    {
        // `.struct`/`.enum`/`.union`/`.alias` are four FILE spellings of one WIRE kind, so comparing file
        // extensions rather than wire kinds would refuse every DUT.
        const string st = "TYPE DUT_X :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE";
        Assert.Equal(ItemKind.Kinds.Dut, StReader.Read(st, ItemKind.KindForWireName("DUT_X.struct")).Kind);
        Assert.Equal(ItemKind.Kinds.Dut, StReader.Read(st, ItemKind.KindForWireName("DUT_X.dut")).Kind);
    }

    [Fact]
    public void Without_an_expected_kind_the_text_still_answers()
    {
        // The reader is still usable where no wire name exists (tests, and the ST format's own round-trip).
        Assert.Equal(ItemKind.Kinds.Program, StReader.Read(ProgramText).Kind);
    }
}
