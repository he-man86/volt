using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace Volt.Bridge.Core.Workspace.SourceText;

/// <summary>
/// Splits a single workspace `.st` file (assembled by the agent) into
/// its TwinCAT tree-item primitives: one outer POU + N children
/// (methods / actions / properties / property accessors).
///
/// Wire-model: the agent sends raw `.st` text to /push via the
/// pushPou op. The bridge runs SplitSt on it to recover the tree
/// structure it needs to drive ITcSmTreeItem.CreateChild calls.
///
/// Format (canonical workspace .st layout — see also StAssembler):
///   {optional pragmas/comments}
///   FUNCTION_BLOCK Name [EXTENDS B] [IMPLEMENTS I,J]
///   VAR_INPUT … END_VAR
///   VAR … END_VAR
///
///   {impl body}
///
///   END_FUNCTION_BLOCK
///
///   {pragmas} METHOD … END_METHOD
///   ACTION … END_ACTION
///   PROPERTY … {GET … END_GET} {SET … END_SET} END_PROPERTY
///
/// Same format for PROGRAM (END_PROGRAM), FUNCTION (END_FUNCTION).
/// INTERFACE (END_INTERFACE) is special: its method/property/action
/// signatures live INSIDE the INTERFACE…END_INTERFACE block (no
/// implementation bodies — interface signatures only), not as siblings
/// after END_INTERFACE. SplitInterfaceBody pulls them out as children.
/// GVL / DUT are simple single-block forms with no child structure.
///
/// State machine — at column 0 (line start), match outer-end keywords
/// (END_FUNCTION_BLOCK / END_PROGRAM / END_FUNCTION / END_INTERFACE)
/// and child boundaries (METHOD / ACTION / PROPERTY / END_METHOD /
/// END_ACTION / END_PROPERTY / GET / SET / END_GET / END_SET).
///
/// Deliberately string/regex-based — no token-level parser. The
/// LSP's full parser lives in volt-lsp-st on the agent side; the
/// bridge only needs the structural skeleton, not statement
/// semantics. Block comments `(* ... *)`, line comments `// ...`,
/// pragmas `{ ... }` and string literals `'...'` / `"..."` are all
/// detected and skipped from the keyword-search.
/// </summary>
public static class StSplitter
{
	public record StAccessor(string Declaration, string Implementation);

	public record StChild(
		string Kind,                 // "method" | "action" | "property"
		string Name,
		string Declaration,          // signature + VAR sections, NO trailing newline
		string Implementation,       // body text, NO leading/trailing newlines
		StAccessor? Getter = null,
		StAccessor? Setter = null,
		string? Folder = null,
		string? AccessModifier = null,
		string? ReturnType = null,
		string? DataType = null);

	public record StSplitResult(
		string PouKind,              // function_block / program / function / interface / gvl / structure / enumeration / union / alias
		string? PouName,             // null for GVL
		string PouDeclaration,
		string PouImplementation,
		List<StChild> Children);

	/// <summary>
	/// Split a workspace `.st` file into its TwinCAT primitives.
	/// </summary>
	public static StSplitResult SplitSt(string sourceText)
	{
		if (string.IsNullOrWhiteSpace(sourceText))
			throw new BridgeException(400, "INVALID_ST", "Empty .st source");

		var lines = NormalizeLines(sourceText);

		// 1. Identify the outer POU header (uses the existing
		// CodeHelper logic which handles pragmas + comments above
		// the keyword).
		var header = CodeHelper.ParseCodeHeader(sourceText);
		var kind = header.Type;

		// 2. Branch on kind: composite POUs have children, simple
		// ones (gvl / DUT subtypes) are single text blobs.
		if (kind is "gvl" or "structure" or "enumeration" or "union" or "alias")
		{
			return new StSplitResult(kind, header.Name, sourceText.TrimEnd(), "", new List<StChild>());
		}

		// 3. Composite POU: find the outer END_X to split POU from
		// children. INTERFACE is special — no implementation body, and
		// method/property signatures live INSIDE the INTERFACE block
		// (not as siblings after END_INTERFACE like FB methods).
		var outerEnd = OuterEndKeyword(kind);
		var (pouStart, pouEnd, childrenStart) = FindOuterBlock(lines, outerEnd);
		var pouLines = lines.Slice(pouStart, pouEnd - pouStart);

		if (kind == "interface")
		{
			// Header = the INTERFACE line (+ any pragmas above). Children
			// = METHOD / PROPERTY / ACTION signature blocks INSIDE the
			// INTERFACE block. childrenStart from FindOuterBlock points
			// AFTER END_INTERFACE and should be empty for well-formed
			// source — we don't merge those in (no spec for sibling
			// children of an interface).
			var (interfaceDecl, interfaceChildren) = SplitInterfaceBody(pouLines);
			return new StSplitResult(kind, header.Name, interfaceDecl, "", interfaceChildren);
		}

		var (pouDecl, pouImpl) = SplitDeclImpl(pouLines, kind);
		var children = SplitChildren(lines.Slice(childrenStart, lines.Count - childrenStart));
		return new StSplitResult(kind, header.Name, pouDecl, pouImpl, children);
	}

