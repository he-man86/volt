using System;
using System.Linq;
using Volt.Engine;
using Volt.Engine.Item;
using Volt.Engine.Seam;
using Xunit;
using Volt.Contracts;

namespace Volt.Engine.Tests.Seam;

/// <summary>The four registries of the new contract (openspec <c>volt-cli-rework</c> design "New Ide/ contract"): kinds,
/// languages, <c>%</c>-keys and vendors. Each refuses a conflict at registration naming both vendors, and each lookup
/// refuses what no host registered by name.</summary>
public class SeamRegistryTests
{
    private sealed class StubFormat : IItemFormat
    {
        public StubFormat(string name) => Name = name;
        public string Name { get; }
        public string Write(Content content, string name) => throw new NotSupportedException();
        public Content Read(string text, string kind, string name, Catalog catalog, string vendor) => throw new NotSupportedException();
        public int? LineOf(string text, string kind, string name, string? member, int objectLine) => throw new NotSupportedException();
    }

    private sealed class OtherReader : IBodyReader
    {
        public object Read(string code, BodyContext context) => code;
    }

    private static readonly KindShape WithBody = new(Members: true, Body: true, AccessorShape.None, Signature: false);
    private static readonly KindShape NoBody = new(Members: false, Body: false, AccessorShape.None, Signature: false);
    private static readonly IItemFormat Layout = new StubFormat("layout");

    private static KindRegistry Kinds(params KindRow[] rows)
    {
        var r = new KindRegistry();
        r.Register("a", rows);
        return r;
    }

    // ── kinds ──

    [Fact]
    public void An_extension_resolves_to_its_row_and_a_wire_name_by_its_last_dot()
    {
        var kinds = Kinds(KindRow.Source("block", "blk", WithBody, Layout), KindRow.Descriptor("station", "stn"));

        Assert.Equal("block", kinds.ForExtension("blk").Kind);
        Assert.Equal("station", kinds.ForWireName("Plant/My.Station/Line.1.stn").Kind);
        Assert.Equal("blk", kinds.ExtensionOf("block"));
    }

    [Fact]
    public void An_unknown_extension_is_a_BAD_REQUEST_naming_it_and_the_known_set()
    {
        var kinds = Kinds(KindRow.Source("block", "blk", WithBody, Layout), KindRow.Descriptor("station", "stn"));

        var ex = Assert.Throws<BridgeException>(() => kinds.ForWireName("Plant/Valve.xyz"));
        Assert.Equal("BAD_REQUEST", ex.ErrorCode);
        Assert.Contains("'.xyz'", ex.Message);
        Assert.Contains(".blk, .stn", ex.Message);

        Assert.Equal("BAD_REQUEST", Assert.Throws<BridgeException>(() => kinds.ForWireName("Plant.d/Valve")).ErrorCode);
    }

    [Fact]
    public void Two_vendors_registering_the_same_row_share_it()
    {
        var kinds = new KindRegistry();
        kinds.Register("codesys", KindRow.Source("pou", "pou", WithBody, new StubFormat("iec")));
        kinds.Register("twincat", KindRow.Source("pou", "pou", WithBody, new StubFormat("iec")));   // another instance, the same format

        Assert.Equal(new[] { "codesys", "twincat" }, kinds.VendorsOf("pou"));
        Assert.Single(kinds.Rows);
    }

    [Fact]
    public void One_kind_spelled_with_two_extensions_is_refused_naming_both_vendors()
    {
        var kinds = new KindRegistry();
        kinds.Register("codesys", KindRow.Source("pou", "pou", WithBody, Layout));

        var ex = Assert.Throws<VoltInvariantException>(() => kinds.Register("twincat", KindRow.Source("pou", "tcpou", WithBody, Layout)));
        Assert.Contains("vendor 'twincat'", ex.Message);
        Assert.Contains("as codesys registered it", ex.Message);
    }

    [Fact]
    public void One_extension_for_two_kinds_is_refused()
    {
        var kinds = new KindRegistry();
        kinds.Register("siemens", KindRow.Source("fb", "blk", WithBody, Layout));

        var ex = Assert.Throws<VoltInvariantException>(() => kinds.Register("fakeco", KindRow.Source("block", "blk", WithBody, Layout)));
        Assert.Contains("'.blk' names kind 'block' here but kind 'fb' as siemens registered it", ex.Message);
    }

