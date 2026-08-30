using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Volt.Contracts;
using Volt.Engine.Library;

namespace Volt.Ide.Twincat;

/// <summary>
/// Parses what <c>_ITcPlcLibraryManager.ProduceAllLibrarySignatures()</c> returns into vendor-neutral
/// <see cref="LibSignature"/>s — the referenced-library declarations the LSP resolves a <c>TON</c> or a
/// <c>CONCAT</c> against.
///
/// <para><b>This closes a capability gap, not a test gap.</b> TwinCAT users got NO library signatures at all:
/// <c>BeckhoffDriver</c> inherited <c>DriverBase</c>'s empty <c>ExtractLibrarySignatures</c>, so completion,
/// hover and go-to-definition on every library FB silently did nothing on one vendor and worked on the other.
/// The reason recorded for that — "TwinCAT has no equivalent surface" — was already known to be wrong: DIALECT
/// C2c measured this exact call returning 181,179 chars out-of-process. Only the FORMAT was missing, and no
/// fixture recorded it; <c>--probe-libsig</c> captured it from the live IDE.</para>
///
/// <para><b>The format, measured.</b> Not one document: the call returns the libraries' XML CONCATENATED, so
/// three referenced libraries come back as three <c>&lt;Library&gt;</c> roots in sequence, which no XML parser
/// will accept as-is. Each carries <c>LibraryName</c>/<c>Version</c>/<c>Distributor</c> — precisely the three
/// parts <see cref="LibraryManifest.Resolution"/> formats, which is what joins a signature to its
/// <c>.library</c> ref, so the grouping falls out rather than being guessed at. Inside,
/// <c>&lt;TypeSignature type="…"&gt;</c> takes exactly five values — <c>FunctionBlock</c>, <c>Function</c>,
/// <c>Type</c>, <c>VarGlobal</c>, <c>Interface</c> — and those are the SAME five strings
/// <see cref="LibSignatureRenderer"/> already switches on, because both are 3S vocabularies.</para>
/// </summary>
internal static class TcLibrarySignatures
{
    /// <summary>Every signature the vendor described well enough to render.</summary>
    public static IReadOnlyList<LibSignature> Parse(string? xml)
    {
        if (string.IsNullOrWhiteSpace(xml)) return Array.Empty<LibSignature>();

        // ONE synthetic root, because the vendor concatenates its libraries. Wrapping is the whole fix — the
        // bytes inside are untouched, so a library's own XML is parsed exactly as it was produced.
        XElement root;
        try { root = XElement.Parse("<Libraries>" + xml + "</Libraries>", LoadOptions.PreserveWhitespace); }
        catch (System.Xml.XmlException ex)
        {
            throw new InvalidOperationException(
                "TwinCAT: the library manager's signature XML did not parse. Volt refuses to report a project " +
                $"as having no library signatures when the IDE produced {xml!.Length} characters of them: {ex.Message}");
        }

        var sigs = new List<LibSignature>();
        var noBody = 0;
        var unknown = new List<string>();

        foreach (var lib in root.Elements("Library"))
        {
            var path = LibraryManifest.Resolution(Text(lib, "LibraryName"), Text(lib, "Version"), Text(lib, "Distributor"));

            foreach (var ts in lib.Element("TypeSignatures")?.Elements("TypeSignature") ?? Enumerable.Empty<XElement>())
            {
                var kind = (string?)ts.Attribute("type") ?? "";
                var name = Text(ts, "Name");
                if (name.Length == 0) continue;

                switch (kind)
                {
                    case "FunctionBlock":
                    case "Function":
                        // Outputs are handed over VERBATIM, return included. A function's return arrives as an
                        // output named after the function (`CONCAT` → `STRING(255)`), and
                        // `LibSignatureRenderer.LiftReturn` already lifts exactly that shape — so `ReturnType`
                        // stays null rather than re-implementing the same rule one layer down and risking the
                        // two disagreeing.
                        sigs.Add(Signature(name, path, kind,
                            Vars(ts.Element("Inputs"), "Input"),
                            Vars(ts.Element("Outputs"), "Output"),
                            Vars(ts.Element("InOuts"), "InOut"),
                            members: Array.Empty<LibVar>()));
                        break;

                    case "VarGlobal":
                        sigs.Add(Signature(name, path, kind,
                            Array.Empty<LibVar>(), Array.Empty<LibVar>(), Array.Empty<LibVar>(),
                            members: Vars(ts.Element("Constants"), "Constant")));
                        break;

                    case "Type":
                    case "Interface":
                        // NOT EMITTED, and this is a judgement rather than an oversight. TwinCAT describes these
                        // by NAME ONLY — measured across the whole document, every one of the 25 `Type` and the
                        // single `Interface` entry carries a `<Name>` and nothing else: no fields, no methods.
                        //
                        // The renderer would still render them, and that is the problem: a member-less `Type`
                        // becomes `TYPE X : STRUCT END_STRUCT END_TYPE`, which does not merely omit the fields —
                        // it ASSERTS THERE ARE NONE, so every `x.field` in an engineer's code becomes a false
                        // error. An empty `INTERFACE` says the same about its methods. Emitting nothing costs one
                        // unknown-type error at the declaration; emitting an empty body costs a wrong error at
                        // every USE. The repo has been here before — rendering aliases as empty structs was
                        // logged as a fidelity bug, not a feature.
                        noBody++;
                        break;

                    default:
                        unknown.Add(kind.Length == 0 ? "(no type attribute)" : kind);
                        break;
                }
            }
        }

        if (noBody > 0)
            VoltLog.Debug($"twincat lib signatures: {noBody} Type/Interface entries carry a name only (no body " +
                          "described by the vendor) and are not emitted — see TcLibrarySignatures");
        if (unknown.Count > 0)
            VoltLog.Warn($"twincat lib signatures: {unknown.Count} entries have a TypeSignature kind Volt does " +
                         $"not model ({string.Join(", ", unknown.Distinct().Take(5))}) — they are not emitted");

        return sigs;
    }

    private static LibSignature Signature(
        string name, string libraryPath, string pouType,
        IReadOnlyList<LibVar> inputs, IReadOnlyList<LibVar> outputs, IReadOnlyList<LibVar> inOuts,
        IReadOnlyList<LibVar> members) =>
        new LibSignature(
            name, libraryPath, pouType,
            inputs, outputs, inOuts, members,
            BaseName: null,      // no EXTENDS in this surface
            ReturnType: null);   // lifted from Outputs by the renderer

    /// <summary>The <c>Name</c>/<c>DataType</c> pairs under a container (<c>Inputs</c>, <c>Constants</c>, …).
    /// A <c>Comment</c> sits beside them and is dropped: <see cref="LibVar"/> has nowhere to put it and the
    /// renderer emits declarations, not documentation.</summary>
    private static IReadOnlyList<LibVar> Vars(XElement? container, string child) =>
        container?.Elements(child)
            .Select(e => new LibVar(Text(e, "Name"), Text(e, "DataType")))
            .Where(v => v.Name.Length > 0 && v.Type.Length > 0)
            .ToList()
        ?? (IReadOnlyList<LibVar>)Array.Empty<LibVar>();

    private static string Text(XElement owner, string child) => owner.Element(child)?.Value.Trim() ?? "";
}
