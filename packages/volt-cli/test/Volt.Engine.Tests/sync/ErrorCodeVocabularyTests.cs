using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Volt.Tests.Shared;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// ONE SITUATION PER CODE (openspec <c>bridge-refusal-review</c> V.1, V.3). <c>BAD_REQUEST</c> is the request breaking
/// the wire's own rules (remedy: change the request); <c>UNSUPPORTED</c> is the IDE, or a documented Volt limit on a
/// vendor shape, not taking it (remedy: change the text); <c>ITEM_UNVERIFIED</c> is a place the push could not read
/// (remedy: fix what stops the IDE enumerating it); <c>INTERNAL_ERROR</c> is Volt's own broken invariant only. Each row
/// here was answered with another code's situation: a child read the IDE refused blamed Volt (INTERNAL_ERROR), a Volt
/// wire rule sent the engineer to change text that is fine (UNSUPPORTED, whose CLI advice is "the IDE will not take this
/// text"), and a fetch without a baseline answered a code named after a cache no client sees (NO_SIDECAR).
/// Only the code changes: every refusal still names its item, and nothing that was refused is accepted.
/// </summary>
public class ErrorCodeVocabularyTests
{
    private const string Prg = "PROGRAM PLC_PRG\nVAR\nEND_VAR";

    // ── the IDE refused a read the lookup needed → ITEM_UNVERIFIED (7.1's situation, met at apply time) ─────────────

