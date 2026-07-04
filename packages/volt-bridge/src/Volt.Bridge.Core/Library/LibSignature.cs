using System.Collections.Generic;

namespace Volt.Bridge.Core.Library;

/// <summary>One variable in a library element's interface: its name and IEC type text.</summary>
public sealed record LibVar(string Name, string Type);

/// <summary>A referenced-library element's public SIGNATURE (declaration only — no implementation), extracted
/// from the precompiled language model. Vendor-neutral: the CODESYS driver fills it by reflection over
/// <c>ISignature</c>; <see cref="LibSignatureRenderer"/> turns it into an ST declaration file the LSP ingests.
/// <see cref="LibraryPath"/> is the owning library's identity ("name, version (company)") — used to group
/// elements by library and to join them to the library's <c>.library</c> ref for foldering.</summary>
public sealed record LibSignature(
    string Name,
    string LibraryPath,
    string PouType,
    IReadOnlyList<LibVar> Inputs,
    IReadOnlyList<LibVar> Outputs,
    IReadOnlyList<LibVar> InOuts,
    IReadOnlyList<LibVar> Members,
    string? BaseName,
    string? ReturnType);
