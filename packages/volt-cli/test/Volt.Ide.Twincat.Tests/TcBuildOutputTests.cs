using System.Collections.Generic;
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
        var parsed = Collect(
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
        var parsed = Collect(
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
        var parsed = Collect(
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
        var parsed = Collect(
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
        var parsed = Collect(
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
        var parsed = Collect("1>MAIN(1,1) : error : unterminated 'quote\r\n");
        Assert.Single(parsed);
    }

    [Fact]
    public void ChromeAloneParsesToNothing()
    {
        Assert.Empty(Collect("1>------ Build started ------\r\n1>Build succeeded.\r\n"));
    }

    /// <summary>THE ITEM THE COMPILER NAMED. Group 1 of the pane regex always held it and the capture was
    /// dropped, so a diagnostic carried a line number with no file to anchor it to — a client had a position
    /// and nowhere to put it. The name is BARE here on purpose: `.TcPOU` is one vendor file type covering
    /// `prg`, `fb` and `func`, so only the declaration (read above this seam) can say which wire kind it is.</summary>
    [Fact]
    public void NamesTheItemTheCompilerNamed()
    {
        var parsed = Collect(
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
        Assert.Null(Assert.Single(Collect(pane)).Name);
    }

    /// <summary>A CHILD'S ERROR NAMES THE POU AND THE CHILD (openspec <c>codesys-diagnostic-child-names</c> 3.3). Measured on
    /// live TcXaeShell 15.0, 2026-10-01: an error inside a method, a property accessor or an action is written as
    /// <c>FILE.TcPOU;POU.Member(line)</c> - the file, a semicolon, then the object's dotted path - and a property accessor
    /// adds its own segment (<c>POU.Prop.Get</c>). The stem test read <c>FB.TcPOU;FB</c> as the item name, which no item
    /// has, so the engine dropped it: every such diagnostic reached the wire with no name - the same gap CODESYS had,
    /// by a different route. The accessor names its PROPERTY: GET/SET are read with it, not beside it.</summary>
    [Theory]
    [InlineData("VltE2E_raw.Compute(6)", "Compute", 6)]
    [InlineData("VltE2E_raw.Prop.Get(2)", "Prop", 2)]
    [InlineData("VltE2E_raw.Act(3)", "Act", 3)]
    public void AChildsErrorNamesThePouAndTheMember(string tail, string member, int line)
    {
        var pane = @"C:\p\TwinCAT Project14\POUs\VltE2E_raw.TcPOU;" + tail + " : error: Identifier 'zz' not defined" + CR;
        var one = Assert.Single(Collect(pane));
        Assert.Equal(("VltE2E_raw", member, line), (one.Name, one.Member, one.Line));
    }

    /// <summary>The POU's own body: the measured line has no semicolon, and no member.</summary>
    [Fact]
    public void AnErrorInThePousOwnBodyHasNoMember()
    {
        var pane = @"C:\p\POUs\VltE2E_raw.TcPOU(6) : error: Identifier 'zzSelf' not defined" + CR;
        var one = Assert.Single(Collect(pane));
        Assert.Equal(("VltE2E_raw", (string?)null), (one.Name, one.Member));
    }

    /// <summary>Two methods of one POU with the same error on the same line are TWO diagnostics. With the member folded
    /// into the item name they now share a <see cref="Volt.Contracts.BridgeDiagnostic.Name"/>, so the cross-pane dedupe
    /// key must carry the member too, or the second method's error is dropped as a duplicate of the first.</summary>
    [Fact]
    public void TwoMembersWithTheSameErrorAreNotDuplicates()
    {
        var kept = Collect(
            @"C:\p\FB.TcPOU;FB.A(6) : error: Identifier 'zz' not defined" + CR +
            @"C:\p\FB.TcPOU;FB.B(6) : error: Identifier 'zz' not defined" + CR);
        Assert.Equal(new[] { "A", "B" }, kept.Select(d => d.Member));
    }

    /// <summary>A GET and a SET of one property with the same error on the same line are TWO diagnostics. Both publish
    /// <c>member</c> = the PROPERTY (an accessor is read with its property, the same answer CODESYS gives), so a dedupe
    /// key built from what the wire carries cannot tell them apart - and TwinCAT writes no column (<c>(2)</c>), so not
    /// even that differs. The second was dropped as a duplicate of the first while CODESYS returned both. The key is the
    /// OBJECT the compiler named (<c>FB.Prop.Get</c> against <c>FB.Prop.Set</c>), not the member it is published as.</summary>
    [Fact]
    public void AGetAndASetWithTheSameErrorAreNotDuplicates()
    {
        var kept = Collect(
            @"C:\p\FB.TcPOU;FB.Prop.Get(2) : error: Identifier 'zz' not defined" + CR +
            @"C:\p\FB.TcPOU;FB.Prop.Set(2) : error: Identifier 'zz' not defined" + CR);
        Assert.Equal(new (string?, string?)[] { ("FB", "Prop"), ("FB", "Prop") }, kept.Select(d => (d.Name, d.Member)));
    }

    /// <summary>ONE error, two panes, ONE diagnostic: Visual Studio's Build pane prefixes MSBuild's project number
    /// (<c>1&gt;</c>) and TwinCAT's own pane does not, and the dedupe must see through that or the engineer gets every
    /// error twice.</summary>
    [Fact]
    public void TheSameChildErrorInTwoPanesIsOneDiagnostic()
    {
        var kept = Collect(
            @"1>C:\p\FB.TcPOU;FB.Compute(6) : error: Identifier 'zz' not defined" + CR,
            @"C:\p\FB.TcPOU;FB.Compute(6) : error: Identifier 'zz' not defined" + CR);
        Assert.Equal(("FB", "Compute"), (Assert.Single(kept).Name, kept[0].Member));
    }

    /// <summary>The object path must be UNDER the file's own POU: <c>FB.TcPOU;FB.Compute</c>. A path whose first segment
    /// is something else is a shape nobody measured, and reading its second segment as a member of <c>FB</c> would be a
    /// guess. It is published unanchored - the message survives, the location is not invented.</summary>
    [Fact]
    public void AnObjectPathOutsideTheFilesPouNamesNothing()
    {
        var one = Assert.Single(Collect(@"C:\p\FB.TcPOU;Other.Compute(6) : error: Identifier 'zz' not defined" + CR));
        Assert.Equal(((string?)null, (string?)null), (one.Name, one.Member));
        Assert.Equal("Identifier 'zz' not defined", one.Message);
    }

    private static List<Volt.Contracts.BridgeDiagnostic> Collect(params string[] panes)
    {
        var seen = new HashSet<string>(System.StringComparer.Ordinal);
        var kept = new List<Volt.Contracts.BridgeDiagnostic>();
        foreach (var pane in panes) TcObjectModel.CollectPane(pane, seen, kept);
        return kept;
    }

    private const string CR = "\r\n";

    /// <summary>The same error in two panes still dedupes, and two errors that differ ONLY by which item they
    /// are about now both survive — the dedupe key grew a field and must not have lost one.</summary>
    [Fact]
    public void TwoItemsWithTheSameErrorBothSurvive()
    {
        var parsed = Collect(
            "1>C:\\p\\A.TcPOU(3,1) : error : Identifier 'a' not defined\r\n" +
            "1>C:\\p\\B.TcPOU(3,1) : error : Identifier 'a' not defined\r\n");
        Assert.Equal(new[] { "A", "B" }, parsed.Select(d => d.Name));
    }
}
