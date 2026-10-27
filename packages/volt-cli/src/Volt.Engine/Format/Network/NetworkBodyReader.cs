using System;
using Volt.Contracts;
using Volt.Engine.Format.St;
using Volt.Engine.Ide;
using Volt.Engine.Seam;

namespace Volt.Engine.Format.Network;

/// <summary>A network body read once: the validated model, and the scope it was read against — the two a host's write
/// takes (<see cref="PushedNetworkBody"/>), so the write holds no copy of the validation.</summary>
public sealed record NetworkRead(NetworkBody Model, NetworkScope Scope);

/// <summary>
/// The reader of a network-text language (<c>%LANGUAGE LD</c>, <c>%LANGUAGE FBD</c>): the code under the line,
/// validated against the scope the body resolves in — its own declarations innermost, then its owner's
/// (<see cref="BodyContext.Declaration"/>), the push's own declarations answering before the IDE's — and returned as a
/// <see cref="NetworkRead"/>. The scope comes from the host (<paramref name="scopeFor"/>): it is the SAME scope the host
/// writes a pulled body against, so the pre-flight reads a body exactly as the write will (network text v2, task 3.9).
/// </summary>
public sealed class NetworkBodyReader : IBodyReader
{
    private readonly string _language;
    private readonly Func<string?, PushedDeclarations, NetworkScope> _scopeFor;

    public NetworkBodyReader(string language, Func<string?, PushedDeclarations, NetworkScope> scopeFor)
    {
        if (!Body.Languages.IsNetwork(language))
            throw new ArgumentException($"'{language}' is no network-text language", nameof(language));
        _language = language;
        _scopeFor = scopeFor ?? throw new ArgumentNullException(nameof(scopeFor));
    }

    /// <summary>READ-ONLY (openspec <c>network-text-st</c> 2.1): a pull shows an LD/FBD body as plain-ST network text
    /// (<see cref="StNetworkWriter"/>), and no push reads it back until section 3 puts the plain-ST reader here. Every LD/FBD
    /// body a push carries — the pre-flight, a create, a driver's own write — comes through this reader, so this is the one
    /// refusal: by name, before anything is read or written. With network text off in this process the refusal is the
    /// switch's (<see cref="NetworkText.Validate"/>), unchanged.</summary>
    public object Read(string code, BodyContext context)
    {
        var body = PropertyLines.JoinBody(PropertyLines.LanguageLine(_language), code);
        if (!NetworkTextSwitch.Enabled) NetworkText.Validate(body, NetworkScope.Empty);
        throw new BridgeException(BridgeErrorCodes.Unsupported,
            $"a body is stated '{PropertyLines.LanguageLine(_language)}', and {ReadOnlyReason}, so it cannot be pushed: a pull " +
            "shows it as plain-ST network text and nothing in the IDE is written from it. Push the item with its body as " +
            $"'{PropertyLines.UnsupportedLine(_language)}' to keep the IDE's {_language} and write the declaration beside it.");
    }

    /// <summary>Why an LD/FBD body is not pushed in this build — the read-only phase of plain-ST network text.</summary>
    public const string ReadOnlyReason = "LD/FBD push comes back with the plain-ST reader";
}
