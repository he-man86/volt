using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A POU'S END LINE MIRRORS ITS OWN HEADER (openspec <c>push-without-header-check</c> 5.Q.3).
///
/// <para>Every POU is <c>X.pou</c> — one kind, whatever its text says — so there is no kind left to spell the outer END
/// line from, and the owner keeps the line: it is the boundary between the POU and its members. The writer reads the
/// declaration's own header keyword in the reader's view (a never-closed <c>(*</c> opens nothing, then every comment,
/// string and pragma is trivia) and closes with its END: <c>PROGRAM</c> → <c>END_PROGRAM</c>, <c>FUNCTION_BLOCK</c> →
/// <c>END_FUNCTION_BLOCK</c>, <c>FUNCTION</c> → <c>END_FUNCTION</c>. A header that names none of them closes with the ONE
/// documented fallback, <c>END_FUNCTION_BLOCK</c> (design 5.Qa, F1) — counted: the pull logs it per item.</para>
/// </summary>
public class PouEndLineTests
{
    private static string Written(string declaration) =>
        StWriter.Write(new ItemContent(ItemKind.Kinds.Pou, declaration, "x := 1;", new List<Member>()));

    private static string EndLineOf(string written) =>
        written.Replace("\r\n", "\n").TrimEnd('\n').Split('\n').Last();

    public static TheoryData<string, string, string> Mirrored => new()
    {
        { "plain PROGRAM", "PROGRAM P\nVAR\nEND_VAR", "END_PROGRAM" },
        { "plain FUNCTION_BLOCK", "FUNCTION_BLOCK P\nVAR\nEND_VAR", "END_FUNCTION_BLOCK" },
        { "plain FUNCTION", "FUNCTION F : INT\nVAR\nEND_VAR", "END_FUNCTION" },
        { "behind a line comment", "// doc\nPROGRAM P\nVAR\nEND_VAR", "END_PROGRAM" },
        { "behind a block comment", "(* doc *)\nFUNCTION F : INT", "END_FUNCTION" },
        { "behind a nested comment", "(* outer (* nested PROGRAM *) still FUNCTION *)\nPROGRAM P", "END_PROGRAM" },
        { "behind an attribute", "{attribute 'qualified_only'}\nFUNCTION_BLOCK P", "END_FUNCTION_BLOCK" },
        { "after a pragma on its own line", "{attribute 'hide'} PROGRAM P\nVAR\nEND_VAR", "END_PROGRAM" },
        { "a comment on the header's line", "(* note *) FUNCTION F : BOOL", "END_FUNCTION" },
        { "CRLF line ends", "// doc\r\nFUNCTION_BLOCK P\r\nVAR\r\nEND_VAR", "END_FUNCTION_BLOCK" },
        { "a BOM", "﻿FUNCTION F : INT", "END_FUNCTION" },
        { "lower case", "program p\nvar\nend_var", "END_PROGRAM" },
        { "mixed case", "Function_Block P", "END_FUNCTION_BLOCK" },
        { "an unclosed comment before the keyword", "(* Motor\n *\nPROGRAM P\nVAR\nEND_VAR", "END_PROGRAM" },
        { "an unclosed comment before FUNCTION", "(* doc\nFUNCTION F : INT", "END_FUNCTION" },
        // The never-closed comment's own WORDS are code in the reader's view; a line leading with a word that is not
        // a POU keyword names nothing and is passed over, so the header a reader sees still decides (5Qa review:
        // this fell back to END_FUNCTION_BLOCK on a PROGRAM, and the post-push comparison then saw a change).
        { "an unclosed comment whose continuation line starts with a word", "(* doc\n   Motor control\nPROGRAM P\nVAR\nEND_VAR", "END_PROGRAM" },
        // ...and a prose line that LEADS with a POU keyword's word is not a header either: a header is the keyword, a
        // name, and then nothing but a return type (`:`) or EXTENDS / IMPLEMENTS. Read by its first word alone, the
        // PROGRAM below was closed with END_FUNCTION and the counted fallback did not count it (5Qa review).
        { "unclosed-comment prose that starts with Function", "(* doc\nFunction to compute speed\nPROGRAM P\nVAR\nEND_VAR", "END_PROGRAM" },
        { "unclosed-comment prose that starts with Program", "(* doc\nProgram for the motor\nFUNCTION_BLOCK FB\nVAR\nEND_VAR", "END_FUNCTION_BLOCK" },
        { "unclosed-comment prose that starts with Function_block", "(* doc\nFunction_block of the axis, see manual\nFUNCTION F : INT", "END_FUNCTION" },
        { "a header with modifiers, EXTENDS and IMPLEMENTS", "FUNCTION_BLOCK PUBLIC ABSTRACT FB EXTENDS Base IMPLEMENTS I1, Ns.I2", "END_FUNCTION_BLOCK" },
        { "a header whose name is on the next line", "PROGRAM\nP\nVAR\nEND_VAR", "END_PROGRAM" },
        { "a FUNCTION with no return type", "FUNCTION F\nVAR\nEND_VAR", "END_FUNCTION" },
        { "a FUNCTION returning an array", "FUNCTION F : ARRAY [0..1] OF INT", "END_FUNCTION" },
        { "prose before the header","This POU drives the motor\nFUNCTION F : INT", "END_FUNCTION" },
        { "a string holding a keyword is no header", "// 'FUNCTION'\nPROGRAM P", "END_PROGRAM" },
    };

