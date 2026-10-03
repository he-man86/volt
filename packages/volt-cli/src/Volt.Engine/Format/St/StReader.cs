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
/// GVL / DUT are one declaration each and are not read at all.
///
/// TWO THINGS ARE READ FROM THE TEXT AND NOTHING ELSE IS:
///   1. the STRUCTURE — where each member block opens and closes, and each
///      member's signature line, which is the only place its name exists;
///   2. the BOUNDARY and the body's LANGUAGE — and those are not read, they
///      are STATED, by `IMPLEMENTATION ST|LD|FBD` (see ImplementationMarker).
/// The KIND comes from the wire name's extension; the item's own header is
/// never read (see the `kind` parameter of Read).
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
/// `{ ... }` are skipped from the keyword-search through the ONE trivia skipper, StTrivia
/// (nested comments, comments opened after code, strings).
/// </summary>
public static class StReader
{
	// The model lives in Item/ — this reader and StWriter are the two halves of ONE format, and they now
	// produce and consume the SAME record rather than two records that happened to line up. See ItemContent.

	/// <summary>
	/// Split one canonical workspace source item (ST text) into the vendor-neutral primitives the
	/// push path writes through <c>IIdeDriver</c>.
	///
	/// <para><b>A TOP-LEVEL ITEM'S HEADER IS NEVER READ</b> (openspec <c>push-without-header-check</c>). Its kind is
	/// <paramref name="kind"/> — the wire name's extension — so the header is not parsed, not checked against it, and
	/// never a reason to refuse: the text is written as sent, and the IDE's build reports what is wrong with it. It
	/// used to be parsed first and checked against the extension, and the parse refused a DUT whose opening comment
	/// was never closed with "No header line found" — a header that was fine, over an error only the build names
	/// (PLCAssist chat <c>c802b74d</c>). A DUT or a GVL is therefore not read at ALL: it is one declaration, handed
	/// over verbatim, empty or not.</para>
	///
	/// <para>A POU or an interface is read for what performing the push needs and nothing else: its
	/// <c>IMPLEMENTATION</c> line (the declaration/body split) and its CHILD elements — METHOD, ACTION, PROPERTY and
	/// its GET/SET — which have no extension of their own, so their header line is what names and delimits them. A
	/// child whose header cannot be read is refused naming the item and the line.</para>
	///
	/// <para><b>A comment that never closes hides no structure.</b> A <c>(*</c> with no <c>*)</c> after it is a
	/// compile error the IDE reports; read as a comment it swallowed the <c>IMPLEMENTATION</c> line, the END line and
	/// every member below it, so the push refused the file as one Volt had not written — or, when only a member's
	/// doc comment was left open, dropped that member without a word. The structure is read as if such a <c>(*</c>
	/// opened nothing; the text itself is carried unchanged.</para>
	/// </summary>
	/// <param name="kind">The kind the WIRE NAME says this item is (<see cref="ItemKind.KindForWireName"/>). It
	/// decides; the text is never consulted for it.</param>
	/// <param name="name">The item's bare name, for the refusals that name the POU's own body. A member is named by its
	/// signature; the POU is named by its FILE, which this text does not carry. Null where there is none, and the
	/// refusal then names the kind.</param>
	public static ItemContent Read(string sourceText, string kind, string? name = null)
	{
		if (kind is null) throw new ArgumentNullException(nameof(kind), "the kind is the wire name's extension; there is no other source for it");
		if (sourceText is null) throw new ArgumentNullException(nameof(sourceText));

		// 1. A DUT or a GVL is ONE declaration, written as sent. Nothing in it is Volt's to judge.
		if (kind is ItemKind.Kinds.Gvl or ItemKind.Kinds.Dut)
			return new ItemContent(kind, sourceText.TrimEnd('\n'), "", new List<Member>());

		var what = name is null ? $"this {kind}" : $"'{name}'";
		if (string.IsNullOrWhiteSpace(sourceText))
			throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"{what} is empty — a {kind} file holds at least its declaration, its {ImplementationMarker.Keyword} line and its END line.");

		var original = NormalizeLines(sourceText);