	/// <summary>
	/// Split an INTERFACE block (lines from start up to but not
	/// including END_INTERFACE) into the header-only declaration and
	/// any METHOD/PROPERTY/ACTION signature children that live inside.
	/// </summary>
	private static (string decl, List<StChild> children) SplitInterfaceBody(IList<string> bodyLines)
	{
		// Find the INTERFACE header line — first non-trivia line.
		var ctx = new ScanContext();
		int interfaceHeaderLineIdx = -1;
		for (int i = 0; i < bodyLines.Count; i++)
		{
			ctx.Update(bodyLines[i]);
			if (ctx.InsideTrivia) continue;
			interfaceHeaderLineIdx = i;
			break;
		}
		if (interfaceHeaderLineIdx < 0)
		{
			// No header found — treat everything as decl, no children.
			return (string.Join("\n", bodyLines).TrimEnd(), new List<StChild>());
		}

		// Declaration = lines up to and including the INTERFACE header.
		var declLines = SliceLines(bodyLines, 0, interfaceHeaderLineIdx);
		var decl = string.Join("\n", declLines).TrimEnd();

		if (interfaceHeaderLineIdx + 1 >= bodyLines.Count)
		{
			return (decl, new List<StChild>());
		}

		// Children region = lines after the INTERFACE header. SplitChildren
		// handles leading blanks, captures pragmas/comments above each
		// signature as part of that child, and parses METHOD…END_METHOD
		// / PROPERTY…END_PROPERTY blocks. Interface methods have only
		// declaration (VAR sections + signature), no implementation —
		// SplitDeclImplOfChild handles that case naturally.
		var childRegion = SliceLines(bodyLines, interfaceHeaderLineIdx + 1, bodyLines.Count - 1);
		var children = SplitChildren(childRegion);
		return (decl, children);
	}

	// ─── Outer-block boundary detection ──────────────────────────────

	private static string OuterEndKeyword(string kind) => kind switch
	{
		"function_block" => "END_FUNCTION_BLOCK",
		"program"        => "END_PROGRAM",
		"function"       => "END_FUNCTION",
		"interface"      => "END_INTERFACE",
		_ => throw new BridgeException(400, "INVALID_ST", $"Unexpected composite POU kind: {kind}"),
	};

	/// <summary>
	/// Walk lines tracking comment/string/pragma context. Returns
	/// (firstLineOfOuter, lineAfterOuterEnd, lineWhereChildrenBegin).
	/// pouStart is the first non-empty non-comment line up to and
	/// INCLUDING the outer keyword (so we keep any pragmas above the
	/// FUNCTION_BLOCK line as part of the POU declaration).
	/// </summary>
	private static (int pouStart, int pouEnd, int childrenStart) FindOuterBlock(IList<string> lines, string outerEnd)
	{
		int pouStart = 0;
		int? endIdx = null;
		var ctx = new ScanContext();
		for (int i = 0; i < lines.Count; i++)
		{
			ctx.Update(lines[i]);
			if (ctx.InsideTrivia) continue;
			if (LineStartsWithKeyword(lines[i], outerEnd))
			{
				endIdx = i;
				break;
			}
		}
		if (endIdx is null)
			throw new BridgeException(400, "INVALID_ST", $"Missing {outerEnd}");

		// Skip blank lines between END_X and first child block.
		int childrenStart = endIdx.Value + 1;
		while (childrenStart < lines.Count && string.IsNullOrWhiteSpace(lines[childrenStart]))
			childrenStart++;
		return (pouStart, endIdx.Value, childrenStart);
	}

