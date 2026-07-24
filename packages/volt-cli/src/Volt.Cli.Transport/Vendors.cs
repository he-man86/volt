namespace Volt.Cli.Transport;

/// <summary>The IDE vendor ids and their display names, defined once — the id that <see cref="PipeNames.ForVendor"/>
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
}
