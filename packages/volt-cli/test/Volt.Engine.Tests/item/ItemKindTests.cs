using System;
using System.Linq;
using Xunit;
using Volt.Engine;
using Volt.Engine.Item;

namespace Volt.Engine.Tests;

/// <summary>
/// THE KIND TABLE, AND ITS REFUSALS.
///
/// <para><c>ItemKind</c> is the vendor-neutral vocabulary the whole wire is spelled in, and nothing referenced
/// it from a test. Two properties matter and neither was pinned: the extension table is internally CONSISTENT
/// (it is the single source of truth three other runtimes are cross-checked against), and every lookup in it
/// REFUSES an unknown kind rather than guessing one.</para>
///
/// <para>The refusals are the sharp half. <c>MemberCode</c> decides WHAT OBJECT is created in the engineer's
/// live project, and it used to fall through to a METHOD for anything it did not recognise — so an unrecognised
/// kind created a method named after the member and reported the push accepted. Its own comment records that it
/// was the one arm disagreeing with the policy stated sixty lines below it.</para>
/// </summary>
public class ItemKindTests
{
    // ── the refusals ───────────────────────────────────────────────────────────────────────────

    /// <summary>EVERY MEMBER KIND MAPS, AND ONLY THOSE. The round trip is the assertion: each code that
    /// <c>IsMember</c> admits must be reachable from some kind string, or a member exists in the project that
    /// the push can never create.</summary>
    [Theory]
    [InlineData(ItemKind.Kinds.Method, ItemKind.PlcMethod)]
    [InlineData(ItemKind.Kinds.Action, ItemKind.PlcAction)]
    [InlineData(ItemKind.Kinds.Property, ItemKind.PlcProp)]
    [InlineData(ItemKind.Kinds.InterfaceMethod, ItemKind.PlcItfMeth)]
    [InlineData(ItemKind.Kinds.InterfaceProperty, ItemKind.PlcItfProp)]
    public void Every_member_kind_maps_to_a_code_that_is_a_member(string kind, int expected)
    {
        Assert.Equal(expected, ItemKind.MemberCode(kind));
        Assert.True(ItemKind.IsMember(expected));
    }

    /// <summary>AN UNKNOWN MEMBER KIND THROWS RATHER THAN CREATING A METHOD.
    ///
    /// <para>The fallback this replaced was invisible by construction: the wrong object was created, the push
    /// reported accepted, and the next pull described the method that now existed — so the workspace and the
    /// project agreed on something the engineer never wrote.</para></summary>
    [Theory]
    [InlineData("transition")]        // real, inlined in the POU, and NOT a member
    [InlineData("property_get")]      // an accessor: read WITH its property, never created as a member
    [InlineData("pou")]               // a top-level kind, not a member at all
    [InlineData("")]
    public void An_unknown_member_kind_is_refused(string kind)
    {
        // A member kind the splitter never emits is a Volt bug, coded as one (openspec bridge-refusal-review 2.18): it
        // answered BAD_REQUEST, which tells a client its request was malformed.
        var ex = Assert.Throws<BridgeException>(() => ItemKind.MemberCode(kind));
        Assert.Equal(Volt.Contracts.BridgeErrorCodes.InternalError, ex.ErrorCode);
    }

    /// <summary>AN UNMAPPED KIND HAS NO EXTENSION, and asking for one throws. A silent <c>""</c> produced a
    /// bare trailing dot (<c>"POUs."</c>) — a filename no lookup on either side of the vendor seam resolves.</summary>
    [Fact]
    public void A_kind_with_no_extension_is_refused()
        => Assert.Throws<ArgumentException>(() => ItemKind.ExtFor("no_such_kind"));

    /// <summary>A FOLDER IS NOT A FILE, so it has no extension either. Both driver walks recurse a folder
    /// without emitting an item; the old <c>folder → ""</c> arm was left over from when folders WERE emitted,
    /// and it is the exact case that produced the trailing dot.</summary>
    [Fact]
    public void A_folder_has_no_extension()
        => Assert.Throws<ArgumentException>(() => ItemKind.ExtFor(ItemKind.Kinds.Folder));

    // ── the table's own consistency ────────────────────────────────────────────────────────────