	// ─── POU decl/impl split ─────────────────────────────────────────

	/// <summary>Index of the first line that begins the body content: a GRAPHICAL-body marker —
	/// <c>NETWORK &lt;n&gt; …</c> (editable VG) or <c>%LANG …</c> (read-only CFC/SFC) — and, when
	/// <paramref name="includeFolder"/> (children), also a leading <c>%FOLDER</c> directive (it's
	/// prepended to the impl and must stay there for PeelFolderDirective). -1 for a plain textual body.
	/// Trivia (comments/strings) is skipped so a comment mentioning these can't false-match.</summary>
	private static int FirstMarkerLine(IList<string> lines, bool includeFolder)
	{
		var ctx = new ScanContext();
		for (int i = 0; i < lines.Count; i++)
		{
			ctx.Update(lines[i]);
			if (ctx.InsideTrivia) continue;
			var t = lines[i].TrimStart();
			if (t.StartsWith("%LANG", System.StringComparison.Ordinal)) return i;
			if (includeFolder && t.StartsWith("%FOLDER", System.StringComparison.Ordinal)) return i;
			if (t.StartsWith("NETWORK ", System.StringComparison.Ordinal) && t.Length > 8 && char.IsDigit(t[8]))
				return i;
		}
		return -1;
	}

	/// <summary>Split at a line index: lines before it are the declaration, the line and everything
	/// after are the implementation.</summary>
	private static (string decl, string impl) SplitAtLine(IList<string> lines, int implStart)
	{
		var d = new StringBuilder();
		for (int i = 0; i < implStart; i++) { if (i > 0) d.Append('\n'); d.Append(lines[i]); }
		var im = new StringBuilder();
		for (int i = implStart; i < lines.Count; i++) { if (i > implStart) im.Append('\n'); im.Append(lines[i]); }
		return (d.ToString().TrimEnd(), im.ToString().Trim());
	}

	private static (string decl, string impl) SplitDeclImpl(IList<string> pouLines, string kind)
	{
		if (kind == "interface")
		{
			// INTERFACE has no impl body; the entire range is declaration.
			return (string.Join("\n", pouLines).TrimEnd(), "");
		}

		// A GRAPHICAL (VG) body — NETWORK <n> <LANG> … (editable) or a %LANG placeholder (CFC/SFC) — is
		// the IMPLEMENTATION in full, INCLUDING its own VAR_TEMP block. Split BEFORE that marker so the
		// VG's VAR_TEMP is never mistaken for a POU declaration var (the END_VAR scan below would pull it
		// into the decl, writing temp vars into the POU and corrupting it on push).
		int gfx = FirstMarkerLine(pouLines, includeFolder: false);
		if (gfx >= 0) return SplitAtLine(pouLines, gfx);

		// Walk backward: declaration ends at the LAST END_VAR (the parent POU's
		// own var sections, not a child's). Anything after is implementation.
		// If no END_VAR present (e.g. FB with no VAR section), declaration is
		// just the first non-blank/non-comment line (the header) and the rest
		// is impl.
		var ctx = new ScanContext();
		int lastEndVar = -1;
		for (int i = 0; i < pouLines.Count; i++)
		{
			ctx.Update(pouLines[i]);
			if (ctx.InsideTrivia) continue;
			if (LineStartsWithKeyword(pouLines[i], "END_VAR")) lastEndVar = i;
		}
		if (lastEndVar < 0)
		{
			// Find header line — first non-trivia line.
			var ctx2 = new ScanContext();
			int headerEnd = 0;
			for (int i = 0; i < pouLines.Count; i++)
			{
				ctx2.Update(pouLines[i]);
				if (ctx2.InsideTrivia) continue;
				headerEnd = i;
				break;
			}
			var declSb = new StringBuilder();
			for (int i = 0; i <= headerEnd; i++)
			{
				if (i > 0) declSb.Append('\n');
				declSb.Append(pouLines[i]);
			}
			var implSb = new StringBuilder();
			for (int i = headerEnd + 1; i < pouLines.Count; i++)
			{
				if (i > headerEnd + 1) implSb.Append('\n');
				implSb.Append(pouLines[i]);
			}
			return (declSb.ToString().TrimEnd(), implSb.ToString().Trim());
		}

		var dSb = new StringBuilder();
		for (int i = 0; i <= lastEndVar; i++)
		{
			if (i > 0) dSb.Append('\n');
			dSb.Append(pouLines[i]);
		}
		var iSb = new StringBuilder();
		for (int i = lastEndVar + 1; i < pouLines.Count; i++)
		{
			if (i > lastEndVar + 1) iSb.Append('\n');
			iSb.Append(pouLines[i]);
		}
		return (dSb.ToString().TrimEnd(), iSb.ToString().Trim());
	}

