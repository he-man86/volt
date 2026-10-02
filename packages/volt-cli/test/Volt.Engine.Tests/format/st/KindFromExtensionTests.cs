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
/// `KindTest.prg`.
///
/// The first fix read the header anyway and REFUSED a text whose header disagreed with the extension. That is
/// gone too (openspec `push-without-header-check`): a top-level item's header is never read — not for the kind,
/// not to check it, not to refuse. The text is written as sent, and the IDE's build reports what is wrong with
/// it. `StReader.Read` takes the kind as a REQUIRED argument, so there is no path left on which the text decides.
/// </summary>
public class KindFromExtensionTests
{
    private const string ProgramText = "PROGRAM KindTest\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := n + 1;\nEND_PROGRAM";
    private const string FbText = "FUNCTION_BLOCK KindTest\nVAR\n\tn : INT;\nEND_VAR\nIMPLEMENTATION ST\nn := n + 1;\nEND_FUNCTION_BLOCK";

    [Fact]
    public void The_wire_name_decides_the_kind_not_the_text()
    {
        Assert.Equal(ItemKind.Kinds.Program, StReader.Read(ProgramText, ItemKind.KindForWireName("KindTest.prg")!).Kind);
        Assert.Equal(ItemKind.Kinds.FunctionBlock, StReader.Read(FbText, ItemKind.KindForWireName("KindTest.fb")!).Kind);
    }

    /// <summary>A text whose header disagrees with the extension is read AS the extension's kind, its declaration
    /// verbatim — never refused for its header, never followed.</summary>
    [Fact]
    public void A_text_that_disagrees_with_the_extension_is_read_as_the_extension_says()
    {
        var item = StReader.Read(ProgramText, ItemKind.Kinds.FunctionBlock);

        Assert.Equal(ItemKind.Kinds.FunctionBlock, item.Kind);
        Assert.Equal("PROGRAM KindTest\nVAR\n\tn : INT;\nEND_VAR", item.Declaration);
        Assert.Equal("n := n + 1;", item.Body);
    }

    /// <summary>`.dut` hands the reader the DUT kind, and the text is a DUT's one declaration handed over as sent —
    /// even when it is not a DUT at all: the IDE's build judges it. Premise changed by the owner (openspec
    /// `push-without-header-check` 5.P): this walked the four subtype names; every DUT is `.dut` now.</summary>
    [Fact]
    public void A_DUT_is_the_DUT_kind_and_its_text_is_not_read()
    {
        const string st = "TYPE DUT_X :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE";
        const string name = "DUT_X.dut";
        Assert.Equal(ItemKind.Kinds.Dut, ItemKind.KindForWireName(name));
        Assert.Equal(st, StReader.Read(st, ItemKind.KindForWireName(name)!).Declaration);
        var program = StReader.Read(ProgramText, ItemKind.KindForWireName(name)!);
        Assert.Equal(ItemKind.Kinds.Dut, program.Kind);
        Assert.Equal(ProgramText, program.Declaration);
    }
}