		// 2. The structure. A `(* @volt-… *)` comment — the tag of a Volt from before the IMPLEMENTATION line — is a
		// comment in a file that states its boundaries: it is read nowhere but as the HINT of the one refusal it explains,
		// a region with no boundary line (Unmarked; openspec bridge-refusal-review 2.1). It used to be refused anywhere
		// in the text, so a current file holding one in an ST body or a declaration could not be pushed — a scan over
		// the code, not a condition of the split.
		var item = ReadStructureOf(sourceText, original, kind, what, splitOnly: false);
		RefuseLinesInDeclarations(item, what);
		return item;
	}

	/// <summary>The members — kind and name — a push reads out of this text through the CHILD SPLITTER alone: every
	/// refusal of the split (an END line after code or with text after it, a member keyword inside an open member,
	/// trivia after the last member, a stray BOM) and none of the checks on what a body or a declaration holds.
	///
	/// <para>The PULL's half of the split (<c>Materializer</c>): the IDE stores each member's text on its own, and a
	/// member whose stored text holds one of those shapes — or a comment one member leaves open and the next closes —
	/// is written into a file the push refuses or splits into OTHER members. So the pull reads its own file back
	/// through this and refuses the item unless every member comes back as itself. Only the split: what a body holds
	/// is not the splitter's question (network text has its own round-trip gate).</para></summary>
	internal static IReadOnlyList<Member> SplitMembers(string sourceText, string kind, string name)
	{
		if (kind is ItemKind.Kinds.Gvl or ItemKind.Kinds.Dut) return Array.Empty<Member>();
		return ReadStructureOf(sourceText, NormalizeLines(sourceText), kind, $"'{name}'", splitOnly: true).Members;
	}

	/// <summary>The structure, read with every never-closed `(*` opening nothing (see <see cref="Read"/>). Neutralized in
	/// a COPY, by a stand-in of the same length that no scanner reads as trivia, and put back in everything that
	/// leaves. <paramref name="splitOnly"/>: the members' kinds and names alone (<see cref="SplitMembers"/>).</summary>
	private static ItemContent ReadStructureOf(string sourceText, List<string> original, string kind, string what, bool splitOnly)
	{
		// A BOM is a BOM only as the text's first character (StTrivia blanks it there). Anywhere else it is a character
		// of its line — and a SLICE of the text that starts on that line would read it as a BOM while the whole text
		// reads it as code, so the splitter's scans would disagree about it. 0 in the six corpora; refused naming the line.
		for (int l = 0; l < original.Count; l++)
			if (original[l].IndexOf('\uFEFF', l == 0 ? Math.Min(1, original[l].Length) : 0) >= 0)
				throw new BridgeException(BridgeErrorCodes.InvalidSt,
					$"{what}, line {l + 1}: holds U+FEFF (a byte-order mark) after the start of the text, where it is no " +
					"byte-order mark but an invisible character. Remove it.");

		var unclosed = StTrivia.UnterminatedOpenings(original);
		var neutralize = unclosed.Count > 0 && sourceText.IndexOf(UnclosedStandIn[0]) < 0;
		var lines = neutralize ? Neutralized(original, unclosed) : original;

		ItemContent item;
		try { item = ReadStructure(lines, kind, what, splitOnly); }
		catch (BridgeException ex) when (neutralize)
		{
			throw new BridgeException(ex.ErrorCode, Restored(ex.Message)!, ex);
		}
		return neutralize ? Restored(item) : item;
	}

	/// <summary>The END keyword that closes a POU's or an interface's outer block — which of the lines
	/// <see cref="OuterEndKeywords"/> accepts the text SPELLS — or null for a DUT or a GVL, which Volt does not read.
	///
	/// <para>Not part of <see cref="ItemContent"/>: the IDE stores no END line — a pull writes it from the declaration's
	/// own header (<see cref="PouHeaderKeyword"/>, <see cref="StWriter"/>) — so it carries nothing a push writes. It is
	/// still a TOKEN of the text, and the post-push comparison (<see cref="Volt.Engine.Sync.PushedText"/>) needs it: text
	/// pushed as <c>PROGRAM … END_FUNCTION_BLOCK</c> comes back <c>PROGRAM … END_PROGRAM</c>, which reads to the same
	/// declaration and body. Upper case — a keyword's case is layout.</para></summary>
	public static string? OuterEndKeyword(string sourceText, string kind)
	{
		if (kind is null) throw new ArgumentNullException(nameof(kind), "the kind is the wire name's extension; there is no other source for it");
		if (sourceText is null) throw new ArgumentNullException(nameof(sourceText));
		if (kind is ItemKind.Kinds.Gvl or ItemKind.Kinds.Dut) return null;
		var original = NormalizeLines(sourceText);
		var unclosed = StTrivia.UnterminatedOpenings(original);
		var lines = unclosed.Count > 0 && sourceText.IndexOf(UnclosedStandIn[0]) < 0 ? Neutralized(original, unclosed) : original;
		return FindOuterBlock(lines, OuterEndKeywords(kind), $"this {kind}").keyword.ToUpperInvariant();
	}

	/// <summary>The POU header keywords a pulled file's outer END line mirrors (<see cref="PouHeaderKeyword"/>).</summary>
	private static readonly string[] PouHeaderKeywords = { "PROGRAM", "FUNCTION_BLOCK", "FUNCTION" };

	/// <summary>Which of <c>PROGRAM</c> / <c>FUNCTION_BLOCK</c> / <c>FUNCTION</c> a POU's DECLARATION opens with, upper
	/// case — or null when it opens with none of them (an empty or prose text, a <c>NAMESPACE</c>, INTERFACE text in a
	/// POU object). The ONE place Volt looks at a POU's header keyword, and it decides nothing about the item: the
	/// pulled file's outer END line MIRRORS it (<see cref="StWriter"/>, openspec <c>push-without-header-check</c> 5.Q.3),
	/// so the file ends the way its own declaration opens. The kind is the object's class (<c>X.pou</c>); which of the
	/// three the text says is the IDE's and its build's business.
	///
	/// <para>Read in the READER'S OWN VIEW, so the writer and every reader of the file agree by construction: a
	/// never-closed <c>(*</c> opens nothing (as in <see cref="Read"/>), then <see cref="StTrivia.Code"/> blanks every
	/// comment (nested ones included), string and pragma — the trivia skipper the child splitter uses. The keyword is
	/// the first word that LEADS a line's code, the position the structure scan reads every keyword at
	/// (<c>LineStartsWithKeyword</c>) — of the FIRST line whose code leads with one of the three. Every other line is passed
	/// over: one that opens with no word (the stand-in of a never-closed comment, its <c>*</c> continuation lines) and one
	/// that opens with another word (that comment's own prose, which the neutralisation turns into code — reading the
	/// first word alone made <c>(* doc / Motor control / PROGRAM P</c> fall back to END_FUNCTION_BLOCK, 5Qa review). And
	/// a line that leads with one of the three is the header only when the rest is HEADER-SHAPED
	/// (<see cref="IsHeaderShaped"/>): prose that starts "Function to compute…" is still prose (5Qa review).
	/// Measured over the six corpora: on every one of the 16,990 POU files the first word-led line already IS the
	/// header, so this changes no corpus END line. Any case; a BOM is no code.</para></summary>
	public static string? PouHeaderKeyword(string declaration)
	{
		if (declaration is null) throw new ArgumentNullException(nameof(declaration));
		var original = NormalizeLines(declaration.TrimStart('\uFEFF'));
		var unclosed = StTrivia.UnterminatedOpenings(original);
		var lines = unclosed.Count > 0 && declaration.IndexOf(UnclosedStandIn[0]) < 0 ? Neutralized(original, unclosed) : original;
		foreach (var code in StTrivia.Code(lines))
		{
			var trimmed = code.TrimStart();
			if (trimmed.Length == 0) continue;
			int end = 0;
			while (end < trimmed.Length && (char.IsLetterOrDigit(trimmed[end]) || trimmed[end] == '_')) end++;
			if (end == 0 || char.IsDigit(trimmed[0])) continue;
			var word = trimmed.Substring(0, end).ToUpperInvariant();
			if (Array.IndexOf(PouHeaderKeywords, word) >= 0 && IsHeaderShaped(trimmed.Substring(end))) return word;
		}
		return null;
	}

	/// <summary>The FB modifiers that may stand between <c>FUNCTION_BLOCK</c> and its name.</summary>
	private static readonly string[] HeaderModifiers = { "PUBLIC", "INTERNAL", "PRIVATE", "PROTECTED", "ABSTRACT", "FINAL" };

	/// <summary>Does the code after a POU keyword read as a header's rest — modifiers, ONE name, then nothing, a return
	/// type (<c>:</c>) or <c>EXTENDS</c> / <c>IMPLEMENTS</c>? A never-closed comment's prose turns into code (the
	/// neutralisation), and a prose line can lead with "Function" or "Program" (5Qa review: <c>(* doc / Function to compute
	/// speed / PROGRAM P</c> was closed with END_FUNCTION); prose has more words after its second. An empty rest (the
	/// name on the next line) is a header.</summary>
	private static bool IsHeaderShaped(string rest)
	{
		var words = new List<string>();
		int i = 0;
		while (true)
		{
			while (i < rest.Length && char.IsWhiteSpace(rest[i])) i++;
			if (i == rest.Length) break;
			int start = i;
			while (i < rest.Length && (char.IsLetterOrDigit(rest[i]) || rest[i] == '_')) i++;
			if (i == start) break;   // a non-word character: `:` (return type) or anything else ends the words
			words.Add(rest.Substring(start, i - start).ToUpperInvariant());
		}
		if (words.Count == 0) return rest.Trim().Length == 0;   // "Program: …" / "Function, …" name no POU
		var at = 0;
		while (at < words.Count && Array.IndexOf(HeaderModifiers, words[at]) >= 0) at++;
		if (at < words.Count) at++;   // the name
		return at == words.Count || words[at] is "EXTENDS" or "IMPLEMENTS";
	}

	/// <summary>The word a MEMBER's declaration opens with, as the child splitter reads it — upper case — or null when it
	/// holds no code at all. The splitter knows a member block by the keyword that leads its first line of code
	/// (<see cref="SplitChildren"/>: METHOD / ACTION / PROPERTY), read through the same <see cref="StTrivia.Code"/> — the ONE
	/// trivia skipper, which NESTS comments (<c>(* a (* b *) c *)</c> is one comment) — so this is the keyword the push
	/// would read the member as. The PULL holds it to the member's CLASS (openspec <c>push-without-header-check</c> 5.Q.5,
	/// <c>Materializer</c>): an IDE can store a method whose text opens with <c>PROPERTY</c> (DIALECT C2l), and a file
	/// carrying it would be read back as a property — a delete of the method and a create of a property, under an ordinary
	/// push. A line that opens with a string opens with its quote.</summary>
	/// <summary>The keyword the child splitter reads a member of <paramref name="kind"/> by, when its DECLARATION opens
	/// with one: METHOD for a method, PROPERTY for a property (interface members too). Null for a kind whose block line is
	/// written from its class (an action, a transition) or that is no member. The splitter's own vocabulary
	/// (<see cref="MemberKeywords"/>), so the pull's class check (<c>Materializer</c>) reads the same words the push does.</summary>
	public static string? MemberKeywordFor(string kind) => kind switch
	{
		ItemKind.Kinds.Method or ItemKind.Kinds.InterfaceMethod => "METHOD",
		ItemKind.Kinds.Property or ItemKind.Kinds.InterfaceProperty => "PROPERTY",
		_ => null,
	};

	public static string? MemberHeaderKeyword(string declaration)
	{
		if (declaration is null) throw new ArgumentNullException(nameof(declaration));
		foreach (var line in StTrivia.Code(NormalizeLines(declaration)))
		{
			var code = line.TrimStart();
			if (code.Length == 0) continue;
			int end = 0;
			while (end < code.Length && (char.IsLetterOrDigit(code[end]) || code[end] == '_')) end++;
			return end == 0 ? code.Substring(0, 1) : code.Substring(0, end).ToUpperInvariant();
		}
		return null;
	}

	/// <summary>A POU's or an interface's structure: the outer block, the declaration/body split, the children.</summary>
	private static ItemContent ReadStructure(List<string> lines, string kind, string what, bool splitOnly)
	{
		// Find the outer END_X to split the POU from its children. INTERFACE is special — no implementation body, and
		// its method/property signatures live INSIDE the INTERFACE block, not as siblings after END_INTERFACE like an
		// FB's methods.
		var (pouEnd, childrenStart, _) = FindOuterBlock(lines, OuterEndKeywords(kind), what);
		var pouLines = SliceLines(lines, 0, pouEnd - 1);

		if (kind == ItemKind.Kinds.Interface)
		{
			// Children = METHOD / PROPERTY / ACTION signature blocks INSIDE the INTERFACE block, so nothing a push
			// writes stands AFTER END_INTERFACE. A line there is refused, naming it — it used to be dropped in silence
			// (a namespace's END_NAMESPACE, a member written after the block, a comment), where the same line after an
			// FB's END is refused by SplitChildren.
			var at = new ChildSite(what, childrenStart);
			var trailing = SliceLines(lines, childrenStart, lines.Count - 1);
			for (int i = 0; i < trailing.Count; i++)
				if (!string.IsNullOrWhiteSpace(trailing[i]))
					throw new BridgeException(BridgeErrorCodes.InvalidSt,
						$"{at.Line(i)}: nothing may follow END_INTERFACE (an interface's members sit inside its block), got: " +
						Truncate(trailing[i].Trim(), 80));
			var (interfaceDecl, interfaceChildren) = SplitInterfaceBody(pouLines, what, splitOnly);
			return new ItemContent(kind, interfaceDecl, "", interfaceChildren);
		}

		// Split only: the POU's own declaration and body are no question of the split (SplitMembers).
		var (pouDecl, pouImpl) = splitOnly ? ("", "") : SplitDeclImpl(pouLines, what);
		var children = SplitChildren(SliceLines(lines, childrenStart, lines.Count - 1), childrenStart, what, marked: true, splitOnly);
		return new ItemContent(kind, pouDecl, pouImpl, children);
	}

	/// <summary>What stands in for a never-closed <c>(*</c> while the structure is read: two Unicode NONCHARACTERS,
	/// which the standard reserves for exactly this — internal use, never interchanged — so no scanner reads them as
	/// a comment and no workspace file holds them. (A text that did hold one is read unneutralized.)</summary>
	private const string UnclosedStandIn = "﷐﷑";

	private static List<string> Neutralized(List<string> lines, List<(int Line, int Column)> unclosed)
	{
		var copy = new List<string>(lines);
		foreach (var (line, column) in unclosed)
			copy[line] = copy[line].Substring(0, column) + UnclosedStandIn + copy[line].Substring(column + 2);
		return copy;
	}

	private static string? Restored(string? text) => text?.Replace(UnclosedStandIn, "(*");

	private static ItemContent Restored(ItemContent item) => item with
	{
		Declaration = Restored(item.Declaration)!,
		Body = Restored(item.Body),
		Members = item.Members.Select(m => m with
		{
			Declaration = Restored(m.Declaration)!,
			Body = Restored(m.Body),
			Folder = Restored(m.Folder),
			ReturnType = Restored(m.ReturnType),
			DataType = Restored(m.DataType),
			Getter = m.Getter is { } g ? g with { Declaration = Restored(g.Declaration), Body = Restored(g.Body) } : null,
			Setter = m.Setter is { } st ? st with { Declaration = Restored(st.Declaration), Body = Restored(st.Body) } : null,
		}).ToList(),
	};

	/// <summary>The index of the first line at or after <paramref name="from"/> that OPENS a member block, or -1 when there
	/// is none. Read over the whole text's code (<see cref="StTrivia"/>), so a `METHOD` inside a comment — nested, or
	/// opened after code — does not count.</summary>
	private static int FirstMemberLine(IList<string> lines, int from)
	{
		var code = StTrivia.Code(lines);
		for (int i = from; i < lines.Count; i++)
			if (MemberKeywordLeading(code[i]) is not null) return i;
		return -1;
	}

	/// <summary>The member keywords a block opens with — the one place a push reads a header.</summary>
	private static readonly string[] MemberKeywords = { "METHOD", "ACTION", "PROPERTY" };

	/// <summary>Which of <see cref="MemberKeywords"/> leads this line of CODE, or null.</summary>
	private static string? MemberKeywordLeading(string code) =>
		MemberKeywords.FirstOrDefault(k => LineStartsWithKeyword(code, k));

	/// <summary>Walk back from a member's keyword line over the comments and pragmas written ABOVE it, and
	/// answer where that member's block really begins. Those lines document the member, not the declaration —
	/// `SplitChildren` attaches them to the child, so the declaration must not swallow them first.</summary>
	private static int BackOverMemberTrivia(IList<string> lines, int keywordLine)
	{
		// The trivia map is built in ONE FORWARD PASS, because a per-line probe cannot see block comments. It used
		// to start a fresh scan on each line walked back, so ` *)` — the TAIL of a comment opened twenty
		// lines earlier — read as code and stopped the walk dead. `IModuleBase` then kept its 23-line usage
		// example in the INTERFACE's declaration instead of on the method it documents, and the interface came
		// back from a round trip with a blank line inserted above that method.
		// A blank line ends the walk — but only a blank line that is really a SEPARATOR. An empty line INSIDE a
		// block comment is part of that comment, and treating it as a separator stopped the walk in the middle of
		// `IModuleBase`'s usage example, handing SplitChildren a region that opens on ` *)` and refusing the file
		// outright ("Expected METHOD/ACTION/PROPERTY").
		var open = StTrivia.OpenAtStart(lines);
		var code = StTrivia.Code(lines);
		var trivia = new bool[lines.Count];
		var separator = new bool[lines.Count];
		for (int i = 0; i < lines.Count; i++)
		{
			trivia[i] = IsTrivia(code[i]);
			separator[i] = !open[i] && string.IsNullOrWhiteSpace(lines[i]);
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
	private static (string decl, List<Member> children) SplitInterfaceBody(IList<string> bodyLines, string what, bool splitOnly)
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
		var children = SplitChildren(childRegion, interfaceHeaderLineIdx + 1, what, marked: false, splitOnly).Select(InterfaceMember).ToList();
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

	/// <summary>The lines that can close the outer block of <paramref name="kind"/>. A POU — program, function or function
	/// block, one kind (<c>X.pou</c>) — has one shape: declaration, boundary, body, END line, then members, so any of the
	/// three END lines closes it: which one the text spells is its header's business, and the push does not read it. An
	/// interface has a shape of its own (its members sit INSIDE the block), so only END_INTERFACE closes it.</summary>
	private static string[] OuterEndKeywords(string kind) => kind switch
	{
		ItemKind.Kinds.Pou => new[] { "END_FUNCTION_BLOCK", "END_PROGRAM", "END_FUNCTION" },
		ItemKind.Kinds.Interface => new[] { "END_INTERFACE" },
		// A caller's bug, not the engineer's text (openspec bridge-refusal-review 2.2): the push reads a POU or an
		// interface here, a DUT or a GVL is not read at all, and a read-only descriptor or a task never reaches the reader.
		_ => throw new ArgumentException($"the ST reader has no composite shape for kind '{kind}': only a POU or an " +
			"interface is split", nameof(kind)),
	};

	/// <summary>
	/// Walk lines tracking comment/pragma context to locate the outer block's end. Returns
	/// (index OF the outer END keyword line, index of the first child line after it — blanks
	/// skipped). The outer block always starts at line 0, so any pragmas/comments above the
	/// FUNCTION_BLOCK line stay part of the POU declaration.
	/// </summary>
	private static (int outerEndIdx, int childrenStart, string keyword) FindOuterBlock(IList<string> lines, string[] outerEnds, string what)
	{
		int? endIdx = null;
		string? keyword = null;
		var code = StTrivia.Code(lines);
		// The header each outer END closes (END_FUNCTION_BLOCK → FUNCTION_BLOCK): the line the item's NAME stands on, where
		// that word is the name and no END line (HeaderNameAt).
		var headers = outerEnds.Select(e => e.Substring("END_".Length)).ToArray();
		var at = new ChildSite(what, 0);
		for (int i = 0; i < lines.Count; i++)
		{
			if (IsTrivia(code[i])) continue;
			keyword = outerEnds.FirstOrDefault(end => LineStartsWithKeyword(code[i], end));
			if (keyword is not null)
			{
				RefuseTextAfter(lines[i], code[i], keyword, at, i);
				endIdx = i;
				break;
			}
			var nameAt = HeaderNameAt(code[i], headers);
			foreach (var end in outerEnds) RefuseEndAfterCode(code[i], end, at, i, nameAt);
		}
		if (endIdx is null)
			throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"Missing {string.Join(" / ", outerEnds)} in {what} — the text does not say where the item ends and " +
				"its members begin.");

		// Skip blank lines between END_X and first child block.
		int childrenStart = endIdx.Value + 1;
		while (childrenStart < lines.Count && string.IsNullOrWhiteSpace(lines[childrenStart]))
			childrenStart++;
		return (endIdx.Value, childrenStart, keyword!);
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
		// ONE line of the keyword's shape per region. Two are refused NAMING BOTH, before either is taken as the
		// boundary: the text alone cannot say which one the engineer meant. One may be a name in a wrapped declaration
		// (`implementation ST` on its own line of a VAR list), the other the real boundary — taking the first as the
		// boundary told the engineer to remove the REAL one. Or both are boundaries (a member pasted with its line),
		// and dropping either would guess.
		var stated = ImplementationMarker.StatedLinesIn(lines);
		if (stated.Count > 1)
			throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"{what} holds more than one {ImplementationMarker.Keyword} line: '{lines[stated[0]].Trim()}' and, below " +
				$"it, '{lines[stated[1]].Trim()}'. A body has ONE, the line that opens it. {ImplementationMarker.Keyword} " +
				"is reserved, so if the other one names something, rename it; otherwise remove it.");
		int at = ImplementationMarker.IndexIn(lines);
		if (at < 0) throw Unmarked(what, lines);
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
	/// <item>a line with no language, or one no body can state (<c>IMPLEMENTATION COBOL</c>, <c>UNSUPPORTED</c> after
	/// language other than ST, a bare CFC, SFC or IL, code after the language) — never guessed;</item>
	/// <item>text under <c>LD</c>/<c>FBD</c> that is no network — never re-read as ST. (Network text under <c>ST</c> is
	/// an ST body like any other, written as sent: the build reports it, openspec <c>bridge-refusal-review</c> 1.1);</item>
	/// <item>code under an UNSUPPORTED line (<c>IMPLEMENTATION CFC|SFC|IL|LD|FBD UNSUPPORTED</c>) —
	/// that body has no text form, the drivers write nothing for it, so the code would be dropped without a word and
	/// overwritten by the next pull.</item>
	/// </list></summary>
	private static string Body(string line, string code, string what)
	{
		var stated = line.Trim();
		if (ImplementationMarker.IsUnsupported(line))
		{
			if (code.Trim().Length > 0)
				throw new BridgeException(BridgeErrorCodes.InvalidSt,
					$"{what} holds code under '{stated}'. Volt shows no implementation for that body and never writes it, " +
					"so the code has nowhere to go and would be dropped. Remove it, and edit the body in the IDE (the " +
					"declaration above the line is yours to edit here).");
			return ImplementationMarker.Join(line, "");
		}

		var word = ImplementationMarker.Stated(line)!;
		if (word.Length == 0)
			throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"{what} states '{stated}' with no language — a body states its language on that line: " +
				$"{ImplementationMarker.For(Languages.St)}, {ImplementationMarker.For(Languages.Ld)} or " +
				$"{ImplementationMarker.For(Languages.Fbd)}. ({ImplementationMarker.Keyword} is reserved, so if the line " +
				"names something, rename it.)");
		// A bare CFC, SFC or IL was section 2b's line for a body Volt does not show; 3b gave every such body one word,
		// UNSUPPORTED, so the bare line states no body. Refused naming the line to write, never read as the hidden body
		// it once meant — a line that reads two ways is the ambiguity the stated language exists to end.
		if (ImplementationMarker.IsNeverShown(word.ToUpperInvariant()))
			throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"{what} states '{stated}'. Volt shows no {word.ToUpperInvariant()} body, so its line is " +
				$"'{ImplementationMarker.Unsupported(word.ToUpperInvariant())}', with nothing under it. Pull the item " +
				"again to get it.");
		var lang = ImplementationMarker.LanguageOf(line)
			?? throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"{what} states '{stated}', and '{word}' is no language a body can state. The line holds the keyword and " +
				$"one of ST, LD or FBD, or — for a body Volt does not show — its language (LD, FBD, CFC, SFC or IL) and " +
				$"{ImplementationMarker.UnsupportedWord}, alone. Code goes under the line, and a body in another language " +
				"is edited in the IDE.");

		// The stated language picks the reader, and the body is not sniffed for another (openspec bridge-refusal-review
		// 1.1, 2.3): an ST body is ST whatever it holds — `NETWORK … END_NETWORK` under `IMPLEMENTATION ST` is written
		// as sent and the IDE's build reports it — and an LD/FBD body is network text, which the NETWORK reader reads and
		// refuses with its own code and line (NETWORK_PARSE for text that is no network).
		return ImplementationMarker.Join(line, code);
	}

	/// <summary>A DECLARATION is written into the IDE verbatim, so a line of Volt's own that ends up in one would
	/// reach the project as code. Two kinds of line, both refused by name:
	/// <list type="bullet">
	/// <item>one of the keyword's shape. A kind that has no implementation (GVL, DUT, an interface and its members)
	/// has no boundary to consume it, and a name spelled <c>IMPLEMENTATION</c> alone on its line (the last enum value, a
	/// variable in a wrapped declaration) has the keyword's shape: the text alone cannot say it is no boundary line.</item>
	/// <item>a <c>%FOLDER</c> directive. Its place is fixed (<see cref="PeelFolderUnder"/>, <see cref="PeelFolderClosing"/>)
	/// and the directive there has been peeled already; one anywhere else is no directive, and leaving it in let a
	/// member's folder read as none while the line was written into its declaration.</item>
	/// </list></summary>
	private static void RefuseLinesInDeclarations(ItemContent item, string what)
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
			{
				if (open[i]) continue;
				if (ImplementationMarker.Stated(lines[i]) is not null)
					throw new BridgeException(BridgeErrorCodes.InvalidSt,
						$"{where} holds '{lines[i].Trim()}' in its declaration. A line of that shape is reserved: " +
						$"{ImplementationMarker.Keyword} at the start of a line opens a body and states its language, so such a " +
						"line stands only where a body starts. Remove the line, or write what it names on a line with more " +
						"than the word (or rename it).");
				if (FolderOn(lines[i]) is not null)
					throw new BridgeException(BridgeErrorCodes.InvalidSt,
						$"{where} holds '{lines[i].Trim()}' in its declaration. A member's %FOLDER stands directly under " +
						"its IMPLEMENTATION line, or as the last line of a property's declaration; anywhere " +
						"else it would be written into the IDE as code. Move it there, or remove it.");
			}
		}
	}

	// ─── Child blocks (composite POU's siblings) ─────────────────────

	/// <summary>The CHILD elements in <paramref name="after"/> — the one place push reads a header, because a child has
	/// no extension: its header line names it, says what it is and delimits it. Every refusal names the item
	/// (<paramref name="owner"/>) and the line IN THE FILE — <paramref name="offset"/> is where <paramref name="after"/>
	/// starts in it. These used to count from the start of the child region, so "line 1" was the line under the POU's
	/// END line, and named no item at all.</summary>
	private static List<Member> SplitChildren(IList<string> after, int offset, string owner, bool marked, bool splitOnly)
	{
		var at = new ChildSite(owner, offset);
		// ONE forward pass over the whole region through the ONE trivia skipper: a comment that opens in one member
		// and closes in the next is one comment, wherever the blocks start.
		var code = StTrivia.Code(after);
		var children = new List<Member>();
		int i = 0;
		while (i < after.Count)
		{
			// Skip blank lines between children.
			while (i < after.Count && string.IsNullOrWhiteSpace(after[i])) i++;
			if (i >= after.Count) break;

			// Capture pragmas/comments preceding the keyword as part of the child.
			int blockStart = i;
			var read = false;
			while (i < after.Count)
			{
				if (!IsTrivia(code[i]))
				{
					switch (MemberKeywordLeading(code[i]))
					{
						case "METHOD": children.Add(ReadMethodOrAction(after, code, ref i, blockStart, ItemKind.Kinds.Method, "END_METHOD", marked, splitOnly, at)); break;
						case "ACTION": children.Add(ReadMethodOrAction(after, code, ref i, blockStart, ItemKind.Kinds.Action, "END_ACTION", marked, splitOnly, at)); break;
						case "PROPERTY": children.Add(ReadProperty(after, code, ref i, blockStart, marked, splitOnly, at)); break;
						default:
							throw new BridgeException(BridgeErrorCodes.InvalidSt,
								$"{at.Line(i)}: expected METHOD/ACTION/PROPERTY, got: {Truncate(after[i].Trim(), 80)}");
					}
					read = true;
					break;
				}
				i++;
			}
			// Comments or pragmas with no member under them: the IDE has nowhere to keep them (a member's leading
			// trivia is written into its declaration; this is no member's), so writing the rest would drop them in
			// silence and the next pull would delete them from the file. Refused naming the line.
			if (!read)
				throw new BridgeException(BridgeErrorCodes.InvalidSt,
					$"{at.Line(blockStart)}: '{Truncate(after[blockStart].Trim(), 80)}' stands after the last member and belongs " +
					"to none, so the IDE has nowhere to keep it. Move it above a member, or into one.");
		}
		return children;
	}

	/// <summary>Where a child region sits: the item it belongs to, and the file line its first line is.</summary>
	private readonly struct ChildSite
	{
		private readonly string _owner;
		private readonly int _offset;
		public ChildSite(string owner, int offset) { _owner = owner; _offset = offset; }

		/// <summary>"'FB_A', line 7" for the region's line <paramref name="index"/>.</summary>
		public string Line(int index) => $"{_owner}, line {Number(index)}";

		/// <summary>The file line number of the region's line <paramref name="index"/>.</summary>
		public int Number(int index) => _offset + index + 1;
	}

	private static Member ReadMethodOrAction(IList<string> lines, string[] code, ref int i, int blockStart, string kind, string endKw, bool marked, bool splitOnly, ChildSite at)
	{
		int sigLine = i; // line with the keyword
		// Find the matching end keyword — at any indentation (see LineStartsWithKeyword), not column 0.
		RefuseEndAfterCode(code[sigLine], endKw, at, sigLine, HeaderNameAt(code[sigLine], MemberKeywords));
		int? endLine = null;
		for (int j = sigLine + 1; j < lines.Count; j++)
		{
			if (IsTrivia(code[j])) continue;
			if (LineStartsWithKeyword(code[j], endKw)) { RefuseTextAfter(lines[j], code[j], endKw, at, j); endLine = j; break; }
			RefuseOpenedInside(code[j], kind, endKw, at, j, sigLine);
			RefuseEndAfterCode(code[j], endKw, at, j, nameAt: -1);
		}
		if (endLine is null)
			throw new BridgeException(BridgeErrorCodes.InvalidSt, $"{at.Line(sigLine)}: missing {endKw} for the {kind} starting there");

		i = endLine.Value + 1;

		// Parse header of the signature line for name + return type.
		var (name, returnType) = ParseMethodOrActionSignature(lines[sigLine], code[sigLine], kind, at.Line(sigLine));
		if (splitOnly) return new Member(kind, name, "", "", ReturnType: returnType);

		// Split decl from impl inside the block (excluding the sigLine's
		// own line and the trailing END_X). Re-scan to find last END_VAR.
		var inner = SliceLines(lines, blockStart, endLine.Value - 1); // includes pragmas + sig
		var what = $"{kind} '{name}'";
		if (!marked)
		{
			// An INTERFACE's members are SIGNATURES (the OWNER decides, which is why `marked` is passed down: an
			// interface's members arrive as kind `method` and are re-kinded afterwards). No boundary line, and the
			// whole block is declaration (see ImplementationMarker.AppliesTo).
			// Its %FOLDER closes the declaration, where the writer puts it with no body to stand under.
			var (itfFolder, itfDecl) = PeelFolderClosing(string.Join("\n", inner).TrimEnd('\n'));
			return new Member(kind, name, itfDecl, "", Folder: itfFolder, ReturnType: returnType);
		}
		var (decl, impl, line) = SplitAtBoundary(inner, what);
		// %FOLDER (the child's sub-folder) is the first line under the boundary when there is one, and is peeled off
		// before the body is checked against the language its line states.
		var (folder, bodyCode) = PeelFolderUnder(impl);
		return new Member(kind, name, decl, Body(line, bodyCode, what), Folder: folder, ReturnType: returnType);
	}

	private static Member ReadProperty(IList<string> lines, string[] code, ref int i, int blockStart, bool marked, bool splitOnly, ChildSite at)
	{
		int sigLine = i;
		RefuseEndAfterCode(code[sigLine], "END_PROPERTY", at, sigLine, HeaderNameAt(code[sigLine], MemberKeywords));

		int? endLine = null;
		var accessorBoundaries = new List<(int start, int end, string kind)>(); // GET/SET ranges within property
		int? currentAccessorStart = null;
		string? currentAccessorKind = null;
		for (int j = sigLine + 1; j < lines.Count; j++)
		{
			if (IsTrivia(code[j])) continue;
			if (LineStartsWithKeyword(code[j], "END_PROPERTY")) { RefuseTextAfter(lines[j], code[j], "END_PROPERTY", at, j); endLine = j; break; }
			RefuseOpenedInside(code[j], ItemKind.Kinds.Property, "END_PROPERTY", at, j, sigLine);
			foreach (var end in PropertyEnds) RefuseEndAfterCode(code[j], end, at, j, nameAt: -1);
			var opens = LineStartsWithKeyword(code[j], "GET") ? "get"
					  : LineStartsWithKeyword(code[j], "SET") ? "set" : null;
			if (opens is not null)
			{
				RefuseTextAfter(lines[j], code[j], opens.ToUpperInvariant(), at, j);
				// A new accessor keyword while one is still OPEN closes the previous one as BARE (bodiless) —
				// `GET` immediately followed by `SET` is two empty accessors, not one accessor swallowing the
				// other. Before, the second keyword was simply ignored and that accessor was lost.
				if (currentAccessorStart is not null && currentAccessorKind is not null)
					accessorBoundaries.Add((currentAccessorStart.Value, currentAccessorStart.Value, currentAccessorKind));
				currentAccessorStart = j;
				currentAccessorKind = opens;
				continue;
			}
			if (LineStartsWithKeyword(code[j], "END_GET") || LineStartsWithKeyword(code[j], "END_SET"))
			{
				RefuseTextAfter(lines[j], code[j], LineStartsWithKeyword(code[j], "END_GET") ? "END_GET" : "END_SET", at, j);
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
			throw new BridgeException(BridgeErrorCodes.InvalidSt, $"{at.Line(sigLine)}: missing END_PROPERTY for the property starting there");

		i = endLine.Value + 1;

		var (name, dataType) = ParsePropertySignature(lines[sigLine], code[sigLine], at.Line(sigLine));
		if (splitOnly) return new Member(ItemKind.Kinds.Property, name, "", "", DataType: dataType);

		// Declaration of the property itself: from blockStart up to (but
		// excluding) the first accessor or END_PROPERTY — whichever is first.
		int declEnd = accessorBoundaries.Count > 0 ? accessorBoundaries[0].start - 1 : endLine.Value - 1;
		var declSlice = SliceLines(lines, blockStart, declEnd);
		// A property has no boundary of its own (its accessors do), so its %FOLDER closes its declaration.
		var (folder, propDecl) = PeelFolderClosing(string.Join("\n", declSlice).TrimEnd());

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

	/// <summary>A region that does not say where its declaration ends. Refused, never guessed — see
	/// <see cref="ImplementationMarker"/> for the three bugs the guessing cost. When the region holds a retired
	/// <c>(* @volt-… *)</c> comment, the refusal names it: that comment is what a Volt from before the keyword wrote where
	/// the line now stands, so it is the HINT that the file predates the format (openspec <c>bridge-refusal-review</c>
	/// 2.1) — and the only place the comment is read at all.</summary>
	private static BridgeException Unmarked(string what, IList<string> region)
	{
		var hint = ImplementationMarker.FindRetiredComment(region) is { } retired
			? $" It holds '{retired.Text}', the comment a Volt from before that line wrote in its place."
			: "";
		return new BridgeException(BridgeErrorCodes.InvalidSt,
			$"{what} has no '{ImplementationMarker.Keyword} <ST|LD|FBD>' line — the text does not say where its " +
			$"declaration ends or what language its body is in.{hint} Run `volt pull` once to rewrite the workspace in " +
			"the current format.");
	}

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
	/// is standing in, so this CHECKS rather than discovers.</param>
	/// <param name="where">The item and file line, for the refusal (a child has no name to be called by until this reads it).</param>
	private static (string name, string? type) ParseSignature(string sig, string code, string keyword, string where)
	{
		// COMMENTS OFF FIRST. An engineer documents a member on its signature line — `METHOD INTERNAL
		// _mStrConcatA //Concats string to sContent` — and CODESYS stores it exactly there. The old patterns
		// anchored at `$`, so anything trailing failed the match outright: Volt PULLED such an FB and then refused
		// its own text, which means the POU could be pulled and never pushed back. Found by sweeping a real
		// customer project; 207 of pro2193's method signatures carry one.
		//
		// The line's CODE is the splitter's own view of it (StTrivia): comments — nested ones too, where a per-line
		// strip left `c *)` of `(* a (* b *) c *)` in the TYPE — and pragmas blanked.
		var clean = code.Trim();

		// A TRAILING SEMICOLON is real, not slop: `METHOD PRIVATE CheckValidRefs : BOOL;` and
		// `PROPERTY Results : ARRAY[0..GVL_Constants.MaxRejectReasonsCamera] OF BOOL;` are both pro2193, as
		// CODESYS wrote them. It is punctuation, not part of the type.
		if (clean.EndsWith(";", StringComparison.Ordinal))
			clean = clean.Substring(0, clean.Length - 1).TrimEnd();

		// The type is everything after the FIRST colon, taken WHOLE and unexamined: no IEC type name contains a
		// colon, and `ARRAY[0..N] OF BOOL` must arrive intact. Volt does not need to understand it — the IDE does,
		// and it is the IDE that refuses a type that is wrong. NOTHING after the colon is the build's declaration error
		// too, so it reads as an empty type and the line is written as sent (openspec bridge-refusal-review 2.4); the one
		// create that needs the type as an argument — a TwinCAT interface member — is refused by that driver, by name.
		string? type = null;
		var colon = clean.IndexOf(':');
		if (colon >= 0)
		{
			type = clean.Substring(colon + 1).Trim();
			clean = clean.Substring(0, colon);
		}

		// KEYWORD [modifier …] NAME — the name is last because everything between is a modifier, and a word
		// there that is NOT one is a malformed line, not a second name to pick from.
		var words = clean.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
		if (words.Length < 2 || !string.Equals(words[0], keyword, StringComparison.OrdinalIgnoreCase))
			throw BadSignature(sig, keyword, $"it does not begin with '{keyword}' and a name", where);
		for (var i = 1; i < words.Length - 1; i++)
			if (!Modifiers.Contains(words[i]))
				throw BadSignature(sig, keyword, $"'{words[i]}' is not an access modifier", where);

		var name = words[words.Length - 1];
		if (!IsIdentifier(name))
			throw BadSignature(sig, keyword, $"'{Truncate(name, 40)}' is not a valid IEC identifier", where);
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
	private static BridgeException BadSignature(string sig, string keyword, string why, string where) =>
		new BridgeException(BridgeErrorCodes.InvalidSt,
			$"{where}: Cannot parse {keyword} signature: {why} — {Truncate(sig.Trim(), 80)}");

	private static (string name, string? returnType) ParseMethodOrActionSignature(string sig, string code, string kind, string where)
	{
		if (kind == ItemKind.Kinds.Method) return ParseSignature(sig, code, "METHOD", where);

		// AN ACTION HAS NO RETURN TYPE — it is a named body sharing the POU's variables. A `:` on the line is a
		// method signature under the wrong keyword, and taking the name and dropping the rest would write it as
		// an action the IDE then cannot call.
		var (name, type) = ParseSignature(sig, code, "ACTION", where);
		if (type != null) throw BadSignature(sig, "ACTION", "an action has no return type", where);
		return (name, null);
	}

	private static (string name, string dataType) ParsePropertySignature(string sig, string code, string where)
	{
		// A PROPERTY's type is MANDATORY where a method's is optional — the one real difference between the two
		// lines, and the reason they were ever two patterns.
		var (name, type) = ParseSignature(sig, code, "PROPERTY", where);
		if (type == null) throw BadSignature(sig, "PROPERTY", "a property must declare a type", where);
		return (name, type);
	}

	/// <summary>The folder a <c>%FOLDER &lt;path&gt;</c> directive line names, or null for any other line.</summary>
	private static string? FolderOn(string line)
	{
		var t = line.Trim();
		return t.StartsWith("%FOLDER ", StringComparison.Ordinal) ? t.Substring("%FOLDER ".Length).Trim() : null;
	}

	/// <summary>Peel the <c>%FOLDER</c> directive off the FIRST line of the text under a member's boundary
	/// line — where the writer puts it, and the only place it is one. This used to take the first such line ANYWHERE in
	/// the text: a line spelled like it inside a block comment in an ST body became the member's folder, so the push
	/// moved the member into a folder named after comment text and deleted the line from the comment.</summary>
	private static (string? folder, string rest) PeelFolderUnder(string text)
	{
		var eol = text.IndexOf('\n');
		var folder = FolderOn(eol < 0 ? text : text.Substring(0, eol));
		// The rest is NOT trimmed: SplitAtBoundary has already decided which blank lines are separator and which are
		// the engineer's, and a blank line under the directive is the body's.
		return folder is null ? (null, text) : (folder, eol < 0 ? "" : text.Substring(eol + 1));
	}

	/// <summary>Peel the <c>%FOLDER</c> directive off the LAST line of a declaration that has no boundary to stand
	/// under — a property's, and an interface member's — where the writer puts it. An interface member's used to be
	/// left in its declaration: the push wrote <c>%FOLDER Commands</c> into the IDE as code and the folder was lost.</summary>
	private static (string? folder, string rest) PeelFolderClosing(string text)
	{
		var eol = text.LastIndexOf('\n');
		var folder = FolderOn(eol < 0 ? text : text.Substring(eol + 1));
		return folder is null ? (null, text) : (folder, eol < 0 ? "" : text.Substring(0, eol));
	}

	// ─── Line scanning helpers ───────────────────────────────────────

	/// <summary>Is this line of CODE (<see cref="StTrivia.Code"/>) trivia — blank, a comment, a pragma, or the inside
	/// of one? A string is code (its quotes stay in the view).</summary>
	private static bool IsTrivia(string code) => code.Trim().Length == 0;

	/// <summary>Index of the first line that is real code (not blank / comment / pragma), or -1 if the
	/// whole range is trivia.</summary>
	private static int FirstCodeLine(IList<string> lines) => Array.FindIndex(StTrivia.Code(lines), c => !IsTrivia(c));

	/// <summary>The END lines a property's block holds.</summary>
	private static readonly string[] PropertyEnds = { "END_PROPERTY", "END_GET", "END_SET" };

	/// <summary>An END line stands at the START of its own line — that is where the splitter reads it. The same word
	/// after code on a line (<c>A := 1; END_METHOD</c>, <c>METHOD A : INT END_METHOD</c>) is no END line to it, so the
	/// block would run on to the NEXT member's END and swallow that member. Refused naming the line instead: the word can
	/// be nothing else there (it is reserved, and comments and strings are already blanked).
	/// <para>The one place the word is NOT an END line is a header's NAME position (<paramref name="nameAt"/>, from
	/// <see cref="HeaderNameAt"/>): <c>METHOD END_METHOD : INT</c> names a method END_METHOD. It used to be refused as
	/// "END_METHOD stands after code", a mistake the text does not hold — and the name is the IDE's to take or refuse
	/// (TcXaeShell takes END_METHOD as a method name, CODESYS refuses it; openspec push-keeps-what-landed 3.G). Any OTHER
	/// occurrence on that line is still refused.</para></summary>
	private static void RefuseEndAfterCode(string code, string endKw, ChildSite at, int line, int nameAt)
	{
		var lead = code.Length - code.TrimStart().Length;
		for (int from = lead + 1; from < code.Length;)
		{
			var k = code.IndexOf(endKw, from, StringComparison.OrdinalIgnoreCase);
			if (k < 0) return;
			var afterIdx = k + endKw.Length;
			if (k != nameAt && !IsWordChar(code[k - 1]) && (afterIdx == code.Length || !IsWordChar(code[afterIdx])))
				throw new BridgeException(BridgeErrorCodes.InvalidSt,
					$"{at.Line(line)}: {endKw} stands after code on its line. An END line opens its own line, which is where " +
					"the push reads it; put it on a line of its own.");
			from = afterIdx;
		}

		static bool IsWordChar(char c) => char.IsLetterOrDigit(c) || c == '_';
	}


	/// <summary>Where a header's NAME starts on this line of CODE — the first word after a leading
	/// <paramref name="keywords"/> word and any access modifiers (<see cref="Modifiers"/>) — or -1 when the line leads with
	/// none of them. Only the position: the name itself is read by <see cref="ParseSignature"/> (members) or not at all
	/// (an item's name is its file's).</summary>
	private static int HeaderNameAt(string code, string[] keywords)
	{
		int i = code.Length - code.TrimStart().Length;
		var first = WordAt(code, i);
		if (first is null || Array.FindIndex(keywords, k => string.Equals(k, first, StringComparison.OrdinalIgnoreCase)) < 0) return -1;
		i += first.Length;
		while (true)
		{
			while (i < code.Length && char.IsWhiteSpace(code[i])) i++;
			var word = WordAt(code, i);
			if (word is null) return -1;
			if (!Modifiers.Contains(word)) return i;
			i += word.Length;
		}

		static string? WordAt(string s, int from)
		{
			int end = from;
			while (end < s.Length && (char.IsLetterOrDigit(s[end]) || s[end] == '_')) end++;
			return end == from ? null : s.Substring(from, end - from);
		}
	}

	/// <summary>Nothing follows an END line's keyword — nor an accessor's GET / SET — on its line. The IDE stores none of
	/// these lines (a pull writes them), so a comment after one (<c>END_METHOD // note</c>, <c>END_GET (* x *)</c>) would
	/// be dropped in silence; and one OPENED there runs over the lines below it, which then land in the next member as
	/// orphaned text with no <c>(*</c>. Refused naming the line. Read off the RAW line after the keyword (the code view,
	/// which keeps columns, says where the keyword stands): the code view has every comment blanked, which is exactly
	/// what this asks about. Spaces and tabs are layout. 0 such lines in the six corpora.</summary>
	private static void RefuseTextAfter(string line, string code, string keyword, ChildSite at, int index)
	{
		var after = code.Length - code.TrimStart().Length + keyword.Length;
		if (line.Substring(after).Trim().Length == 0) return;
		throw new BridgeException(BridgeErrorCodes.InvalidSt,
			$"{at.Line(index)}: '{Truncate(line.Trim(), 80)}' — an END line holds its END keyword alone (a GET / SET line its " +
			$"keyword). The IDE stores no such line, so anything after {keyword} would be lost; put it on a line of its own.");
	}

	/// <summary>A member keyword leading a line INSIDE an open member block: the block above it was never closed. Read as
	/// the old block's text, the new member would vanish into it — an interface member has no boundary line to refuse it
	/// later — so the file is refused naming both lines.</summary>
	private static void RefuseOpenedInside(string code, string kind, string endKw, ChildSite at, int line, int sigLine)
	{
		if (MemberKeywordLeading(code) is not { } opens) return;
		throw new BridgeException(BridgeErrorCodes.InvalidSt,
			$"{at.Line(line)}: {opens} opens a member inside the {kind} starting at line {at.Number(sigLine)}, which has no " +
			$"{endKw} before it. Close that {kind} with {endKw} on a line of its own.");
	}

	/// <summary>Does this line's CODE begin with <paramref name="keyword"/> as a whole word?
	/// <para>Callers pass the line's CODE (<see cref="StTrivia.Code"/>), never the raw line: a structural keyword is still structural
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
