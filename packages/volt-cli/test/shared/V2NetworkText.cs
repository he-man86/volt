using Volt.Engine.Format.Network;

namespace Volt.Tests.Shared;

/// <summary>
/// NETWORK TEXT V2 AS A MODEL BUILDER for the vendor writers' tests: a body written in v2 text, read by the v2 gate into the
/// model the writer under test takes. The push reads plain-ST network text (openspec <c>network-text-st</c> 3.1,
/// <see cref="NetworkText.Validate"/>); these tests drive a writer from a model, and v2 text is how they spell one until
/// 3.2 deletes v2 and re-spells them in plain ST. Refuses as the v2 gate does: <see cref="NetworkTextException"/> with the
/// first finding.
/// </summary>
public static class V2NetworkText
{
    public static NetworkBody Validate(string body, NetworkScope scope)
    {
        var result = NetworkTextGate.Validate(body, scope);
        if (result.Ok) return result.Body!;
        var first = result.Diagnostics[0];
        throw new NetworkTextException(first.Message, first.Code) { Line = first.Line };
    }
}