	// ─── Child blocks (composite POU's siblings) ─────────────────────

	private static List<StChild> SplitChildren(IList<string> after)
	{
		var children = new List<StChild>();
		int i = 0;
		while (i < after.Count)
		{
			// Skip blank lines between children.
			while (i < after.Count && string.IsNullOrWhiteSpace(after[i])) i++;
			if (i >= after.Count) break;

			// Capture pragmas/comments preceding the keyword as part of the child.
			int blockStart = i;
			var ctx = new ScanContext();
			while (i < after.Count)
			{
				ctx.Update(after[i]);
				if (!ctx.InsideTrivia)
				{
					if (LineStartsWithKeyword(after[i], "METHOD")) { children.Add(ReadMethodOrAction(after, ref i, blockStart, "method", "END_METHOD")); break; }
					if (LineStartsWithKeyword(after[i], "ACTION")) { children.Add(ReadMethodOrAction(after, ref i, blockStart, "action", "END_ACTION")); break; }
					if (LineStartsWithKeyword(after[i], "PROPERTY")) { children.Add(ReadProperty(after, ref i, blockStart)); break; }
					throw new BridgeException(400, "INVALID_ST",
						$"Expected METHOD/ACTION/PROPERTY at line {i + 1}, got: {Truncate(after[i], 80)}");
				}
				i++;
			}
		}
		return children;
	}

	private static StChild ReadMethodOrAction(IList<string> lines, ref int i, int blockStart, string kind, string endKw)
	{
		int sigLine = i; // line with the keyword
		// Find matching end at column 0.
		var ctx = new ScanContext();
		// Re-walk from blockStart to sigLine to bring scan context up to
		// date (the pragmas/comments above the keyword).
		for (int k = blockStart; k <= sigLine; k++) ctx.Update(lines[k]);

		int? endLine = null;
		for (int j = sigLine + 1; j < lines.Count; j++)
		{
			ctx.Update(lines[j]);
			if (ctx.InsideTrivia) continue;
			if (LineStartsWithKeyword(lines[j], endKw)) { endLine = j; break; }
		}
		if (endLine is null)
			throw new BridgeException(400, "INVALID_ST", $"Missing {endKw} for {kind} starting at line {sigLine + 1}");

		// Block runs blockStart..endLine inclusive (covers pragmas above).
		var block = SliceLines(lines, blockStart, endLine.Value);
		i = endLine.Value + 1;

		// Parse header of the signature line for name + access mods + return type.
		var sig = lines[sigLine];
		var (name, accessModifier, returnType) = ParseMethodOrActionSignature(sig, kind);

		// Split decl from impl inside the block (excluding the sigLine's
		// own line and the trailing END_X). Re-scan to find last END_VAR.
		var inner = SliceLines(lines, blockStart, endLine.Value - 1); // includes pragmas + sig
		var (decl, impl) = SplitDeclImplOfChild(inner);
		// The body begins with an optional Volt directive block; %FOLDER is ours (the child's
		// sub-folder) and is peeled off. The graphical marker (NETWORK …, or %LANG for CFC/SFC) stays
		// in the body for graphical detection.
		var (folder, body) = PeelFolderDirective(impl);
		return new StChild(kind, name, decl, body, Folder: folder, AccessModifier: accessModifier, ReturnType: returnType);
	}

