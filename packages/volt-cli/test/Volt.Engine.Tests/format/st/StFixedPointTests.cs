using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Xunit;
using Volt.Engine.Format.St;
using Volt.Engine.Item;

namespace Volt.Engine.Tests;

/// <summary>
/// <b>THE ROUND-TRIP INVARIANT: what a pull writes, a push must be able to send back unchanged.</b>
///
/// <para>A workspace file is <see cref="StWriter"/>'s output, and a push feeds it straight back through
/// <see cref="StReader"/>. So <c>Write(Read(x)) == x</c> is not a nicety — it IS the guarantee that pulling a
/// project and pushing it again is a no-op, and every byte the pair disagrees on is a byte an engineer's project
/// silently loses or gains. This gate holds the WHOLE emitted text to the file, not a field of it, because the
/// failures below were all boundary whitespace: no assertion about a declaration's content would have seen one
/// of them.</para>
///
/// <para><b>Why one gate instead of a test per bug.</b> These fixtures are the shapes a sweep of five real
/// customer projects turned up — 55 files across 902 that Volt could not take its own output back from. They
/// are not six independent defects; they are six faces of one thing, that the declaration/implementation
/// boundary is IMPLICIT in the file and both sides have to agree on where it is. A new emitter rule or reader
/// rule that gets any face wrong fails here, including the faces nobody has hit yet — which is what a per-bug
/// test cannot do. When a live corpus turns up a seventh shape, it belongs in this folder, not in a new class.</para>
///
/// <para>Sweeping real projects is still worth doing and is NOT a build-agent job (the corpora are large and
/// live outside volt-cli): set <c>VOLT_CORPUS</c> to `packages/volt-lsp-iec/test-corpus` and
/// <see cref="Every_file_in_a_real_corpus_survives_a_round_trip"/> runs the same assertion over all of them.</para>
/// </summary>
public class StFixedPointTests
{
    private readonly Xunit.Abstractions.ITestOutputHelper _out;

    public StFixedPointTests(Xunit.Abstractions.ITestOutputHelper output) => _out = output;

    /// <summary>Each vendor's name for the referenced-library tree. Kept beside the sweep that uses it, because
    /// the finder (`scripts/corpus-migration.ts`) needs the same pair and the two drifting apart is how one
    /// vendor's signatures quietly enter a gate that was never meant to judge them.</summary>
    private static readonly string[] LibraryFolders = { "Library Manager", "References" };

    private static readonly string FixtureDir =
        Path.Combine(AppContext.BaseDirectory, "fixtures", "st-fixed-point");

    public static TheoryData<string> Fixtures()
    {
        var data = new TheoryData<string>();
        foreach (var f in Directory.GetFiles(FixtureDir).OrderBy(f => f, StringComparer.Ordinal))
            data.Add(Path.GetFileName(f));
        return data;
    }

    [Theory]
    [MemberData(nameof(Fixtures))]
    public void A_pulled_file_reads_and_writes_back_byte_for_byte(string fixture)
    {
        var text = Read(Path.Combine(FixtureDir, fixture));
        Assert.Equal(text, StWriter.Write(StReader.Read(text)));
    }

    /// <summary>The boundary is implicit, so the two sides have to agree on it TWICE — once about where the
    /// declaration ends, once about which blank lines are separator. This pins the first half directly: text a
    /// human would call "the header" must come back as the DECLARATION, never as executable code. A function
    /// block whose base class lands in its body still round-trips as text; it stops being a derived function
    /// block in the IDE, which is the failure the byte comparison alone cannot describe.</summary>
    [Fact]
    public void A_wrapped_header_is_declaration_not_body()
    {
        var item = StReader.Read(Read(Path.Combine(FixtureDir, "wrapped-header-no-var-section.fb")));

        Assert.Contains("EXTENDS Cylinder_52ValveFB", item.Declaration);
        Assert.Contains("IMPLEMENTS IActuator", item.Declaration);
        Assert.DoesNotContain("EXTENDS", item.Body ?? "");
        Assert.DoesNotContain("IMPLEMENTS", item.Body ?? "");
    }

    /// <summary>The other half: a member's leading documentation belongs to the MEMBER. `IModuleBase` kept a
    /// 23-line usage example on the interface itself because the walk that claims a member's trivia could not
    /// see that ` *)` closes a comment opened twenty lines earlier.</summary>
    [Fact]
    public void A_block_comment_above_a_member_belongs_to_that_member()
    {
        var item = StReader.Read(Read(Path.Combine(FixtureDir, "block-comment-with-a-blank-line-above-a-member.itf")));

        var eStop = item.Members.Single(m => m.Name == "EStop");
        Assert.Contains("Add code here to handle emergency stops", eStop.Declaration);
        Assert.DoesNotContain("Add code here to handle emergency stops", item.Declaration);
        // …and the interface's own wrapped header stays where it belongs.
        Assert.Contains("EXTENDS IAbleToRegister", item.Declaration);
    }

