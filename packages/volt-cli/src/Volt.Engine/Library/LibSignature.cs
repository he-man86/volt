using System.Collections.Generic;

namespace Volt.Engine.Library;

/// <summary>One variable in a library element's interface: its name, IEC type text, and optional initial value
/// (an enum member's ordinal, or a pin/field default) — rendered as `:= Initial` so enum values survive.</summary>
public sealed record LibVar(string Name, string Type, string? Initial = null);

/// <summary>A method (or interface method) of a library element: its own pin interface + optional return type,
/// declaration only. <see cref="LibSignatureRenderer"/> emits it as a `METHOD name : ret … END_METHOD` block
/// after the parent FB/interface — the same textual form project FBs materialize, so the LSP binds it as a
/// member and member access (`fb.Method()`, `itf.Method()`) resolves instead of reading as unknown-member.</summary>
public sealed record LibMethod(
    string Name,
    IReadOnlyList<LibVar> Inputs,
    IReadOnlyList<LibVar> Outputs,
    IReadOnlyList<LibVar> InOuts,
    string? ReturnType = null);

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
    string? ReturnType,
    // For a DUT ALIAS (CODESYS `Flags == "Alias"`, e.g. `TYPE HANDLE : __XWORD`): the base type text. The
    // alias is modeled as a single unnamed variable whose Type is the base, so it can't ride in Members
    // (name-filtered). Non-null ⇒ render `TYPE name : AliasBase; END_TYPE` (an alias body), not a struct body.
    string? AliasBase = null,
    // The CODESYS DUT sub-kind flag ("Alias" / "Union" / "None"/…) — it picks the rendered BODY form (a union
    // gets UNION/END_UNION), not the extension (every DUT is `.dut`). Empty for non-DUT signatures.
    string Flags = "",
    // Methods of an FB or interface (declaration only). Null/empty for elements that have none. Folded into the
    // parent's rendered text as METHOD blocks so a library FB's methods are known to the LSP, not unknown-member.
    IReadOnlyList<LibMethod>? Methods = null);
