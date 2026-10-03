using System;
using Volt.Contracts;
using Volt.Engine.Format.St;
using Volt.Engine.Item;
using Xunit;

namespace Volt.Engine.Tests;

/// <summary>
/// A KIND THE ST READER HAS NO SHAPE FOR IS A CALLER'S BUG, NOT THE ENGINEER'S TEXT (openspec
/// <c>bridge-refusal-review</c> 2.2).
///
/// <para>The reader takes the kind from the wire name's extension, and the push hands it only a POU, an interface, a
/// DUT or a GVL: a read-only descriptor is refused in the pre-flight (<c>PushService</c>, "is read-only") and a task is
/// gated by its own format. So a member kind, a task or a descriptor reaching it is Volt calling it wrong. It used to
/// answer <c>INVALID_ST</c> — "your text is invalid" for a text nobody had looked at; it throws
/// <see cref="ArgumentException"/>, which the push reports as <c>INTERNAL_ERROR</c>.</para>
/// </summary>
public class StReaderKindInvariantTests
{
    [Theory]
    [InlineData(ItemKind.Kinds.Method)]
    [InlineData(ItemKind.Kinds.Action)]
    [InlineData("task")]
    public void A_kind_with_no_composite_shape_is_an_argument_fault_not_invalid_ST(string kind)
    {
        var ex = Assert.ThrowsAny<ArgumentException>(() =>
            StReader.Read("FUNCTION_BLOCK F\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n", kind, "F"));

        Assert.IsNotAssignableFrom<ICodedError>(ex);
        Assert.Contains(kind, ex.Message);
    }
}
