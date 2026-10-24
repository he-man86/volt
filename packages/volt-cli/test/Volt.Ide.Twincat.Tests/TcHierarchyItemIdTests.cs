using System;
using Xunit;
using Volt.Contracts;
using Volt.Engine;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// A VSITEMID IS A DWORD, AND IT ARRIVES IN WHATEVER VARIANT THE HIERARCHY CHOSE (openspec
/// <c>twincat-large-solution-refs</c> 2). <c>VSHPROPID_FirstVisibleChild</c> / <c>NextVisibleSibling</c> answer an item
/// id as a VARIANT, and a project system is free to box it as <c>VT_I4</c>, <c>VT_UI4</c>, <c>VT_I8</c> or narrower: a
/// pointer-valued id at or above 2 GB (a large-address-aware 32-bit XAE past 2 GB of memory) is a NEGATIVE <c>Int32</c>,
/// and the same DWORD sign-extended into an <c>Int64</c> is a negative <c>Int64</c>. The reader converted every type but
/// <c>Int32</c> with a checked <c>Convert.ToUInt32</c>, which throws <c>OverflowException: Value was either too large or
/// too small for a UInt32</c> on a negative one — the whole hierarchy unread, every operation refused.
/// <para>Every 32-bit pattern in any integer type is the same DWORD; a value no DWORD can be is refused by name, never
/// truncated into another item's id.</para>
/// </summary>
public class TcHierarchyItemIdTests
{
    [Theory]
    [InlineData(5, 5u)]
    [InlineData(-2, 0xFFFFFFFEu)]          // VSITEMID_ROOT as VT_I4
    [InlineData(-1, 0xFFFFFFFFu)]          // VSITEMID_NIL as VT_I4
    [InlineData(int.MinValue, 0x80000000u)]
    public void An_Int32_id_is_its_DWORD(int boxed, uint expected) => Assert.Equal(expected, TcSolutionExplorer.ItemId(boxed));

    [Theory]
    [InlineData(5L, 5u)]
    [InlineData(-2L, 0xFFFFFFFEu)]         // a DWORD sign-extended into VT_I8
    [InlineData(-2147483648L, 0x80000000u)]
    [InlineData(0xFFFFFFFEL, 0xFFFFFFFEu)] // the same DWORD zero-extended
    public void An_Int64_id_is_its_DWORD_sign_or_zero_extended(long boxed, uint expected) =>
        Assert.Equal(expected, TcSolutionExplorer.ItemId(boxed));

    [Fact]
    public void Narrower_and_unsigned_ids_are_their_DWORD()
    {
        Assert.Equal(0xFFFFFFFEu, TcSolutionExplorer.ItemId(0xFFFFFFFEu));
        Assert.Equal(0xFFFFFFFFu, TcSolutionExplorer.ItemId((short)-1));
        Assert.Equal(7u, TcSolutionExplorer.ItemId((ushort)7));
        Assert.Equal(0xFFFFFFFFu, TcSolutionExplorer.ItemId((sbyte)-1));
        Assert.Equal(9u, TcSolutionExplorer.ItemId((byte)9));
        Assert.Equal(0xFFFFFFFEu, TcSolutionExplorer.ItemId(0xFFFFFFFEUL));
    }

    [Theory]
    [InlineData(0x1_0000_0000L)]
    [InlineData(-2147483649L)]
    public void An_Int64_no_DWORD_can_be_is_refused_by_name(long boxed)
    {
        var refused = Assert.Throws<HierarchyReadException>(() => TcSolutionExplorer.ItemId(boxed));
        Assert.Contains("Int64", refused.Message);
        Assert.Contains(boxed.ToString(System.Globalization.CultureInfo.InvariantCulture), refused.Message);
    }

    [Fact]
    public void A_non_integer_id_is_refused_by_name()
    {
        var refused = Assert.Throws<HierarchyReadException>(() => TcSolutionExplorer.ItemId("12"));
        Assert.Contains("String", refused.Message);
    }
}
