using System;
using System.Collections.Generic;
using Volt.Engine.Item;

namespace Volt.Engine.Ide;

/// <summary>
/// The parts of a driver's measured NAME refusal (<c>IVendorStore.RefusedName</c>) that both vendors answered
/// alike. Each driver composes its own answer from these and its own facts (its word list, CODESYS's backtick names).
/// </summary>
public static class MeasuredNames
{
    /// <summary>Whether a driver's reserved-WORD list answers for <paramref name="word"/> as the name of a new
    /// <paramref name="kind"/>: every word for a POU and a METHOD / ACTION / PROPERTY, where the lists were measured
    /// (openspec <c>push-keeps-what-landed</c> 3.1); for an interface METHOD / PROPERTY only the words a probe ASKED there
    /// (<see cref="AskedOnInterfaceMembers"/>) — any other word reaches the IDE.</summary>
    public static bool WordMeasuredFor(string kind, string word) =>
        kind is ItemKind.Kinds.Pou or ItemKind.Kinds.Method or ItemKind.Kinds.Action or ItemKind.Kinds.Property
        || (kind is ItemKind.Kinds.InterfaceMethod or ItemKind.Kinds.InterfaceProperty && AskedOnInterfaceMembers.Contains(word));

    /// <summary>The listed words a probe asked for an interface METHOD and PROPERTY, on both vendors, and both refused
    /// (openspec <c>bridge-refusal-review</c> 3.1, "double underscore": <c>scripts/vendor-facts.codesys.json, fact identifier-shapes</c>,
    /// <c>vendor-facts.twincat.json, fact identifier-shapes</c>). It sat measured and unused, so an interface member named so passed the
    /// pre-flight and was refused mid-batch (review 3a+3b). Case-insensitive, as the lists are.</summary>
    private static readonly HashSet<string> AskedOnInterfaceMembers =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "a__b" };

    /// <summary>An ASCII name that is no identifier: not a letter or underscore, then letters, digits and underscores
    /// (a leading digit, an ASCII punctuation mark, an ASCII blank). Measured refused by both vendors for a POU and every
    /// member kind (openspec <c>bridge-refusal-review</c> 3.1, <c>scripts/vendor-facts.codesys.json, fact identifier-shapes</c>
    /// and <c>vendor-facts.twincat.json, fact identifier-shapes</c>), and on CODESYS whatever the project's "Unicode
    /// identifiers" option (DIALECT C28b), so it is refused before the batch's first write. A lone <c>_</c> is an
    /// identifier. CODESYS adds one shape of its own (a backtick-quoted name), which its driver states.
    ///
    /// <para><b>A name holding any character past ASCII is never judged here</b> (openspec
    /// <c>codesys-existing-unicode-members</c>): CODESYS takes <c>Fööbar</c>, <c>Привет</c>, <c>名前</c> exactly when the
    /// PROJECT's Compile option "Unicode identifiers" is on (measured SP21, C28b); a Chinese customer's project holds and
    /// builds such methods. No driver can refuse one from the word alone: it goes to the IDE, and the IDE's own refusal,
    /// in its own words and language, is the answer (<c>ChildRefusedException</c>).</para></summary>
    public static bool IsAsciiNonIdentifier(string name)
    {
        foreach (var c in name) if (c > 0x7f) return false;
        if (name.Length == 0) return true;
        if (!IsAsciiLetter(name[0]) && name[0] != '_') return true;
        for (var i = 1; i < name.Length; i++)
            if (!IsAsciiLetter(name[i]) && (name[i] < '0' || name[i] > '9') && name[i] != '_') return true;
        return false;
    }

    private static bool IsAsciiLetter(char c) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
}
