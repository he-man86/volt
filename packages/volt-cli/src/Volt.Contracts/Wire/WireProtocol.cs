namespace Volt.Contracts;

/// <summary>THE ONE WIRE PROTOCOL NUMBER. Every request states it (<c>PipeRequest.protocol</c>) and a bridge refuses a
/// request that states none or another (<see cref="BridgeErrorCodes.ProtocolMismatch"/>), before its body is read; the
/// bridge's <c>health.protocol</c>, its relay <c>hello.protocol</c> and the OpenRPC document's <c>info.version</c> carry
/// it too.
///
/// <para><b>The bump rule:</b> the number changes when an old peer would read the new wire without refusing it and take a
/// different meaning. <c>DocDataTests</c> pins the hash of the generated <c>volt-bridge.openrpc.json</c> beside this
/// number, so a change of the wire's SHAPE fails until its author re-pins it and decides.</para>
///
/// <para>1: the path wire — items keyed by <c>&lt;folder&gt;/&lt;name&gt;.&lt;kind&gt;</c>, every request stating its
/// protocol, request bodies and the envelope read strictly. The shape of protocol 1 is still being settled (owner,
/// 2026-10-24: the number stays 1 through <c>wire-final-shape</c>).</para></summary>
public static class WireProtocol
{
    public const int Version = 1;
}
