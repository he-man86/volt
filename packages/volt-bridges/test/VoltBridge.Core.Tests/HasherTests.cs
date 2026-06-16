using VoltBridge.Core;
using Xunit;

namespace VoltBridge.Core.Tests;

/// <summary>
/// The item version is content-addressed: a hash of the item's FOLDER + its MATERIALIZED workspace
/// text (the exact .st/.fbd/.enum bytes). Same content ⇒ same version; any content or folder change ⇒
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
        // The materialized .fbd text is what's hashed — so an edit to the VG body (here: a different
        // operand) yields a different version, while the unchanged body is stable.
        const string fbd1 = "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n  END_VAR\n  i1 := a;\n  i2 := b;\n  g1 := (i1 AND i2);\n  out := g1;\nEND_NETWORK\n";
        const string fbd2 = "NETWORK 0 FBD\n  VAR_TEMP\n    i1 : BOOL;\n    i2 : BOOL;\n    g1 : BOOL;\n  END_VAR\n  i1 := a;\n  i2 := b;\n  g1 := (i1 OR i2);\n  out := g1;\nEND_NETWORK\n";
        Assert.Equal(Hasher.ComputeItemVersion("", fbd1), Hasher.ComputeItemVersion("", fbd1));
        Assert.NotEqual(Hasher.ComputeItemVersion("", fbd1), Hasher.ComputeItemVersion("", fbd2));
    }

    [Fact]
    public void Null_text_is_stable()
    {
        Assert.Equal(Hasher.ComputeItemVersion(null, null), Hasher.ComputeItemVersion(null, null));
        Assert.Equal(16, Hasher.ComputeItemVersion("", "").Length);
    }
}
