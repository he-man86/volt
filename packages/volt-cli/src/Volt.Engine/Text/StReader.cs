using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Model;
using Volt.Engine.Vocabulary;

namespace Volt.Engine.Text;

/// <summary>
/// Splits one canonical workspace source item (ST text) into the vendor-neutral primitives
/// <c>Sync/PushService</c> writes through the <c>IIdeDriver</c> contract: one outer item + N
/// children (methods / actions / properties / property accessors).
///
/// Wire-model: a push carries the item's whole ST text in the pipe's declarative `set` op
/// (<c>Wire/PushModels</c>). PushService runs Read on it to recover the tree structure it
/// needs to create/update those children. The inverse producer — the canonical text this
/// expects — is <see cref="StWriter"/>, its neighbour in this folder.
///
/// Format (canonical workspace ST-text layout — see StWriter):
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
/// State machine — at the first non-whitespace of a line (LineStartsWithKeyword
/// does TrimStart, so ANY indentation matches; it is not column-0), match outer-end keywords
/// (END_FUNCTION_BLOCK / END_PROGRAM / END_FUNCTION / END_INTERFACE)
/// and child boundaries (METHOD / ACTION / PROPERTY / END_METHOD /
/// END_ACTION / END_PROPERTY / GET / SET / END_GET / END_SET).
///
/// Deliberately string/regex-based — no token-level parser. The
/// full ST parser lives in the `volt-lsp-iec` LSP; the push path
/// only needs the structural skeleton, not statement semantics.
/// Block comments `(* ... *)`, line comments `// ...` and pragmas
/// `{ ... }` are skipped from the keyword-search (see ScanContext).
/// </summary>
public static class StReader
{
	// The model lives in Item/ — this reader and StWriter are the two halves of ONE format, and they now
	// produce and consume the SAME record rather than two records that happened to line up. See ItemContent.

	/// <summary>
	/// Split one canonical workspace source item (ST text) into the vendor-neutral primitives the
	/// push path writes through <c>IIdeDriver</c>.
	/// </summary>
	public static ItemContent Read(string sourceText)
	{
		if (string.IsNullOrWhiteSpace(sourceText))
			throw new BridgeException(BridgeErrorCodes.InvalidSt, "Empty ST source");

		var lines = NormalizeLines(sourceText);

		// 1. Identify the outer POU kind (uses the existing CodeHelper
		// logic which handles pragmas + comments above the keyword; it
		// also validates the header).
		var kind = CodeHelper.ParseCodeHeader(sourceText).Type;

		// 2. Branch on kind: composite POUs have children, simple
		// ones (gvl / dut) are single text blobs.
		if (kind is ItemKind.Kinds.Gvl or ItemKind.Kinds.Dut)
		{
			return new ItemContent(kind, sourceText.TrimEnd(), "", new List<Member>());
		}

		// 3. Composite POU: find the outer END_X to split POU from
		// children. INTERFACE is special — no implementation body, and
		// method/property signatures live INSIDE the INTERFACE block
		// (not as siblings after END_INTERFACE like FB methods).
		var outerEnd = OuterEndKeyword(kind);
		var (pouEnd, childrenStart) = FindOuterBlock(lines, outerEnd);
		var pouLines = SliceLines(lines, 0, pouEnd - 1);

		if (kind == ItemKind.Kinds.Interface)
		{
			// Header = the INTERFACE line (+ any pragmas above). Children
			// = METHOD / PROPERTY / ACTION signature blocks INSIDE the
			// INTERFACE block. childrenStart from FindOuterBlock points
			// AFTER END_INTERFACE and should be empty for well-formed
			// source — we don't merge those in (no spec for sibling
			// children of an interface).
			var (interfaceDecl, interfaceChildren) = SplitInterfaceBody(pouLines);
			return new ItemContent(kind, interfaceDecl, "", interfaceChildren);
		}

		var (pouDecl, pouImpl) = SplitDeclImpl(pouLines, kind);
		var children = SplitChildren(SliceLines(lines, childrenStart, lines.Count - 1));
		return new ItemContent(kind, pouDecl, pouImpl, children);
	}

