using System;
using System.Collections.Generic;
using Volt.Engine.Format.Network;
using Volt.Engine.Ide;

namespace Volt.Tests.Shared;

/// <summary>
/// The two facts a <see cref="NetworkScope"/> takes from below the seam (openspec <c>bridge-refusal-review</c> D3, D4),
/// for a test that builds a scope without a driver: an item's KIND by name, and whether the vendor refuses a word as a
/// POU's name.
///
/// <para><see cref="RefusedPouName"/> is the words BOTH vendors' measured lists refuse (<see cref="BothVendorsRefusedNames"/>,
/// generated from the live probes as the drivers' own lists are). It used to be a 25-word stand-in, so the corpus
/// oracle said nothing about the production predicate: <c>DATE_AND_TIME</c> (164 corpus declarations), <c>__XWORD</c>
/// (981), <c>BIT</c> (396), <c>__SYSTEM</c> (272) … were instances here and not in either driver (review of
/// <c>bridge-refusal-review</c> 4a). What it still cannot see is a word ONE vendor refuses (TwinCAT takes <c>LDT</c>
/// as a name, CODESYS does not) — the driver suites hold those (<c>CodesysScopeFactsTests</c>, <c>TcScopeFactsTests</c>).</para>
/// </summary>
public static class Scopes
{
    /// <summary>The words a test may use as a type no POU can be named — refused by both vendors' measured lists.</summary>
    public static IReadOnlyCollection<string> BothVendorsRefuse => BothVendorsRefusedNames.Words;

    /// <summary>Whether a word is one of <see cref="BothVendorsRefuse"/>.</summary>
    public static bool RefusedPouName(string word) => BothVendorsRefusedNames.Contains(word);

    /// <summary>No project around the body: no item of any name has a kind.</summary>
    public static string? NoItem(string name) => null;

    /// <summary>The scope of a body whose declarations are <paramref name="declaration"/> and nothing else: no other
    /// item, no global, the stand-in name list.</summary>
    public static NetworkScope Of(string? declaration) =>
        NetworkScope.FromDeclarations(declaration, _ => null, () => Array.Empty<string>(), NoItem, RefusedPouName);
}
