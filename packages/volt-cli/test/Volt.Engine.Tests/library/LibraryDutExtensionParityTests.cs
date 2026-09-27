using Xunit;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Volt.Engine.Library;
using Volt.Engine.Sync;

namespace Volt.Engine.Tests;

/// <summary>
/// A LIBRARY DUT AND A PROJECT DUT OF THE SAME SHAPE CARRY THE SAME EXTENSION (openspec
/// <c>dut-subtype-on-the-wire</c>, scenario "project and library DUTs agree").
///
/// <para>The wire was inconsistent before that change: <c>LibSignatureRenderer</c> named a library's DUTs
/// <c>.enum</c>/<c>.struct</c>/<c>.union</c>/<c>.alias</c> itself, while the project's own DUTs travelled as
/// <c>.dut</c> and were renamed in the CLI. Two namings of one shape meant two classifiers that could disagree
/// about the same text; the LSP and every client then see a library enum and a project enum under different
/// extensions.</para>
///
/// <para>So this pins agreement at the NAME, for every shape the renderer produces: the renderer's extension, the
/// extension the project materializer mints for the very text the renderer wrote, and the one subtype reader
/// (<c>CodeHelper.DutSubtype</c>) all say the same thing.</para>
/// </summary>
public class LibraryDutExtensionParityTests
{
    private static readonly LibVar[] None = new LibVar[0];

    public static TheoryData<LibSignature, string> Shapes => new()
    {
        { new LibSignature("PERIODE", "lib", "VarGlobal", None, None, None,
              new[] { new LibVar("UNKNOWN", "PERIODE", "0"), new LibVar("STANDARD", "PERIODE", "1") },
              null, null, Flags: "Enum"), ".enum" },
        { new LibSignature("PT", "lib", "Type", None, None, None,
              new[] { new LibVar("Lo", "INT"), new LibVar("Hi", "INT") }, null, null), ".struct" },
        { new LibSignature("U", "lib", "Type", None, None, None,
              new[] { new LibVar("asWord", "WORD") }, null, null, null, "Union"), ".union" },
        { new LibSignature("HANDLE", "CAA Types", "Type", None, None, None, None, null, null, "__XWORD"), ".alias" },
    };

    [Theory]
    [MemberData(nameof(Shapes))]
    public void A_library_dut_and_a_project_dut_of_the_same_shape_carry_the_same_extension(LibSignature sig, string ext)
    {
        var (libExt, text) = LibSignatureRenderer.Render(sig)!.Value;

        // The same declaration, held by the PROJECT as a DUT, materialized through the one wire-name minting site.
        var ide = new FakeIde(new FakeIde.Item(sig.Name, ItemKind.PlcDut, "DUTs", true, text, null, null, null));
        var projectName = Materializer.Materialize(ide, sig.Name, ItemKind.Kinds.Dut, new ItemRef(sig.Name)).FullName;

        Assert.Equal(ext, libExt);
        Assert.Equal(sig.Name + libExt, projectName);
        Assert.Equal("." + CodeHelper.DutSubtype(text), libExt);
    }
}
