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
        $"PROGRAM {name}\nVAR\nEND_VAR\n(* @volt-implementation *)\nn := 0;\n\nEND_PROGRAM\n";

    private static PushResponse Push(FakeIde ide, params PushOp[] ops) =>
        PushService.Handle(ide, new PushRequest
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
        Push(ide, new SetItemOp { Name = "A.prg", SourceText = Prg("A"), IfVersion = null });

        var stale = Push(ide, new SetItemOp { Name = "A.prg", SourceText = Prg("A"), IfVersion = "not-the-version" });

        var conflict = Assert.Single(stale.Conflicts!);
        Assert.False(stale.Accepted);
        Assert.Equal(ConflictCodes.StaleItemVersion, conflict.Code);
        Assert.NotNull(conflict.CurrentVersion);      // still structured — the code is in ADDITION, not instead
    }

    /// <summary>A create that landed on a name the IDE holds. NOT "pull and retry": the remedy is to fetch the
    /// item's version and push an update, or pick another name.</summary>
    [Fact]
    public void A_create_onto_an_existing_name_says_so()
    {
        var ide = new FakeIde();
        Push(ide, new SetItemOp { Name = "A.prg", SourceText = Prg("A"), IfVersion = null });

        var collide = Push(ide, new SetItemOp { Name = "A.prg", SourceText = Prg("A"), IfVersion = null });

        Assert.False(collide.Accepted);
        Assert.Equal(ConflictCodes.ItemExists, Assert.Single(collide.Conflicts!).Code);
    }

    /// <summary>A version quoted for an item that is gone. Distinct from a stale version because there is
    /// nothing to merge with.</summary>
    [Fact]
    public void A_version_for_a_missing_item_says_so()
    {
        var ide = new FakeIde();

        var gone = Push(ide, new SetItemOp { Name = "Ghost.prg", SourceText = Prg("Ghost"), IfVersion = "some-version" });

        Assert.False(gone.Accepted);
        var conflict = Assert.Single(gone.Conflicts!);
        Assert.Equal(ConflictCodes.ItemMissing, conflict.Code);
        Assert.Null(conflict.CurrentVersion);
    }

    /// <summary>The LEASE — the project moved under the push. It is reported on a synthetic row whose name is
    /// pinned in the vocabulary, because the CLI branches on this one to tell the user to pull.</summary>
    [Fact]
    public void A_stale_lease_says_so_on_the_project_row()
    {
        var ide = new FakeIde();

        var stale = PushService.Handle(ide, new PushRequest
        {
            ExpectedProjectVersion = "a-lease-from-another-lifetime",
            Ops = new List<PushOp> { new SetItemOp { Name = "A.prg", SourceText = Prg("A"), IfVersion = null } },
        });

        Assert.False(stale.Accepted);
        var conflict = Assert.Single(stale.Conflicts!);
        Assert.Equal(ConflictCodes.StaleProjectVersion, conflict.Code);
        Assert.Equal(ConflictCodes.ProjectName, conflict.Name);
    }

    /// <summary>A body the ST reader cannot read is INVALID_ST — raised as a `BridgeException` inside the
    /// pre-flight, which is exactly the class that used to arrive uncoded.</summary>
    [Fact]
    public void An_unreadable_body_is_refused_with_its_code()
    {
        var ide = new FakeIde();

        var res = Push(ide, new SetItemOp
        {
            Name = "Broken.prg",
            SourceText = "this is not a POU at all",
            IfVersion = null,
        });

        Assert.False(res.Accepted);
        var conflict = Assert.Single(res.Conflicts!);
        Assert.False(string.IsNullOrEmpty(conflict.Code));
        Assert.Contains(conflict.Code, new[] { BridgeErrorCodes.InvalidSt, BridgeErrorCodes.InvalidCodeHeader });
    }

    /// <summary>An op the engine cannot route is BAD_REQUEST — a `set` that creates an item and supplies no
    /// source has nothing to create it from.</summary>
    [Fact]
    public void A_create_with_no_source_is_refused_with_BAD_REQUEST()
    {
        var ide = new FakeIde();

        var res = Push(ide, new SetItemOp { Name = "Ghost.prg", SourceText = null, IfVersion = null });

        Assert.False(res.Accepted);
        var conflict = Assert.Single(res.Conflicts!);
        Assert.Equal(BridgeErrorCodes.BadRequest, conflict.Code);
    }

    /// <summary>DELETING SOMETHING THAT IS NOT THERE IS ACCEPTED, and that is deliberate — `PushService`
    /// answers "no-op" for it in so many words.
    ///
    /// <para>Written down because it is the obvious way to reach for a NOT_FOUND and it is not one: a delete
    /// is idempotent, so a client replaying a push, or two clients racing to remove the same item, both
    /// succeed. Asserting it here stops the next reader "fixing" the absence of a code by making the delete
    /// throw.</para></summary>
    [Fact]
    public void Deleting_an_absent_item_is_a_no_op_not_a_refusal()
    {
        var ide = new FakeIde();

        var res = Push(ide, new DeleteItemOp { Name = "NeverExisted.prg", IfVersion = null });

        Assert.True(res.Accepted);
        Assert.Null(res.Conflicts);
    }

    /// <summary>EVERY CODED REFUSAL, one shape per code the push path can raise — so the mapping is asserted
    /// as a set rather than one example at a time, and a future refusal that forgets its code shows up here.</summary>
    [Fact]
    public void No_refusal_on_the_push_path_arrives_without_a_code()
    {
        var ide = new FakeIde();
        Push(ide, new SetItemOp { Name = "Real.prg", SourceText = Prg("Real"), IfVersion = null });

        // A delete is NOT in this list: deleting an absent item is an accepted no-op by design (see the test
        // above), so it refuses nothing and has nothing to carry.
        var refusals = new (string What, PushOp Op)[]
        {
            ("a body the reader refuses", new SetItemOp { Name = "X.prg", SourceText = "nonsense", IfVersion = null }),
            ("a create with no source", new SetItemOp { Name = "Y.prg", SourceText = null, IfVersion = null }),
            ("an empty body on a create", new SetItemOp { Name = "W.prg", SourceText = "", IfVersion = null }),
        };

        foreach (var (what, op) in refusals)
        {
            var res = Push(ide, op);
            Assert.False(res.Accepted, what);
            var conflict = Assert.Single(res.Conflicts!);
            Assert.False(string.IsNullOrEmpty(conflict.Code),
                $"{what}: refused with a message and no code — a caller can only match the English");
        }
    }
}
