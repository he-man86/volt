namespace Volt.Cli.Transport;

/// <summary>Bridge pipe names. TwinCAT is one supervised worker on a single well-known pipe
/// (<see cref="Twincat"/>) that multiplexes every running project via the COM ROT. CODESYS is an in-proc host
/// loaded into EACH running IDE, so every CODESYS process serves its OWN pipe
/// <c>volt.bridge.codesys.&lt;pid&gt;</c> (<see cref="CodesysInstance"/>) — multiple coexist without colliding, and
/// clients find them by enumerating <see cref="CodesysPrefix"/> (see <c>PipeDiscovery</c>). The CLI and connector
/// are clients.</summary>
public static class PipeNames
{
    /// <summary>The base name for CODESYS. NOT served directly anymore — it's the prefix for per-instance pipes.</summary>
    public const string Codesys = "volt.bridge.codesys";
    public const string Twincat = "volt.bridge.twincat";

    /// <summary>Discovery prefix for live CODESYS instance pipes: <c>volt.bridge.codesys.</c></summary>
    public const string CodesysPrefix = Codesys + ".";

    /// <summary>The pipe a specific CODESYS in-proc host serves, keyed by its process id.</summary>
    public static string CodesysInstance(int pid) => CodesysPrefix + pid;

    public static string ForVendor(string vendor) => "volt.bridge." + vendor.ToLowerInvariant();
}