    /// <summary>NO EXTENSION IS CLAIMED BY TWO KINDS, and no kind appears twice. A duplicated extension makes the
    /// workspace ambiguous in the direction that matters most: kind is recovered from the file's extension on push,
    /// so two kinds sharing one would make a pushed file's kind unknowable.
    ///
    /// <para><b>Premise changed by the owner (openspec <c>push-without-header-check</c> 5.P, 2026-10-02).</b> The DUT
    /// was the one many-to-one row (its subtype names); every DUT is <c>X.dut</c> now, so the table is one-to-one in
    /// both directions with no exception.</para></summary>
    [Fact]
    public void The_extension_table_is_one_to_one()
    {
        var all = ItemKind.SourceKindExtensions.Concat(ItemKind.ReferenceKindExtensions).ToArray();

        Assert.Equal(all.Length, all.Select(x => x.Kind).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(all.Length, all.Select(x => x.Ext).Distinct(StringComparer.Ordinal).Count());
    }

    /// <summary>AND SOURCE AND REFERENCE KINDS DO NOT OVERLAP. The split decides whether a file is writable;
    /// a kind on both lists would be writable and read-only at once, and which one won would depend on the
    /// order a consumer happened to concatenate them in.</summary>
    [Fact]
    public void A_kind_is_writable_source_or_a_read_only_reference_never_both()
    {
        var source = ItemKind.SourceKindExtensions.Select(x => x.Kind).ToHashSet(StringComparer.Ordinal);

        Assert.DoesNotContain(ItemKind.ReferenceKindExtensions, r => source.Contains(r.Kind));
    }

    /// <summary>`FileExtensions` is the two lists, and the writable flag matches which list a kind came from.
    /// The CLI's own extension registry is built from this projection, so a kind that arrived with the wrong flag
    /// would make a read-only descriptor pushable — or a real source file refused.
    /// File extension == wire extension for every kind, so the projection is the table, entry for entry.</summary>
    [Fact]
    public void FileExtensions_reports_writability_from_the_list_a_kind_came_from()
    {
        var flags = ItemKind.FileExtensions.ToDictionary(x => x.Ext, x => x.IsSource, StringComparer.Ordinal);

        Assert.Equal(ItemKind.SourceKindExtensions.Count + ItemKind.ReferenceKindExtensions.Count, flags.Count);
        Assert.All(ItemKind.SourceKindExtensions, x => Assert.True(flags[x.Ext]));
        Assert.All(ItemKind.ReferenceKindExtensions, x => Assert.False(flags[x.Ext]));
    }

    /// <summary>THE DUT KIND HAS ONE EXTENSION, <c>dut</c> — an ordinary, writable source extension, and what
    /// <c>ExtFor</c> answers for it like for every other kind.
    ///
    /// <para><b>Premise changed by the owner (openspec <c>push-without-header-check</c> 5.P, 2026-10-02: "keep it
    /// simple").</b> This asserted five DUT extensions — the four subtypes a vendor could state, and <c>dut</c> for
    /// none — and that <c>ExtFor</c> refused the DUT kind. The subtype left the wire.</para></summary>
    [Fact]
    public void The_dut_kind_has_the_one_extension_dut()
    {
        var dutExts = ItemKind.SourceKindExtensions.Where(x => x.Kind == ItemKind.Kinds.Dut).Select(x => x.Ext).ToArray();

        Assert.Equal(new[] { "dut" }, dutExts);
        Assert.Equal("dut", ItemKind.ExtFor(ItemKind.Kinds.Dut));
        Assert.Contains(ItemKind.FileExtensions, x => x.Ext == "dut" && x.IsSource && x.IsWritable);
        Assert.Equal(ItemKind.Kinds.Dut, ItemKind.KindForWireName("X.dut"));
    }

    /// <summary>THE POU KIND HAS ONE EXTENSION, <c>pou</c> (openspec <c>push-without-header-check</c> 5.Q, owner
    /// 2026-10-02: a wire extension carries only what the IDE stores per object). A program, a function block and a
    /// function are one kind — CODESYS has one <c>POUObject</c> class whose kind follows its text, TwinCAT re-derives
    /// its three tree codes from the text on a reload — so every one of TwinCAT's three codes maps to it and it is
    /// the one writable POU extension.</summary>
    [Fact]
    public void The_pou_kind_has_the_one_extension_pou()
    {
        var pouExts = ItemKind.SourceKindExtensions.Where(x => x.Kind == ItemKind.Kinds.Pou).Select(x => x.Ext).ToArray();

        Assert.Equal(new[] { "pou" }, pouExts);
        Assert.Equal("pou", ItemKind.ExtFor(ItemKind.Kinds.Pou));
        Assert.Contains(ItemKind.FileExtensions, x => x.Ext == "pou" && x.IsSource && x.IsWritable);
        Assert.Equal(ItemKind.Kinds.Pou, ItemKind.KindForWireName("X.pou"));
        Assert.All(new[] { ItemKind.PlcPou, ItemKind.PlcPouProg, ItemKind.PlcPouFunc },
                   code => Assert.Equal(ItemKind.Kinds.Pou, ItemKind.Map(code)));
    }

    /// <summary>A RETIRED POU NAME NAMES NO KIND (5.Q). <c>X.prg</c> / <c>X.fb</c> / <c>X.fun</c> are foreign names like
    /// <c>X.foo</c> — no alias of <c>X.pou</c> — so every consumer that routes by the name refuses them, a push with
    /// <c>BAD_REQUEST</c> (<c>RequireWireNames</c>) and a baseline holding one by name (<c>Sidecar</c>).</summary>
    [Theory]
    [InlineData("X.prg")]
    [InlineData("X.fb")]
    [InlineData("X.fun")]
    public void A_retired_pou_name_names_no_kind(string wireName) =>
        Assert.Null(ItemKind.KindForWireName(wireName));

    /// <summary>A SPLIT DUT NAME NAMES NO KIND (5.P). <c>X.struct</c> / <c>X.enum</c> / <c>X.union</c> /
    /// <c>X.alias</c> are foreign names like <c>X.foo</c> — no alias of <c>X.dut</c> (two spellings of one item is the
    /// collapse the item-name invariant forbids), so every consumer that routes by the name refuses them.</summary>
    [Theory]
    [InlineData("X.struct")]
    [InlineData("X.enum")]
    [InlineData("X.union")]
    [InlineData("X.alias")]
    public void A_split_dut_name_names_no_kind(string wireName) =>
        Assert.Null(ItemKind.KindForWireName(wireName));

    /// <summary>AND EVERY KIND RESOLVES THROUGH `ExtFor` to the extension the table gives it — the table and its
    /// lookup cannot disagree, which is the whole reason there is only one table.</summary>
    [Fact]
    public void ExtFor_agrees_with_the_table_for_every_kind()
    {
        var table = ItemKind.SourceKindExtensions.Concat(ItemKind.ReferenceKindExtensions).ToList();
        Assert.All(table, x => Assert.Equal(x.Ext, ItemKind.ExtFor(x.Kind)));
    }

    // ── the member / inlined split ─────────────────────────────────────────────────────────────

    /// <summary>EVERY MEMBER IS INLINED IN ITS POU, but not everything inlined is a member. The asymmetry is the
    /// point: accessors, transitions and program references live inside a POU and are read WITH it, so a walk
    /// that treated "inlined" as "member" would put them in the reconciliation — where the pushed member set
    /// never mentions them and the push therefore DELETES them.</summary>
    [Fact]
    public void Every_member_is_inlined_but_not_every_inlined_kind_is_a_member()
    {
        foreach (var code in new[] { ItemKind.PlcAction, ItemKind.PlcMethod, ItemKind.PlcItfMeth,
                                     ItemKind.PlcProp, ItemKind.PlcItfProp })
        {
            Assert.True(ItemKind.IsMember(code));
            Assert.True(ItemKind.IsInlinedInPou(code));
        }

        foreach (var code in new[] { ItemKind.PlcPropGet, ItemKind.PlcPropSet, ItemKind.PlcItfPropGet,
                                     ItemKind.PlcItfPropSet, ItemKind.PlcTrans, ItemKind.PlcProgRef })
        {
            Assert.True(ItemKind.IsInlinedInPou(code));
            Assert.False(ItemKind.IsMember(code));
        }
    }

    /// <summary>AND A TOP-LEVEL ITEM IS NEITHER. A POU is not inlined in itself, and a walk that thought so
    /// would recurse into the project forever.</summary>
    [Theory]
    [InlineData(ItemKind.PlcPou)]
    [InlineData(ItemKind.PlcPouProg)]
    [InlineData(ItemKind.PlcPouFunc)]
    [InlineData(ItemKind.PlcDut)]
    [InlineData(ItemKind.PlcGvl)]
    [InlineData(ItemKind.PlcFolder)]
    public void A_top_level_kind_is_neither_a_member_nor_inlined(int code)
    {
        Assert.False(ItemKind.IsMember(code));
        Assert.False(ItemKind.IsInlinedInPou(code));
    }
}
