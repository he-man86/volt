using System;
using System.Text.RegularExpressions;

namespace BeckhoffBridge.Helpers;

/// <summary>
/// Code helpers for parsing IEC 61131-3 headers and joining declaration/implementation.
/// </summary>
internal static class CodeHelper
{
	/// <summary>Result of parsing an IEC 61131-3 code header.</summary>
	public record CodeHeader(
		string Type,
		string? Name,
		string? ReturnType = null,
		string? DataType = null,
		string? AccessModifier = null);

	/// <summary>
	/// Parse the first meaningful line of IEC 61131-3 code to extract type, name, and metadata.
	/// Skips attribute lines ({attribute ...}) to find the real header.
	///
	/// Supported headers:
	///   FUNCTION_BLOCK name → type=function_block
	///   PROGRAM name → type=program
	///   FUNCTION name [: ReturnType] → type=function
	///   METHOD [access] name [: ReturnType] → type=method
	///   PROPERTY name : DataType → type=property
	///   ACTION name → type=action
	///   INTERFACE name → type=interface
	///   TYPE name : ... → type=structure/enumeration/union/alias (detected from content)
	///   VAR_GLOBAL → type=gvl, name=null
	/// </summary>
	public static CodeHeader ParseCodeHeader(string code)
	{
		if (string.IsNullOrWhiteSpace(code))
			throw new BridgeException(400, "INVALID_CODE_HEADER", "Empty code — cannot parse header");

		// Find the first non-attribute, non-comment, non-empty line
		var lines = code.Split('\n');
		string headerLine = "";
		int headerIdx = -1;
		bool inBlockComment = false;
		for (int i = 0; i < lines.Length; i++)
		{
			var trimmed = lines[i].Trim();
			if (inBlockComment)
			{
				if (trimmed.Contains("*)")) inBlockComment = false;
				continue;
			}
			if (trimmed.Length == 0) continue;
			if (trimmed.StartsWith("{")) continue; // skip {attribute ...} lines
			if (trimmed.StartsWith("//")) continue; // skip single-line comments
			if (trimmed.StartsWith("(*"))
			{
				if (!trimmed.Contains("*)")) inBlockComment = true;
				continue;
			}
			headerLine = trimmed;
			headerIdx = i;
			break;
		}

		if (headerLine.Length == 0)
			throw new BridgeException(400, "INVALID_CODE_HEADER", "No header line found in code");

		// VAR_GLOBAL → GVL (name not in code)
		// VAR_CONFIG → same standalone shape as a GVL; TwinCAT also
		// stores it as a GVL-type tree item. The IEC address-binding
		// block has identical file structure (single VAR section + END_VAR).
		if (Regex.IsMatch(headerLine, @"^(VAR_GLOBAL|VAR_CONFIG)\b", RegexOptions.IgnoreCase))
			return new CodeHeader("gvl", null);

		// FUNCTION_BLOCK name [EXTENDS ...] [IMPLEMENTS ...]
		var fbMatch = Regex.Match(headerLine,
			@"^FUNCTION_BLOCK\s+(\w+)", RegexOptions.IgnoreCase);
		if (fbMatch.Success)
			return new CodeHeader("function_block", fbMatch.Groups[1].Value);

		// PROGRAM name
		var prgMatch = Regex.Match(headerLine,
			@"^PROGRAM\s+(\w+)", RegexOptions.IgnoreCase);
		if (prgMatch.Success)
			return new CodeHeader("program", prgMatch.Groups[1].Value);

		// FUNCTION name [: ReturnType] — ReturnType may be complex (e.g. ARRAY[0..3] OF BOOL)
		var fcMatch = Regex.Match(headerLine,
			@"^FUNCTION\s+(\w+)(?:\s*:\s*(.+?))?\s*;?\s*$", RegexOptions.IgnoreCase);
		if (fcMatch.Success)
			return new CodeHeader("function", fcMatch.Groups[1].Value,
				ReturnType: fcMatch.Groups[2].Success ? fcMatch.Groups[2].Value.Trim() : null);

		// METHOD [access...] name [: ReturnType]
		// Multiple access modifiers may stack (e.g. METHOD PROTECTED FINAL Execute,
		// METHOD PUBLIC ABSTRACT MyMethod). The previous single-modifier regex
		// rejected stacked combos as "Unrecognized code header" — anchor: chat
		// afa87d2c 2026-04-30, AI hit this 8 times trying to patch FB_Machine.
		// ReturnType may be complex (e.g. ARRAY[0..3] OF BOOL).
		var methodMatch = Regex.Match(headerLine,
			@"^METHOD\s+((?:(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|FINAL|ABSTRACT)\s+)*)(\w+)(?:\s*:\s*(.+?))?\s*;?\s*$",
			RegexOptions.IgnoreCase);
		if (methodMatch.Success)
			return new CodeHeader("method", methodMatch.Groups[2].Value,
				ReturnType: methodMatch.Groups[3].Success ? methodMatch.Groups[3].Value.Trim() : null,
				// Extract just the ACL keyword (PUBLIC/PRIVATE/PROTECTED/INTERNAL)
				// for the TwinCAT vInfo. FINAL/ABSTRACT stay in DeclarationText
				// and TwinCAT picks them up via SetChildCode — they're not
				// valid access-modifier values for CreateChild's vInfo.
				AccessModifier: ExtractAclModifier(methodMatch.Groups[1].Value));

		// PROPERTY [access] name : DataType — DataType may be complex (e.g. ARRAY[0..3] OF BOOL)
		var propMatch = Regex.Match(headerLine,
			@"^PROPERTY\s+(?:(PUBLIC|PRIVATE|PROTECTED|INTERNAL)\s+)?(\w+)\s*:\s*(.+?)\s*;?\s*$",
			RegexOptions.IgnoreCase);
		if (propMatch.Success)
			return new CodeHeader("property", propMatch.Groups[2].Value,
				DataType: propMatch.Groups[3].Value.Trim(),
				AccessModifier: propMatch.Groups[1].Success ? propMatch.Groups[1].Value.ToUpperInvariant() : null);

		// ACTION name
		var actMatch = Regex.Match(headerLine,
			@"^ACTION\s+(\w+)", RegexOptions.IgnoreCase);
		if (actMatch.Success)
			return new CodeHeader("action", actMatch.Groups[1].Value);

		// INTERFACE name
		var ifaceMatch = Regex.Match(headerLine,
			@"^INTERFACE\s+(\w+)", RegexOptions.IgnoreCase);
		if (ifaceMatch.Success)
			return new CodeHeader("interface", ifaceMatch.Groups[1].Value);

		// TYPE name : ... → detect DUT subtype from content
		var typeMatch = Regex.Match(headerLine,
			@"^TYPE\s+(\w+)\s*:", RegexOptions.IgnoreCase);
		if (typeMatch.Success)
		{
			var typeName = typeMatch.Groups[1].Value;
			var restOfCode = string.Join("\n", lines, headerIdx, lines.Length - headerIdx);
			var dutSubType = DetectDutSubType(restOfCode);
			return new CodeHeader(dutSubType, typeName);
		}

		throw new BridgeException(400, "INVALID_CODE_HEADER",
			$"Unrecognized code header: {(headerLine.Length > 80 ? headerLine[..80] + "..." : headerLine)}");
	}

