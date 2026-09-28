using System;
using System.IO;
using System.Linq;
using Volt.Engine.Library;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// Referenced-library signatures on TwinCAT — parsed from REAL vendor bytes.
///
/// <para><c>library-signatures.xml</c> is a verbatim excerpt of what
/// <c>_ITcPlcLibraryManager.ProduceAllLibrarySignatures()</c> returned from the live IDE (181,179 chars in
/// full), trimmed to two libraries carrying one of each of the five <c>TypeSignature</c> kinds. Nothing in it
/// is hand-written, which is the point: a parser gated against invented input proves only that it agrees with
/// whoever invented it.</para>
///
/// <para>Volt shipped NO library signatures on this vendor at all before — the driver inherited an empty
/// implementation, so completion, hover and go-to-definition on a <c>TON</c> silently did nothing on TwinCAT
/// and worked on CODESYS.</para>
/// </summary>
public class TcLibrarySignaturesTests
{
    private static string Xml() => Fixtures.Pou("library-signatures.xml");

    /// <summary>THE CONCATENATION. The vendor returns each library's XML one after another, so the payload has
    /// several roots and is not a well-formed document — feeding it straight to a parser throws, which is why
    /// this is asserted first rather than assumed.</summary>
    [Fact]
    public void Reads_several_concatenated_library_roots()
    {
        var raw = Xml();
        Assert.Equal(2, raw.Split("<Library>").Length - 1);
        Assert.Throws<System.Xml.XmlException>(() => System.Xml.Linq.XElement.Parse(raw));

        var sigs = TcLibrarySignatures.Parse(raw);

        Assert.Contains(sigs, s => s.LibraryPath.StartsWith("Tc2_Standard,", StringComparison.Ordinal));
        Assert.Contains(sigs, s => s.LibraryPath.StartsWith("Tc2_System,", StringComparison.Ordinal));
    }

    /// <summary>The library identity must be spelled the way <see cref="LibraryManifest.Resolution"/> spells it,
    /// because <c>LibraryFetch</c> joins a signature to its <c>.library</c> ref by that exact string. Get it
    /// wrong and every element lands under "(unresolved)" instead of beside its library.</summary>
    [Fact]
    public void Library_identity_matches_the_manifest_resolution()
    {
        var sig = TcLibrarySignatures.Parse(Xml()).First(s => s.Name == "RS");

        Assert.Equal(LibraryManifest.Resolution("Tc2_Standard", "3.4.5.0", "Beckhoff Automation GmbH"), sig.LibraryPath);
    }

    [Fact]
    public void A_function_block_keeps_its_pins()
    {
        var rs = TcLibrarySignatures.Parse(Xml()).First(s => s.Name == "RS");

        Assert.Equal("FunctionBlock", rs.PouType);
        Assert.Equal(new[] { "SET", "RESET1" }, rs.Inputs.Select(v => v.Name));
        Assert.All(rs.Inputs, v => Assert.Equal("BOOL", v.Type));
        Assert.Equal(new[] { "Q1" }, rs.Outputs.Select(v => v.Name));
    }

    /// <summary>A FUNCTION'S RETURN ARRIVES AS AN OUTPUT NAMED AFTER THE FUNCTION — <c>CONCAT</c> returns
    /// <c>STRING(255)</c> through an <c>&lt;Output&gt;</c> called <c>CONCAT</c>. The parser hands outputs over
    /// verbatim and lets <c>LibSignatureRenderer</c> lift it, so this asserts the RENDERED text: the return is
    /// on the signature line and does NOT also appear as a VAR_OUTPUT.</summary>
    [Fact]
    public void A_functions_return_is_lifted_out_of_its_outputs()
    {
        var concat = TcLibrarySignatures.Parse(Xml()).First(s => s.Name == "CONCAT");
        Assert.Equal(new[] { "CONCAT" }, concat.Outputs.Select(v => v.Name));

        var rendered = LibSignatureRenderer.Render(concat);

        Assert.NotNull(rendered);
        Assert.Equal(".fun", rendered!.Value.Ext);
        Assert.Contains("FUNCTION CONCAT : STRING(255)", rendered.Value.Text);
        Assert.Contains("STR1 : STRING(255)", rendered.Value.Text);
        Assert.DoesNotContain("VAR_OUTPUT", rendered.Value.Text);
    }

    [Fact]
    public void A_global_variable_list_keeps_its_constants()
    {
        var gvl = TcLibrarySignatures.Parse(Xml()).First(s => s.PouType == "VarGlobal");

        Assert.NotEmpty(gvl.Members);
        Assert.All(gvl.Members, v => Assert.NotEqual("", v.Type));
    }

