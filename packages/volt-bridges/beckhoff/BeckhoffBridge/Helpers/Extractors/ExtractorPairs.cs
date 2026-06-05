using System.Collections.Generic;
using System.Text;

namespace BeckhoffBridge.Helpers.Extractors;

/// <summary>
/// Tiny builder for the `key = value` manifest shape every extractor
/// produces. Mirrors the CODESYS bridge's <c>_emit_pairs</c> helper —
/// same wire shape so the workspace looks the same regardless of
/// which bridge populated it.
///
/// Skips entries whose value is null / empty. Preserves declaration
/// order — callers control ordering by the order they call
/// <see cref="Add"/>. Trailing newline always present when there's
/// any content; empty input → empty output (no spurious newline).
/// </summary>
internal sealed class ExtractorPairs
{
	private readonly List<(string Key, string Value)> _pairs = new();

	/// <summary>Append a key/value. Null/empty values are silently
	/// skipped — same convention as CODESYS's <c>_emit_pairs</c>.</summary>
	public ExtractorPairs Add(string key, string? value)
	{
		if (string.IsNullOrEmpty(value)) return this;
		_pairs.Add((key, value));
		return this;
	}

	/// <summary>Append a key/value rendering a bool as "true"/"false".
	/// Null values silently skip.</summary>
	public ExtractorPairs Add(string key, bool? value)
	{
		if (value is null) return this;
		_pairs.Add((key, value.Value ? "true" : "false"));
		return this;
	}

	/// <summary>Append a key/value rendering an int. Null silently
	/// skips.</summary>
	public ExtractorPairs Add(string key, int? value)
	{
		if (value is null) return this;
		_pairs.Add((key, value.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)));
		return this;
	}

	/// <summary>Append a raw line — used by callers that need to emit
	/// non-pair-shaped lines (e.g. task POU call list "pou = MAIN")
	/// inline with the pair output.</summary>
	public ExtractorPairs AddRaw(string line)
	{
		if (string.IsNullOrEmpty(line)) return this;
		// Store raw lines with an empty key sentinel so Build emits
		// them verbatim. Callers must pass pre-formatted "key = value"
		// strings.
		_pairs.Add(("", line));
		return this;
	}

	/// <summary>Render to a string. Empty input → empty string. Otherwise
	/// each entry on its own LF-terminated line.</summary>
	public string Build()
	{
		if (_pairs.Count == 0) return "";
		var sb = new StringBuilder();
		foreach (var (key, value) in _pairs)
		{
			if (key.Length == 0)
				sb.Append(value);
			else
				sb.Append(key).Append(" = ").Append(value);
			sb.Append('\n');
		}
		return sb.ToString();
	}
}
