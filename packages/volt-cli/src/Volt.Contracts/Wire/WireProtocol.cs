namespace Volt.Contracts;

/// <summary>THE ONE WIRE PROTOCOL NUMBER. The bridge's relay <c>hello.protocol</c>, its <c>health.protocol</c> and the
/// OpenRPC document's <c>info.version</c> all carry it, and the CLI refuses a bridge whose <c>health</c> states another.
///
/// <para><b>The bump rule:</b> the number changes when an old peer would read the new wire without refusing it and take a
/// different meaning. Request bodies are read strictly (<see cref="WireJson.Request"/>), so a new request member reaches
/// an old bridge as a refusal and needs no bump. Responses are read leniently, so a removed, renamed or re-meant response
/// member needs one, and an added response member an old client can safely ignore does not. <c>DocDataTests</c> pins the
/// hash of the generated <c>volt-bridge.openrpc.json</c> beside this number, so a change of the wire's SHAPE fails until
/// its author re-pins it and decides; a change of MEANING with the same shape is the author's call by the same rule.</para>
///
/// <para>1: the path wire (openspec <c>multi-application-tree</c>) — items keyed by <c>&lt;folder&gt;/&lt;name&gt;.&lt;kind&gt;</c>,
/// request bodies read strictly, <c>unreadable</c> named by path beside <c>unreadableNodes</c>. The number stayed 1 for
/// this release by owner decision (PLC Assist's relay serves 1 only, and refuses an outdated bridge by its own
/// bridge-version check); this schema is pinned as protocol 1, and the next shape change bumps.</para></summary>
public static class WireProtocol
{
    public const int Version = 1;
}
