using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Seam;

namespace Volt.Cli.Sync;

/// <summary>
/// The vendors whose bridges this CLI reaches, as a CLIENT knows them — their ids and names in a
/// <see cref="VendorRegistry"/>, and how a person gets each one's bridge running. The id is the one its host declares
/// (<c>volt.bridge.&lt;id&gt;.&lt;pid&gt;</c>, the binding's <c>vendor</c>); the CLI ships without the hosts, so it states the
/// ones it ships beside, once, here.
/// <para>What differs per vendor is data, not a branch: the remedy when no bridge runs (a CODESYS bridge loads in-proc
/// from a script the user runs; a TwinCAT bridge is a worker only the connector spawns), and the shell processes whose
/// elevation hides an IDE from an unelevated worker (<see cref="BridgeResolver.UnreachableXae"/>).</para>
/// </summary>
public static class ClientVendors
{
    /// <summary>How a person gets a vendor's bridge running, and the IDE shell processes the CLI names when a running
    /// shell has none (empty when the bridge runs inside the IDE).</summary>
    public sealed record Reach(string NoBridgeRemedy, IReadOnlyList<string> ShellProcesses);

    private static readonly (VendorRow Row, Reach Reach)[] Shipped =
    {
        (new VendorRow("codesys", "CODESYS"),
            new Reach("open the project in CODESYS (tray → “Activate in CODESYS…”), then retry.", Array.Empty<string>())),
        (new VendorRow("twincat", "TwinCAT"),
            new Reach("start the Volt Connector (it runs the TwinCAT worker; opening the project alone is not enough), then retry.",
                new[] { "TcXaeShell", "TcXaeShell64" })),
    };

    /// <summary>The ids and names of the shipped vendors.</summary>
    public static readonly VendorRegistry Registry = Fill();

    private static VendorRegistry Fill()
    {
        var registry = new VendorRegistry();
        foreach (var (row, _) in Shipped) registry.Register(row);
        return registry;
    }

    /// <summary>The name a person reads for <paramref name="vendor"/> (any case); an id no shipped host has is refused
    /// by name.</summary>
    public static string Display(string vendor) => Registry.Display((vendor ?? "").ToLowerInvariant());

    /// <summary>How <paramref name="vendor"/>'s bridge is reached; an id no shipped host has is refused by name.</summary>
    public static Reach ReachOf(string vendor)
    {
        var id = (vendor ?? "").ToLowerInvariant();
        Registry.Display(id);   // refuses an unknown id, naming the known ones
        return Shipped.First(v => v.Row.Id == id).Reach;
    }
}
