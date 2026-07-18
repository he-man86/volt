namespace Volt.Cli.Transport;

/// <summary>The per-vendor pipe name — the named-pipe replacement for the fixed HTTP ports (CODESYS 8556 /
/// TwinCAT 8555). One local pipe per live bridge; the CLI and the connector are clients.</summary>
public static class PipeNames
{
    public const string Codesys = "volt.bridge.codesys";
    public const string Beckhoff = "volt.bridge.beckhoff";

    public static string ForVendor(string vendor) => "volt.bridge." + vendor.ToLowerInvariant();

    /// <summary>Transition mapping from the legacy fixed ports the workspace binding still stores (8555 = TwinCAT,
    /// else CODESYS) to the pipe name — mirrors volt-git's vendorForPort until bindings carry the vendor directly.</summary>
    public static string ForPort(int port) => port == 8555 ? Beckhoff : Codesys;
}
