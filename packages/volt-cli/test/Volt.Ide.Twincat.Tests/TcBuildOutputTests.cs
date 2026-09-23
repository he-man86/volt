using System.Linq;
using Volt.Ide.Twincat;
using Xunit;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// Parsing the IDE's Output pane into diagnostics. Offline: the parse is pure, the COM walk around it is not.
/// </summary>
public class TcBuildOutputTests
{
    [Fact]
    public void ReadsTheOrdinaryOneLineShape()
    {
        var parsed = TcObjectModel.ParsePaneText(
            "1>C:\\p\\MAIN.TcPOU(12,4) : error : 'x' is no component of 'Y'\r\n");
        var one = Assert.Single(parsed);
        Assert.Equal("'x' is no component of 'Y'", one.Message);
        Assert.Equal(12, one.Line);
        Assert.Equal(4, one.Column);
    }

    [Fact]
    public void KeepsAMessageThatSPANSLines()
    {
        // The bug this test exists for: the compiler quotes source text back at you, and that text carries its own
        // line break. `.` does not match a newline, so the message arrived as `The code '.size;` — no closing
        // quote, and the wire carried the truncation (found in the LSP conformance recordings, 2026-09-17).
        var parsed = TcObjectModel.ParsePaneText(
            "1>C:\\p\\MAIN.TcPOU(9,1) : warning : The code '.size;\r\n' has no effect. Is this the intent?\r\n");
        var one = Assert.Single(parsed);
        // the break is kept AS THE PANE WROTE IT — CODESYS records the same message with its CRLF intact
        Assert.Equal("The code '.size;\r\n' has no effect. Is this the intent?", one.Message);
    }

    [Fact]
    public void DoesNotSwallowTheNextDiagnosticOrTheBuildChrome()
    {
        // Continuation is recognised by an UNBALANCED quote, so a message with its quotes closed stops at its own
        // line however much chrome follows.
        var parsed = TcObjectModel.ParsePaneText(
            "1>------ Build started: Project: Untitled1 ------\r\n" +
            "1>C:\\p\\MAIN.TcPOU(3,1) : error : Identifier 'a' not defined\r\n" +
            "1>C:\\p\\MAIN.TcPOU(4,1) : error : Identifier 'b' not defined\r\n" +
            "1>Build FAILED.\r\n");
        Assert.Equal(2, parsed.Count);
        Assert.Equal("Identifier 'a' not defined", parsed[0].Message);
        Assert.Equal("Identifier 'b' not defined", parsed[1].Message);
    }

    /// <summary>
    /// AND AN APOSTROPHE IS A QUOTE. "Outputs can't be of type 'REFERENCE TO'" carries THREE of them - the
    /// contraction plus the pair around the type - so the odd-count rule read the message as unfinished and joined
    /// the build's summary line onto it. One row in 2524, and the last contaminated one: the chrome list held every
    /// other line the build writes about itself and not "Compile complete" (`cc4_output_reference_type`, 2026-09-20).
    /// </summary>
    [Fact]
    public void AnApostropheDoesNotSwallowTheCompileSummary()
    {
        var parsed = TcObjectModel.ParsePaneText(
            "1>C:\\p\\MAIN.TcPOU(2,1) : error : Outputs can't be of type 'REFERENCE TO'\r\n" +
            "1>Compile complete -- 1 errors, 0 warnings\r\n");
        var one = Assert.Single(parsed);
        Assert.Equal("Outputs can't be of type 'REFERENCE TO'", one.Message);
    }

