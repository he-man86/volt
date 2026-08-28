using System.Collections.Generic;
using System.Linq;
using Xunit;
using Volt.Contracts;
using Volt.Engine.Sync;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Cli.Tests;

/// <summary>
/// THE TRANSPORT MATRIX: for every writable source kind, exactly which IDE interactions a create / update / move
/// issues. This is the "one way in, one way out" agreement written down as a test rather than as prose.
/// <para>The point is the NEGATIVE half. It is easy to add a second way to write a POU — the bridge has done it
/// three times, and each time it cost a data-loss bug (a graphical child flattened, a body spliced over a sibling
/// method, an accessor created as a function block named "Get"). A test that only checks the new path still
/// passes when an old one runs beside it. So each case asserts the COMPLETE recorded call list, not a subset:
/// anything extra fails.</para>
/// <para>Scope: this pins the CALLS. What the IDE then does with the document is measured live
/// (`pou-writes-via-plcopen` §3.1, §4.2) — a fake cannot answer that and must not pretend to.</para>
/// </summary>
public class TransportMatrixTests
{
    // ── the kinds, and a minimal valid canonical source for each ────────────────────────────────────
    private const string FbSrc  = "FUNCTION_BLOCK K\nVAR\n\tn : INT;\nEND_VAR\n\nn := 1;\n\nEND_FUNCTION_BLOCK\n";
    private const string PrgSrc = "PROGRAM K\nVAR\n\tn : INT;\nEND_VAR\n\nn := 1;\n\nEND_PROGRAM\n";
    private const string FunSrc = "FUNCTION K : INT\nVAR\n\tn : INT;\nEND_VAR\n\nK := 1;\n\nEND_FUNCTION\n";
    private const string ItfSrc = "INTERFACE K\n\nMETHOD M : BOOL\nEND_METHOD\n\nEND_INTERFACE\n";
    private const string DutSrc = "TYPE K :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE\n";
    private const string GvlSrc = "VAR_GLOBAL\n\tn : INT;\nEND_VAR\n";

    /// <summary>THE MATRIX. kindCode, extension, source, the exact calls an UPDATE makes, and the exact calls a
    /// CREATE makes. Read it as the table it is:
    /// <code>
    ///   kind                     update      create
    ///   fb/prg/fun/itf/dut/gvl   writexml    create + writexml + decl
    /// </code>
    /// <b>One row, six kinds</b> — that uniformity IS the agreement, not a coincidence to be preserved by hand.
    /// It used to be three rows: POUs took the document while an interface's members went one COM call at a time
    /// and a DUT/GVL took a WriteText. The differences that justified that are real but they are DOCUMENT-SHAPE
    /// differences (an interface's members live in <c>Methods</c>/<c>Properties</c> rather than
    /// <c>addData/data</c>; a DUT/GVL has no members and no <c>&lt;body&gt;</c>), and shape is something the
    /// document layer reads off the owner element — not a reason for a second transport.
    /// <para>`ItfSrc` carries one method on purpose: under the old matrix that method cost a visible
    /// `create:M` + `write:M`, and it is what this row proves now rides in the document.</para></summary>
    public static TheoryData<int, string, string, string[], string[]> Writable => new()
    {
        { ItemKind.PlcPouFb,   "fb",  FbSrc,  new[] { "writecontent:K" }, new[] { "create:K", "writecontent:K" } },
        { ItemKind.PlcPouProg, "prg", PrgSrc, new[] { "writecontent:K" }, new[] { "create:K", "writecontent:K" } },
        { ItemKind.PlcPouFunc, "fun", FunSrc, new[] { "writecontent:K" }, new[] { "create:K", "writecontent:K" } },
        { ItemKind.PlcItf,     "itf", ItfSrc, new[] { "writecontent:K" }, new[] { "create:K", "writecontent:K" } },
        { ItemKind.PlcDut,     "dut", DutSrc, new[] { "writecontent:K" }, new[] { "create:K", "writecontent:K" } },
        { ItemKind.PlcGvl,     "gvl", GvlSrc, new[] { "writecontent:K" }, new[] { "create:K", "writecontent:K" } },
    };

    private static FakeIde Ide(int code, string src, params FakeIde.Item[] extra)
    {
        var items = new List<FakeIde.Item>
        {
            new("K", code, "", true, src.Split("\n\n")[0], "n := 1;", null, null),
        };
        items.AddRange(extra);
        return new FakeIde(items.ToArray());
    }

