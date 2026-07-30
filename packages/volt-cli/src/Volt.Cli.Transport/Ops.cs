namespace Volt.Cli.Transport;

/// <summary>The bridge pipe op names — the wire <c>op</c> field — defined once. The host dispatch
/// (<c>BridgePipeHost</c>), every client (<c>BridgeClient</c>, the connector's <c>PerPipeProjectSource</c>), and the
/// progress/active-op labels that mirror these ops all reference these consts, so an op is spelled in exactly ONE
/// place. The values travel on the wire as-is: name them freely, change them never.
///
/// The e2e TypeScript harness spells the same names independently — that's a client on the far side of the pipe,
/// not a shared type (the pipe IS the boundary). Keep the two spellings in agreement by hand.</summary>
public static class Ops
{
    public const string Health = "health";
    public const string Connect = "connect";
    public const string Disconnect = "disconnect";
    public const string Refs = "refs";
    public const string Fetch = "fetch";
    public const string Init = "init";
    public const string Push = "push";
    public const string Build = "build";
}
