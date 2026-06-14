using System.Linq;
using System.Text.RegularExpressions;

namespace VoltBridge.Core.Fbd;

/// <summary>
/// CODESYS's <c>IImplementationObject.GetImplementationSnippet()</c> returns an FBD/LD
/// body already rendered as ST — but interspersed with editor markers:
///   <c>{p N}</c> (element ids), <c>{bp}</c>/<c>{nobp}</c> (breakpoints), and a trailing
///   <c>{ assert(hastype(…)) }</c> type-guard. This strips them to clean ST.
///
/// It is the CODESYS-side production renderer (CODESYS's own, authoritative output) and
/// the oracle the cross-vendor <see cref="FbdTranspiler"/> is tuned to match.
/// </summary>
public static class FbdSnippet
{
    private static readonly Regex Marker = new(@"\{[^{}]*\}", RegexOptions.Compiled);

    public static string CleanImplementation(string? snippet)
    {
        if (string.IsNullOrEmpty(snippet)) return "";
        var st = Marker.Replace(snippet!, "");
        st = st.Replace("\r\n", "\n").Replace("\r", "\n");
        // Drop lines that are empty or a bare ";" (the stripped {assert} leaves a "; ").
        var lines = st.Split('\n')
            .Select(l => l.TrimEnd())
            .Where(l => l.Trim().Length > 0 && l.Trim() != ";");
        var body = string.Join("\n", lines).Trim();
        return body.Length == 0 ? "" : body + "\n";
    }
}