	private static StChild ReadProperty(IList<string> lines, ref int i, int blockStart)
	{
		int sigLine = i;
		var ctx = new ScanContext();
		for (int k = blockStart; k <= sigLine; k++) ctx.Update(lines[k]);

		int? endLine = null;
		var accessorBoundaries = new List<(int start, int end, string kind)>(); // GET/SET ranges within property
		int? currentAccessorStart = null;
		string? currentAccessorKind = null;
		for (int j = sigLine + 1; j < lines.Count; j++)
		{
			ctx.Update(lines[j]);
			if (ctx.InsideTrivia) continue;
			if (LineStartsWithKeyword(lines[j], "END_PROPERTY")) { endLine = j; break; }
			if (LineStartsWithKeyword(lines[j], "GET") && currentAccessorStart is null)
			{
				currentAccessorStart = j;
				currentAccessorKind = "get";
				continue;
			}
			if (LineStartsWithKeyword(lines[j], "SET") && currentAccessorStart is null)
			{
				currentAccessorStart = j;
				currentAccessorKind = "set";
				continue;
			}
			if (LineStartsWithKeyword(lines[j], "END_GET") || LineStartsWithKeyword(lines[j], "END_SET"))
			{
				if (currentAccessorStart is not null && currentAccessorKind is not null)
				{
					accessorBoundaries.Add((currentAccessorStart.Value, j, currentAccessorKind));
					currentAccessorStart = null;
					currentAccessorKind = null;
				}
			}
		}
		if (endLine is null)
			throw new BridgeException(400, "INVALID_ST", $"Missing END_PROPERTY for property starting at line {sigLine + 1}");

		i = endLine.Value + 1;

		var sig = lines[sigLine];
		var (name, accessModifier, dataType) = ParsePropertySignature(sig);

		// Declaration of the property itself: from blockStart up to (but
		// excluding) the first accessor or END_PROPERTY — whichever is first.
		int declEnd = accessorBoundaries.Count > 0 ? accessorBoundaries[0].start - 1 : endLine.Value - 1;
		var declSlice = SliceLines(lines, blockStart, declEnd);
		// A %FOLDER directive may sit just under the signature — peel it into the folder field.
		var (folder, propDecl) = PeelFolderDirective(string.Join("\n", declSlice).TrimEnd());

		StAccessor? getter = null, setter = null;
		foreach (var (gStart, gEnd, gKind) in accessorBoundaries)
		{
			var inner = SliceLines(lines, gStart, gEnd); // includes GET/END_GET keywords
			var acc = ParseAccessor(inner);
			if (gKind == "get") getter = acc;
			else setter = acc;
		}

		return new StChild(
			"property", name, propDecl, "",
			Getter: getter, Setter: setter,
			Folder: folder, AccessModifier: accessModifier, DataType: dataType);
	}

	private static StAccessor ParseAccessor(IList<string> accLines)
	{
		// First line is GET / SET, last line is END_GET / END_SET — strip both.
		// Between them: optional VAR sections + body. No signature line —
		// the GET/SET keyword IS the signature. Decl is everything up to
		// END_VAR (if any); impl is the rest.
		var inner = SliceLines(accLines, 1, accLines.Count - 2);
		var ctx = new ScanContext();
		int lastEndVar = -1;
		for (int i = 0; i < inner.Count; i++)
		{
			ctx.Update(inner[i]);
			if (ctx.InsideTrivia) continue;
			if (LineStartsWithKeyword(inner[i], "END_VAR")) lastEndVar = i;
		}
		if (lastEndVar < 0)
		{
			return new StAccessor("", string.Join("\n", inner).Trim());
		}
		var dSb = new StringBuilder();
		for (int i = 0; i <= lastEndVar; i++)
		{
			if (i > 0) dSb.Append('\n');
			dSb.Append(inner[i]);
		}
		var iSb = new StringBuilder();
		for (int i = lastEndVar + 1; i < inner.Count; i++)
		{
			if (i > lastEndVar + 1) iSb.Append('\n');
			iSb.Append(inner[i]);
		}
		return new StAccessor(dSb.ToString().TrimEnd(), iSb.ToString().Trim());
	}