    /// <summary>
    /// A COMPLETE MESSAGE CAN HAVE AN ODD NUMBER OF QUOTES, and the continuation heuristic must not read that as
    /// unterminated. It quotes SOURCE at you, and ST source is full of string literals: "String constant ''...'
    /// too long for destination type 'STRING(4)'" carries five quotes because the constant it names is itself
    /// `''`. The unbalanced-quote rule then joined line after line looking for a closing quote that never comes,
    /// swallowing the error list's own path echo and then the whole build log into one "message".
    ///
    /// Measured 2026-09-20 over the TwinCAT conformance recording: 24 diagnostics across ~24 fixtures carried
    /// build chrome this way, which made TwinCAT look like it disagreed with the LSP on a family of string
    /// warnings it actually reports identically.
    /// </summary>
    [Fact]
    public void AnOddQuoteCountInACompleteMessageDoesNotSwallowTheBuildLog()
    {
        var parsed = TcObjectModel.ParsePaneText(
            "1>C:\\p\\MAIN.TcPOU(3,1) : warning : String constant ''...' too long for destination type 'STRING(4)'\r\n" +
            "1>C:\\p\\MAIN.TcPOU(3) : warning: String constant ''...' too long for destination type 'STRING(4)'\r\n" +
            "1>Size of generated code: 69708 bytes\r\n" +
            "1>Build complete -- 0 errors, 2 warnings : ready for download!\r\n");
        Assert.Equal(2, parsed.Count);
        foreach (var d in parsed)
        {
            Assert.DoesNotContain("Size of generated code", d.Message);
            Assert.DoesNotContain("Build complete", d.Message);
            Assert.DoesNotContain(".TcPOU", d.Message);
        }
    }

    [Fact]
    public void AnUnclosedQuoteAtTheEndOfThePaneDoesNotHang()
    {
        var parsed = TcObjectModel.ParsePaneText("1>MAIN(1,1) : error : unterminated 'quote\r\n");
        Assert.Single(parsed);
    }

    [Fact]
    public void ChromeAloneParsesToNothing()
    {
        Assert.Empty(TcObjectModel.ParsePaneText("1>------ Build started ------\r\n1>Build succeeded.\r\n"));
    }

    /// <summary>THE ITEM THE COMPILER NAMED. Group 1 of the pane regex always held it and the capture was
    /// dropped, so a diagnostic carried a line number with no file to anchor it to — a client had a position
    /// and nowhere to put it. The name is BARE here on purpose: `.TcPOU` is one vendor file type covering
    /// `prg`, `fb` and `func`, so only the declaration (read above this seam) can say which wire kind it is.</summary>
    [Fact]
    public void NamesTheItemTheCompilerNamed()
    {
        var parsed = TcObjectModel.ParsePaneText(
            "1>C:\\p\\POUs\\FB_Motor.TcPOU(12,4) : error : 'x' is no component of 'Y'\r\n");
        Assert.Equal("FB_Motor", Assert.Single(parsed).Name);
    }

    /// <summary>A PROJECT-level message names no item. MSBuild writes the solution caption where a path would
    /// go, and calling that a POU would point an editor at a file that does not exist.
    ///
    /// <para>A SPACE is the whole test, on purpose: an IEC identifier cannot contain one, so a caption is
    /// recognisable while a single bare word is NOT -- `1&gt;Build : error : ...` is shaped exactly like a
    /// project named `Build`. This layer cannot tell them apart and does not try. The engine resolves the name
    /// against the real tree and drops what matches no item, which is the only place that question can be
    /// answered (`BuildDiagnosticNameTests.An_unknown_name_never_leaks_through_as_a_bare_one`).</para></summary>
    [Fact]
    public void AProjectLevelMessageNamesNothing()
    {
        var pane = "1>TwinCAT Project1 : error : the configuration could not be activated\r\n";
        Assert.Null(Assert.Single(TcObjectModel.ParsePaneText(pane)).Name);
    }

    /// <summary>The same error in two panes still dedupes, and two errors that differ ONLY by which item they
    /// are about now both survive — the dedupe key grew a field and must not have lost one.</summary>
    [Fact]
    public void TwoItemsWithTheSameErrorBothSurvive()
    {
        var parsed = TcObjectModel.ParsePaneText(
            "1>C:\\p\\A.TcPOU(3,1) : error : Identifier 'a' not defined\r\n" +
            "1>C:\\p\\B.TcPOU(3,1) : error : Identifier 'a' not defined\r\n");
        Assert.Equal(new[] { "A", "B" }, parsed.Select(d => d.Name));
    }
}
