using System;
using System.Linq;
using Xunit;
using Volt.Engine.Item;
using K = Volt.Engine.Item.ItemKind.Kinds;

namespace Volt.Engine.Tests;

/// <summary>
/// ONE SHAPE TABLE PER KIND (openspec <c>bridge-refusal-review</c> D11). The five predicates the table replaced are
/// pinned here AS THEY WERE (step 4a, <c>0bc065950c</c>), each against the row its callers now ask — the proof that no
/// answer a push reads changes. Each old predicate is evaluated only over the kinds its callers handed it; the three
/// cells where one word carried another meaning are named, with the row that now answers them.
/// </summary>
public class KindShapeTests
{
    private static readonly string[] Items = { K.Pou, K.Interface, K.Gvl, K.Dut };
    private static readonly string[] Members = { K.Method, K.Action, K.Property, K.InterfaceMethod, K.InterfaceProperty };

    // ── the predicates as they were ──
    private static bool OldAppliesTo(string kind) =>
        kind != K.Gvl && kind != K.Dut && kind != K.Interface && kind != K.InterfaceMethod && kind != K.InterfaceProperty;
    private static bool OldHasBody(string kind) => kind is not (K.Gvl or K.Dut);
    private static bool OldCarriesAccessors(string kind) => kind is K.Property or K.InterfaceProperty or K.InterfaceMethod;
    private static bool OldReadsAccessors(string kind) => kind is K.Property or K.InterfaceProperty;   // CodesysDriver.ReadMember, PushService accessor reconcile
    private static bool OldSignatureSeed(string kind) => kind is K.InterfaceMethod or K.InterfaceProperty;  // PushService.CreateSeed

    [Fact]
    public void Every_item_kind_is_read_and_written_as_before()
    {
        foreach (var kind in Items)
        {
            var row = ItemKind.ShapeOf(kind);
            Assert.Equal(OldHasBody(kind), row.Composite);                    // StWriter.HasBody, StReader `Gvl or Dut`
            Assert.Equal(kind == K.Interface, row.MembersInside);             // StReader `kind == Interface`
            Assert.Equal(OldAppliesTo(kind), row.Body);                       // ImplementationMarker.AppliesTo / CanHold
        }
    }

    [Fact]
    public void Every_member_kind_is_marked_as_before_in_its_own_owner()
    {
        // StWriter.AssembleChild asked AppliesTo(child) && AppliesTo(owner); interface members are kinds of their own.
        foreach (var kind in new[] { K.Method, K.Action })
            Assert.Equal(OldAppliesTo(kind) && OldAppliesTo(K.Pou), ItemKind.ShapeOf(kind).Body);
        Assert.Equal(OldAppliesTo(K.InterfaceMethod) && OldAppliesTo(K.Interface), ItemKind.ShapeOf(K.InterfaceMethod).Body);

        // StWriter.AssembleProperty marked a property's accessors by AppliesTo(property) && AppliesTo(owner).
        Assert.Equal(OldAppliesTo(K.Property) && OldAppliesTo(K.Pou),
                     ItemKind.ShapeOf(K.Property).Accessors == AccessorShape.WithBodies);
        Assert.Equal(OldAppliesTo(K.InterfaceProperty) && OldAppliesTo(K.Interface),
                     ItemKind.ShapeOf(K.InterfaceProperty).Accessors == AccessorShape.WithBodies);
    }

    [Fact]
    public void The_accessor_reads_and_the_create_seed_answer_as_before()
    {
        foreach (var kind in Members)
        {
            var row = ItemKind.ShapeOf(kind);
            Assert.Equal(OldReadsAccessors(kind), row.Accessors != AccessorShape.None);
            Assert.Equal(OldSignatureSeed(kind), row.Signature);
        }
    }

    /// <summary>The three disagreeing cells, each now answered by the row that means what the caller asked.</summary>
    [Fact]
    public void The_three_overloaded_cells_are_answered_by_their_own_column()
    {
        // AppliesTo(property) was TRUE because a property's ACCESSORS carry the line: the property itself has no body.
        Assert.True(OldAppliesTo(K.Property));
        Assert.False(ItemKind.ShapeOf(K.Property).Body);
        Assert.Equal(AccessorShape.WithBodies, ItemKind.ShapeOf(K.Property).Accessors);

        // HasBody(interface) meant "composite": an interface has no IMPLEMENTATION line.
        Assert.True(OldHasBody(K.Interface));
        Assert.True(ItemKind.ShapeOf(K.Interface).Composite);
        Assert.False(ItemKind.ShapeOf(K.Interface).Body);

        // CarriesAccessors(interface_method) meant "has no body": an interface method has no accessors either.
        Assert.True(OldCarriesAccessors(K.InterfaceMethod));
        Assert.Equal(AccessorShape.None, ItemKind.ShapeOf(K.InterfaceMethod).Accessors);
        Assert.False(ItemKind.ShapeOf(K.InterfaceMethod).Body);
    }

    /// <summary>The guard's split, stated by the table: accessors where there are accessors, the body where there is a
    /// body, and NOTHING for a kind with neither — the interface method, which the guard used to ask about accessors.</summary>
    [Fact]
    public void The_guard_checks_what_the_row_says_exists()
    {
        foreach (var kind in Members)
        {
            var row = ItemKind.ShapeOf(kind);
            var checksAccessors = row.Accessors != AccessorShape.None;
            Assert.Equal(OldCarriesAccessors(kind) && kind != K.InterfaceMethod, checksAccessors);
            Assert.False(checksAccessors && row.Body, $"{kind} has accessors and a body");
        }
        Assert.False(ItemKind.ShapeOf(K.InterfaceMethod).Body);
        Assert.Equal(AccessorShape.None, ItemKind.ShapeOf(K.InterfaceMethod).Accessors);
    }

    [Theory]
    [InlineData(K.Task)]
    [InlineData(K.Folder)]
    [InlineData(K.Library)]
    [InlineData(K.Transition)]
    [InlineData("nonsense")]
    public void A_kind_no_source_file_holds_has_no_row(string kind) =>
        Assert.Throws<ArgumentException>(() => ItemKind.ShapeOf(kind));

    [Fact]
    public void Every_source_kind_has_a_row() =>
        Assert.All(ItemKind.SourceKindExtensions.Select(x => x.Kind), k => ItemKind.ShapeOf(k));
}