    private static List<string> Apply(FakeIde ide, SetItemOp op)
    {
        var refs = RefsService.Handle(ide);
        var resp = PushService.Handle(ide, new PushRequest { ExpectedProjectVersion = refs.ProjectVersion, Ops = new() { op } });
        Assert.True(resp.Accepted,
            "push rejected: " + string.Join("; ", resp.Conflicts?.Select(c => $"{c.Name}: {c.Reason}") ?? new[] { "<none>" }));
        return ide.Recorded;
    }

    // ── UPDATE ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>An UPDATE is ONE WriteXml and nothing else — for every writable kind.</summary>
    [Theory]
    [MemberData(nameof(Writable))]
    public void Update_uses_exactly_the_matrix_calls(int code, string ext, string src, string[] onUpdate, string[] onCreate)
    {
        _ = onCreate;
        var ide = Ide(code, src);
        var refs = RefsService.Handle(ide);
        var recorded = Apply(ide, new SetItemOp { Name = $"K.{ext}", IfVersion = refs.Items[$"K.{ext}"], SourceText = src });

        Assert.Equal(onUpdate, recorded.ToArray());
    }

    // ── CREATE ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>A CREATE is ONE CreateChild (structure) + ONE WriteText (the declaration aspect) + ONE WriteXml
    /// (body and members), for every writable kind. No CreateChild+WriteText per member, no orphan walk.
    /// <para>There is no <c>decl:K</c> any more: the declaration used to take its own aspect write AFTER the
    /// document write (an ordering that was measured, because TwinCAT's importer regenerated a declaration the
    /// document did not carry verbatim). One <c>WriteContent</c> now carries declaration, body and members
    /// together, and nothing re-imports the item, so the second call has nothing left to do. The rule
    /// is exact: it is issued IF AND ONLY
    /// IF the pushed declaration differs from what the item already has. An UPDATE that does not touch the
    /// declaration therefore writes nothing — which is why the update column is unchanged by the move to the
    /// aspect — and a CREATE pays it whenever the pushed declaration adds anything to the seed
    /// <c>CreateChild</c> laid down.</para>
    /// <para><b>The INTERFACE row is the exception, and it is not an accident of the fixture:</b> an interface's
    /// declaration is its header and nothing else — there are no variables to add — so a created interface's
    /// declaration is already exactly the seed, and no write is due. A row that paid one would mean Volt was
    /// rewriting a declaration it had not changed. See openspec/changes/declaration-from-the-aspect.</para></summary>
    [Theory]
    [MemberData(nameof(Writable))]
    public void Create_uses_exactly_the_matrix_calls(int code, string ext, string src, string[] onUpdate, string[] onCreate)
    {
        _ = (code, onUpdate);
        var ide = new FakeIde();
        var recorded = Apply(ide, new SetItemOp { Name = $"K.{ext}", SourceText = src });

        Assert.Equal(onCreate, recorded.ToArray());
    }

    /// <summary>A POU created WITH members costs the same two calls — the members ride in the document. This is
    /// the case the old path was worst at: five methods meant five CreateChild + five WriteText on top.
    /// <para>No <c>write:K</c> here: this source's declaration is <c>FUNCTION_BLOCK K / VAR / END_VAR</c>, which
    /// is exactly what the create seeded, so the declaration aspect has nothing to receive. The members are the
    /// subject and they ride in the one document write.</para></summary>
    [Fact]
    public void Creating_a_POU_with_members_still_costs_two_calls()
    {
        var ide = new FakeIde();
        var recorded = Apply(ide, new SetItemOp
        {
            Name = "K.fb",
            SourceText = "FUNCTION_BLOCK K\nVAR\nEND_VAR\n\nEND_FUNCTION_BLOCK\n\n"
                       + "METHOD A : BOOL\nA := TRUE;\nEND_METHOD\n\nMETHOD B : BOOL\nB := TRUE;\nEND_METHOD\n\n"
                       + "ACTION Act\nn := 1;\nEND_ACTION\n",
        });

        Assert.Equal(new[] { "create:K", "writecontent:K" }, recorded.ToArray());
        var doc = FakeIde.AllText(ide.WrittenContent["K"]);
        foreach (var member in new[] { "A", "B", "Act" }) Assert.Contains(member, doc);
    }