    [Theory]
    [InlineData("role")]
    [InlineData("shape")]
    [InlineData("format")]
    public void One_kind_with_another_role_shape_or_format_is_refused(string differs)
    {
        var kinds = new KindRegistry();
        kinds.Register("codesys", KindRow.Source("gvl", "gvl", NoBody, Layout));
        var other = differs switch
        {
            "role" => KindRow.Descriptor("gvl", "gvl"),
            "shape" => KindRow.Source("gvl", "gvl", WithBody, Layout),
            _ => KindRow.Source("gvl", "gvl", NoBody, new StubFormat("scl")),
        };

        Assert.Throws<VoltInvariantException>(() => kinds.Register("twincat", other));
    }

    [Theory]
    [InlineData("POU")]
    [InlineData("p ou")]
    [InlineData("")]
    public void An_extension_that_is_no_lower_case_word_is_refused(string extension) =>
        Assert.Throws<VoltInvariantException>(() => Kinds(KindRow.Descriptor("thing", extension)));

    [Fact]
    public void A_row_whose_role_contradicts_its_fields_is_refused()
    {
        Assert.Throws<VoltInvariantException>(() => Kinds(new KindRow("method", "meth", KindRole.Member, WithBody)));   // a member is no file
        Assert.Throws<VoltInvariantException>(() => Kinds(new KindRow("block", "blk", KindRole.Source, WithBody)));      // a source kind has a format
        Assert.Throws<VoltInvariantException>(() => Kinds(new KindRow("block", "blk", KindRole.Source, null, Layout)));  // and a shape
        Assert.Throws<VoltInvariantException>(() => Kinds(new KindRow("station", "stn", KindRole.Descriptor, null, Layout)));
    }

    [Fact]
    public void The_source_extension_set_holds_only_source_kinds_in_ordinal_order()
    {
        var kinds = Kinds(KindRow.Source("type", "typ", NoBody, Layout), KindRow.Source("block", "blk", WithBody, Layout),
                          KindRow.Descriptor("station", "stn"), KindRow.Descriptor("task", "task", writable: true),
                          KindRow.Member("routine", WithBody));

        Assert.Equal(new[] { "blk", "typ" }, kinds.SourceExtensions);
        Assert.Throws<ArgumentException>(() => kinds.ExtensionOf("routine"));
        Assert.Throws<ArgumentException>(() => kinds.ExtensionOf("nothing"));
    }

    /// <summary>TODAY'S CODESYS-FAMILY TABLE IS EXPRESSIBLE (design: "the old contract on the new one"): every row of
    /// <see cref="ItemKind"/>'s extension tables as a registry row, registered by BOTH family hosts, is accepted — and the
    /// registry's source set is exactly the set <c>bun run check</c> gates today.</summary>
    [Fact]
    public void The_family_table_registered_by_both_hosts_is_accepted_and_keeps_its_source_set()
    {
        var iec = new StubFormat("iec");
        var rows = ItemKind.SourceKindExtensions.Select(x => KindRow.Source(x.Kind, x.Ext, ItemKind.ShapeOf(x.Kind), iec))
            .Concat(ItemKind.ReferenceKindExtensions.Select(x =>
                KindRow.Descriptor(x.Kind, x.Ext, writable: ItemKind.WritableReferenceKinds.Contains(x.Kind))))
            .Concat(new[] { ItemKind.Kinds.Method, ItemKind.Kinds.Action, ItemKind.Kinds.Property,
                            ItemKind.Kinds.InterfaceMethod, ItemKind.Kinds.InterfaceProperty }
                .Select(k => KindRow.Member(k, ItemKind.ShapeOf(k))))
            .ToList();
        var kinds = new KindRegistry();
        kinds.Register("codesys", rows);
        kinds.Register("twincat", rows);

        Assert.Equal(ItemKind.SourceKindExtensions.Select(x => x.Ext).OrderBy(x => x, StringComparer.Ordinal), kinds.SourceExtensions);
        Assert.Equal(ItemKind.SourceKindExtensions.Count + ItemKind.ReferenceKindExtensions.Count, kinds.Extensions.Count);
    }

    // ── languages ──

