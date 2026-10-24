using System;

namespace Volt.Connector
{
    /// <summary>
    /// The vendors this connector supervises, as the connector knows them: each id (the one its host declares — the
    /// pipe prefix <c>volt.bridge.&lt;id&gt;.</c> and <see cref="DetectedProject.Vendor"/>), the name the tray shows, and
    /// the TwinCAT shell processes whose windows it watches and whose workers it spawns. The connector is the one
    /// component whose job is per-vendor (it launches CODESYS's in-proc host and spawns TwinCAT's worker), so these facts
    /// are its own — they left the wire contract with <c>wire-final-shape</c>.
    /// </summary>
    public static class ConnectorVendors
    {
        public const string Codesys = "codesys";
        public const string Twincat = "twincat";

        /// <summary>The XAE shells' process names: TcXaeShell 15 (32-bit) and TwinCAT 4026's 64-bit TcXaeShell64.</summary>
        public static readonly string[] TwincatShellProcesses = { "TcXaeShell", "TcXaeShell64" };

        /// <summary>The human name of a vendor id ("codesys" → "CODESYS"). An id the connector does not supervise is a
        /// caller bug, not a name to guess, so it throws.</summary>
        public static string Display(string vendor) => vendor switch
        {
            Codesys => "CODESYS",
            Twincat => "TwinCAT",
            _ => throw new ArgumentException($"'{vendor}' is not a vendor this connector supervises ({Codesys} | {Twincat})", nameof(vendor)),
        };
    }
}