    /// <summary>A TWINCAT LIBRARY ENUM IS AN ENUM. The vendor sends <c>E_WATCHDOG_TIME_CONFIG</c> (real bytes, above)
    /// as a <c>VarGlobal</c> whose every constant is typed as the container itself, and it has no flag to say
    /// "enum" — that self-typing IS its only statement of one. Rendered as a GVL it declares
    /// <c>eWATCHDOG_TIME_DISABLED : E_WATCHDOG_TIME_CONFIG</c> against a type no file declares, so every library FB
    /// taking one (Tc2_System's <c>FB_FileOpen</c> takes an <c>E_OpenPath</c>) resolves to an undeclared type. That
    /// shipped when the renderer began trusting only CODESYS's <c>Enum</c> flag (a8f7e0d715): twelve Tc2_System
    /// enums of Project14 re-pulled as <c>.gvl</c>.</summary>
    [Fact]
    public void A_library_enum_renders_as_an_enum()
    {
        var sig = TcLibrarySignatures.Parse(Xml()).First(s => s.Name == "E_WATCHDOG_TIME_CONFIG");

        var rendered = LibSignatureRenderer.Render(sig);

        Assert.NotNull(rendered);
        Assert.Equal(".enum", rendered!.Value.Ext);
        Assert.Equal("TYPE E_WATCHDOG_TIME_CONFIG :\n(\n\teWATCHDOG_TIME_DISABLED,\n\teWATCHDOG_TIME_SECONDS,\n" +
                     "\teWATCHDOG_TIME_MINUTES\n);\nEND_TYPE", rendered.Value.Text);
    }

    /// <summary>The other half: a <c>VarGlobal</c> whose constants are typed as something else is a GVL, as
    /// Tc2_System's <c>Global_Version</c> is (<c>stLibVersion_Tc2_System : ST_LibVersion</c>). The element is
    /// the vendor's shape, excerpted to the one constant.</summary>
    [Fact]
    public void A_library_gvl_stays_a_gvl()
    {
        const string xml = "<Library><LibraryName>Tc2_System</LibraryName><Version>3.10.1.0</Version>" +
            "<Distributor>Beckhoff Automation GmbH</Distributor><TypeSignatures><TypeSignature type=\"VarGlobal\">" +
            "<Name>Global_Version</Name><Constants><Constant><Name>stLibVersion_Tc2_System</Name>" +
            "<DataType>ST_LibVersion</DataType></Constant></Constants></TypeSignature></TypeSignatures></Library>";

        var rendered = LibSignatureRenderer.Render(TcLibrarySignatures.Parse(xml).Single());

        Assert.Equal(".gvl", rendered!.Value.Ext);
        Assert.Equal("VAR_GLOBAL\n\tstLibVersion_Tc2_System : ST_LibVersion;\nEND_VAR", rendered.Value.Text);
    }

    /// <summary>A NAME-ONLY KIND IS NOT EMITTED, and that is the deliberate half of this work.
    ///
    /// <para>TwinCAT describes a <c>Type</c> and an <c>Interface</c> by name alone — no fields, no methods. The
    /// renderer would still render them, and that is the danger: a member-less <c>Type</c> becomes
    /// <c>TYPE X : STRUCT END_STRUCT END_TYPE</c>, which does not merely omit the fields, it ASSERTS THERE ARE
    /// NONE — so every <c>x.field</c> an engineer writes becomes a false error. Emitting nothing costs one
    /// unknown-type error at the declaration; emitting an empty body costs a wrong error at every use.</para></summary>
    [Fact]
    public void A_type_or_interface_with_no_body_is_not_emitted()
    {
        var raw = Xml();
        Assert.Contains("type=\"Type\"", raw);
        Assert.Contains("type=\"Interface\"", raw);

        var sigs = TcLibrarySignatures.Parse(raw);

        Assert.DoesNotContain(sigs, s => s.PouType == "Type");
        Assert.DoesNotContain(sigs, s => s.PouType == "Interface");
        Assert.DoesNotContain(sigs.Select(s => LibSignatureRenderer.Render(s)?.Text ?? ""),
                              t => t.Contains("STRUCT\nEND_STRUCT"));
    }

    /// <summary>Nothing in, nothing out — a project with no references is not an error.</summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void No_libraries_is_not_a_failure(string? xml) =>
        Assert.Empty(TcLibrarySignatures.Parse(xml));

    /// <summary>A payload the IDE produced but Volt could not parse must FAIL, not read as "this project has no
    /// libraries" — that answer would make the LSP mark every library call unresolved and look like the
    /// engineer's mistake.</summary>
    [Fact]
    public void Malformed_xml_fails_loudly()
    {
        var ex = Assert.Throws<InvalidOperationException>(() => TcLibrarySignatures.Parse("<Library><oops>"));
        Assert.Contains("did not parse", ex.Message);
    }
}
