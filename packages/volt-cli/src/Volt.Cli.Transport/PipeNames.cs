namespace Volt.Cli.Transport;

/// <summary>The per-vendor pipe name — one local pipe per live bridge, keyed by the vendor id
/// (<c>codesys</c> / <c>twincat</c>). The CLI and the connector are clients.</summary>
public static class PipeNames
{
    public const string Codesys = "volt.bridge.codesys";
    public const string Twincat = "volt.bridge.twincat";

    public static string ForVendor(string vendor) => "volt.bridge." + vendor.ToLowerInvariant();
}