	private static (string decl, string impl) SplitDeclImplOfChild(IList<string> innerLines)
	{
		// Same guard as the root POU, plus %FOLDER: a child's impl is everything from the first
		// %FOLDER/graphical marker (its VG body — incl. VAR_TEMP — and the %FOLDER directive that
		// PeelFolderDirective will strip). Real VAR sections stay in the decl before it.
		int gfx = FirstMarkerLine(innerLines, includeFolder: true);
		if (gfx >= 0) return SplitAtLine(innerLines, gfx);

		var ctx = new ScanContext();
		int lastEndVar = -1;
		// Find the signature line first — first non-trivia line.
		int sigLine = -1;
		for (int i = 0; i < innerLines.Count; i++)
		{
			ctx.Update(innerLines[i]);
			if (ctx.InsideTrivia) continue;
			if (sigLine < 0) sigLine = i;
			if (LineStartsWithKeyword(innerLines[i], "END_VAR")) lastEndVar = i;
		}
		if (lastEndVar < 0)
		{
			// No VAR sections — declaration is the signature line + any preceding
			// pragmas; implementation is everything after the signature line.
			var declSb = new StringBuilder();
			for (int i = 0; i <= sigLine; i++)
			{
				if (i > 0) declSb.Append('\n');
				declSb.Append(innerLines[i]);
			}
			var implSb = new StringBuilder();
			for (int i = sigLine + 1; i < innerLines.Count; i++)
			{
				if (i > sigLine + 1) implSb.Append('\n');
				implSb.Append(innerLines[i]);
			}
			return (declSb.ToString().TrimEnd(), implSb.ToString().Trim());
		}
		var dSb = new StringBuilder();
		for (int i = 0; i <= lastEndVar; i++)
		{
			if (i > 0) dSb.Append('\n');
			dSb.Append(innerLines[i]);
		}
		var iSb = new StringBuilder();
		for (int i = lastEndVar + 1; i < innerLines.Count; i++)
		{
			if (i > lastEndVar + 1) iSb.Append('\n');
			iSb.Append(innerLines[i]);
		}
		return (dSb.ToString().TrimEnd(), iSb.ToString().Trim());
	}

	// ─── Signature parsing helpers (METHOD/ACTION/PROPERTY headers) ──

	private static (string name, string? accessModifier, string? returnType) ParseMethodOrActionSignature(string sig, string kind)
	{
		var clean = sig.TrimEnd();
		if (kind == "method")
		{
			var m = Regex.Match(clean,
				@"^METHOD\s+((?:(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|FINAL|ABSTRACT)\s+)*)(\w+)(?:\s*:\s*(.+?))?\s*;?\s*$",
				RegexOptions.IgnoreCase);
			if (!m.Success)
				throw new BridgeException(400, "INVALID_ST", $"Cannot parse METHOD signature: {Truncate(sig, 80)}");
			var name = m.Groups[2].Value;
			var acl = CodeHelper.ExtractAcl(m.Groups[1].Value);
			var rt  = m.Groups[3].Success ? m.Groups[3].Value.Trim() : null;
			return (name, acl, rt);
		}
		// action
		var ma = Regex.Match(clean, @"^ACTION\s+(\w+)\s*$", RegexOptions.IgnoreCase);
		if (!ma.Success)
			throw new BridgeException(400, "INVALID_ST", $"Cannot parse ACTION signature: {Truncate(sig, 80)}");
		return (ma.Groups[1].Value, null, null);
	}

	private static (string name, string? accessModifier, string dataType) ParsePropertySignature(string sig)
	{
		var m = Regex.Match(sig.TrimEnd(),
			@"^PROPERTY\s+(?:(PUBLIC|PRIVATE|PROTECTED|INTERNAL)\s+)?(\w+)\s*:\s*(.+?)\s*;?\s*$",
			RegexOptions.IgnoreCase);
		if (!m.Success)
			throw new BridgeException(400, "INVALID_ST", $"Cannot parse PROPERTY signature: {Truncate(sig, 80)}");
		var name = m.Groups[2].Value;
		var acl  = m.Groups[1].Success ? m.Groups[1].Value.ToUpperInvariant() : null;
		var dt   = m.Groups[3].Value.Trim();
		return (name, acl, dt);
	}

