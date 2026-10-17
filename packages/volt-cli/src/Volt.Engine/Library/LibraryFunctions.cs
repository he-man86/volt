using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Engine.Format.Network;

namespace Volt.Engine.Library;

/// <summary>
/// A referenced library's FUNCTION as a call box needs it (openspec <c>ld-fbd-coverage</c> 2R.4b): the <c>CallType</c>
/// and the pin names the editor gives the box it draws, read off the IDE's library signatures — the same read the pull
/// materializes a library's declarations from (<see cref="LibSignatureRenderer"/>). Measured live (CODESYS SP21,
/// <c>ng_m_library_function*</c>): the box a push builds without them answers "The assignment source is incorrect.", positional
/// or named, where the drawn one builds.
/// </summary>
public static class LibraryFunctions
{
    /// <summary>The callee a box named <paramref name="name"/> is built with, or null when no signature is a FUNCTION of
    /// that name, or when two libraries declare one with different pins (the build judges which, not Volt). A function
    /// with a <c>VAR_IN_OUT</c> keeps no input order: a signature lists its inputs and in-outs apart, and a positional call
    /// fills them in declaration order, which it does not carry — so none is derived and a positional pin stays as the
    /// text wrote it; its <c>CallType</c> is derived all the same.</summary>
    public static Callee? Of(IReadOnlyList<LibSignature> signatures, string name)
    {
        if (signatures is null) throw new ArgumentNullException(nameof(signatures));
        var callees = signatures
            .Where(s => IsFunction(s) && string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase))
            .Select(CalleeOf)
            .ToList();
        if (callees.Count == 0) return null;
        var first = callees[0];
        return callees.All(c => c.Inputs.SequenceEqual(first.Inputs, StringComparer.OrdinalIgnoreCase) &&
                                c.Outputs!.SequenceEqual(first.Outputs!, StringComparer.OrdinalIgnoreCase))
            ? first
            : null;
    }

    // The signature's POU type is the vendor's enum member, namespace-qualified on CODESYS (`…POUType.Function`), as the
    // renderer reads it.
    private static bool IsFunction(LibSignature s) =>
        (s.PouType.Contains(".") ? s.PouType.Substring(s.PouType.LastIndexOf('.') + 1) : s.PouType) == "Function";

    private static Callee CalleeOf(LibSignature s)
    {
        // The result is a self-named output on CODESYS (verified live, LibSignatureRenderer.LiftReturn): no VAR_OUTPUT.
        var (_, outputs) = LibSignatureRenderer.LiftReturn(s.Name, s.Outputs, s.ReturnType);
        var inputs = s.InOuts.Count == 0 ? s.Inputs.Select(v => v.Name).ToList() : new List<string>();
        return new Callee(Callee.FunctionCallType, inputs, outputs.Select(v => v.Name).ToList());
    }
}
