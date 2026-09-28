using System;
using System.Linq;
using System.Collections.Generic;
using System.Text;

using Volt.Contracts;
using Volt.Engine;
using Volt.Engine.Library;
using Volt.Engine.Format.Body;
using Volt.Engine.Item;

namespace Volt.Engine.Format.St;

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
///   IMPLEMENTATION ST
///   {impl body}
///
///   END_FUNCTION_BLOCK
///
///   {pragmas} METHOD … IMPLEMENTATION LD … END_METHOD
///   ACTION … IMPLEMENTATION ST … END_ACTION
///   PROPERTY … {GET … IMPLEMENTATION ST … END_GET} {SET … END_SET} END_PROPERTY
///
/// Same format for PROGRAM (END_PROGRAM), FUNCTION (END_FUNCTION).
/// INTERFACE (END_INTERFACE) is special: its method/property/action
/// signatures live INSIDE the INTERFACE…END_INTERFACE block (no
/// implementation bodies — interface signatures only), not as siblings
/// after END_INTERFACE. SplitInterfaceBody pulls them out as children.
/// An interface and its members carry NO boundary line: signatures have no
/// implementation, so there is no boundary to record.
/// GVL / DUT are simple single-block forms with no child structure.
///
/// TWO THINGS ARE READ FROM THE TEXT AND NOTHING ELSE IS:
///   1. the STRUCTURE — where each member block opens and closes;
///   2. the BOUNDARY and the body's LANGUAGE — and those are not read, they
///      are STATED, by `IMPLEMENTATION ST|LD|FBD` (see ImplementationMarker).
/// The KIND comes from the wire name's extension, never the header
/// (see the `expectedKind` parameter of Read).
///
/// Structure scan — at the first non-whitespace of a line (LineStartsWithKeyword
/// does TrimStart, so ANY indentation matches; it is not column-0), match outer-end keywords
/// (END_FUNCTION_BLOCK / END_PROGRAM / END_FUNCTION / END_INTERFACE)
/// and child boundaries (METHOD / ACTION / PROPERTY / END_METHOD /
/// END_ACTION / END_PROPERTY / GET / SET / END_GET / END_SET).
///
/// Deliberately string-based — no token-level parser. The
/// full ST parser lives in the `volt-lsp-iec` LSP; the push path
/// only needs the structural skeleton, not statement semantics.
/// Block comments `(* ... *)`, line comments `// ...` and pragmas
/// `{ ... }` are skipped from the keyword-search (see ScanContext).
/// </summary>
public static class StReader
{
	// The model lives in Item/ — this reader and StWriter are the two halves of ONE format, and they now
	// produce and consume the SAME record rather than two records that happened to line up. See ItemContent.