    [Fact]
    public void Whether_a_language_is_shown_is_per_vendor_and_its_grammar_is_one()
    {
        var langs = new LanguageRegistry();
        langs.Register("codesys", new[] { LanguageRow.Shown("ST", PlainTextReader.Instance), LanguageRow.Shown("FBD", new OtherReader()), LanguageRow.Hidden("CFC") });
        langs.Register("siemens", new[] { LanguageRow.Shown("SCL", PlainTextReader.Instance), LanguageRow.Hidden("FBD") });

        Assert.True(langs.IsShown("FBD", "codesys"));
        Assert.False(langs.IsShown("FBD", "siemens"));
        Assert.Equal(new[] { "FBD", "ST" }, langs.ShownBy("codesys"));
        Assert.Equal(new[] { "SCL" }, langs.ShownBy("siemens"));
        Assert.Equal(new[] { "CFC", "FBD", "SCL", "ST" }, langs.Names);
        Assert.Same(PlainTextReader.Instance, langs.Reader("ST"));
        Assert.Throws<ArgumentException>(() => langs.Reader("CFC"));
    }

    [Fact]
    public void Two_readers_for_one_language_name_are_refused()
    {
        var langs = new LanguageRegistry();
        langs.Register("codesys", LanguageRow.Shown("FBD", new OtherReader()));

        var ex = Assert.Throws<VoltInvariantException>(() => langs.Register("siemens", LanguageRow.Shown("FBD", PlainTextReader.Instance)));
        Assert.Contains("one language name is one grammar", ex.Message);
    }

    [Theory]
    [InlineData("st")]
    [InlineData("NONE")]
    [InlineData("UNSUPPORTED")]
    [InlineData("S T")]
    public void A_language_name_that_is_no_upper_case_word_or_is_the_lines_own_word_is_refused(string name) =>
        Assert.Throws<VoltInvariantException>(() => new LanguageRegistry().Register("a", LanguageRow.Hidden(name)));

    [Fact]
    public void The_line_states_a_shown_language_only_where_the_vendor_shows_it()
    {
        var langs = new LanguageRegistry();
        langs.Register("fakeco", new[] { LanguageRow.Shown("FKL", PlainTextReader.Instance), LanguageRow.Hidden("LAD") });

        Assert.Equal(BodyText.Shown("FKL", ""), ImplementationLine.Parse("implementation fkl", langs, "fakeco"));
        Assert.Equal(BodyText.Hidden("STL", ""), ImplementationLine.Parse("IMPLEMENTATION STL UNSUPPORTED", langs, "fakeco"));
        Assert.Equal(BodyText.Abstract, ImplementationLine.Parse("IMPLEMENTATION NONE", langs, "fakeco"));

        var ex = Assert.Throws<BridgeException>(() => ImplementationLine.Parse("IMPLEMENTATION LAD", langs, "fakeco"));
        Assert.Equal("INVALID_ST", ex.ErrorCode);
        Assert.Contains("shows no LAD body (it shows FKL)", ex.Message);
        Assert.Equal("INVALID_ST", Assert.Throws<BridgeException>(() => ImplementationLine.Parse("IMPLEMENTATION", langs, "fakeco")).ErrorCode);

        foreach (var body in new[] { BodyText.Shown("FKL", "x"), BodyText.Hidden("LAD", "why"), BodyText.Abstract })
            Assert.Equal(body.Form, ImplementationLine.Parse(ImplementationLine.For(body), langs, "fakeco").Form);
    }

    // ── %-keys ──

    private static PropertyKeyRegistry Keys()
    {
        var keys = new PropertyKeyRegistry();
        keys.Register("codesys", new[]
        {
            new PropertyKey("EXCLUDE_FROM_BUILD", PropertyGrammar.Flag), new PropertyKey("ONLINE_CHANGE_RESERVE", PropertyGrammar.Integer),
            new PropertyKey("CLASS", PropertyGrammar.Words), new PropertyKey("COMMENT", PropertyGrammar.Text),
            new PropertyKey("UNDEFINE", PropertyGrammar.Text, Repeats: true),
        });
        keys.Register("rockwell", new PropertyKey("REVISION", PropertyGrammar.Word));
        return keys;
    }