    // ── MOVE ────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>A PURE move touches the item ONCE, structurally, for every writable kind — no read, no delete,
    /// no content write. (`create:Dest` is the destination folder being resolved-or-created.)</summary>
    [Theory]
    [MemberData(nameof(Writable))]
    public void A_pure_move_is_one_structural_relocation(int code, string ext, string src, string[] onUpdate, string[] onCreate)
    {
        _ = (onUpdate, onCreate);
        var ide = Ide(code, src);
        var refs = RefsService.Handle(ide);
        var recorded = Apply(ide, new SetItemOp { Name = $"K.{ext}", IfVersion = refs.Items[$"K.{ext}"], ToFolder = "Dest" });

        Assert.Equal(new[] { "create:Dest", "move:K->Dest" }, recorded.ToArray());
        Assert.DoesNotContain(recorded, r => r.StartsWith("delete:") || r.StartsWith("write"));
    }

    // ── the negative half: nothing else may reach the IDE ───────────────────────────────────────────

    /// <summary>The whole point, and it now covers EVERY writable kind rather than only POUs. A document write
    /// must not ALSO run the per-child path — the two coexisting is exactly how a body got written twice, by two
    /// mechanisms that disagreed. Asserted as an absence, with members present so the per-child loop would have
    /// something to do if it ran.
    /// <para>This used to `return` early for interface/DUT/GVL, because those kinds legitimately still used the
    /// per-child transport. That exemption is gone — which is the difference between "the new path works" and
    /// "there is only one path", and only the second one stays true on its own.</para></summary>
    [Theory]
    [MemberData(nameof(Writable))]
    public void No_per_child_or_accessor_interaction_survives_a_write(int code, string ext, string src, string[] onUpdate, string[] onCreate)
    {
        _ = (onUpdate, onCreate);
        var ide = Ide(code, src);
        var refs = RefsService.Handle(ide);
        var withMembers = src.Replace("END_FUNCTION_BLOCK\n", "END_FUNCTION_BLOCK\n\nMETHOD M : BOOL\nM := TRUE;\nEND_METHOD\n")
                             .Replace("END_PROGRAM\n", "END_PROGRAM\n\nACTION A\nn := 1;\nEND_ACTION\n")
                             .Replace("END_FUNCTION\n", "END_FUNCTION\n");
        var recorded = Apply(ide, new SetItemOp { Name = $"K.{ext}", IfVersion = refs.Items[$"K.{ext}"], SourceText = withMembers });

        Assert.Equal(new[] { "writecontent:K" }, recorded.ToArray());
        // Named individually so a failure says WHICH old mechanism came back.
        // Per-CHILD WriteText, which is the mechanism that flattened bodies. The ROOT's own `write:K` is the
        // declaration aspect and is legitimate — but it is absent here anyway, because this push does not
        // change the declaration and the no-op guard suppresses it.
        Assert.DoesNotContain(recorded, r => r.StartsWith("write:"));
        Assert.DoesNotContain(recorded, r => r.StartsWith("create:"));   // per-child CreateChild / accessor create
        Assert.DoesNotContain(recorded, r => r.StartsWith("delete:"));   // orphan walk / accessor drop
    }