    /// <summary>An ACTION's trailing comment is BODY, and this is the one boundary question the byte gate above
    /// cannot answer.
    ///
    /// <para>An action is the single member with no declaration to write: IEC gives it a name and a body and
    /// nothing else, so both drivers pass <c>null</c> where every other member passes its declaration. A line
    /// that lands in an action's declaration is therefore not misplaced, it is DELETED on the next push — and
    /// the file still round-trips byte for byte, because the writer joins declaration and body with the single
    /// newline the reader split on. Twelve actions across the corpora are comment-ONLY; for those the whole
    /// content would go. The assertion has to be about the split, not about the text.</para></summary>
    [Fact]
    public void An_actions_trailing_comment_is_body_because_an_action_has_no_declaration()
    {
        var item = StReader.Read(Read(Path.Combine(FixtureDir, "action-with-a-leading-comment.fb")));

        var action = item.Members.Single(m => m.Kind == ItemKind.Kinds.Action);
        Assert.Equal("ACTION Reset", action.Declaration);
        Assert.Contains("Put every axis back to its home position", action.Body);
    }

    /// <summary>A header's `: type` wraps too, and the wrapped line is DECLARATION.
    ///
    /// <para>`EXTENDS`/`IMPLEMENTS` were already understood as continuations; a return type on its own line is
    /// the same shape and CODESYS writes it that way. The rule needs no vocabulary — no valid ST statement
    /// begins with a colon — so this is the one continuation form that can be recognised without knowing a
    /// keyword. Byte-identical either way, like every member-level boundary move, so the assertion is about the
    /// split.</para></summary>
    [Fact]
    public void A_wrapped_return_type_is_declaration_not_the_first_line_of_the_body()
    {
        var item = StReader.Read(Read(Path.Combine(FixtureDir, "wrapped-return-type-no-var-section.fun")));

        Assert.Contains(": REAL", item.Declaration);
        Assert.DoesNotContain("REAL", item.Body ?? "");
        Assert.Equal("Compute := 2.0;", item.Body);
    }

    /// <summary>A PROPERTY signature's trailing comment is not part of its DATA TYPE.
    ///
    /// <para>The method parser strips comments before matching and says why; the property parser matched the raw
    /// line, so `PROPERTY Ready : BOOL // the ready flag` produced a data type of `BOOL // the ready flag` —
    /// which <c>PushService.CreateSeed</c> hands to TwinCAT as the property's declared type. No corpus property
    /// carries a comment today and 207 method signatures do, so this was latent rather than absent: the same
    /// ordinary habit, arriving at the one parser that could not take it.</para></summary>
    [Fact]
    public void A_property_signatures_trailing_comment_is_not_part_of_its_type()
    {
        var item = StReader.Read(
            "FUNCTION_BLOCK Machine\nVAR\nEND_VAR\n(* @volt-implementation *)\n;\n\nEND_FUNCTION_BLOCK\n\n" +
            "PROPERTY PUBLIC Ready : BOOL\t// TRUE once every axis has homed\n" +
            "GET\n(* @volt-implementation *)\nReady := TRUE;\nEND_GET\n" +
            "END_PROPERTY\n");

        var ready = item.Members.Single(m => m.Name == "Ready");
        Assert.Equal("BOOL", ready.DataType);
    }

    /// <summary>THE ONE ROUND-TRIP HOLE LEFT, recorded rather than fixed — because fixing it changes the FILE
    /// FORMAT and invalidates every workspace already on disk.
    ///
    /// <para><b>The shape.</b> A TOP-LEVEL declaration ending `END_VAR`, a comment on the very next line, then
    /// code. <see cref="StWriter"/> separates a top-level declaration from its body with a BLANK LINE, so the
    /// reader has to treat that blank as the separator — which means it cannot also tell whether a comment sitting
    /// against `END_VAR` belonged to the declaration or opened the body. It guesses body, the writer re-emits with
    /// its blank line, and the comment has moved.</para>
    ///
    /// <para><b>Why no reader rule fixes it.</b> One blank line cannot encode two different facts. The corpus
    /// proves both assignments are real: `member-comment-after-end-var.prg` and `trailing-space-on-a-boundary-line.fb`
    /// are the same text at the two levels with OPPOSITE correct answers, because a member is joined with a single
    /// newline and a top-level item with two. The fix is writer-side (emit the declaration's own trailing newline
    /// count) or an explicit boundary marker in the file, like the `%FOLDER` and `NETWORK` markers already there —
    /// and either one re-pulls every committed corpus and invalidates users' repos. That is a decision, not a
    /// cleanup.</para>
    ///
    /// <para><b>Why it is not urgent.</b> Absent from all 902 files across the five corpora: a pulled file always
    /// has the writer's blank line, so only a HAND-EDITED file reaches this. But it escalates where it does bite —
    /// for a CFC/SFC POU the body reads back as `// note` + blank + the marker, <c>BodyMarker.Is</c> is a
    /// <c>TrimStart</c> prefix test that then says "not a marker", and <c>BodyFormatGuard</c> refuses the push.
    /// Pulled and never pushable, from one comment in the wrong place.</para>
    ///
    /// <para>Un-skip this when the format decision is made; it is the assertion the fix has to satisfy.</para></summary>
    [Fact(Skip = "KNOWN + measured: fixing it changes the file format and re-pulls every corpus — see the summary.")]
    public void A_top_level_comment_against_END_VAR_does_not_migrate_into_the_body()
    {
        const string text =
            "FUNCTION_BLOCK Machine\nVAR\n\tstep\t: INT;\nEND_VAR\n" +
            "// this comment sits against END_VAR, with no blank line under it\n" +
            "(* @volt-implementation *)\nstep := 0;\n\nEND_FUNCTION_BLOCK\n";

        Assert.Equal(text, StWriter.Write(StReader.Read(text)));
    }

