using System;
using Volt.Engine.Item;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// An <see cref="ItemRef"/> over a COM double, as the driver hands one out: the node AND the PLC project it belongs to
/// (openspec multi-application-tree — the driver addresses that PLC project before it touches the node). A test that
/// drives a node double directly builds its ref here, never a bare <c>new ItemRef(node)</c>, which the driver refuses.
/// </summary>
internal static class TcRefs
{
    /// <summary>The PLC project of the driver <see cref="TcUntouchablePouTests.Project"/> bound last on this thread.</summary>
    [ThreadStatic] internal static TcPlc? Bound;

    /// <summary>A PLC project for a driver bound to nothing: the tests that read a node's own text and no tree.</summary>
    private static readonly TcPlc Loose = new("System", new object(), new object(), "Plc");

    /// <summary><paramref name="com"/> in the PLC project the last <see cref="TcUntouchablePouTests.Project"/> bound.</summary>
    internal static ItemRef Ref(object com) =>
        new(new BeckhoffDriver.TcNode(com, Bound ?? throw new InvalidOperationException("no driver bound on this thread")));

    /// <summary><paramref name="com"/> for a driver bound to nothing.</summary>
    internal static ItemRef LooseRef(object com) => new(new BeckhoffDriver.TcNode(com, Loose));
}
