using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Seam;

namespace Volt.Engine.Item;

/// <summary>
/// TRANSITIONAL — the door through which a vendor that speaks only the new contract (<see cref="Volt.Engine.Seam"/>)
/// reaches the OLD engine, until step 5 of openspec <c>volt-cli-rework</c> moves <c>Sync/</c> onto the new contract and
/// deletes this file with <see cref="ItemKind"/>'s numeric codes.
///
/// <para>Why it exists (design "Step 4 findings"): the old engine admits no kind it does not hardcode. Its kind table,
/// its file layout (<c>StReader</c>/<c>StWriter</c>) and its <c>int</c> kind codes are closed, so a third vendor outside
/// the CODESYS family is refused at the wire (<c>BAD_REQUEST</c> for <c>.blk</c>) and dropped from <c>refs</c> before
/// its host is ever asked. This class opens exactly those three doors for the kinds a catalog declares, and nothing
/// else: the CODESYS-family rows stay <see cref="ItemKind"/>'s own, untouched, so the wire of both shipped vendors is
/// byte-identical. Nothing is admitted in a shipped process.</para>
///
/// <para>An admitted kind travels the old engine under a SYNTHETIC code (from <see cref="FirstCode"/>), because every
/// old walk and lookup keys a kind by number. The code never leaves the process and is no vendor's.</para>
/// </summary>
public static class SeamAdmission
{
    /// <summary>Above every vendor code (TwinCAT's TREEITEMTYPE range is 0-700, the CODESYS synthetics 690-700).</summary>
    public const int FirstCode = 100_000;

    private sealed record Admitted(KindRow Row, int Code, Catalog Catalog, string Vendor);

    private static readonly object Gate = new();
    private static Dictionary<string, Admitted> _byKind = new();   // kind words and extensions: the default (ordinal) string key
    private static Dictionary<int, Admitted> _byCode = new();
    private static Dictionary<string, Admitted> _byExtension = new();

    /// <summary>Admit every kind <paramref name="vendor"/> declares in <paramref name="catalog"/>. A kind or an extension
    /// the old table already holds is refused (the family rows are not in a catalog yet, so the registry cannot see the
    /// clash); admitting the same row twice is a no-op, another row under an admitted kind is refused.</summary>
    public static void Admit(Catalog catalog, string vendor)
    {
        if (catalog is null) throw new ArgumentNullException(nameof(catalog));
        lock (Gate)
        {
            var byKind = new Dictionary<string, Admitted>(_byKind);
            var byCode = new Dictionary<int, Admitted>(_byCode);
            var byExt = new Dictionary<string, Admitted>(_byExtension);
            foreach (var row in catalog.Kinds.Rows.Where(r => catalog.Kinds.VendorsOf(r.Kind).Contains(vendor)))
            {
                if (ItemKind.IsFamilyKind(row.Kind) || (row.Extension is { } e && ItemKind.IsFamilyExtension(e)))
                    throw new InvalidOperationException(
                        $"vendor '{vendor}' declares {row}, which the old kind table already holds: a third vendor brings its own kinds");
                if (byKind.TryGetValue(row.Kind, out var held))
                {
                    if (!held.Row.SameAs(row))
                        throw new InvalidOperationException($"kind '{row.Kind}' is admitted as {held.Row}, not {row}");
                    continue;
                }
                var admitted = new Admitted(row, FirstCode + byCode.Count, catalog, vendor);
                byKind[row.Kind] = admitted;
                byCode[admitted.Code] = admitted;
                if (row.Extension is { } ext) byExt[ext] = admitted;
            }
            // Published whole, so a reader on another thread sees the old maps or the new ones, never half of one.
            _byKind = byKind; _byCode = byCode; _byExtension = byExt;
        }
    }

    /// <summary>The synthetic code an admitted kind travels the old engine under. Any other kind is Volt's bug.</summary>
    public static int CodeOf(string kind) =>
        _byKind.TryGetValue(kind ?? "", out var a)
            ? a.Code
            : throw new BridgeException(BridgeErrorCodes.InternalError,
                $"no create code for the top-level kind '{kind}': the pre-flight admits only a writable source kind");

    /// <summary>The catalog and vendor an admitted kind was declared in, or null for any other kind.</summary>
    public static (Catalog Catalog, string Vendor)? DeclaredIn(string kind) =>
        _byKind.TryGetValue(kind ?? "", out var a) ? (a.Catalog, a.Vendor) : null;

    internal static KindRow? Row(string kind) => _byKind.TryGetValue(kind ?? "", out var a) ? a.Row : null;

    internal static string? KindOfCode(int code) => _byCode.TryGetValue(code, out var a) ? a.Row.Kind : null;

    internal static string? KindOfExtension(string extension) =>
        _byExtension.TryGetValue(extension ?? "", out var a) ? a.Row.Kind : null;

    internal static bool IsSourceCode(int code) => _byCode.TryGetValue(code, out var a) && a.Row.Role == KindRole.Source;
}
