using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Item;
using Volt.Engine.Sync;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A REFUSED PUSH CARRIES THE CODE IT COMPUTED.
///
/// <para><b>Why this could be missed for so long.</b> A push catches every exception from its pre-flight and
/// its apply loop and answers with a REJECTION — <c>accepted:false</c> plus a conflict — rather than an error
/// frame. That is the right design: a refusal is an outcome, not a transport failure. But the conflict was
/// built with <c>Code = netEx?.Code</c>, so only a network-text diagnostic kept its code and every
/// <c>BridgeException</c> raised on that path lost one. Because those exceptions are raised NOWHERE ELSE on
/// the wire, five of the ten <c>BridgeErrorCodes</c> values were unobservable by any client.</para>
///
/// <para>What that cost is visible in the callers: the e2e suite asserted on an exact English sentence
/// (<c>c.reason === "item changed since you fetched its version"</c>) and the CLI printed the prose with no
/// branch at all. A caller could not separate "pull and try again" from "this shape can never be written",
/// which is precisely the branch an agent needs.</para>
///
/// <para>These assert the CODE, never the message. A test that pins the wording is the thing that made
/// rewording a message a breaking change.</para>
/// </summary>
public class PushConflictCodeTests
{
    private static string Prg(string name) =>
        $"PROGRAM {name}\nVAR\nEND_VAR\nIMPLEMENTATION ST\nn := 0;\n\nEND_PROGRAM\n";

