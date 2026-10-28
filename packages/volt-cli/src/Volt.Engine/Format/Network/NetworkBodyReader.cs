using System;
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

    /// <summary>The body read as plain-ST network text (openspec <c>network-text-st</c> 3.1) against the scope the host writes
    /// it in — the one gate every LD/FBD body a push carries passes (the pre-flight, a create, a driver's own write).</summary>
    public object Read(string code, BodyContext context)
    {
        var scope = _scopeFor(context.Declaration, context.Pushed);
        return new NetworkRead(NetworkText.Validate(PropertyLines.JoinBody(PropertyLines.LanguageLine(_language), code), scope), scope);
    }
}
