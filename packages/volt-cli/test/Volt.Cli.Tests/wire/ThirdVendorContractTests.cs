using System.Linq;
using Volt.Engine;
using Volt.Engine.Item;
using Volt.Engine.Seam;
using Xunit;

namespace Volt.Cli.Tests;

/// <summary>The third test vendor against the new contract ALONE — what the old engine cannot carry over the pipe yet
/// (design "Step 4 findings", F4): its own <c>%</c>-keys and a hidden body in its own format, read and written through the
/// registries, and its declaration sitting beside the CODESYS family's in one catalog.</summary>
public class ThirdVendorContractTests
{
    private static readonly Catalog Fakecos = Catalog.Of(Fakeco.DeclarationOf());

    [Theory]
    [InlineData(Fakeco.Block, "%RETAIN\n%NOTE 'main drive'\nBLOCK Motor\nIN start\n%LANGUAGE FKL\nlamp = start\n")]
    [InlineData(Fakeco.Block, "BLOCK Chart\n%LANGUAGE LAD UNSUPPORTED\n")]
    [InlineData(Fakeco.Type, "%NOTE 'rpm'\nTYPE Speed\nFIELD rpm\n")]
    public void The_vendors_own_format_reads_and_writes_its_text_back_byte_for_byte(string kind, string text)
    {
        var content = Fakeco.Format.Read(text, kind, "X", Fakecos, Fakeco.Id);

        Assert.Equal(text, Fakeco.Format.Write(content, "X"));
    }

    [Fact]
    public void Its_keys_and_its_hidden_body_are_facts_not_text()
    {
        var block = Fakeco.Format.Read("%RETAIN\nBLOCK Chart\n%LANGUAGE LAD UNSUPPORTED\n", Fakeco.Block, "Chart", Fakecos, Fakeco.Id);

        Assert.Equal(new[] { new Property("RETAIN", null) }, block.Properties.Items);
        Assert.Equal(BodyText.Hidden("LAD", ""), block.Body);
        Assert.Equal("BLOCK Chart", block.Declaration);
    }

    [Theory]
    [InlineData(Fakeco.Block, "BLOCK Motor\n%LANGUAGE ST\nx := 1;\n", "shows no ST body (it shows FKL)")]
    [InlineData(Fakeco.Block, "BLOCK Motor\nlamp = start\n", "has none")]
    [InlineData(Fakeco.Block, "%EXCLUDE_FROM_BUILD\nBLOCK Motor\n%LANGUAGE FKL\n", "%EXCLUDE_FROM_BUILD is no property key a host declared")]
    [InlineData(Fakeco.Type, "TYPE Speed\n%LANGUAGE FKL\n", "a type has no body")]
    [InlineData(Fakeco.Block, "BLOCK Chart\n%LANGUAGE LAD UNSUPPORTED\nx\n", "code follows it")]
    public void A_text_the_vendor_cannot_hold_is_refused_by_name(string kind, string text, string why)
    {
        var ex = Assert.Throws<BridgeException>(() => Fakeco.Format.Read(text, kind, "X", Fakecos, Fakeco.Id));
        Assert.Equal("INVALID_ST", ex.ErrorCode);
        Assert.Contains(why, ex.Message);
    }

    /// <summary>A non-family vendor and the CODESYS family share one catalog without a conflict: no kind, extension,
    /// language grammar or key of one is spelled differently by the other.</summary>
    [Fact]
    public void Its_declaration_sits_beside_the_familys_in_one_catalog()
    {
        var family = new VendorDeclaration(new VendorRow("codesys", "CODESYS"),
            ItemKind.ReferenceKindExtensions.Select(x => KindRow.Descriptor(x.Kind, x.Ext)).ToList(),
            new[] { LanguageRow.Shown("ST", PlainTextReader.Instance), LanguageRow.Hidden("CFC") },
            new[] { new PropertyKey("EXCLUDE_FROM_BUILD", PropertyGrammar.Flag), new PropertyKey("COMMENT", PropertyGrammar.Text) });

        var catalog = Catalog.Of(family, Fakeco.DeclarationOf());

        Assert.Equal(new[] { "blk", "typ" }, catalog.Kinds.SourceExtensions);
        Assert.Equal(new[] { "FKL" }, catalog.Languages.ShownBy(Fakeco.Id));
        Assert.Equal("Fakeco", catalog.Vendors.Display(Fakeco.Id));
    }
}