	/// <summary>Peel a leading `%FOLDER &lt;path&gt;` Volt directive out of a child body/decl into the
	/// folder field, returning (folder, remaining-text). The signature line is clean; %FOLDER leads the
	/// body's top directive block, ahead of the graphical content (NETWORK …, or %LANG for CFC/SFC).</summary>
	private static (string? folder, string rest) PeelFolderDirective(string text)
	{
		var lines = text.Replace("\r", "").Split('\n');
		string? folder = null;
		var kept = new List<string>(lines.Length);
		foreach (var line in lines)
		{
			var t = line.Trim();
			if (folder is null && t.StartsWith("%FOLDER ", StringComparison.Ordinal))
			{
				var f = t.Substring("%FOLDER ".Length).Trim();
				folder = f.Length == 0 ? null : f;
				continue;
			}
			kept.Add(line);
		}
		return (folder, string.Join("\n", kept).Trim());
	}

	// ─── Line scanning helpers ───────────────────────────────────────

	/// <summary>
	/// Track whether the next characters are inside `(* block comment *)`
	/// since block comments span multiple lines. Single-line `// ...` and
	/// pragma `{ ... }` reset per line. String literals don't cross
	/// lines in well-formed ST.
	/// </summary>
	private sealed class ScanContext
	{
		private bool _inBlockComment;
		public bool InsideTrivia { get; private set; }

		public void Update(string line)
		{
			InsideTrivia = false;
			var trimmed = line.TrimStart();

			// If the line opens with a comment or pragma and the whole line
			// is just that, treat as trivia.
			if (_inBlockComment)
			{
				int close = line.IndexOf("*)", StringComparison.Ordinal);
				if (close < 0) { InsideTrivia = true; return; }
				_inBlockComment = false;
				// Anything after */) on the same line is real source. But for
				// our purposes — keyword-at-column-0 detection — we only care
				// about lines that start with code. If the close-comment isn't
				// at the very beginning of the line, mark as trivia.
				if (trimmed.IndexOf("*)", StringComparison.Ordinal) >= 0
					&& trimmed.IndexOf("*)", StringComparison.Ordinal) + 2 >= trimmed.Length)
					InsideTrivia = true;
				return;
			}

			if (trimmed.Length == 0) { InsideTrivia = true; return; }
			if (trimmed.StartsWith("//", StringComparison.Ordinal)) { InsideTrivia = true; return; }
			if (trimmed.StartsWith("{", StringComparison.Ordinal))
			{
				// Pragma { ... } — same-line pragmas are trivia. Multi-line
				// pragmas aren't valid IEC-61131-3, so don't track them.
				InsideTrivia = true;
				return;
			}
			if (trimmed.StartsWith("(*", StringComparison.Ordinal))
			{
				int close = trimmed.IndexOf("*)", StringComparison.Ordinal);
				if (close < 0) { _inBlockComment = true; InsideTrivia = true; return; }
				// Single-line block comment. If the comment is the whole line,
				// trivia; otherwise tail is real source.
				if (close + 2 >= trimmed.Length) { InsideTrivia = true; return; }
				InsideTrivia = false;
				return;
			}
		}
	}

	private static bool LineStartsWithKeyword(string line, string keyword)
	{
		var trimmed = line.TrimStart();
		if (!trimmed.StartsWith(keyword, StringComparison.OrdinalIgnoreCase)) return false;
		if (trimmed.Length == keyword.Length) return true;
		char after = trimmed[keyword.Length];
		// Keyword boundary — must be whitespace, comment, or end.
		return !char.IsLetterOrDigit(after) && after != '_';
	}

	private static List<string> NormalizeLines(string source)
	{
		// Split on \n, preserve original lines (no trailing \r).
		var raw = source.Replace("\r\n", "\n").Replace("\r", "\n").Split('\n');
		return new List<string>(raw);
	}

	private static List<string> SliceLines(IList<string> lines, int startInclusive, int endInclusive)
	{
		var slice = new List<string>(Math.Max(0, endInclusive - startInclusive + 1));
		for (int i = startInclusive; i <= endInclusive && i < lines.Count; i++) slice.Add(lines[i]);
		return slice;
	}

	private static string Truncate(string s, int max) => s.Length <= max ? s : s.Substring(0, max) + "...";
}

/// <summary>Lightweight Slice extension to mimic Span-ish access on List&lt;string&gt;.</summary>
internal static class StSplitterExtensions
{
	public static List<string> Slice(this List<string> src, int start, int count)
	{
		var dst = new List<string>(count);
		for (int i = 0; i < count && start + i < src.Count; i++) dst.Add(src[start + i]);
		return dst;
	}
}