	/// <summary>Refuse a text whose header declares <paramref name="declared"/> under a wire name whose extension says
	/// <paramref name="expectedKind"/> — THE refusal <see cref="Read"/> makes, for a caller that must read the text
	/// before it compares (the push's update arm, whose re-type guard first names what the live object IS). A null
	/// <paramref name="expectedKind"/> is no wire name and checks nothing.</summary>
	public static void RequireKind(string declared, string? expectedKind)
	{
		if (expectedKind != null && !string.Equals(declared, expectedKind, System.StringComparison.Ordinal))
			throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"the item's extension says '{expectedKind}' and its text declares a '{declared}'. The extension is " +
				"the kind — rename the file to match the code, or change the code to match the file. (Writing it " +
				"anyway would silently replace the item with one of the other kind, under a different name.)");
	}

	/// <summary>
	/// Split one canonical workspace source item (ST text) into the vendor-neutral primitives the
	/// push path writes through <c>IIdeDriver</c>.
	/// </summary>
	/// <param name="expectedKind">The kind the WIRE NAME says this item is (<see cref="ItemKind.KindForWireName"/>).
	/// When given it DECIDES, and a header that disagrees is refused rather than followed — see the class remark.
	/// Null only where no wire name exists (the format's own round-trip, and tests).</param>
	/// <param name="name">The item's bare name, for the refusals that name the POU's own body. A member is named by its
	/// signature; the POU is named by its FILE, which this text does not carry (<c>CodeHelper.ParseCodeHeader</c>
	/// reads no name, on purpose). Null where there is none, and the refusal then names the kind.</param>
	public static ItemContent Read(string sourceText, string? expectedKind = null, string? name = null)
	{
		if (string.IsNullOrWhiteSpace(sourceText))
			throw new BridgeException(BridgeErrorCodes.InvalidSt, "Empty ST source");

		var lines = NormalizeLines(sourceText);

		// 1. The kind. THE EXTENSION IS THE KIND — it is on the wire name and `KindForWireName` reads it off,
		// so the header is CHECKED against it rather than consulted for it. Taking the kind from the text let a
		// push rename the object: `KindTest.fb` whose text said `PROGRAM` was accepted and produced
		// `KindTest.prg` (measured on live SP21, 2026-09-17), and since the wire is keyed by the FULL name the
		// next `ifVersion` then named an item that no longer existed.
		var declared = CodeHelper.ParseCodeHeader(sourceText);
		RequireKind(declared, expectedKind);
		var kind = expectedKind ?? declared;
		var what = name is null ? $"this {kind}" : $"'{name}'";

		// 2. Branch on kind: composite POUs have children, simple
		// ones (gvl / dut) are single text blobs.
		if (kind is ItemKind.Kinds.Gvl or ItemKind.Kinds.Dut)
		{
			RefuseReservedNames(lines);
			var simple = new ItemContent(kind, sourceText.TrimEnd('\n'), "", new List<Member>());
			RefuseKeywordInDeclarations(simple, what);
			return simple;
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
			RefuseReservedNames(lines);
			var itf = new ItemContent(kind, interfaceDecl, "", interfaceChildren);
			RefuseKeywordInDeclarations(itf, what);
			return itf;
		}

		var (pouDecl, pouImpl) = SplitDeclImpl(pouLines, what);
		var children = SplitChildren(SliceLines(lines, childrenStart, lines.Count - 1), marked: true);
		RefuseReservedNames(lines);
		var pou = new ItemContent(kind, pouDecl, pouImpl, children);
		RefuseKeywordInDeclarations(pou, what);
		return pou;
	}

	/// <summary>The index of the first line that OPENS a member block, or -1 when there is none. Trivia-aware,
	/// so a `METHOD` inside a comment does not count.</summary>
	private static int FirstMemberLine(IList<string> lines, int from)
	{
		var ctx = new ScanContext();
		for (int i = 0; i < lines.Count; i++)
		{
			ctx.Update(lines[i]);
			if (i < from || ctx.InsideTrivia) continue;
			if (LineStartsWithKeyword(ctx.Code, "METHOD") ||
				LineStartsWithKeyword(ctx.Code, "ACTION") ||
				LineStartsWithKeyword(ctx.Code, "PROPERTY")) return i;
		}
		return -1;
	}

	/// <summary>Walk back from a member's keyword line over the comments and pragmas written ABOVE it, and
	/// answer where that member's block really begins. Those lines document the member, not the declaration —
	/// `SplitChildren` attaches them to the child, so the declaration must not swallow them first.</summary>
	private static int BackOverMemberTrivia(IList<string> lines, int keywordLine)
	{
		// The trivia map is built in ONE FORWARD PASS, because a per-line probe cannot see block comments. It used
		// to start a fresh ScanContext on each line walked back, so ` *)` — the TAIL of a comment opened twenty
		// lines earlier — read as code and stopped the walk dead. `IModuleBase` then kept its 23-line usage
		// example in the INTERFACE's declaration instead of on the method it documents, and the interface came
		// back from a round trip with a blank line inserted above that method.
		// A blank line ends the walk — but only a blank line that is really a SEPARATOR. An empty line INSIDE a
		// block comment is part of that comment, and treating it as a separator stopped the walk in the middle of
		// `IModuleBase`'s usage example, handing SplitChildren a region that opens on ` *)` and refusing the file
		// outright ("Expected METHOD/ACTION/PROPERTY").
		var trivia = new bool[lines.Count];
		var separator = new bool[lines.Count];
		var inBlockComment = false;
		for (int i = 0; i < lines.Count; i++)
		{
			var openBefore = inBlockComment;
			var code = CodeHelper.CodeOn(lines[i], ref inBlockComment);
			trivia[i] = code.Trim().Length == 0;
			separator[i] = !openBefore && string.IsNullOrWhiteSpace(lines[i]);
		}

		int start = keywordLine;
		while (start - 1 >= 0)
		{
			if (separator[start - 1]) break;   // a blank line separates the member from the declaration
			if (!trivia[start - 1]) break;     // real code: the declaration ends here
			start--;                           // a comment or pragma: it documents the member, not the header
		}
		return start;
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

		// THE DECLARATION IS EVERYTHING BEFORE THE FIRST MEMBER — it is not parsed, and Volt has no business
		// knowing what is in it.
		//
		// This used to end the declaration at the INTERFACE header LINE, which is right only while the whole
		// header fits on one line. CODESYS stores it wrapped — `EXTENDS IModuleStartable` on its own line — and
		// that line then landed in the child region, where `SplitChildren` refused it with "Expected
		// METHOD/ACTION/PROPERTY": Volt PULLED such an interface and would not take its own text back, so the POU
		// could be pulled and never pushed. Found by sweeping a real customer project.
		//
		// The first fix taught this to absorb `EXTENDS`/`IMPLEMENTS` by name, and that was the wrong shape: a
		// DECLARATION is handed to the IDE VERBATIM (it is written straight to the declaration aspect), so
		// nothing here should have to recognise its contents. Any header this reader has not heard of — another
		// continuation keyword, an attribute, a pragma — would have broken it again in exactly the same way.
		//
		// Bounding it by where the MEMBERS start needs no vocabulary at all. The member's own leading trivia
		// belongs to the MEMBER (`SplitChildren` attaches the comments and pragmas above a signature to it), so
		// the boundary walks back over that trivia to the blank line or code that precedes it.
		int firstMember = FirstMemberLine(bodyLines, interfaceHeaderLineIdx + 1);
		int declEnd = firstMember < 0 ? bodyLines.Count - 1 : BackOverMemberTrivia(bodyLines, firstMember) - 1;

		var declLines = SliceLines(bodyLines, 0, declEnd);
		var decl = string.Join("\n", declLines).TrimEnd();

		if (declEnd + 1 >= bodyLines.Count)
		{
			return (decl, new List<Member>());
		}
		interfaceHeaderLineIdx = declEnd;

		// Children region = lines after the INTERFACE header. SplitChildren
		// handles leading blanks, captures pragmas/comments above each
		// signature as part of that child, and parses METHOD…END_METHOD
		// / PROPERTY…END_PROPERTY blocks. Interface methods have only
		// declaration (VAR sections + signature), no implementation —
		// ReadMethodOrAction keeps the whole block as declaration (marked: false).
		var childRegion = SliceLines(bodyLines, interfaceHeaderLineIdx + 1, bodyLines.Count - 1);
		// THE OWNER DECIDES THE MEMBER KIND, here exactly as it does on the IDE side
		// (CodesysDriver.MemberKind). `SplitChildren` is shared with function blocks and can only see
		// `METHOD`/`PROPERTY`, so without this an interface read from TEXT reported `method` while the same
		// interface read from the IDE reported `interface_method` - and StWriter, knowing only the latter,
		// threw "No END keyword for POU child kind 'interface_method'". The whole interface then materialized
		// as UNREADABLE: created in the project, accepted by push, and absent from /refs.
		var children = SplitChildren(childRegion, marked: false).Select(InterfaceMember).ToList();
		return (decl, children);
	}

	/// <summary>The interface-scoped spelling of a member kind. An interface method is still
	/// `METHOD ... END_METHOD` in text - only the WIRE kind differs, and it differs because TwinCAT
	/// distinguishes them too.</summary>
	private static Member InterfaceMember(Member m) => m.Kind switch
	{
		ItemKind.Kinds.Method => m with { Kind = ItemKind.Kinds.InterfaceMethod },
		ItemKind.Kinds.Property => m with { Kind = ItemKind.Kinds.InterfaceProperty },
		_ => m,
	};

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
			if (LineStartsWithKeyword(ctx.Code, outerEnd))
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

	/// <summary>Split at the boundary line: everything above it is the declaration, everything below the
	/// implementation, and the line itself belongs to neither. No trivia is classified and no keyword is looked for
	/// in the declaration — that is the whole point of stating it (see <see cref="ImplementationMarker"/>).
	///
	/// <para>The line is returned too, because it also states the body's LANGUAGE: the caller checks the body
	/// against it and joins the two (<see cref="Body"/>) once any <c>%FOLDER</c> directive is peeled off the text
	/// under it.</para></summary>
	private static (string decl, string impl, string line) SplitAtBoundary(IList<string> lines, string what)
	{
		int at = ImplementationMarker.IndexIn(lines);
		if (at < 0) throw Unmarked(what);
		// A FILE FROM BEFORE THE KEYWORD. The retired comment is no boundary, so such a file has none and is refused
		// above — except the old shape of a body Volt cannot write: the comment, THEN the marker line, which finds its
		// boundary at the marker and would push the comment into the IDE as the tail of the declaration. That shape,
		// and only that one, is the comment standing AS a boundary. Anywhere else it is an engineer's comment in a
		// current file, and refusing it sent them to `volt pull`, which writes the same IDE text straight back.
		if (ImplementationMarker.IsMarkerLine(lines[at]))
		{
			int above = at - 1;
			while (above >= 0 && string.IsNullOrWhiteSpace(lines[above])) above--;
			if (above >= 0 && ImplementationMarker.IsRetired(lines[above])) throw Unmarked(what);
		}
		var decl = string.Join("\n", SliceLines(lines, 0, at - 1));
		var impl = string.Join("\n", SliceLines(lines, at + 1, lines.Count - 1));
		return (decl.TrimEnd('\n'), impl.TrimEnd('\n'), lines[at]);
	}

	/// <summary>A POU's own declaration and body. THE LINE DECIDES, and nothing else does; a file without one is
	/// REFUSED, never guessed at.
	///
	/// <para>What used to be here: the last <c>END_VAR</c>, or the end of a wrapped header, and then a rule about which
	/// trailing comments belonged to which side. That price came due three times, and every time invisibly: the
	/// halves are re-joined on read, so a file split in the wrong place round-trips byte for byte while the project
	/// holds it broken. A GRAPHICAL body carries its own VAR_TEMP blocks, which an END_VAR scan pulled into the POU's
	/// declaration; with the boundary stated, network text is its own line and what follows it.</para></summary>
	private static (string decl, string impl) SplitDeclImpl(IList<string> pouLines, string what)
	{
		var (decl, impl, line) = SplitAtBoundary(pouLines, what);
		return (decl, Body(line, impl, what));
	}

	/// <summary>The body a boundary line and the text under it make — checked against what the line STATES, which
	/// is the one signal for how the body is read. Every refusal names <paramref name="what"/> and the line as
	/// written, and each is raised before anything is written:
	/// <list type="bullet">
	/// <item>a line with no language, or one no body can state (<c>IMPLEMENTATION CFC</c>) — never guessed;</item>
	/// <item>a body whose text contradicts its language: network text under <c>ST</c>, or text under <c>LD</c>/<c>FBD</c>
	/// that is no network — never re-read as the other;</item>
	/// <item>a second keyword line outside a comment — neither the boundary nor ST the IDE can compile, and dropping
	/// it would guess at what the engineer meant;</item>
	/// <item>code under, or after, a <see cref="BodyMarker"/> line — that body has no text form, the drivers write
	/// nothing for it, so the code would be dropped without a word and overwritten by the next pull.</item>
	/// </list></summary>
	private static string Body(string line, string code, string what)
	{
		if (ImplementationMarker.IsMarkerLine(line))
		{
			var marker = line.Trim();
			var close = marker.IndexOf("*)", StringComparison.Ordinal);
			if (close < 0 || close + 2 < marker.Length || code.Trim().Length > 0)
				throw new BridgeException(BridgeErrorCodes.InvalidSt,
					$"{what} holds code under or after its marker line '{(close < 0 ? marker : marker.Substring(0, close + 2))}'. " +
					"That body has no text form Volt can write, so the code has nowhere to go and would be dropped. " +
					"Remove it, and edit the body in the IDE.");
			return ImplementationMarker.Join(marker, "");
		}

		var stated = line.Trim();
		var word = ImplementationMarker.Stated(line)!;
		if (word.Length == 0)
			throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"{what} states '{stated}' with no language — a body states its language on that line: " +
				$"{ImplementationMarker.For(Languages.St)}, {ImplementationMarker.For(Languages.Ld)} or " +
				$"{ImplementationMarker.For(Languages.Fbd)}. ({ImplementationMarker.Keyword} is reserved, so if the line " +
				"names something, rename it.)");
		var lang = ImplementationMarker.LanguageOf(line)
			?? throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"{what} states '{stated}', and '{word}' is no language a body can state — ST, LD or FBD. " +
				"A body in another language is edited in the IDE.");

		// A marker ALONE under a stated language contradicts it: the marker says the body has no text form, the line
		// says it is ST (or LD, FBD). Read on, the body would BE the marker in memory (BodyMarker.Is), and the push
		// would skip it as a no-op under a line claiming a language Volt reads.
		if (BodyMarker.Is(code))
			throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"{what} states '{stated}' over the marker line '{code.Trim()}'. The marker states a body with no text " +
				$"form and stands alone where the {ImplementationMarker.Keyword} line would: keep one or the other.");

		if (SecondStatedLine(code) is { } second)
			throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"{what} holds a second '{second.Trim()}' line in its body — a body has ONE {ImplementationMarker.Keyword} " +
				"line, the one that opens it. Remove the other.");

		var network = Volt.Engine.Format.Network.NetworkText.OpensNetwork(code);
		if (lang == Languages.St && network)
			throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"{what} states '{stated}', and its body is network text. State the language it is written in " +
				$"({ImplementationMarker.For(Languages.Ld)} or {ImplementationMarker.For(Languages.Fbd)}), or write the body as ST.");
		if (lang != Languages.St && !network && StTrivia.Code(code.Split('\n')).Any(l => l.Trim().Length > 0))
			throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"{what} states '{stated}', and its body is not network text — a network-text body is a sequence of " +
				$"NETWORK … END_NETWORK blocks. State {ImplementationMarker.For(Languages.St)} for an ST body.");
		return ImplementationMarker.Join(line, code);
	}

	/// <summary>A line of the keyword's shape in a body's text, outside every comment, or null.</summary>
	private static string? SecondStatedLine(string code)
	{
		var lines = code.Split('\n');
		var open = StTrivia.OpenAtStart(lines);
		for (int i = 0; i < lines.Length; i++)
			if (!open[i] && ImplementationMarker.Stated(lines[i]) is not null) return lines[i];
		return null;
	}

	/// <summary><c>IMPLEMENTATION</c> is RESERVED: no name in a workspace file may be spelled like it, in any case —
	/// a variable at any scope, a member, the POU, an enum value, a struct member. A name spelled like the boundary line
	/// could stand at the start of a line and read as one, so it is refused by name, never renamed or tolerated.
	///
	/// <para>Checked over the whole text's CODE — comments, strings and pragmas blanked (<see cref="StTrivia"/>) — and
	/// every occurrence, not only a declaration: IEC has no such keyword, so any code use of the word is a name, and
	/// a check hung on one declaration path lets every other position through. The lines of the keyword's own shape are
	/// skipped HERE because each has one owner that refuses it with a better message: the boundary is consumed, a second
	/// one in a body is refused by <see cref="Body"/>, and one anywhere else lands in a declaration and is refused by
	/// <see cref="RefuseKeywordInDeclarations"/> — which is what catches a name standing alone on its line.</para></summary>
	private static void RefuseReservedNames(IList<string> lines)
	{
		var open = StTrivia.OpenAtStart(lines);
		var code = StTrivia.Code(lines);
		for (int i = 0; i < lines.Count; i++)
		{
			if (!open[i] && ImplementationMarker.Stated(lines[i]) is not null) continue;
			var m = ReservedWord.Match(code[i]);
			if (m.Success)
				throw new BridgeException(BridgeErrorCodes.InvalidSt,
					$"'{m.Value}' (line {i + 1}) is reserved: {ImplementationMarker.Keyword} is the line that states where " +
					"a body starts and what language it is in, so nothing in a workspace may be named it. Rename it.");
		}
	}

	/// <summary>A line of the keyword's shape that ended up in a DECLARATION is no boundary, and a declaration is
	/// written into the IDE verbatim — so it would carry the line push is meant to strip. It gets there two ways, and
	/// both are refused by name: a kind that has no implementation (GVL, DUT, an interface and its members) has no
	/// boundary to consume it, and a name spelled <c>IMPLEMENTATION</c> alone on its line (the last enum value, a
	/// variable in a wrapped declaration) has the keyword's shape and slipped past the reserved-name scan on it.</summary>
	private static void RefuseKeywordInDeclarations(ItemContent item, string what)
	{
		Refuse(what, item.Declaration);
		foreach (var m in item.Members)
		{
			var member = $"{m.Kind} '{m.Name}'";
			Refuse(member, m.Declaration);
			Refuse($"{member} GET", m.Getter?.Declaration);
			Refuse($"{member} SET", m.Setter?.Declaration);
		}

		static void Refuse(string where, string? declaration)
		{
			if (string.IsNullOrEmpty(declaration)) return;
			var lines = declaration!.Split('\n');
			var open = StTrivia.OpenAtStart(lines);
			for (int i = 0; i < lines.Length; i++)
				if (!open[i] && ImplementationMarker.Stated(lines[i]) is not null)
					throw new BridgeException(BridgeErrorCodes.InvalidSt,
						$"{where} holds '{lines[i].Trim()}' in its declaration. {ImplementationMarker.Keyword} is reserved: " +
						"it is the line that opens a body and states its language, so it stands only where a body starts, " +
						"and nothing may be named it. Remove the line, or rename what it names.");
		}
	}

	private static readonly System.Text.RegularExpressions.Regex ReservedWord =
		new(@"(?<![A-Za-z0-9_])" + ImplementationMarker.Keyword + "(?![A-Za-z0-9_])",
			System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant);

	// ─── Child blocks (composite POU's siblings) ─────────────────────

	private static List<Member> SplitChildren(IList<string> after, bool marked)
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
					if (LineStartsWithKeyword(ctx.Code, "METHOD")) { children.Add(ReadMethodOrAction(after, ref i, blockStart, ItemKind.Kinds.Method, "END_METHOD", marked)); break; }
					if (LineStartsWithKeyword(ctx.Code, "ACTION")) { children.Add(ReadMethodOrAction(after, ref i, blockStart, ItemKind.Kinds.Action, "END_ACTION", marked)); break; }
					if (LineStartsWithKeyword(ctx.Code, "PROPERTY")) { children.Add(ReadProperty(after, ref i, blockStart, marked)); break; }
					throw new BridgeException(BridgeErrorCodes.InvalidSt,
						$"Expected METHOD/ACTION/PROPERTY at line {i + 1}, got: {Truncate(after[i], 80)}");
				}
				i++;
			}
		}
		return children;
	}

	private static Member ReadMethodOrAction(IList<string> lines, ref int i, int blockStart, string kind, string endKw, bool marked)
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
			if (LineStartsWithKeyword(ctx.Code, endKw)) { endLine = j; break; }
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
		var what = $"{kind} '{name}'";
		if (!marked)
		{
			// An INTERFACE's members are SIGNATURES (the OWNER decides, which is why `marked` is passed down: an
			// interface's members arrive as kind `method` and are re-kinded afterwards). No boundary line, and the
			// whole block is declaration (see ImplementationMarker.AppliesTo).
			return new Member(kind, name, string.Join("\n", inner).TrimEnd('\n'), "", ReturnType: returnType);
		}
		var (decl, impl, line) = SplitAtBoundary(inner, what);
		// The text under the boundary begins with an optional Volt directive block; %FOLDER is ours (the child's
		// sub-folder) and is peeled off before the body is checked against the language its line states.
		var (folder, code) = PeelFolderDirective(impl);
		return new Member(kind, name, decl, Body(line, code, what), Folder: folder, ReturnType: returnType);
	}

	private static Member ReadProperty(IList<string> lines, ref int i, int blockStart, bool marked)
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
			if (LineStartsWithKeyword(ctx.Code, "END_PROPERTY")) { endLine = j; break; }
			var opens = LineStartsWithKeyword(ctx.Code, "GET") ? "get"
					  : LineStartsWithKeyword(ctx.Code, "SET") ? "set" : null;
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
			if (LineStartsWithKeyword(ctx.Code, "END_GET") || LineStartsWithKeyword(ctx.Code, "END_SET"))
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
			var acc = ParseAccessor(inner, marked, $"property '{name}' {gKind.ToUpperInvariant()}");
			if (gKind == "get") getter = acc;
			else setter = acc;
		}

		return new Member(
			ItemKind.Kinds.Property, name, propDecl, "",
			Getter: getter, Setter: setter,
			Folder: folder, DataType: dataType);
	}

	private static Accessor ParseAccessor(IList<string> accLines, bool marked, string what)
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
		// An INTERFACE's accessors are signatures — no body, so no marker and nothing to split.
		if (!marked) return new Accessor(string.Join("\n", inner).TrimEnd('\n'), "");
		var (decl, impl, line) = SplitAtBoundary(inner, what);
		return new Accessor(decl, Body(line, impl, what));
	}

	/// <summary>A file that does not say where its declaration ends. Refused, never guessed — see
	/// <see cref="ImplementationMarker"/> for the three bugs the guessing cost.</summary>
	private static BridgeException Unmarked(string what) => new BridgeException(BridgeErrorCodes.InvalidSt,
		$"{what} has no '{ImplementationMarker.Keyword} <ST|LD|FBD>' line — the text does not say where its " +
		"declaration ends or what language its body is in. Run `volt pull` once to rewrite the workspace in the " +
		"current format.");

	// ─── Signature parsing (METHOD/ACTION/PROPERTY headers) ─────────

	/// <summary>The access/abstractness keywords a member signature may carry between its keyword and its name.
	///
	/// <para>Spelled ONCE. It used to be written out in two regexes, and they had already drifted: the property
	/// pattern allowed <c>?</c> over four keywords where the method pattern allowed <c>*</c> over six, so
	/// `PROPERTY PUBLIC ABSTRACT Ready : INT` — ordinary CODESYS, and a file Volt itself had written — threw
	/// <c>InvalidSt</c> from inside the write, mid-batch. A set cannot drift from itself.</para></summary>
	private static readonly HashSet<string> Modifiers =
		new HashSet<string>(StringComparer.OrdinalIgnoreCase)
		{ "PUBLIC", "PRIVATE", "PROTECTED", "INTERNAL", "FINAL", "ABSTRACT" };

	/// <summary>Read a member's NAME and (where it has one) its TYPE off its signature line.
	///
	/// <para><b>This is the only text in a declaration Volt still reads, and it cannot be removed the way the
	/// others were.</b> The kind comes from the wire name's extension and the decl/impl boundary is stated by
	/// <see cref="ImplementationMarker"/> — both because a FILE carries them. A method is not a file: it lives
	/// inside its POU's, exactly as a method lives inside its class in every other language, so its signature
	/// line is the only place its name exists. There is no second source for it to disagree with, which is what
	/// made the kind dangerous and makes this safe.</para>
	///
	/// <para><b>It was two regexes and is now neither</b>, for two reasons that both bite in production:
	/// <c>\w</c> is UNICODE in .NET, so `METHOD Ünit` matched and `Ünit` became a member name on the wire that
	/// CODESYS will not create; and <c>RegexOptions.IgnoreCase</c> without <c>CultureInvariant</c> folds `I`
	/// against the CURRENT culture, so under tr-TR the keyword `ACTION` stops matching itself. Neither hazard
	/// has a spelling in a pattern that is still readable. Four words and a colon do not need one.</para></summary>
	/// <param name="keyword">The keyword the line must open with — the caller already knows it from the block it
	/// is standing in, so this CHECKS rather than discovers, the same way <c>Read</c> checks the header kind.</param>
	private static (string name, string? type) ParseSignature(string sig, string keyword)
	{
		// COMMENTS OFF FIRST. An engineer documents a member on its signature line — `METHOD INTERNAL
		// _mStrConcatA //Concats string to sContent` — and CODESYS stores it exactly there. The old patterns
		// anchored at `$`, so anything trailing failed the match outright: Volt PULLED such an FB and then refused
		// its own text, which means the POU could be pulled and never pushed back. Found by sweeping a real
		// customer project; 207 of pro2193's method signatures carry one.
		//
		// `CodeHelper.WithoutComments` is the one definition of "the code on this line" — re-implementing the
		// strip here is how the two would drift.
		var clean = CodeHelper.WithoutComments(sig).Trim();

		// A TRAILING SEMICOLON is real, not slop: `METHOD PRIVATE CheckValidRefs : BOOL;` and
		// `PROPERTY Results : ARRAY[0..GVL_Constants.MaxRejectReasonsCamera] OF BOOL;` are both pro2193, as
		// CODESYS wrote them. It is punctuation, not part of the type.
		if (clean.EndsWith(";", StringComparison.Ordinal))
			clean = clean.Substring(0, clean.Length - 1).TrimEnd();

		// The type is everything after the FIRST colon, taken WHOLE and unexamined: no IEC type name contains a
		// colon, and `ARRAY[0..N] OF BOOL` must arrive intact. Volt does not need to understand it — the IDE does,
		// and it is the IDE that refuses a type that is wrong.
		string? type = null;
		var colon = clean.IndexOf(':');
		if (colon >= 0)
		{
			type = clean.Substring(colon + 1).Trim();
			clean = clean.Substring(0, colon);
			if (type.Length == 0) throw BadSignature(sig, keyword, "nothing follows the ':'");
		}

		// KEYWORD [modifier …] NAME — the name is last because everything between is a modifier, and a word
		// there that is NOT one is a malformed line, not a second name to pick from.
		var words = clean.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
		if (words.Length < 2 || !string.Equals(words[0], keyword, StringComparison.OrdinalIgnoreCase))
			throw BadSignature(sig, keyword, $"it does not begin with '{keyword}' and a name");
		for (var i = 1; i < words.Length - 1; i++)
			if (!Modifiers.Contains(words[i]))
				throw BadSignature(sig, keyword, $"'{words[i]}' is not an access modifier");

		var name = words[words.Length - 1];
		if (!IsIdentifier(name))
			throw BadSignature(sig, keyword, $"'{Truncate(name, 40)}' is not a valid IEC identifier");
		return (name, type);
	}

	/// <summary>An IEC 61131-3 identifier: an ASCII letter or underscore, then letters, digits and underscores.
	/// <para>ASCII deliberately. This name becomes the member's identity — it is what
	/// <c>IIdeDriver.CreateChild</c> is asked for — so accepting one the vendor will refuse only moves the
	/// failure to the middle of a write. <c>\w</c>, which the pattern here used to be, accepts every Unicode
	/// letter and every connector punctuation mark.</para></summary>
	private static bool IsIdentifier(string s)
	{
		if (s.Length == 0) return false;
		if (!IsAsciiLetter(s[0]) && s[0] != '_') return false;
		for (var i = 1; i < s.Length; i++)
			if (!IsAsciiLetter(s[i]) && (s[i] < '0' || s[i] > '9') && s[i] != '_') return false;
		return true;
	}

	private static bool IsAsciiLetter(char c) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');

	/// <summary>The refusal. It names the line AND what is wrong with it — a member signature is something the
	/// engineer typed, so "Cannot parse" alone sends them looking at the whole file.</summary>
	private static BridgeException BadSignature(string sig, string keyword, string why) =>
		new BridgeException(BridgeErrorCodes.InvalidSt,
			$"Cannot parse {keyword} signature: {why} — {Truncate(sig.Trim(), 80)}");

	private static (string name, string? returnType) ParseMethodOrActionSignature(string sig, string kind)
	{
		if (kind == ItemKind.Kinds.Method) return ParseSignature(sig, "METHOD");

		// AN ACTION HAS NO RETURN TYPE — it is a named body sharing the POU's variables. A `:` on the line is a
		// method signature under the wrong keyword, and taking the name and dropping the rest would write it as
		// an action the IDE then cannot call.
		var (name, type) = ParseSignature(sig, "ACTION");
		if (type != null) throw BadSignature(sig, "ACTION", "an action has no return type");
		return (name, null);
	}

	private static (string name, string dataType) ParsePropertySignature(string sig)
	{
		// A PROPERTY's type is MANDATORY where a method's is optional — the one real difference between the two
		// lines, and the reason they were ever two patterns.
		var (name, type) = ParseSignature(sig, "PROPERTY");
		if (type == null) throw BadSignature(sig, "PROPERTY", "a property must declare a type");
		return (name, type);
	}

	/// <summary>Peel a leading `%FOLDER &lt;path&gt;` Volt directive out of a child body/decl into the
	/// folder field, returning (folder, remaining-text). The signature line is clean; %FOLDER leads the
	/// body's top directive block, under the body's boundary line.</summary>
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
		// NOT `.Trim()`. Peeling a directive is not licence to reformat what is left: SplitAtBoundary has already
		// decided which blank lines are separator and which are the engineer's, and trimming here undid that
		// decision for every child — the blank under a method's opening comment vanished on the way through.
		// When there is no %FOLDER at all this returns the text it was given, unchanged.
		return (folder, string.Join("\n", kept).TrimEnd('\n'));
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

		/// <summary>The CODE on the line just scanned — comments and pragmas removed, block-comment state
		/// carried across lines. Empty exactly when <see cref="InsideTrivia"/> is true.
		/// <para>This used to be computed and thrown away, and every structural keyword test then ran against the
		/// RAW line. So <c>(* restore *) END_GET</c> was correctly judged to contain code and just as correctly
		/// failed to match <c>END_GET</c> — the accessor was never closed, the next keyword closed it as BARE, and
		/// a bare accessor means "exists, holds no code". The getter's body was discarded on READ, before any push
		/// was involved. The same miss moved a method's whole VAR_INPUT block into its implementation.</para></summary>
		public string Code { get; private set; } = "";

		/// <summary>Advance over one line. Delegates to <see cref="CodeHelper.CodeOn"/> — THE trivia scanner —
		/// so this cannot drift from the one <c>HeaderLine</c> uses. It had: this copy called
		/// <c>(* doc *) FUNCTION_BLOCK FB</c> code (correctly) while <c>HeaderLine</c> skipped the line whole, and it
		/// did not strip a BOM. Same question, two answers, and the wrong one classified items on the wire.</summary>
		public void Update(string line)
		{
			Code = CodeHelper.CodeOn(line, ref _inBlockComment);
			InsideTrivia = Code.Length == 0;
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

	/// <summary>Does this line's CODE begin with <paramref name="keyword"/> as a whole word?
	/// <para>Callers pass <c>ScanContext.Code</c>, never the raw line: a structural keyword is still structural
	/// when a closed comment precedes it on the same line, which is exactly where engineers put the note
	/// explaining what an accessor is for.</para></summary>
	private static bool LineStartsWithKeyword(string code, string keyword)
	{
		var trimmed = code.TrimStart();
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