	/// <summary>
	/// Pull the ACL keyword (PUBLIC/PRIVATE/PROTECTED/INTERNAL) out of a
	/// possibly-empty modifier list like "PROTECTED FINAL " or "PUBLIC ".
	/// Returns null if no ACL keyword is present (TwinCAT then defaults
	/// to PUBLIC). FINAL/ABSTRACT are intentionally ignored here because
	/// they're not valid access-modifier vInfo values — they survive in
	/// the DeclarationText that SetChildCode writes after CreateChild.
	/// </summary>
	private static string? ExtractAclModifier(string modifierList)
	{
		if (string.IsNullOrWhiteSpace(modifierList)) return null;
		foreach (var token in modifierList.Split(' ', StringSplitOptions.RemoveEmptyEntries))
		{
			var upper = token.ToUpperInvariant();
			if (upper is "PUBLIC" or "PRIVATE" or "PROTECTED" or "INTERNAL")
				return upper;
		}
		return null;
	}

	/// <summary>
	/// Detect DUT subtype (structure/enumeration/union/alias) from TYPE block content.
	/// </summary>
	private static string DetectDutSubType(string typeBlock)
	{
		if (Regex.IsMatch(typeBlock, @"\bSTRUCT\b", RegexOptions.IgnoreCase))
			return "structure";
		if (Regex.IsMatch(typeBlock, @"\bUNION\b", RegexOptions.IgnoreCase))
			return "union";
		// Enumeration: TYPE Name : (\n  VAL1, ... or TYPE Name : (VAL1, ...
		if (Regex.IsMatch(typeBlock, @":\s*\(", RegexOptions.IgnoreCase))
			return "enumeration";
		// Default to alias
		return "alias";
	}


}
