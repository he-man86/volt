using System;
using Volt.Contracts;
using Volt.Engine.Format.Body;
using Volt.Engine.Format.Network;
using Volt.Engine.Format.St;
using Volt.Engine.Seam;

namespace Volt.Engine.Ide;

/// <summary>
/// TRANSITIONAL (openspec <c>volt-cli-rework</c>; deleted in step 7 with the old interfaces): what an OLD-contract host —
/// the test double <c>FakeIde</c> — declares on the new contract: the IEC format's kind rows and keys, and the six body
/// languages. The shipped hosts state their own.
/// </summary>
public static class FamilyDeclaration
{
    /// <summary>The declaration of an old-contract host serving <paramref name="vendor"/>; its LD and FBD bodies are read
    /// against the scopes it builds (<paramref name="scopeFor"/>, the old <c>NetworkScopeFor</c>).</summary>
    public static VendorDeclaration For(string vendor, Func<string?, PushedDeclarations, NetworkScope> scopeFor) => new(
        new VendorRow(vendor, Vendors.Display(vendor)),
        IecFormat.KindRows,
        new[]
        {
            LanguageRow.Shown(Languages.St, PlainTextReader.Instance),
            LanguageRow.Shown(Languages.Ld, new NetworkBodyReader(Languages.Ld, scopeFor)),
            LanguageRow.Shown(Languages.Fbd, new NetworkBodyReader(Languages.Fbd, scopeFor)),
            LanguageRow.Hidden(Languages.Cfc), LanguageRow.Hidden(Languages.Sfc), LanguageRow.Hidden(Languages.Il),
        },
        IecFormat.PropertyKeys);
}
