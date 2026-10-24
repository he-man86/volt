namespace Volt.Wire;

/// <summary>Bridge pipe names. Every vendor serves ONE pipe PER running IDE, keyed by process id
/// (<c>volt.bridge.&lt;vendor&gt;.&lt;pid&gt;</c>), and clients find them by enumerating the vendor prefix (see
/// <c>PipeDiscovery</c>). The vendor id is the host's own (its declaration's <c>VendorRow</c>); nothing here knows one.</summary>
public static class PipeNames
{
    /// <summary>The prefix every bridge pipe starts with: <c>volt.bridge.</c>.</summary>
    public const string Prefix = "volt.bridge.";

    /// <summary>The per-instance pipe discovery prefix for a vendor, <c>volt.bridge.&lt;vendor&gt;.</c>. Clients discover
    /// live pipes with this prefix — there is no bare per-vendor pipe to connect to.</summary>
    public static string PrefixForVendor(string vendor) => Prefix + vendor.ToLowerInvariant() + ".";

    /// <summary>The pipe the bridge of <paramref name="vendor"/> serves for the IDE whose process id is
    /// <paramref name="pid"/>.</summary>
    public static string Instance(string vendor, int pid) =>
        PrefixForVendor(vendor) + pid.ToString(System.Globalization.CultureInfo.InvariantCulture);
}
