namespace Volt.Cli.Transport;

/// <summary>Bridge pipe names. BOTH vendors serve ONE pipe PER running IDE, keyed by process id
/// (<c>volt.bridge.&lt;vendor&gt;.&lt;pid&gt;</c>), and clients find them by enumerating the vendor prefix (see
/// <c>PipeDiscovery</c>). CODESYS is an in-proc host loaded into each IDE; TwinCAT is an external worker the connector
/// spawns per XAE window (see <c>TwincatSupervisor</c>). Multiple coexist without colliding. The CLI and connector are
/// clients.</summary>
public static class PipeNames
{
    /// <summary>Base name — NOT served directly; the prefix for per-instance pipes.</summary>
    public const string Codesys = "volt.bridge.codesys";
    public const string Twincat = "volt.bridge.twincat";

    /// <summary>Discovery prefix for live CODESYS instance pipes: <c>volt.bridge.codesys.</c></summary>
    public const string CodesysPrefix = Codesys + ".";
    /// <summary>Discovery prefix for live TwinCAT (per-XAE) instance pipes: <c>volt.bridge.twincat.</c></summary>
    public const string TwincatPrefix = Twincat + ".";

    /// <summary>The pipe a specific CODESYS in-proc host serves, keyed by its process id.</summary>
    public static string CodesysInstance(int pid) => CodesysPrefix + pid;
    /// <summary>The pipe a specific TwinCAT per-XAE worker serves, keyed by the XAE window's process id.</summary>
    public static string TwincatInstance(int pid) => TwincatPrefix + pid;

    /// <summary>The per-instance pipe discovery prefix for a vendor.</summary>
    public static string PrefixForVendor(string vendor) => "volt.bridge." + vendor.ToLowerInvariant() + ".";

    public static string ForVendor(string vendor) => "volt.bridge." + vendor.ToLowerInvariant();
}