    [Theory]
    [MemberData(nameof(Mirrored))]
    public void The_END_line_mirrors_the_header_keyword(string _, string declaration, string end)
    {
        var written = Written(declaration);

        Assert.Equal(end, EndLineOf(written));
        // ...and the reader takes it back as the boundary, so the file reads to what was written.
        var read = StReader.Read(written, ItemKind.Kinds.Pou);
        Assert.Equal(declaration.Replace("\r\n", "\n").TrimEnd('\n'), read.Declaration.Replace("\r\n", "\n"));
        Assert.Equal("x := 1;", read.Body!.TrimEnd('\n').Split('\n').Last());
    }

    public static TheoryData<string, string> Fallback => new()
    {
        { "empty", "" },
        { "prose", "This POU still has to be written" },
        { "a namespace", "NAMESPACE N" },
        { "interface text in a POU object", "INTERFACE I" },
        { "a comment and nothing else", "// only a note\n(* and another *)" },
        { "a comment that never closes", "(* never closed\nnor here" },
        { "a word that only starts like a keyword", "FUNCTIONAL F" },
        { "VAR before any header", "VAR\n\tx : INT;\nEND_VAR" },
    };

    /// <summary>THE ONE FALLBACK: a header that names none of the three closes with <c>END_FUNCTION_BLOCK</c> — the
    /// create seed's own END line and the shape that takes every member kind — and the file still reads back.</summary>
    [Theory]
    [MemberData(nameof(Fallback))]
    public void A_header_naming_no_POU_keyword_closes_with_the_fallback(string _, string declaration)
    {
        Assert.Null(StReader.PouHeaderKeyword(declaration));
        Assert.Equal("END_" + StWriter.FallbackPouHeader, EndLineOf(Written(declaration)));
        Assert.Equal("END_FUNCTION_BLOCK", "END_" + StWriter.FallbackPouHeader);
    }

    /// <summary>The fallback is COUNTED: the pull names every item it fires for in the log, and logs nothing for a POU
    /// whose header names its kind.</summary>
    [Fact]
    public void The_pull_logs_each_fallback_by_item_name()
    {
        var ide = new FakeIde(
            new FakeIde.Item("Prose", ItemKind.PlcPou, "", true, "This POU still has to be written", "", null, null),
            new FakeIde.Item("Fine", ItemKind.PlcPou, "", true, "PROGRAM Fine\nVAR\nEND_VAR", "", null, null));
        var dir = Path.Combine(Path.GetTempPath(), "volt-log-test-" + Guid.NewGuid().ToString("N"));
        VoltLog.Init("codesys", dir);
        try
        {
            var prose = Materializer.Materialize(ide, "Prose", ItemKind.Kinds.Pou, new ItemRef("Prose"));
            var fine = Materializer.Materialize(ide, "Fine", ItemKind.Kinds.Pou, new ItemRef("Fine"));
            var log = string.Concat(Directory.GetFiles(dir, "codesys-*.log").Select(File.ReadAllText));

            Assert.Equal("Prose.pou", prose.FullName);
            Assert.Equal("END_FUNCTION_BLOCK", EndLineOf(prose.Text));
            Assert.Equal("END_PROGRAM", EndLineOf(fine.Text));
            Assert.Contains("pull: 'Prose'", log);
            Assert.Contains("fallback END_FUNCTION_BLOCK", log);
            Assert.DoesNotContain("'Fine'", log);
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    /// <summary>A POU WHOSE TEXT DECLARES NOTHING PULLS AS <c>X.pou</c>, never unreadable (5.Q.2): its kind is its
    /// class, so a broken text names no other kind and needs no <c>--force</c>.</summary>
    [Fact]
    public void A_pou_whose_text_declares_nothing_pulls_as_pou()
    {
        var ide = new FakeIde(new FakeIde.Item("Broken", ItemKind.PlcPou, "", true,
            "(* Motor\n *\nVAR\n\tn : INT;\nEND_VAR", "n := n + 1;", null, null));

        var refs = RefsService.Handle(ide);

        Assert.Contains("Broken.pou", refs.Items.Keys);
        Assert.Empty(refs.Unreadable);
    }
}