    private static PushResponse Push(FakeIde ide, params PushOp[] ops) =>
        BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = RefsService.Handle(ide).ProjectVersion,
            Ops = ops.ToList(),
        });

    /// <summary>THE GATE'S FOUR OUTCOMES ARE FOUR CODES.
    ///
    /// <para>They used to be one: `code: null`, told apart only by which version field happened to be null and
    /// by a synthetic item named `&lt;project&gt;`. So "your lease is stale, pull and retry", "that name is
    /// taken, pick another" and "the item you hold a version for is gone, there is nothing to merge with" were
    /// one undifferentiated answer — three different next steps for the engineer, and a caller could only get
    /// at them by matching English.</para>
    ///
    /// <para>An earlier version of this file pinned the OPPOSITE ("a version conflict is not a coded refusal").
    /// That was a defensible reading of the old doc comment and it is not the design any more.</para></summary>
    [Fact]
    public void A_stale_item_version_says_so()
    {
        var ide = new FakeIde();
        Push(ide, new SetItemOp { Name = "A.pou", SourceText = Prg("A"), IfVersion = null });

        var stale = Push(ide, new SetItemOp { Name = "A.pou", SourceText = Prg("A"), IfVersion = "not-the-version" });

        var conflict = Assert.Single(stale.Conflicts!);
        Assert.False(stale.Landed());
        Assert.Equal(ConflictCodes.StaleItemVersion, conflict.Code);
        Assert.NotNull(conflict.CurrentVersion);      // still structured — the code is in ADDITION, not instead
    }

    /// <summary>A create that landed on a name the IDE holds. NOT "pull and retry": the remedy is to fetch the
    /// item's version and push an update, or pick another name.</summary>
    [Fact]
    public void A_create_onto_an_existing_name_says_so()
    {
        var ide = new FakeIde();
        Push(ide, new SetItemOp { Name = "A.pou", SourceText = Prg("A"), IfVersion = null });

        var collide = Push(ide, new SetItemOp { Name = "A.pou", SourceText = Prg("A"), IfVersion = null });

        Assert.False(collide.Landed());
        Assert.Equal(ConflictCodes.ItemExists, Assert.Single(collide.Conflicts!).Code);
    }

    /// <summary>A version quoted for an item that is gone. Distinct from a stale version because there is
    /// nothing to merge with.</summary>
    [Fact]
    public void A_version_for_a_missing_item_says_so()
    {
        var ide = new FakeIde();

        var gone = Push(ide, new SetItemOp { Name = "Ghost.pou", SourceText = Prg("Ghost"), IfVersion = "some-version" });

        Assert.False(gone.Landed());
        var conflict = Assert.Single(gone.Conflicts!);
        Assert.Equal(ConflictCodes.ItemMissing, conflict.Code);
        Assert.Null(conflict.CurrentVersion);
    }

    /// <summary>The LEASE — the project moved under the push. It is reported on a synthetic row whose name is
    /// pinned in the vocabulary, because the CLI branches on this one to tell the user to pull.</summary>
    [Fact]
    public void A_stale_lease_is_the_error_frame_STALE_PROJECT_VERSION_carrying_the_IDEs_version()
    {
        var ide = new FakeIde();

        var stale = Assert.Throws<BridgeException>(() => BoundWrite.Push(ide, new PushRequest
        {
            ExpectedProjectVersion = "a-lease-from-another-lifetime",
            Ops = new List<PushOp> { new SetItemOp { Name = "A.pou", SourceText = Prg("A"), IfVersion = null } },
        }));

        Assert.Equal(BridgeErrorCodes.StaleProjectVersion, stale.ErrorCode);
        Assert.Equal(RefsService.Handle(ide).ProjectVersion,
            Assert.IsType<StaleProjectVersionData>(stale.ErrorData).CurrentProjectVersion);
        Assert.False(ide.Exists("A"));
    }

    /// <summary>A body the ST reader cannot read is INVALID_ST — raised as a `BridgeException` inside the
    /// pre-flight, which is exactly the class that used to arrive uncoded.</summary>
    [Fact]
    public void An_unreadable_body_is_refused_with_its_code()
    {
        var ide = new FakeIde();

        var res = Push(ide, new SetItemOp
        {
            Name = "Broken.pou",
            SourceText = "this is not a POU at all",
            IfVersion = null,
        });

        Assert.False(res.Landed());
        var conflict = Assert.Single(res.Conflicts!);
        Assert.False(string.IsNullOrEmpty(conflict.Code));
        Assert.Equal(BridgeErrorCodes.InvalidSt, conflict.Code);
    }

    /// <summary>An op the engine cannot route is BAD_REQUEST — a `set` that creates an item and supplies no
    /// source has nothing to create it from.</summary>
    [Fact]
    public void A_create_with_no_source_is_refused_with_BAD_REQUEST()
    {
        var ide = new FakeIde();

        var res = Push(ide, new SetItemOp { Name = "Ghost.pou", SourceText = null, IfVersion = null });

        Assert.False(res.Landed());
        var conflict = Assert.Single(res.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, conflict.Code);
    }

    /// <summary>A DELETE THAT QUOTES NO VERSION OF SOMETHING THAT IS NOT THERE IS ACCEPTED: the delete is idempotent, so a
    /// client that only wants the item gone, replaying or racing another, succeeds.</summary>
    [Fact]
    public void Deleting_an_absent_item_with_no_version_is_a_no_op_not_a_refusal()
    {
        var ide = new FakeIde();

        var res = Push(ide, new DeleteItemOp { Name = "NeverExisted.pou", IfVersion = null });

        Assert.True(res.Landed());
        Assert.Empty(res.Conflicts);
        Assert.Empty(res.Removed);   // it was not there, so the push made nothing disappear
    }

    /// <summary>A QUOTED VERSION MUST HOLD, on a delete as on every other op (owner decision 2026-10-23): a delete quoting
    /// the version the client last saw, of an item the IDE no longer holds, is refused ITEM_MISSING — the client's view of
    /// the IDE is stale, and a success would hide that. Nothing is written.</summary>
    [Fact]
    public void Deleting_an_absent_item_that_quotes_a_version_is_ITEM_MISSING()
    {
        var ide = new FakeIde();

        var res = Push(ide, new DeleteItemOp { Name = "NeverExisted.pou", IfVersion = "0123456789abcdef" });

        Assert.False(res.Landed());
        var conflict = Assert.Single(res.Conflicts!);
        Assert.Equal(ConflictCodes.ItemMissing, conflict.Code);
        Assert.Equal("NeverExisted.pou", conflict.Name);
        Assert.Equal("0123456789abcdef", conflict.YourVersion);
        Assert.Null(conflict.CurrentVersion);
        Assert.Empty(ide.Recorded);
    }

    /// <summary>EVERY CODED REFUSAL, one shape per code the push path can raise — so the mapping is asserted
    /// as a set rather than one example at a time, and a future refusal that forgets its code shows up here.</summary>
    [Fact]
    public void No_refusal_on_the_push_path_arrives_without_a_code()
    {
        var ide = new FakeIde();
        Push(ide, new SetItemOp { Name = "Real.pou", SourceText = Prg("Real"), IfVersion = null });

        // A delete with no version is NOT in this list: deleting an absent item is an accepted no-op by design (see the
        // tests above), so it refuses nothing and has nothing to carry.
        var refusals = new (string What, PushOp Op)[]
        {
            ("a body the reader refuses", new SetItemOp { Name = "X.pou", SourceText = "nonsense", IfVersion = null }),
            ("a create with no source", new SetItemOp { Name = "Y.pou", SourceText = null, IfVersion = null }),
            ("an empty body on a create", new SetItemOp { Name = "W.pou", SourceText = "", IfVersion = null }),
        };

        foreach (var (what, op) in refusals)
        {
            var res = Push(ide, op);
            Assert.False(res.Landed(), what);
            var conflict = Assert.Single(res.Conflicts!);
            Assert.False(string.IsNullOrEmpty(conflict.Code),
                $"{what}: refused with a message and no code — a caller can only match the English");
        }
    }

    /// <summary>A DRIVER'S CODED "CANNOT" REACHES THE CLIENT AS `UNSUPPORTED`.
    ///
    /// <para>Both drivers refuse a shape this vendor cannot express — a graphical body with no vendor form, a member
    /// kind with no mapping, an Execute box, a box output pin wired straight to a variable — and every one arrived as
    /// `code: null` until it carried a code: a refusal whose own message says at length that the shape can NEVER be
    /// written, carrying nothing to tell it apart from "pull and retry". The code is the throw's own (an
    /// <c>UnsupportedException</c> here), never read off the exception's type (wire-final-shape step 3c).</para>
    ///
    /// <para>Found by the LIVE suite, not this one — `create-shapes.test.ts` on TwinCAT — after the offline
    /// tier had been green through several rounds of exactly this work. The fake has no vendor importer to
    /// refuse anything, so the whole class was invisible here.</para></summary>
    [Fact]
    public void A_vendor_that_cannot_express_the_shape_is_refused_with_UNSUPPORTED()
    {
        var ide = new FakeIde
        {
            RefuseContentWrite = _ => new UnsupportedException("this vendor cannot draw that"),
        };

        var res = BoundWrite.Push(ide, new PushRequest
        {
            Ops = new List<PushOp>
            {
                new SetItemOp { Name = "Shape.pou", SourceText = Prg("Shape"), IfVersion = null },
            },
        });

        Assert.False(res.Landed());
        Assert.Equal(BridgeErrorCodes.Unsupported, Assert.Single(res.Conflicts!).Code);
    }

    /// <summary>EVERY RE-CODE OF openspec <c>bridge-refusal-review</c> §2 REACHES THE WIRE WITH ITS CODE (D14). The rows
    /// carry their code at the throw (wire-final-shape step 3c), so it is asserted per class at the write: a Volt
    /// invariant (<c>ArgumentException</c>, 2.2; <c>VoltInvariantException</c>; a coded INTERNAL_ERROR, 2.35) is
    /// INTERNAL_ERROR, a vendor limit (<c>UnsupportedException</c>, 2.21) is UNSUPPORTED, an API this IDE lacks is
    /// IDE_UNSUPPORTED, and a malformed `.task` (<c>TaskDescriptorException</c>, D14) is BAD_REQUEST. A FOREIGN BCL
    /// exception — <c>NotSupportedException</c> and <c>InvalidOperationException</c> included — is nobody's
    /// classification and answers INTERNAL_ERROR: the type is never read as a code, so a conflict and an error frame
    /// answer one failure alike. (2.14/2.15, 2.16-2.18 and 2.25 assert their codes where they are raised.)</summary>
    [Theory]
    [InlineData("argument", BridgeErrorCodes.InternalError)]
    [InlineData("invariant", BridgeErrorCodes.InternalError)]
    [InlineData("coded-internal", BridgeErrorCodes.InternalError)]
    [InlineData("vendor-limit", BridgeErrorCodes.Unsupported)]
    [InlineData("ide-api-missing", BridgeErrorCodes.IdeUnsupported)]
    [InlineData("foreign-not-supported", BridgeErrorCodes.InternalError)]
    [InlineData("foreign-invalid-operation", BridgeErrorCodes.InternalError)]
    [InlineData("task", BridgeErrorCodes.BadRequest)]
    public void Each_refusal_class_reaches_the_wire_with_its_code(string refusal, string code)
    {
        System.Exception ex = refusal switch
        {
            "argument" => new System.ArgumentException("a kind with no composite shape"),
            "invariant" => new VoltInvariantException("network model invariant — a Volt bug"),
            "coded-internal" => new BridgeException(BridgeErrorCodes.InternalError, "moved item not found after the move"),
            "vendor-limit" => new UnsupportedException("no Implementation aspect"),
            "ide-api-missing" => new BridgeException(BridgeErrorCodes.IdeUnsupported, "CODESYS: no 'move' on this object"),
            "foreign-not-supported" => new System.NotSupportedException("Specified method is not supported."),
            "foreign-invalid-operation" => new System.InvalidOperationException("Collection was modified"),
            "task" => new Volt.Engine.Format.Task.TaskDescriptorException("line 3: 'CoreBinding' is not a task field"),
            _ => throw new System.ArgumentOutOfRangeException(nameof(refusal)),
        };
        var ide = new FakeIde { RefuseContentWrite = _ => ex };

        var res = Push(ide, new SetItemOp { Name = "Shape.pou", SourceText = Prg("Shape"), IfVersion = null });

        Assert.False(res.Landed());
        Assert.Equal(code, Assert.Single(res.Conflicts!).Code);
    }

    /// <summary>A VOLT BUG ANSWERED AS A CONFLICT IS LOGGED WHOLE, as one answered as a frame is (<c>PipeServer</c>):
    /// INTERNAL_ERROR's remedy is "report a bug", and the conflict carries only the message — without the exception and its
    /// stack in the log there is nothing to report. A refusal with a code of its own is the client's to act on and is not
    /// logged as an error (gate 3c review, finding 7).</summary>
    [Theory]
    [InlineData("invariant", true)]
    [InlineData("foreign", true)]
    [InlineData("vendor-limit", false)]
    public void A_Volt_bug_answered_as_a_conflict_is_logged_with_its_stack(string refusal, bool logged)
    {
        System.Exception ex = refusal switch
        {
            "invariant" => new VoltInvariantException("network model invariant — a Volt bug"),
            "foreign" => new System.InvalidOperationException("Collection was modified"),
            _ => new UnsupportedException("no Implementation aspect"),
        };
        var ide = new FakeIde { RefuseContentWrite = _ => ex };
        using var log = new LogCapture(VoltLogLevel.Info);

        var res = Push(ide, new SetItemOp { Name = "Shape.pou", SourceText = Prg("Shape"), IfVersion = null });

        Assert.False(res.Landed());
        var text = log.Read();
        if (!logged) { Assert.DoesNotContain("[error]", text, System.StringComparison.OrdinalIgnoreCase); return; }
        Assert.Contains("Shape.pou", text);
        Assert.Contains(ex.GetType().FullName!, text);    // the whole exception: its type…
        Assert.Contains(ex.Message, text);
        Assert.Contains("   at ", text);                   // …and its stack
    }
}