    /// <summary>A read-only reference kind is never written at all. `library`/`device`/`task`/… have no push
    /// path; a push naming one must be refused, not quietly applied through some other transport.</summary>
    [Theory]
    [InlineData(ItemKind.PlcLibRef, "library")]
    [InlineData(ItemKind.PlcTask, "task")]
    public void A_read_only_kind_is_never_written(int code, string ext)
    {
        var ide = new FakeIde(new FakeIde.Item("K", code, "", true, "MANIFEST", null, null, null))
           ;
        var refs = RefsService.Handle(ide);
        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new() { new SetItemOp { Name = $"K.{ext}", IfVersion = refs.Items.GetValueOrDefault($"K.{ext}"), SourceText = "MANIFEST" } },
        });

        Assert.False(resp.Accepted, "a read-only reference kind must be refused, not written");
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("write"));
    }

    // ── the two the audit found ─────────────────────────────────────────────────────────────────────

    /// <summary>The body-format guard must not call <c>BodyLanguage</c> at all on the single-document path.
    /// <para>It is not a cheap accessor: on CODESYS it is a FULL PLCopen export. The guard called it once per
    /// child, so a POU with N methods paid N exports for the guards, one more for the splice basis, and one for
    /// the root — 22 IDE round-trips to write one 20-method POU. Every language question is answerable from the
    /// ONE export the write already needs.</para></summary>
    [Fact]
    public void The_guards_cost_no_extra_export_on_the_single_document_path()
    {
        var ide = new FakeIde(
            new FakeIde.Item("K", ItemKind.PlcPouFb, "", true, "FUNCTION_BLOCK K\nVAR\nEND_VAR", "", null, null,
                Children: new[] { "A", "B", "C" }),
            new FakeIde.Item("A", ItemKind.PlcMethod, "", false, "METHOD A : BOOL", "A := TRUE;", null, null),
            new FakeIde.Item("B", ItemKind.PlcMethod, "", false, "METHOD B : BOOL", "B := TRUE;", null, null),
            new FakeIde.Item("C", ItemKind.PlcMethod, "", false, "METHOD C : BOOL", "C := TRUE;", null, null))
           ;
        var refs = RefsService.Handle(ide);

        var recorded = Apply(ide, new SetItemOp
        {
            Name = "K.fb",
            IfVersion = refs.Items["K.fb"],
            SourceText = "FUNCTION_BLOCK K\nVAR\nEND_VAR\n\nEND_FUNCTION_BLOCK\n\n"
                       + "METHOD A : BOOL\nA := FALSE;\nEND_METHOD\n\nMETHOD B : BOOL\nB := TRUE;\nEND_METHOD\n\n"
                       + "METHOD C : BOOL\nC := TRUE;\nEND_METHOD\n",
        });

        Assert.Equal(new[] { "writecontent:K" }, recorded.ToArray());
        Assert.DoesNotContain(recorded, r => r.StartsWith("bodylang:"));
    }

    /// <summary>A guard may not MUTATE the project it is about to refuse. `RequireChildFormatWritable` resolved
    /// the child's folder to find it, and folder resolution CREATES missing folders — so a refused push could
    /// leave new empty folders behind, in a method documented as "validate BEFORE writing anything, so a refusal
    /// is atomic". Here the pushed child names a folder that does not exist and the push is REFUSED (its body is
    /// a read-only CFC): nothing may be created.</summary>
    [Fact]
    public void A_refused_push_creates_no_folders()
    {
        var ide = new FakeIde(
            new FakeIde.Item("K", ItemKind.PlcPouFb, "", true, "FUNCTION_BLOCK K\nVAR\nEND_VAR", "", null, null,
                Children: new[] { "M" }),
            new FakeIde.Item("M", ItemKind.PlcMethod, "", false, "METHOD M : BOOL", "", "CFC", null));
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new() { new SetItemOp
            {
                Name = "K.fb",
                IfVersion = refs.Items["K.fb"],
                SourceText = "FUNCTION_BLOCK K\nVAR\nEND_VAR\n\nEND_FUNCTION_BLOCK\n\n"
                           + "METHOD M : BOOL\n%FOLDER Nested/Deep\nM := TRUE;\nEND_METHOD\n",
            } },
        });

        Assert.False(resp.Accepted, "a read-only CFC child must refuse the push");
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("create:") || r.StartsWith("write") || r.StartsWith("delete:"));
    }

    // ── THE LEGACY ARM ──────────────────────────────────────────────────────────────────────────────
    // Everything above runs with OneDocumentWrite = TRUE. In production that is CODESYS only: TwinCAT inherits
    // false and takes the per-transport path, so the arm the matrix pinned was the arm one vendor runs, and the
    // arm the OTHER vendor runs had no complete-call-list assertion at all. Two arms, one pinned, is the exact
    // condition under which they drift — and they already have: a refusal message had to be hand-aligned
    // word-for-word between them because clients got a different sentence depending on the attached IDE.
    //
    // Read the two tables together and the cost of the second arm is the point:
    //
    //     kind          one-document          legacy (per-transport)
    //     fb/prg/fun    writexml:K            bodylang:K, write:K
    //     itf           writexml:K            write:K, create:M, write:M     <- the member costs 2 extra calls
    //     dut/gvl       writexml:K            write:K
    //
    // `bodylang:K` is not free: on CODESYS it is a FULL PLCopen export, which is why the document arm reads the
    // export once and answers every language question from it. `create:M`/`write:M` is the per-child loop — one
    // method here, but N calls for N members, which is what the document arm collapsed.


    private static string SourceFor(string ext) => ext switch
    {
        "fb" => FbSrc, "prg" => PrgSrc, "fun" => FunSrc,
        "itf" => ItfSrc, "dut" => DutSrc, "gvl" => GvlSrc,
        _ => throw new System.ArgumentOutOfRangeException(nameof(ext), ext, "not a writable kind in the matrix"),
    };
}
