using System;
using System.Collections.Generic;
using System.Reflection;
using Volt.Contracts;
using Volt.Engine;
using Xunit;

namespace Volt.Ide.Codesys.Tests;

/// <summary>
/// A TASK CALL LIST THE IDE WILL NOT REBUILD IS UNSUPPORTED, NOT A VOLT BUG (openspec <c>bridge-refusal-review</c> V.1).
/// Each refusal was an uncoded <c>InvalidOperationException</c>, which the push reports as <c>INTERNAL_ERROR</c>: the
/// call list offering no writeable copy, the IDE refusing the rebuild, and a writeable copy that is no list. In each the
/// IDE did not take the write — <c>UNSUPPORTED</c>'s situation. Messages unchanged.
/// </summary>
public class CodesysTaskCallListRefusalTests
{
    private static Exception Invoke(string method, params object?[] args)
    {
        var m = typeof(CodesysObjectModel).GetMethod(method, BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(m);
        try { m!.Invoke(null, args); }
        catch (TargetInvocationException tie) { return tie.InnerException!; }
        throw new Xunit.Sdk.XunitException($"{method} did not refuse");
    }

    private static readonly IReadOnlyList<string> Calls = new[] { "PLC_PRG" };

    /// <summary>A call list with no <c>PerformWithWriteableCopy</c>.</summary>
    private sealed class ReadOnlyCallList { }

    /// <summary>A call list whose writeable copy the IDE refuses to hand out.</summary>
    private sealed class RefusingCallList
    {
        public void PerformWithWriteableCopy(Action<object> edit) => throw new InvalidOperationException("the task is locked");
    }

    [Fact]
    public void A_call_list_with_no_writeable_copy_is_UNSUPPORTED()
    {
        var ex = Assert.IsType<BridgeException>(Invoke("WriteCallList", new object(), new ReadOnlyCallList(), Calls));
        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("PerformWithWriteableCopy", ex.Message);
    }

    [Fact]
    public void A_rebuild_the_IDE_refused_is_UNSUPPORTED()
    {
        var ex = Assert.IsType<BridgeException>(Invoke("WriteCallList", new object(), new RefusingCallList(), Calls));
        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("CODESYS refused a task call-list rebuild", ex.Message);
        Assert.Contains("the task is locked", ex.Message);
    }

    [Fact]
    public void A_writeable_copy_that_is_no_list_is_UNSUPPORTED()
    {
        var ex = Assert.IsType<BridgeException>(Invoke("RebuildCallList", new object(), new object(), Calls));
        Assert.Equal(BridgeErrorCodes.Unsupported, ex.ErrorCode);
        Assert.Contains("not an IList", ex.Message);
    }
}
