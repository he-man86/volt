namespace Volt.Contracts;

/// <summary>The IDE vendor ids and their display names, defined once — the id that <see cref="PipeNames.PrefixForVendor"/>
/// keys off, that the <c>.volt</c> binding stores, and that tags a health response, plus the human name shown in the
/// tray/notifications. Every layer (CLI, connector, both drivers) references these instead of re-spelling the id or
/// the display string. The TS side re-declares its own <c>Vendor</c> union — that's a client across the CLI
/// boundary, not a shared type.</summary>
public static class Vendors
{
    public const string Codesys = "codesys";
    public const string Twincat = "twincat";

    public const string CodesysDisplay = "CODESYS";
    public const string TwincatDisplay = "TwinCAT";

    /// <summary>The human name of a vendor id ("codesys" → "CODESYS"). An id that is not a vendor is a caller bug, not
    /// a name to guess, so it throws.</summary>
    public static string Display(string vendor) => vendor switch
    {
        Codesys => CodesysDisplay,
        Twincat => TwincatDisplay,
        _ => throw new ArgumentException($"'{vendor}' is not a Volt vendor id ({Codesys} | {Twincat})", nameof(vendor)),
    };

    /// <summary>The XAE shells' process names: TcXaeShell 15 (32-bit) and TwinCAT 4026's 64-bit TcXaeShell64 — read by the
    /// connector's window diagnosis and by the CLI naming an elevated XAE it cannot reach.</summary>
    public static readonly string[] TwincatShellProcesses = { "TcXaeShell", "TcXaeShell64" };
}