	/// <summary>
	/// Split an INTERFACE block (lines from start up to but not
	/// including END_INTERFACE) into the header-only declaration and
	/// any METHOD/PROPERTY/ACTION signature children that live inside.
	/// </summary>
	private static (string decl, List<Member> children) SplitInterfaceBody(IList<string> bodyLines)
	{
		// Find the INTERFACE header line — first non-trivia line.
		int interfaceHeaderLineIdx = FirstCodeLine(bodyLines);
		if (interfaceHeaderLineIdx < 0)
		{
			// No header found — treat everything as decl, no children.
			return (string.Join("\n", bodyLines).TrimEnd(), new List<Member>());
		}

		// Declaration = lines up to and including the INTERFACE header.
		var declLines = SliceLines(bodyLines, 0, interfaceHeaderLineIdx);
		var decl = string.Join("\n", declLines).TrimEnd();

		if (interfaceHeaderLineIdx + 1 >= bodyLines.Count)
		{
			return (decl, new List<Member>());
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
		ItemKind.Kinds.FunctionBlock => "END_FUNCTION_BLOCK",
		ItemKind.Kinds.Program        => "END_PROGRAM",
		ItemKind.Kinds.Function       => "END_FUNCTION",
		ItemKind.Kinds.Interface      => "END_INTERFACE",
		_ => throw new BridgeException(BridgeErrorCodes.InvalidSt, $"Unexpected composite POU kind: {kind}"),
	};

	/// <summary>
	/// Walk lines tracking comment/pragma context to locate the outer block's end. Returns
	/// (index OF the outer END keyword line, index of the first child line after it — blanks
	/// skipped). The outer block always starts at line 0, so any pragmas/comments above the
	/// FUNCTION_BLOCK line stay part of the POU declaration.
	/// </summary>
	private static (int outerEndIdx, int childrenStart) FindOuterBlock(IList<string> lines, string outerEnd)
	{
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
			throw new BridgeException(BridgeErrorCodes.InvalidSt, $"Missing {outerEnd}");

		// Skip blank lines between END_X and first child block.
		int childrenStart = endIdx.Value + 1;
		while (childrenStart < lines.Count && string.IsNullOrWhiteSpace(lines[childrenStart]))
			childrenStart++;
		return (endIdx.Value, childrenStart);
	}

	// ─── POU decl/impl split ─────────────────────────────────────────

	/// <summary>Index of the first line that begins the body content: the editable graphical-body marker
	/// <c>NETWORK &lt;n&gt; …</c>, and, when <paramref name="includeFolder"/> (children), also a leading
	/// <c>%FOLDER</c> directive (it's prepended to the impl and must stay there for PeelFolderDirective).
	/// -1 for a plain textual body (which includes CFC/SFC — their `(* @volt-graphical: LANG *)` marker is a
	/// comment, i.e. trivia, so it's declaration-adjacent, not a body start).
	/// Trivia (comments/pragmas) is skipped so a comment mentioning these can't false-match.</summary>
	private static int FirstMarkerLine(IList<string> lines, bool includeFolder)
	{
		var ctx = new ScanContext();
		for (int i = 0; i < lines.Count; i++)
		{
			ctx.Update(lines[i]);
			if (ctx.InsideTrivia) continue;
			var t = lines[i].TrimStart();
			if (includeFolder && t.StartsWith("%FOLDER", StringComparison.Ordinal)) return i;
			if (t.StartsWith("NETWORK ", StringComparison.Ordinal) && t.Length > 8 && char.IsDigit(t[8]))
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
		if (kind == ItemKind.Kinds.Interface)
		{
			// INTERFACE has no impl body; the entire range is declaration.
			return (string.Join("\n", pouLines).TrimEnd(), "");
		}

		// A GRAPHICAL (network text) body — NETWORK <n> <LANG> … (editable FBD/LD; CFC/SFC are declaration-only) — is
		// the IMPLEMENTATION in full, INCLUDING its own VAR_TEMP block. Split BEFORE that marker so the
		// network text's VAR_TEMP is never mistaken for a POU declaration var (the END_VAR scan below would pull it
		// into the decl, writing temp vars into the POU and corrupting it on push).
		int gfx = FirstMarkerLine(pouLines, includeFolder: false);
		if (gfx >= 0) return SplitAtLine(pouLines, gfx);

		// Walk backward: declaration ends at the LAST END_VAR (the parent POU's
		// own var sections, not a child's). Anything after is implementation.
		// If no END_VAR present (e.g. FB with no VAR section), declaration is
		// just the first non-blank/non-comment line (the header) and the rest
		// is impl.
		int lastEndVar = LastCodeLine(pouLines, "END_VAR");
		if (lastEndVar < 0)
			// Header line = first non-trivia line; line 0 if the whole block reads as trivia.
			return SplitAtLine(pouLines, Math.Max(FirstCodeLine(pouLines), 0) + 1);
		return SplitAtLine(pouLines, lastEndVar + 1);
	}

	// ─── Child blocks (composite POU's siblings) ─────────────────────

	private static List<Member> SplitChildren(IList<string> after)
	{
		var children = new List<Member>();
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
					if (LineStartsWithKeyword(after[i], "METHOD")) { children.Add(ReadMethodOrAction(after, ref i, blockStart, ItemKind.Kinds.Method, "END_METHOD")); break; }
					if (LineStartsWithKeyword(after[i], "ACTION")) { children.Add(ReadMethodOrAction(after, ref i, blockStart, ItemKind.Kinds.Action, "END_ACTION")); break; }
					if (LineStartsWithKeyword(after[i], "PROPERTY")) { children.Add(ReadProperty(after, ref i, blockStart)); break; }
					throw new BridgeException(BridgeErrorCodes.InvalidSt,
						$"Expected METHOD/ACTION/PROPERTY at line {i + 1}, got: {Truncate(after[i], 80)}");
				}
				i++;
			}
		}
		return children;
	}

	private static Member ReadMethodOrAction(IList<string> lines, ref int i, int blockStart, string kind, string endKw)
	{
		int sigLine = i; // line with the keyword
		// Find the matching end keyword — at any indentation (see LineStartsWithKeyword), not column 0.
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
			throw new BridgeException(BridgeErrorCodes.InvalidSt, $"Missing {endKw} for {kind} starting at line {sigLine + 1}");

		// Block runs blockStart..endLine inclusive (covers pragmas above).
		var block = SliceLines(lines, blockStart, endLine.Value);
		i = endLine.Value + 1;

		// Parse header of the signature line for name + return type.
		var sig = lines[sigLine];
		var (name, returnType) = ParseMethodOrActionSignature(sig, kind);

		// Split decl from impl inside the block (excluding the sigLine's
		// own line and the trailing END_X). Re-scan to find last END_VAR.
		var inner = SliceLines(lines, blockStart, endLine.Value - 1); // includes pragmas + sig
		var (decl, impl) = SplitDeclImplOfChild(inner);
		// The body begins with an optional Volt directive block; %FOLDER is ours (the child's
		// sub-folder) and is peeled off. The graphical marker (NETWORK … for editable FBD/LD) stays
		// in the body for graphical detection.
		var (folder, body) = PeelFolderDirective(impl);
		return new Member(kind, name, decl, body, Folder: folder, ReturnType: returnType);
	}

	private static Member ReadProperty(IList<string> lines, ref int i, int blockStart)
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
			var opens = LineStartsWithKeyword(lines[j], "GET") ? "get"
					  : LineStartsWithKeyword(lines[j], "SET") ? "set" : null;
			if (opens is not null)
			{
				// A new accessor keyword while one is still OPEN closes the previous one as BARE (bodiless) —
				// `GET` immediately followed by `SET` is two empty accessors, not one accessor swallowing the
				// other. Before, the second keyword was simply ignored and that accessor was lost.
				if (currentAccessorStart is not null && currentAccessorKind is not null)
					accessorBoundaries.Add((currentAccessorStart.Value, currentAccessorStart.Value, currentAccessorKind));
				currentAccessorStart = j;
				currentAccessorKind = opens;
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
		// A BARE `GET` (or `SET`) with no `END_GET` — the bodiless form the LSP documents and a human writes by
		// hand. It used to fall off the end of this loop unclosed: `accessorBoundaries` stayed empty, the keyword
		// was swallowed into the property's DECLARATION, the accessor came back null, and the push then REMOVED
		// the engineer's getter (null code means "this property has no getter"). Silent data loss from a shape the
		// docs call valid. Close it here instead — a bare keyword IS an accessor, just an empty one.
		if (currentAccessorStart is not null && currentAccessorKind is not null)
		{
			accessorBoundaries.Add((currentAccessorStart.Value, currentAccessorStart.Value, currentAccessorKind));
			currentAccessorStart = null;
			currentAccessorKind = null;
		}
		if (endLine is null)
			throw new BridgeException(BridgeErrorCodes.InvalidSt, $"Missing END_PROPERTY for property starting at line {sigLine + 1}");

		i = endLine.Value + 1;

		var sig = lines[sigLine];
		var (name, dataType) = ParsePropertySignature(sig);

		// Declaration of the property itself: from blockStart up to (but
		// excluding) the first accessor or END_PROPERTY — whichever is first.
		int declEnd = accessorBoundaries.Count > 0 ? accessorBoundaries[0].start - 1 : endLine.Value - 1;
		var declSlice = SliceLines(lines, blockStart, declEnd);
		// A %FOLDER directive may sit just under the signature — peel it into the folder field.
		var (folder, propDecl) = PeelFolderDirective(string.Join("\n", declSlice).TrimEnd());

		Accessor? getter = null, setter = null;
		foreach (var (gStart, gEnd, gKind) in accessorBoundaries)
		{
			var inner = SliceLines(lines, gStart, gEnd); // includes GET/END_GET keywords
			var acc = ParseAccessor(inner);
			if (gKind == "get") getter = acc;
			else setter = acc;
		}

		return new Member(
			ItemKind.Kinds.Property, name, propDecl, "",
			Getter: getter, Setter: setter,
			Folder: folder, DataType: dataType);
	}

	private static Accessor ParseAccessor(IList<string> accLines)
	{
		// First line is GET / SET, last line is END_GET / END_SET — strip both.
		// Between them: optional VAR sections + body. No signature line —
		// the GET/SET keyword IS the signature. Decl is everything up to
		// END_VAR (if any); impl is the rest.
		// A BARE keyword is one line and has no END_: it is a PRESENT but empty accessor. `""`/`""` says exactly
		// that — present-with-no-body — which is the distinction the whole accessor model turns on (null would
		// mean "no such accessor" and would delete it on push).
		if (accLines.Count <= 1) return new Accessor("", "");
		var inner = SliceLines(accLines, 1, accLines.Count - 2);
		var (decl, impl) = SplitAtLine(inner, LastCodeLine(inner, "END_VAR") + 1);
		return new Accessor(decl, impl);
	}

	private static (string decl, string impl) SplitDeclImplOfChild(IList<string> innerLines)
	{
		// Same guard as the root POU, plus %FOLDER: a child's impl is everything from the first
		// %FOLDER/graphical marker (its network-text body — incl. VAR_TEMP — and the %FOLDER directive that
		// PeelFolderDirective will strip). Real VAR sections stay in the decl before it.
		int gfx = FirstMarkerLine(innerLines, includeFolder: true);
		if (gfx >= 0) return SplitAtLine(innerLines, gfx);

		int lastEndVar = LastCodeLine(innerLines, "END_VAR");
		if (lastEndVar < 0)
			// No VAR sections — declaration is the signature line (first non-trivia line) + any
			// preceding pragmas; implementation is everything after the signature line.
			return SplitAtLine(innerLines, FirstCodeLine(innerLines) + 1);
		return SplitAtLine(innerLines, lastEndVar + 1);
	}

	// ─── Signature parsing helpers (METHOD/ACTION/PROPERTY headers) ──

	/// <summary>Name + (methods only) return type off the signature line. The access-modifier group is
	/// matched but not captured into a field — nothing on the write path tells the IDE a member's
	/// visibility on create, so an extracted modifier would have no reader.</summary>
	private static (string name, string? returnType) ParseMethodOrActionSignature(string sig, string kind)
	{
		var clean = sig.TrimEnd();
		if (kind == ItemKind.Kinds.Method)
		{
			var m = Regex.Match(clean,
				@"^METHOD\s+(?:(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|FINAL|ABSTRACT)\s+)*(\w+)(?:\s*:\s*(.+?))?\s*;?\s*$",
				RegexOptions.IgnoreCase);
			if (!m.Success)
				throw new BridgeException(BridgeErrorCodes.InvalidSt, $"Cannot parse METHOD signature: {Truncate(sig, 80)}");
			var name = m.Groups[1].Value;
			var rt  = m.Groups[2].Success ? m.Groups[2].Value.Trim() : null;
			return (name, rt);
		}
		// action
		var ma = Regex.Match(clean, @"^ACTION\s+(\w+)\s*$", RegexOptions.IgnoreCase);
		if (!ma.Success)
			throw new BridgeException(BridgeErrorCodes.InvalidSt, $"Cannot parse ACTION signature: {Truncate(sig, 80)}");
		return (ma.Groups[1].Value, null);
	}

	private static (string name, string dataType) ParsePropertySignature(string sig)
	{
		var m = Regex.Match(sig.TrimEnd(),
			@"^PROPERTY\s+(?:(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL)\s+)?(\w+)\s*:\s*(.+?)\s*;?\s*$",
			RegexOptions.IgnoreCase);
		if (!m.Success)
			throw new BridgeException(BridgeErrorCodes.InvalidSt, $"Cannot parse PROPERTY signature: {Truncate(sig, 80)}");
		return (m.Groups[1].Value, m.Groups[2].Value.Trim());
	}

	/// <summary>Peel a leading `%FOLDER &lt;path&gt;` Volt directive out of a child body/decl into the
	/// folder field, returning (folder, remaining-text). The signature line is clean; %FOLDER leads the
	/// body's top directive block, ahead of the graphical content (the NETWORK marker for editable FBD/LD).</summary>
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
				// Anything after *) on the same line is real source. But for
				// our purposes — leading-keyword detection — we only care
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

	/// <summary>Index of the first line that is real code (not blank / comment / pragma), or -1 if the
	/// whole range is trivia.</summary>
	private static int FirstCodeLine(IList<string> lines)
	{
		var ctx = new ScanContext();
		for (int i = 0; i < lines.Count; i++)
		{
			ctx.Update(lines[i]);
			if (!ctx.InsideTrivia) return i;
		}
		return -1;
	}

	/// <summary>Index of the LAST code line starting with <paramref name="keyword"/>, or -1 if there is
	/// none. Trivia is skipped so a commented-out keyword can't match.</summary>
	private static int LastCodeLine(IList<string> lines, string keyword)
	{
		var ctx = new ScanContext();
		int last = -1;
		for (int i = 0; i < lines.Count; i++)
		{
			ctx.Update(lines[i]);
			if (ctx.InsideTrivia) continue;
			if (LineStartsWithKeyword(lines[i], keyword)) last = i;
		}
		return last;
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

	/// <summary>The lines in [startInclusive, endInclusive] — the ONE slicing convention in this file.
	/// An empty or reversed range yields an empty list.</summary>
	private static List<string> SliceLines(IList<string> lines, int startInclusive, int endInclusive)
	{
		var slice = new List<string>(Math.Max(0, endInclusive - startInclusive + 1));
		for (int i = startInclusive; i <= endInclusive && i < lines.Count; i++) slice.Add(lines[i]);
		return slice;
	}

	private static string Truncate(string s, int max) => s.Length <= max ? s : s.Substring(0, max) + "...";
}
