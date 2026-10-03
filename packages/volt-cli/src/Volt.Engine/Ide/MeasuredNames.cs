using System;
using System.Collections.Generic;
using Volt.Engine.Item;

namespace Volt.Engine.Ide;

/// <summary>
/// The parts of a driver's measured NAME refusal (<see cref="ICodeStore.RefusedName"/>) that both vendors answered
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
    /// (openspec <c>bridge-refusal-review</c> 3.1, "double underscore": <c>scripts/identifier-names.log</c>,
    /// <c>tc-refusal-measure-names.log</c>). It sat measured and unused, so an interface member named so passed the
    /// pre-flight and was refused mid-batch (review 3a+3b). Case-insensitive, as the lists are.</summary>
    private static readonly HashSet<string> AskedOnInterfaceMembers =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "a__b" };

    /// <summary>An ASCII identifier: a letter or underscore, then letters, digits and underscores. Measured on both
    /// vendors for a POU and every member kind (openspec <c>bridge-refusal-review</c> 3.1, <c>scripts/identifier-names.log</c>
    /// and <c>tc-refusal-measure-names.log</c>): every name outside it that was asked — non-ASCII letters, a leading
    /// digit, every ASCII punctuation mark, a no-break or zero-width space — was refused by the IDE's own NAME refusal,
    /// a lone <c>_</c> was created. CODESYS adds one shape of its own (a backtick-quoted name), which its driver
    /// states.</summary>
    public static bool IsAsciiIdentifier(string name)
    {
        if (name.Length == 0) return false;
        if (!IsAsciiLetter(name[0]) && name[0] != '_') return false;
        for (var i = 1; i < name.Length; i++)
            if (!IsAsciiLetter(name[i]) && (name[i] < '0' || name[i] > '9') && name[i] != '_') return false;
        return true;
    }

    private static bool IsAsciiLetter(char c) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
}