    /// <summary>The sweep, over whatever `VOLT_CORPUS` points at. Skipped — not failed — when it is unset, which
    /// is every CI run: a corpus is a real customer project and cannot be committed here.</summary>
    [Fact]
    public void Every_file_in_a_real_corpus_survives_a_round_trip()
    {
        // Unset means "not asked for" and skips. SET BUT MISSING means the operator asked and got nothing, and
        // silently passing there is how a sweep reports success on zero files.
        var corpus = Environment.GetEnvironmentVariable("VOLT_CORPUS");
        if (string.IsNullOrEmpty(corpus)) return;
        Assert.True(Directory.Exists(corpus), $"VOLT_CORPUS='{corpus}' does not exist — pass an absolute path");

        var drifted = new List<string>();
        var checkedCount = 0;
        var skipped = 0;
        foreach (var file in Directory.EnumerateFiles(corpus, "*.*", SearchOption.AllDirectories))
        {
            // A referenced library's signatures carry source extensions but are RENDERED, not pulled — they are
            // read-only by location and never travel back through a push, so they are not held to the round trip.
            // BOTH vendors' names for that folder: CODESYS calls it `Library Manager`, TwinCAT `References`.
            // Only CODESYS was excluded, which was invisible until a TwinCAT corpus existed — and then 216
            // rendered signature files entered the sweep at once.
            if (LibraryFolders.Any(f => file.Contains(f, StringComparison.Ordinal))) { skipped++; continue; }
            // `WireExtFor` FIRST. A DUT is one wire kind but four FILE extensions (.struct/.enum/.union/.alias),
            // and `KindForWireName` only knows the wire spelling — so asking it about a file extension answered
            // null for every DUT and this sweep silently skipped 290 of the corpus's 902 files, a third of the
            // evidence, while reporting a pass.
            var ext = ItemKind.WireExtFor(Path.GetExtension(file).ToLowerInvariant());
            if (!ItemKind.IsSourceKind(ItemKind.KindForWireName("x." + ext) ?? "")) { skipped++; continue; }

            var text = Read(file);
            checkedCount++;
            string back;
            try { back = StWriter.Write(StReader.Read(text)); }
            catch (Exception ex) { drifted.Add($"{file}: THREW {ex.Message}"); continue; }
            if (back != text) drifted.Add($"{file}: {FirstDifference(text, back)}");
        }

        // SAY HOW MUCH IT COVERED. `checkedCount > 0` stops a sweep of the wrong directory from passing, but it
        // cannot tell 10 files from 900 — and a corpus whose source is 4% of its file count (twincat-project14:
        // 10 of 247, the rest rendered `References/` signatures) passes in under a millisecond either way. A
        // gate that reports only pass/fail invites "the sweep is green" to be read as "the corpus is covered".
        _out.WriteLine($"corpus {corpus}: {checkedCount} source file(s) round-tripped, {skipped} skipped " +
                       "(library signatures + non-source kinds)");

        Assert.True(checkedCount > 0, $"VOLT_CORPUS='{corpus}' holds no source files — wrong directory?");
        Assert.Empty(drifted);
    }

    /// <summary>Workspace files are LF; a checkout on Windows may smudge them to CRLF (`.gitattributes` says
    /// `text=auto`), and the format under test is defined in LF. Normalising here keeps the gate about the
    /// format rather than about the checkout.</summary>
    private static string Read(string path) => File.ReadAllText(path).Replace("\r\n", "\n");

    private static string FirstDifference(string want, string got)
    {
        var a = want.Split('\n');
        var b = got.Split('\n');
        for (var i = 0; i < Math.Max(a.Length, b.Length); i++)
            if (i >= a.Length || i >= b.Length || a[i] != b[i])
                return $"line {i + 1} want {Quote(i < a.Length ? a[i] : null)} got {Quote(i < b.Length ? b[i] : null)}";
        return "(identical line by line — the trailing newline differs)";
    }

    private static string Quote(string? line) => line is null ? "<eof>" : "\"" + line + "\"";
}