    [Fact]
    public void Each_grammar_reads_its_value_and_writes_it_back()
    {
        var keys = Keys();
        foreach (var line in new[] { "%EXCLUDE_FROM_BUILD", "%ONLINE_CHANGE_RESERVE 4", "%CLASS CHECK CheckBounds", "%COMMENT 'a b'", "%REVISION 2.1" })
            Assert.Equal(line, keys.Format(keys.Parse(line)));
    }

    [Theory]
    [InlineData("%EXCLUDE_FROM_BUILD yes", "is a flag")]
    [InlineData("%ONLINE_CHANGE_RESERVE four", "takes one integer")]
    [InlineData("%CLASS", "takes a value")]
    [InlineData("%COMMENT a b", "takes one quoted string")]
    [InlineData("%REVISION 2 1", "takes one word")]
    [InlineData("%OPTIMIZED", "%OPTIMIZED is no property key a host declared")]
    [InlineData("CLASS x", "is no %-line")]
    public void A_line_its_grammar_or_the_key_set_refuses_is_INVALID_ST_naming_it(string line, string why)
    {
        var ex = Assert.Throws<BridgeException>(() => Keys().Parse(line));
        Assert.Equal("INVALID_ST", ex.ErrorCode);
        Assert.Contains(why, ex.Message);
    }

    [Fact]
    public void Only_a_repeating_key_may_be_stated_twice()
    {
        Assert.Equal(2, Keys().ParseAll(new[] { "%UNDEFINE 'A'", "%UNDEFINE 'B'" }).Items.Count);
        Assert.Contains("stated twice", Assert.Throws<BridgeException>(() => Keys().ParseAll(new[] { "%COMMENT 'a'", "%COMMENT 'b'" })).Message);
    }

    [Fact]
    public void A_key_with_two_grammars_or_no_key_shape_is_refused_at_registration()
    {
        var keys = Keys();
        Assert.Contains("one key is one grammar",
            Assert.Throws<VoltInvariantException>(() => keys.Register("siemens", new PropertyKey("COMMENT", PropertyGrammar.Words))).Message);
        Assert.Throws<VoltInvariantException>(() => keys.Register("x", new PropertyKey("FOLDER", PropertyGrammar.Words)));
        Assert.Throws<VoltInvariantException>(() => keys.Register("x", new PropertyKey("retain", PropertyGrammar.Flag)));
        keys.Register("twincat", new PropertyKey("COMMENT", PropertyGrammar.Text));   // the same key, the same grammar: shared
    }

    // ── vendors ──

    [Fact]
    public void A_vendor_has_one_display_name_and_an_unknown_id_is_refused_naming_the_known()
    {
        var vendors = new VendorRegistry();
        vendors.Register(new VendorRow("codesys", "CODESYS"));
        vendors.Register(new VendorRow("fakeco", "Fakeco"));
        vendors.Register(new VendorRow("fakeco", "Fakeco"));

        Assert.Equal("Fakeco", vendors.Display("fakeco"));
        Assert.Contains("(codesys | fakeco)", Assert.Throws<ArgumentException>(() => vendors.Display("siemens")).Message);
        Assert.Throws<VoltInvariantException>(() => vendors.Register(new VendorRow("fakeco", "FakeCo")));
        Assert.Throws<VoltInvariantException>(() => vendors.Register(new VendorRow("Fake.co", "Fakeco")));   // names no pipe
    }

    // ── the catalog ──

    [Fact]
    public void A_catalog_registers_every_declaration_and_refuses_the_first_conflict()
    {
        VendorDeclaration Decl(string id, string ext) => new(new VendorRow(id, id.ToUpperInvariant()),
            new[] { KindRow.Source("block", ext, WithBody, Layout) }, new[] { LanguageRow.Shown("FKL", PlainTextReader.Instance) },
            new[] { new PropertyKey("RETAIN", PropertyGrammar.Flag) });

        var catalog = Catalog.Of(Decl("fakeco", "blk"), Decl("fakeco2", "blk"));
        Assert.Equal(new[] { "fakeco", "fakeco2" }, catalog.Kinds.VendorsOf("block"));
        Assert.Equal(new[] { "FKL" }, catalog.Languages.ShownBy("fakeco2"));

        Assert.Throws<VoltInvariantException>(() => Catalog.Of(Decl("fakeco", "blk"), Decl("other", "blok")));
    }
}