    public static IEnumerable<object[]> LookupFaults() => new[]
    {
        new object[] { "the child count", "the project root", new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", Prg, "x := 1;")) { FaultingNodes = new[] { "<root>" } } },
        new object[] { "a child", "the project root", new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", Prg, "x := 1;")) { FaultingChildReads = new[] { "<root>" } } },
        new object[] { "a child's name", "the project root", new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", Prg, "x := 1;")) { FaultingNameReads = new[] { "PLC_PRG" } } },
        new object[] { "a nested folder's child count", "the folder 'POUs'", new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", Prg, "x := 1;", "POUs")) { FaultingNodes = new[] { "POUs" } } },
        new object[] { "a nested folder's child", "the folder 'POUs'", new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", Prg, "x := 1;", "POUs")) { FaultingChildReads = new[] { "POUs" } } },
    };

    /// <summary>The refusal names the FOLDER whose read the IDE refused — ITEM_UNVERIFIED's remedy is that folder's, and a
    /// lookup's folder is never in a walk's <c>unwalkedFolders</c> — and keeps the IDE's exception as the inner one, so a
    /// driver that degrades its session on a dead channel (TwinCAT's <c>IsRpcFault</c> walks the inner chain) still sees it
    /// (review of step V: the message named no folder and the inner exception was dropped).</summary>
    [Theory]
    [MemberData(nameof(LookupFaults))]
    public void A_tree_read_the_IDE_refused_during_a_lookup_is_ITEM_UNVERIFIED(string read, string place, FakeIde ide)
    {
        var ex = Assert.Throws<BridgeException>(() => ItemLookup.Find(ide, "FB_Wanted"));

        Assert.True(ex.ErrorCode == ConflictCodes.ItemUnverified, $"{read}: {ex.ErrorCode} — {ex.Message}");
        Assert.Contains("'FB_Wanted'", ex.Message);           // the item the lookup was for
        Assert.Contains(place, ex.Message);                   // the folder whose read the IDE refused
        Assert.Contains("COM fault", ex.Message);             // and what the IDE said
        Assert.IsType<System.InvalidOperationException>(ex.InnerException);   // the IDE's own exception, kept
    }

    /// <summary>The same refusal reaches a push client as the op's conflict, with the code — not as INTERNAL_ERROR.</summary>
    [Fact]
    public void A_push_whose_lookup_the_IDE_refused_answers_ITEM_UNVERIFIED_on_the_op()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", Prg, "x := 1;")) { FaultingChildReads = new[] { "<root>" } };
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "FB_New.pou", ToFolder = "",
                                SourceText = "FUNCTION_BLOCK FB_New\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n" },
            },
        });

        var refused = Assert.Single(resp.Conflicts!);
        Assert.Equal("FB_New.pou", refused.Name);
        Assert.Equal(ConflictCodes.ItemUnverified, refused.Code);
        Assert.Contains("'FB_New'", refused.Reason);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("create"));
    }

    // ── Volt's own wire rules → BAD_REQUEST ─────────────────────────────────────────────────────────────────────

    /// <summary>A push of a read-only descriptor is the request asking for something the wire never does — not the IDE
    /// refusing a text. (<c>ProjectSettingsReadOnlyPushTests</c> pins the rest of the refusal.)</summary>
    [Theory]
    [InlineData("Project Settings.projectsettings")]
    [InlineData("Standard.library")]
    public void A_push_of_a_read_only_descriptor_is_BAD_REQUEST(string wireName)
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", Prg, "x := 1;"));
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Ops = new List<PushOp> { new SetItemOp { Name = wireName, SourceText = "anything\n" } },
        });

        var refused = Assert.Single(resp.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, refused.Code);
        Assert.Contains($"'{wireName}' is read-only", refused.Reason);
    }

    /// <summary>A MOVE whose name resolves to an object that is no source item (a task the pushed `.pou` name shares its
    /// bare name with — a lookup is by bare name) is the request naming something a move never takes — Volt's rule, not the IDE's.</summary>
    [Fact]
    public void A_move_of_a_non_source_item_is_BAD_REQUEST()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", Prg, "x := 1;"),
            new FakeIde.Item("CM_Carrier", ItemKind.PlcTask, "", true, "Type:     Cyclic\nInterval: 10ms\nPriority: 1\n", null, null, null));
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Force = true,
            Ops = new List<PushOp> { new SetItemOp { Name = "CM_Carrier.pou", ToFolder = "Elsewhere" } },
        });

        var refused = Assert.Single(resp.Conflicts!, c => c.Code != ConflictCodes.NotAttempted);
        Assert.Equal(BridgeErrorCodes.BadRequest, refused.Code);
        Assert.Contains("'CM_Carrier'", refused.Reason);
        Assert.Contains("only source items", refused.Reason);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("move"));
    }

    /// <summary>V.3: a fetch with no baseline is the request missing a field — <c>BAD_REQUEST</c>, the message naming the
    /// wire fields that make it unambiguous (it named a CLI command, and its code a cache no client sees).</summary>
    [Fact]
    public void A_fetch_without_a_baseline_is_BAD_REQUEST_naming_the_wire_fields()
    {
        var ide = new FakeIde(FakeIde.Item.TextualPou("PLC_PRG", Prg, "x := 1;"));

        var ex = Assert.Throws<BridgeException>(() => FetchService.Handle(ide, new FetchRequest()));

        Assert.Equal(BridgeErrorCodes.BadRequest, ex.ErrorCode);
        Assert.Contains("`knownItems`", ex.Message);
        Assert.Contains("`onlyItems`", ex.Message);
        Assert.Contains("`init: true`", ex.Message);
        Assert.DoesNotContain("volt init", ex.Message);
    }

    // ── an unwalked folder met by a forced replace → ITEM_UNVERIFIED ────────────────────────────────────────────

    /// <summary>A forced replace of an item the driver must not open, in a folder the walk did not read: the push does not
    /// know where to recreate it. That is the walk's gap (the folder could not be enumerated), not a Volt bug.</summary>
    [Fact]
    public void A_forced_replace_of_an_unopened_item_whose_folder_the_walk_skipped_is_ITEM_UNVERIFIED()
    {
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", Prg, "x := 1;"),
            FakeIde.Item.TextualPou("FB_Broken", "FUNCTION_BLOCK FB_Broken\nVAR\nEND_VAR", ";", "Hidden"));
        ide.UnopenedItems.Add("FB_Broken");
        ide.UnwalkableFolders = new[] { "Hidden" };
        var refs = RefsService.Handle(ide);

        var resp = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = refs.ProjectVersion,
            Force = true,
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "FB_Broken.pou",
                                SourceText = "FUNCTION_BLOCK FB_Broken\nVAR\nEND_VAR\nIMPLEMENTATION ST\n;\nEND_FUNCTION_BLOCK\n" },
            },
        });

        var refused = Assert.Single(resp.Conflicts!, c => c.Code != ConflictCodes.NotAttempted);
        Assert.Equal(ConflictCodes.ItemUnverified, refused.Code);
        Assert.Contains("'FB_Broken'", refused.Reason);
        Assert.DoesNotContain(ide.Recorded, r => r.StartsWith("delete"));
    }

    // ── an item the IDE does not return → UNREADABLE, naming the way out that works ─────────────────────────────

    /// <summary>A forced UPDATE of an item the IDE does not return at all (a member it holds no declaration for, both
    /// drivers: coded UNREADABLE) cannot work — force skips the version gate, and the update still reads the live item to
    /// write it. UNREADABLE's other remedy, "push with force", would loop: forced push, UNREADABLE, forced push. So the
    /// refusal says what does work, and that path is proven here: delete it, then create it, in two pushes (one op per
    /// item). (Review of step V; the forced update kept its refusal, only the advice changed.)</summary>
    [Fact]
    public void A_forced_update_of_an_item_the_IDE_does_not_return_is_UNREADABLE_naming_delete_then_create()
    {
        const string fb = "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR\nIMPLEMENTATION ST\nx := 1;\nEND_FUNCTION_BLOCK\n";
        var ide = new FakeIde(
            FakeIde.Item.TextualPou("PLC_PRG", Prg, "x := 1;"),
            FakeIde.Item.TextualPou("FB_A", "FUNCTION_BLOCK FB_A\nVAR\nEND_VAR", "x := 0;"));
        // The driver's read of the broken item, as both drivers now refuse it — until the item is deleted.
        ide.OnReadContent = (fake, item) =>
        {
            if (fake.Name(item) == "FB_A" && !fake.Recorded.Any(r => r.StartsWith("delete")))
                throw new BridgeException(BridgeErrorCodes.Unreadable,
                    "'Step': the IDE reports no declaration for this member — that is a broken item, not a transport gap");
        };
        Assert.Contains("FB_A", RefsService.Handle(ide).Unreadable);

        var forced = PushService.Handle(ide, new PushRequest
        {
            Force = true,
            Ops = new List<PushOp> { new SetItemOp { Name = "FB_A.pou", SourceText = fb } },
        });

        var refused = Assert.Single(forced.Conflicts!, c => c.Code != ConflictCodes.NotAttempted);
        Assert.Equal(BridgeErrorCodes.Unreadable, refused.Code);
        Assert.Contains("'FB_A'", refused.Reason);
        Assert.Contains("no declaration", refused.Reason);               // the IDE's fact, kept
        Assert.Contains("with or without force", refused.Reason);        // force is not the way out here…
        Assert.Contains("deleteItem", refused.Reason);                   // …delete, then create, is

        var deleted = PushService.Handle(ide, new PushRequest { Force = true, Ops = new List<PushOp> { new DeleteItemOp { Name = "FB_A.pou" } } });
        Assert.True(deleted.Accepted, string.Join("; ", (deleted.Conflicts ?? new()).Select(c => c.Reason)));
        var created = PushService.Handle(ide, new PushRequest { Ops = new List<PushOp> { new SetItemOp { Name = "FB_A.pou", SourceText = fb } } });
        Assert.True(created.Accepted, string.Join("; ", (created.Conflicts ?? new()).Select(c => c.Reason)));
        Assert.Contains("FB_A.pou", RefsService.Handle(ide).Items.Keys);
    }
}
