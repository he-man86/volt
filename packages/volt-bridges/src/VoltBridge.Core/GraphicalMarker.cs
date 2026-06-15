using System;

namespace VoltBridge.Core;

/// <summary>
/// The single owner of the textual graphical-body contract between the read path
/// (<see cref="SourceAssembler"/> emits) and the write path (PushHandler parses). Centralized so the
/// two sides can't drift as graphical languages are added.
///
/// Two shapes carry a graphical body to the workspace:
///   - A ROOT FBD/LD POU body IS the editable VG language, starting with <c>%LANG</c> — its file
///     extension (.fbd/.ld) marks it graphical, so it needs NO marker.
///   - A graphical CHILD (action/method) inside a file whose root language differs carries a leading
///     <c>(* @volt-graphical: LANG [vg] *)</c> marker. The <c>vg</c> tag means the body round-trips
///     on push; without it the body is a read-only view (ST/CFC/SFC) and is never written back.
/// </summary>
public static class GraphicalMarker
{
    private const string Prefix = "(* @volt-graphical:";
    private const string VgTag = " vg *)";
    private const string VgBodyHeader = "%LANG";

    /// <summary>Wrap a graphical body in its marker (<c>vg</c> tag when editable), followed by the
    /// body text (omitted when empty, e.g. a read-only CFC/SFC view).</summary>
    public static string Wrap(string language, bool editable, string body)
    {
        var marker = $"(* @volt-graphical: {(editable ? language + " vg" : language)} *)";
        return string.IsNullOrEmpty(body) ? marker : marker + "\n" + body;
    }

    /// <summary>The body carries the @volt-graphical marker (a graphical child).</summary>
    public static bool IsMarked(string? impl)
        => impl != null && impl.TrimStart().StartsWith(Prefix, StringComparison.Ordinal);

    /// <summary>The body IS the editable VG language (a root .fbd/.ld POU body), recognized by its
    /// leading <c>%LANG</c> header — no marker, the file extension conveys it.</summary>
    public static bool IsVgBody(string? impl)
        => impl != null && impl.TrimStart().StartsWith(VgBodyHeader, StringComparison.Ordinal);

    /// <summary>A marked body whose marker carries the <c>vg</c> tag — an EDITABLE body that push
    /// round-trips (vs. a read-only ST/CFC/SFC view).</summary>
    public static bool IsVgMarked(string? impl)
    {
        if (!IsMarked(impl)) return false;
        var firstLine = impl!.TrimStart();
        var nl = firstLine.IndexOf('\n');
        if (nl >= 0) firstLine = firstLine.Substring(0, nl);
        return firstLine.Contains(VgTag);
    }

    /// <summary>The body of a marked child — everything after the marker line.</summary>
    public static string ExtractBody(string impl)
    {
        var t = impl.TrimStart();
        var nl = t.IndexOf('\n');
        return nl < 0 ? "" : t.Substring(nl + 1);
    }
}
