using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Item;
using Volt.Engine.Format.St;
using Xunit;
using Volt.Engine.Sync;

namespace Volt.Cli.Tests;

/// <summary>
/// The item version is content-addressed: a hash of the item's FOLDER + its MATERIALIZED workspace
/// text (the exact assembled ST-text bytes). Same content ⇒ same version; any content or folder change ⇒
/// a new version. This is the single basis used by /refs, /fetch, and the push receipt, so they agree.
/// </summary>
public class HasherTests
{
    [Fact]
    public void Same_content_same_version()
    {
        var a = Hasher.ComputeItemVersion("POUs", "PROGRAM P\nVAR\nEND_VAR\n\nx := 1;\nEND_PROGRAM\n");
        var b = Hasher.ComputeItemVersion("POUs", "PROGRAM P\nVAR\nEND_VAR\n\nx := 1;\nEND_PROGRAM\n");
        Assert.Equal(a, b);
    }

    [Fact]
    public void Content_change_changes_version()
    {
        var a = Hasher.ComputeItemVersion("POUs", "x := 1;");
        var b = Hasher.ComputeItemVersion("POUs", "x := 2;");
        Assert.NotEqual(a, b);
    }

    [Fact]
    public void Folder_change_changes_version()   // a move re-versions the item
    {
        var a = Hasher.ComputeItemVersion("POUs/A", "x := 1;");
        var b = Hasher.ComputeItemVersion("POUs/B", "x := 1;");
        Assert.NotEqual(a, b);
    }

    [Fact]
    public void A_graphical_body_edit_changes_the_version()
    {
        // The materialized network-text body text is what's hashed — so an edit to the body (here: a different
        // operand) yields a different version, while the unchanged body is stable.
        const string fbd1 = "NETWORK 0 FBD\n  LET i1 := a;\n  LET i2 := b;\n  LET g1 := (i1 AND i2);\n  out := g1;\nEND_NETWORK\n";
        const string fbd2 = "NETWORK 0 FBD\n  LET i1 := a;\n  LET i2 := b;\n  LET g1 := (i1 OR i2);\n  out := g1;\nEND_NETWORK\n";
        Assert.Equal(Hasher.ComputeItemVersion("", fbd1), Hasher.ComputeItemVersion("", fbd1));
        Assert.NotEqual(Hasher.ComputeItemVersion("", fbd1), Hasher.ComputeItemVersion("", fbd2));
    }

    [Fact]
    public void Null_text_is_stable()
    {
        Assert.Equal(Hasher.ComputeItemVersion(null, null), Hasher.ComputeItemVersion(null, null));
        Assert.Equal(16, Hasher.ComputeItemVersion("", "").Length);
    }

    /// <summary>THE CONSISTENCY THE PUSH'S LAST-MOMENT CHECK DEPENDS ON.
    ///
    /// <para><c>PushService</c> re-hashes an item immediately before overwriting it, to catch an engineer who
    /// moved, deleted or edited it in the IDE while the push was being applied. It computes that hash ITSELF,
    /// from content already in hand, rather than paying for another materialize. If that computation ever
    /// diverges from the one <see cref="Versioning"/> uses for the SAME item, every ordinary update push starts
    /// refusing with "changed in the IDE while this push was being applied" - a false conflict on a project
    /// nobody touched. This pins the two together.</para></summary>
    [Fact]
    public void The_push_late_check_hashes_an_item_exactly_as_Versioning_does()
    {
        var ide = new FakeIde(
            new FakeIde.Item("FB_H", ItemKind.PlcPouFb, "POUs", true,
                "FUNCTION_BLOCK FB_H\nVAR\n\tx : INT;\nEND_VAR", "x := 1;", null, null));

        var item = ide.WalkItems().Items.Single(i => i.Name == "FB_H");

        // What refs/fetch record for it.
        var authoritative = Versioning.Materialize(ide, "FB_H", ItemKind.Kinds.FunctionBlock, item.Item, item.Folder).Version;

        // What the push computes from the content it already read.
        var live = ide.ReadContent(item.Item);
        var lateCheck = Hasher.ComputeItemVersion(item.Folder, StWriter.Write(live));

        Assert.Equal(authoritative, lateCheck);
    }

    /// <summary>The project version does not depend on walk ORDER. Two vendors walk their trees differently and
    /// must still agree, and a dictionary's iteration order is not a contract - if this ever regressed, a
    /// project nobody edited would report a different version on every call and every push would say
    /// "pull first".</summary>
    [Fact]
    public void The_project_version_is_independent_of_insertion_order()
    {
        var forward = new Dictionary<string, string>
        {
            ["A.fb"] = "1111111111111111", ["B.fb"] = "2222222222222222", ["C.fb"] = "3333333333333333",
        };
        var backward = new Dictionary<string, string>
        {
            ["C.fb"] = "3333333333333333", ["B.fb"] = "2222222222222222", ["A.fb"] = "1111111111111111",
        };

        Assert.Equal(Hasher.ComputeProjectVersion(forward), Hasher.ComputeProjectVersion(backward));
    }

    /// <summary>A MOVE re-versions the item. The folder is in the hash precisely so that relocating a POU is a
    /// change the client can see - a move that did not move the version would leave the workspace and the IDE
    /// disagreeing about where a file lives, with `volt status` reporting clean.</summary>
    [Fact]
    public void Moving_an_item_changes_its_version()
    {
        const string text = "PROGRAM P\nVAR\nEND_VAR\n\nx := 1;\nEND_PROGRAM\n";
        Assert.NotEqual(Hasher.ComputeItemVersion("POUs", text),
                        Hasher.ComputeItemVersion("POUs/Motion", text));
    }

    /// <summary>An EMPTY folder and a MISSING one must not be the same hash by accident. The hasher's own doc
    /// forbids defaulting a null folder to "" for this reason: an item at the project root and an item whose
    /// folder failed to read would then version identically, and the failure would surface as "no change".</summary>
    [Fact]
    public void The_root_folder_and_a_named_folder_hash_differently()
    {
        const string text = "PROGRAM P\nVAR\nEND_VAR\nEND_PROGRAM\n";
        Assert.NotEqual(Hasher.ComputeItemVersion("", text), Hasher.ComputeItemVersion("POUs", text));
    }
}
