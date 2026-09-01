using System.Linq;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;
using Xunit.Abstractions;

namespace Volt.Engine.Tests;

/// <summary>
/// A POU's declaration comes from the IDE, not from an optional vendor extension in its export.
///
/// <para><c>InterfaceAsPlainText</c> is not part of PLCopen. It is a vendor <c>addData</c> block, and the TC6 XSD
/// defines <c>addData</c> as <i>"application specific data defined in external schemata"</i> with a REQUIRED
/// <c>handleUnknown</c> attribute enumerating <c>preserve</c> / <c>discard</c> / <c>implementation</c>. The
/// standard has a vocabulary for DISMISSING vendor data — so requiring one such block is requiring something the
/// specification says a processor may drop.</para>
///
/// <para><b>And one did.</b> Live TwinCAT, 2026-08-27: every POU failed to materialize, and `refs` answered with
/// libraries, DUTs, GVLs and a task and no POUs at all. Measured — 8 of 8 recorded June exports carry the block
/// (two of them for POUs with NO variables, so it was emitted unconditionally); 0 of 2 live exports do, and one
/// of those declares 45 variables. Reproduced through the COM interface AND the IDE's own export.</para>
///
/// <para>The declaration was never lost: it is in the typed <c>&lt;interface&gt;</c>, and it is in the object
/// model's own aspect, exactly as the engineer typed it. The typed form is not a substitute — 45 typed variables
/// reproduce names and types, never the engineer's alignment or the blank line before <c>END_VAR</c> — so the
/// aspect is the only source that is both always present and exact.</para>
/// </summary>
public class MaterializerDeclarationTransportTests
{
    private readonly ITestOutputHelper _out;
    public MaterializerDeclarationTransportTests(ITestOutputHelper o) => _out = o;

    /// <summary>A declaration with formatting a typed <c>&lt;interface&gt;</c> could never reproduce: column
    /// alignment, one variable deliberately out of line, and a blank line before END_VAR.</summary>
    private const string Awkward =
        "FUNCTION_BLOCK FB_P\nVAR_INPUT\n\txEmergencyStop  : BOOL;\n\txRemoteMode                 : BOOL;\n\n" +
        "END_VAR\n";

    /// <summary>THE live TwinCAT shape: the export omits the plaintext block, the aspect has the declaration.
    /// <para>RED before this change — <c>BuildPouFromXml</c> threw "a POU document without a declaration is a
    /// broken export" on every POU of both fixture projects.</para></summary>
    [Fact]
    public void A_pou_materializes_when_the_export_omits_the_plaintext_block()
    {
        var ide = new FakeIde { OmitsPlaintextDeclaration = true };
        ide.AddItem(new FakeIde.Item("FB_P", ItemKind.PlcPouFb, "", true, Awkward, "x := 1;", null, null));

        var ex = Record.Exception(() => Materializer.Materialize(ide, "FB_P", "function_block", new ItemRef("FB_P")));
        Assert.True(ex is null,
            "a POU whose export omits the OPTIONAL interfaceasplaintext block is unreadable — this is live " +
            $"TwinCAT, on every POU: {ex?.Message}");
    }

    /// <summary>And it is the engineer's text, byte for byte — not a rendering of the typed interface.
    /// <para>This is the half that stops "fix the throw" turning into "generate something plausible": the
    /// alignment and the blank line below survive only if the declaration came from the aspect.</para></summary>
    [Fact]
    public void The_declaration_is_the_engineers_text_not_a_rendering()
    {
        var ide = new FakeIde { OmitsPlaintextDeclaration = true };
        ide.AddItem(new FakeIde.Item("FB_P", ItemKind.PlcPouFb, "", true, Awkward, "x := 1;", null, null));

        var text = Materializer.Materialize(ide, "FB_P", "function_block", new ItemRef("FB_P")).Text;
        _out.WriteLine(text);

        Assert.Contains("xEmergencyStop  : BOOL;", text);            // the alignment
        Assert.Contains("xRemoteMode                 : BOOL;", text); // and the odd column
    }

    /// <summary>An export that DOES carry the block still works — the change must not swap one vendor's breakage
    /// for the other's. CODESYS emits it today, and its e2e suite is green on it.</summary>
    [Fact]
    public void A_pou_whose_export_carries_the_block_is_unaffected()
    {
        var ide = new FakeIde();   // emits interfaceasplaintext, as CODESYS does
        ide.AddItem(new FakeIde.Item("FB_Q", ItemKind.PlcPouFb, "", true, Awkward, "x := 1;", null, null));

        var text = Materializer.Materialize(ide, "FB_Q", "function_block", new ItemRef("FB_Q")).Text;
        Assert.Contains("xEmergencyStop  : BOOL;", text);
    }
}
