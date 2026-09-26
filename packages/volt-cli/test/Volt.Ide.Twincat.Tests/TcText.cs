using Volt.Engine.Format.Network;
using Volt.Tests.Shared;

namespace Volt.Ide.Twincat.Tests;

/// <summary>
/// Network text as the TwinCAT driver uses it, for tests that drive the PULL → text → PUSH path over a fixture
/// archive. Network text v2 writes and reads a body against a <see cref="NetworkScope"/> (task 3.9); a fixture
/// archive comes without its POU's parsed VAR block, so the scope is the pulled model's own names and FB instances
/// — what that POU's declarations say of them (<see cref="NetworkModelOracle.ScopeOf"/>). The push reads the text
/// back against the SAME scope the pull wrote it with, as the driver does.
/// </summary>
internal static class TcText
{
    public static NetworkScope ScopeOf(NetworkBody pulled) => NetworkModelOracle.ScopeOf(pulled);

    /// <summary>The pull: a vendor-read model as the text an engineer sees in git.</summary>
    public static string Write(NetworkBody pulled) => NetworkTextWriter.Write(pulled, ScopeOf(pulled));

    /// <summary>The push's gate, against the scope the text was pulled with: the model, or
    /// <see cref="NetworkTextException"/>.</summary>
    public static NetworkBody Validate(string text, NetworkScope scope) => NetworkText.Validate(text, scope);

    /// <summary>The in-place writer, its change gate rendering against the pushed model's scope.</summary>
    public static string? Apply(string? bodyXml, NetworkBody model) =>
        TcNetworkWriter.Apply(bodyXml, model, ScopeOf(model));
}
