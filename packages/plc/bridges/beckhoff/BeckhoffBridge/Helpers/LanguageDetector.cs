using System;

namespace BeckhoffBridge.Helpers;

/// <summary>
/// Classify the IEC 61131 language an implementation body is written in,
/// by sniffing the XML wrapper TwinCAT emits. Returned values match
/// TwinCAT's own <c>IECLanguage</c> vocabulary (ST / FBD / LD / SFC /
/// CFC) plus a fallback <c>UNKNOWN</c> for shapes we don't yet
/// recognize — that's a real signal worth seeing in logs, not a silent
/// default.
///
/// <para>Detection map:</para>
/// <list type="bullet">
///   <item><description><c>""</c> → ST (no body — declaration-only items)</description></item>
///   <item><description><c>&lt;NWL&gt;…</c> → FBD or LD (peek inside for <c>DefaultViewMode = "Ld"</c>)</description></item>
///   <item><description><c>&lt;STBody&gt;…</c> → SFC</description></item>
///   <item><description><c>&lt;CFC&gt;…</c> → CFC</description></item>
///   <item><description>plain text → ST</description></item>
///   <item><description>other XML → UNKNOWN</description></item>
/// </list>
///
/// <para>Why this lives at the wire level (and not just internally for
/// the placeholder mask): AI clients and future graphical-language LSPs
/// need to route per language without parsing the body. While a
/// graphical-language LSP doesn't exist yet, the bridge masks
/// graphical bodies with a placeholder and clients see
/// <c>language: "FBD"</c> etc. Once an LSP lands, the mask drops and
/// callers consume the same field — protocol shape doesn't change.</para>
/// </summary>
public static class LanguageDetector
{
	/// <summary>
	/// Detect the IEC 61131 language of an implementation body. Returns
	/// one of: "ST", "FBD", "LD", "SFC", "CFC", "UNKNOWN".
	/// </summary>
	public static string Detect(string? impl)
	{
		if (string.IsNullOrEmpty(impl)) return "ST";
		var trimmed = impl.TrimStart();
		if (trimmed.StartsWith("<NWL>", StringComparison.OrdinalIgnoreCase))
		{
			// FBD and LD share the NWL wrapper; the editor's chosen view
			// is recorded inside as `<v n="DefaultViewMode">"Ld"</v>`.
			// We only look for "Ld" — anything else (Fbd, missing, future
			// view modes) collapses to FBD, the dominant default.
			return trimmed.Contains("\"Ld\"", StringComparison.Ordinal) ? "LD" : "FBD";
		}
		if (trimmed.StartsWith("<STBody>", StringComparison.OrdinalIgnoreCase)) return "SFC";
		if (trimmed.StartsWith("<CFC>", StringComparison.OrdinalIgnoreCase)) return "CFC";
		if (trimmed.StartsWith("<", StringComparison.Ordinal)) return "UNKNOWN";
		return "ST";
	}

	/// <summary>True if the language is anything other than plain ST.</summary>
	public static bool IsGraphical(string? impl) => Detect(impl) != "ST";
}
