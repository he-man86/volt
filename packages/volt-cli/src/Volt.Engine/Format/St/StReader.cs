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
/// <c>Sync/PushService</c> writes through the <c>IVendorDriver</c> contract: one outer item + N
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
	/// push path writes through <c>IVendorDriver</c>.
	///
	/// <para><b>A TOP-LEVEL ITEM'S HEADER IS NEVER READ</b> (openspec <c>push-without-header-check</c>). Its kind is
	/// <paramref name="kind"/> — the wire name's extension — so the header is not parsed, not checked against it, and
	/// never a reason to refuse: the text is written as sent, and the IDE's build reports what is wrong with it (a parse
	/// once refused a fine DUT over an unclosed comment only the build names — PLCAssist chat <c>c802b74d</c>). A DUT or a
	/// GVL is therefore not read at ALL: it is one declaration, handed over verbatim, empty or not.</para>
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

		// 1. A kind that is not composite (a DUT, a GVL: ItemKind.ShapeOf) is ONE declaration, written as sent. Nothing in
		// it is Volt's to judge. It has no body slot, so it carries NO body — null, not "" (openspec bridge-refusal-review
		// D26: a driver refuses a text at a slot its object lacks, so "" would be refused as a body the item cannot hold).
		if (!ItemShape(kind).Composite)
		{
			// ITS PROPERTY LINES close it (openspec bridge-one-to-one §1.2) — the one thing read out of such a text; the
			// declaration above them is handed over as sent. One anywhere else would be written into the IDE as code.
			var what1 = name is null ? $"this {kind}" : $"'{name}'";
			// The declaration VERBATIM, its own trailing newlines included (openspec bridge-one-to-one §1.1 "every character",
			// `trailing-newline-cache`): the file holds it plus exactly ONE newline, which is all that is stripped.
			var (props, _, declaration) = PeelPropertiesClosing(StripSeparator(sourceText), what1, 1, folderAllowed: false);
			RefusePropertyLinesIn(what1, declaration);
			return new ItemContent(kind, declaration, null, new List<Member>(), props);
		}

		// An EMPTY or blank POU or interface text has no outer block, so it is refused as every text without one is
		// (FindOuterBlock: "Missing END_FUNCTION_BLOCK / END_PROGRAM / END_FUNCTION", or END_INTERFACE) — one condition, one
		// message, right for both composite kinds (openspec bridge-refusal-review D9). Its own branch said an interface
		// "holds its IMPLEMENTATION line", which an interface has not.
		var what = name is null ? $"this {kind}" : $"'{name}'";
		var original = NormalizeLines(sourceText);

		// 2. The structure.
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
		if (!ItemShape(kind).Composite) return Array.Empty<Member>();
		return ReadStructureOf(sourceText, NormalizeLines(sourceText), kind, $"'{name}'", splitOnly: true).Members;
	}

	/// <summary>The structure, read with every never-closed `(*` opening nothing (see <see cref="Read"/>). Neutralized in
	/// a COPY, by a stand-in of the same length that no scanner reads as trivia, and put back in everything that
	/// leaves. <paramref name="splitOnly"/>: the members' kinds and names alone (<see cref="SplitMembers"/>).</summary>
	private static ItemContent ReadStructureOf(string sourceText, List<string> original, string kind, string what, bool splitOnly)
	{
		RefuseInnerBom(original, what);

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

	/// <summary>U+FEFF — a byte-order mark as the text's first character, an invisible character anywhere else.</summary>
	private const char Bom = (char)0xFEFF;

	/// <summary>A BOM is a BOM only as the text's first character (StTrivia blanks it there). Anywhere else it is a
	/// character of its line — and a SLICE of the text that starts on that line would read it as a BOM while the whole text
	/// reads it as code, so the splitter's scans would disagree about it: refused, naming the line. 0 occurrences in the six
	/// corpora (openspec bridge-refusal-review 7.3). WHAT the refusal says depends on where the character stands, each
	/// position asked of the CODESYS build on its own (<c>record:exec</c> 2026-10-04, fixtures <c>ufeff_*</c>):
	/// <list type="bullet">
	/// <item>between two tokens — <c>ufeff_after_start</c> (a declaration: "Type definition expected instead of '&lt;U+FEFF&gt;'")
	/// and <c>ufeff_in_body</c> (a body: "';' expected instead of '&lt;U+FEFF&gt;'"): the build refuses it, so it is the
	/// text's fault as the IDE judges it — <c>INVALID_ST</c>, quoting the build;</item>
	/// <item>inside a comment (<c>ufeff_in_comment</c>) or a STRING or WSTRING literal (<c>ufeff_in_string</c>,
	/// <c>ufeff_in_wstring</c>): the build ACCEPTS it — <c>UNSUPPORTED</c>, Volt's splitter limit, "niche: accepted
	/// loss";</item>
	/// <item>inside a pragma — not measured: <c>UNSUPPORTED</c>, the splitter's limit, with no claim about the build.</item>
	/// </list></summary>
	private static void RefuseInnerBom(List<string> original, string what)
	{
		string[]? classes = null;
		for (int l = 0; l < original.Count; l++)
		{
			int col = original[l].IndexOf(Bom, l == 0 ? Math.Min(1, original[l].Length) : 0);
			if (col < 0) continue;
			classes ??= StTrivia.Classes(original);
			var at = $"{what}, line {l + 1}: holds U+FEFF (a byte-order mark) after the start of the text, where it is no " +
				"byte-order mark but an invisible character";
			const string splitter = "Volt's splitter does not read U+FEFF after the start of the text — a slice of the text " +
				"starting on that line would read it as a byte-order mark where the whole text reads it as a character " +
				"(niche: accepted loss, 0 occurrences in the corpora). Remove it.";
			throw classes[l][col] switch
			{
				StTrivia.CodeChar => (Exception)new BridgeException(BridgeErrorCodes.InvalidSt,
					$"{at}, between two tokens; the CODESYS build refuses it too (measured: \"Type definition expected " +
					"instead of '" + Bom + "'\" in a declaration, \"';' expected instead of '" + Bom + "'\" in a body). Remove it."),
				StTrivia.StringChar => new BridgeException(BridgeErrorCodes.Unsupported,
					$"{at}, inside a string literal. The CODESYS build accepts it there (measured), but {splitter}"),
				StTrivia.CommentChar => new BridgeException(BridgeErrorCodes.Unsupported,
					$"{at}, inside a comment. The CODESYS build accepts it there (measured), but {splitter}"),
				StTrivia.PragmaChar => new BridgeException(BridgeErrorCodes.Unsupported,
					$"{at}, inside a pragma (what the build says of it there is not measured). {splitter}"),
				var other => new VoltInvariantException(
					$"{what}, line {l + 1}: StTrivia classed the U+FEFF at column {col + 1} as '{other}', which only the text's " +
					"first character can be"),
			};
		}
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
		if (!ItemShape(kind).Composite) return null;
		var original = NormalizeLines(sourceText);
		var unclosed = StTrivia.UnterminatedOpenings(original);
		var lines = unclosed.Count > 0 && sourceText.IndexOf(UnclosedStandIn[0]) < 0 ? Neutralized(original, unclosed) : original;
		return FindOuterBlock(lines, OuterEndKeywords(kind), $"this {kind}").keyword.ToUpperInvariant();
	}

	/// <summary>The row of a SOURCE item's kind (<see cref="ItemKind.ShapeOf"/>) — the only kinds this reader reads: a POU,
	/// an interface, a DUT or a GVL. A member kind, a task or a descriptor reaching it is a caller's bug, not the
	/// engineer's text (openspec <c>bridge-refusal-review</c> 2.2): <see cref="ArgumentException"/>, INTERNAL_ERROR on push.</summary>
	private static IecLayout.Shape ItemShape(string kind) =>
		ItemKind.IsSourceKind(kind)
			? IecLayout.Of(kind)
			: throw new ArgumentException($"the ST reader has no composite shape for kind '{kind}': it reads a source item " +
			                              "(a POU, an interface, a DUT or a GVL)", nameof(kind));

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

	/// <summary>The word a MEMBER's declaration opens with, as the child splitter reads it — upper case — or null when it
	/// holds no code at all. The splitter knows a member block by the keyword that leads its first line of code
	/// (<see cref="SplitChildren"/>: METHOD / ACTION / PROPERTY), read through the same <see cref="StTrivia.Code"/> — the ONE
	/// trivia skipper, which NESTS comments (<c>(* a (* b *) c *)</c> is one comment) — so this is the keyword the push
	/// would read the member as. The PULL holds it to the member's CLASS (openspec <c>push-without-header-check</c> 5.Q.5,
	/// <c>Materializer</c>): an IDE can store a method whose text opens with <c>PROPERTY</c> (DIALECT C2l), and a file
	/// carrying it would be read back as a property — a delete of the method and a create of a property, under an ordinary
	/// push. A line that opens with a string opens with its quote.</summary>
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

	/// <summary>Does a MEMBER's declaration say <c>ABSTRACT</c> — among the modifiers between its keyword (METHOD /
	/// PROPERTY) and its name, on its first line of code (read through <see cref="StTrivia.Code"/>, so a commented
	/// <c>ABSTRACT</c> is none)? Read by the engine's fold of an abstract member with no code into <c>IMPLEMENTATION
	/// NONE</c> (<see cref="AbstractMemberFold"/>) and by the push's guard (openspec <c>abstract-member-push</c>,
	/// <c>abstract-member-parity</c>). It answers true for <c>FUNCTION_BLOCK ABSTRACT</c> too, so a caller picks the member
	/// site by kind before it asks. Any case. Every member carries its declaration, so a null one is refused, never read as
	/// "not abstract".</summary>
	public static bool MemberHeaderIsAbstract(string declaration)
	{
		if (declaration is null) throw new ArgumentNullException(nameof(declaration));
		foreach (var line in StTrivia.Code(NormalizeLines(declaration)))
		{
			var words = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
			if (words.Length == 0) continue;
			for (int i = 1; i < words.Length; i++)
			{
				var word = words[i].ToUpperInvariant();
				if (word == "ABSTRACT") return true;
				if (Array.IndexOf(HeaderModifiers, word) < 0) return false;   // the name: no modifier after it
			}
			return false;
		}
		return false;
	}

	/// <summary>A POU's or an interface's structure: the outer block, the declaration/body split, the children.</summary>
	private static ItemContent ReadStructure(List<string> lines, string kind, string what, bool splitOnly)
	{
		// Find the outer END_X to split the POU from its children. INTERFACE is special — no implementation body, and
		// its method/property signatures live INSIDE the INTERFACE block, not as siblings after END_INTERFACE like an
		// FB's methods.
		var (pouEnd, childrenStart, _) = FindOuterBlock(lines, OuterEndKeywords(kind), what);
		var pouLines = SliceLines(lines, 0, pouEnd - 1);

		if (ItemShape(kind).MembersInside)
		{
			// Children = METHOD / PROPERTY / ACTION signature blocks INSIDE the INTERFACE block, so nothing a push
			// writes stands AFTER END_INTERFACE. A line there (END_NAMESPACE, a member after the block, a comment) is
			// refused, naming it — never dropped in silence — as the same line after an FB's END is by SplitChildren.
			var at = new ChildSite(what, childrenStart);
			var trailing = SliceLines(lines, childrenStart, lines.Count - 1);
			for (int i = 0; i < trailing.Count; i++)
				if (!string.IsNullOrWhiteSpace(trailing[i]))
					throw new BridgeException(BridgeErrorCodes.InvalidSt,
						$"{at.Line(i)}: nothing may follow END_INTERFACE (an interface's members sit inside its block), got: " +
						Truncate(trailing[i].Trim(), 80));
			var (interfaceDecl, interfaceChildren) = SplitInterfaceBody(pouLines, what, splitOnly);
			// An interface has no boundary line, so its property lines close its declaration (openspec bridge-one-to-one §1.2).
			var (itfProps, _, itfDecl) = splitOnly
				? (ObjectProperties.None, null, interfaceDecl)
				: PeelPropertiesClosing(interfaceDecl, what, 1, folderAllowed: false);
			return new ItemContent(kind, itfDecl, null, interfaceChildren, itfProps);   // no body slot (D26)
		}

		// Split only: the POU's own declaration and body are no question of the split (SplitMembers).
		var (pouDecl, pouImpl, pouStated, pouProps) = splitOnly
			? ("", "", null, ObjectProperties.None)
			: SplitDeclImpl(pouLines, what);
		var children = SplitChildren(SliceLines(lines, childrenStart, lines.Count - 1), childrenStart, what, marked: true, splitOnly);
		return new ItemContent(kind, pouDecl, pouImpl, children, pouProps, Stated: pouStated);
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
		// The trivia map is built in ONE FORWARD PASS, because a per-line probe cannot see block comments: the ` *)`
		// TAIL of a comment opened twenty lines earlier is no code. A blank line ends the walk only when it is really
		// a SEPARATOR — an empty line INSIDE a block comment is part of that comment (both measured on `IModuleBase`'s
		// usage example, which otherwise stayed in the interface's declaration or split mid-comment).
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
			return (StripSeparator(string.Join("\n", bodyLines)), new List<Member>());
		}

		// THE DECLARATION IS EVERYTHING BEFORE THE FIRST MEMBER — it is not parsed, and Volt has no business
		// knowing what is in it.
		//
		// Not the header LINE: CODESYS stores a wrapped header (`EXTENDS IModuleStartable` on its own line), and no
		// list of continuation keywords can know every header shape. A DECLARATION is handed to the IDE VERBATIM, so
		// it is bounded by where the MEMBERS start, which needs no vocabulary at all. The member's own leading trivia
		// belongs to the MEMBER (`SplitChildren` attaches the comments and pragmas above a signature to it), so
		// the boundary walks back over that trivia to the blank line or code that precedes it.
		int firstMember = FirstMemberLine(bodyLines, interfaceHeaderLineIdx + 1);
		int declEnd = firstMember < 0 ? bodyLines.Count - 1 : BackOverMemberTrivia(bodyLines, firstMember) - 1;

		var declLines = SliceLines(bodyLines, 0, declEnd);
		// VERBATIM but for the ONE separator newline the writer puts between the declaration and the first member (or the
		// END line) — the blank line the join reads back as a trailing "\n" (bridge-one-to-one §1.1, every character).
		var decl = StripSeparator(string.Join("\n", declLines));

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
		// (ItemKind.MemberKind). `SplitChildren` is shared with function blocks and can only see
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
	private static (string decl, string impl, string line) SplitAtBoundary(IList<string> lines, string what) =>
		SplitAtBoundaryAt(lines, what, bodySeparator: false) is var (d, i, l, _) ? (d, i, l) : default;

	/// <summary>A text minus exactly ONE trailing newline — the layout's separator the writer adds after a verbatim text
	/// (<see cref="StWriter"/>), and nothing else: every other trailing newline is the vendor's.</summary>
	internal static string StripSeparator(string text) =>
		text.EndsWith("\n", StringComparison.Ordinal) ? text.Substring(0, text.Length - 1) : text;

	/// <summary><see cref="SplitAtBoundary"/>, and the index of the boundary line in <paramref name="lines"/> — where the
	/// property lines under it start counting from.</summary>
	private static (string decl, string impl, string line, int at) SplitAtBoundaryAt(IList<string> lines, string what,
	                                                                                 bool bodySeparator)
	{
		// ONE boundary line per region (ImplementationMarker.Is). Two are refused NAMING BOTH, before either is taken as the
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
		if (stated.Count == 0) throw Unmarked(what, lines);
		int at = stated[0];
		// Both halves VERBATIM (openspec bridge-one-to-one §1.1 "every character", `trailing-newline-cache`): the vendor
		// keeps a text's trailing newlines, so the file spells them, and the reader strips only the layout's own separator —
		// none between a declaration and its boundary line (the line itself separates them), and for a body the one blank
		// line the writer puts before a POU's END line (<paramref name="bodySeparator"/>). Trimming more would pull
		// `…END_VAR\n\n\n` and `…END_VAR` identically, and a push would write the vendor's newlines away.
		var decl = string.Join("\n", SliceLines(lines, 0, at - 1));
		var impl = string.Join("\n", SliceLines(lines, at + 1, lines.Count - 1));
		return (decl, bodySeparator ? StripSeparator(impl) : impl, lines[at], at);
	}

	/// <summary>A POU's own declaration and body. THE LINE DECIDES, and nothing else does; a file without one is
	/// REFUSED, never guessed at.
	///
	/// <para>An inferred boundary (the last <c>END_VAR</c>, a wrapped header) fails invisibly — the halves are re-joined
	/// on read, so a wrong split round-trips byte for byte while the project holds it broken (see
	/// <see cref="ImplementationMarker"/>); a graphical body's own VAR_TEMP blocks are one such case.</para></summary>
	private static (string decl, string impl, StatedLanguage stated, ObjectProperties props) SplitDeclImpl(IList<string> pouLines, string what)
	{
		var (decl, impl, line, at) = SplitAtBoundaryAt(pouLines, what, bodySeparator: true);
		// The POU's property lines stand directly under its boundary line (openspec bridge-one-to-one §1.2), peeled before
		// the body is checked against the language the line states. A POU has no %FOLDER there: its folder is its file's.
		var (props, _, code) = PeelPropertiesUnder(impl, what, at + 2, folderAllowed: false);
		var (body, stated) = Body(line, code, what);
		return (decl, body, stated, props);
	}

	/// <summary>The body a boundary line and the text under it make — checked against what the line STATES, which
	/// is the one signal for how the body is read. Only a boundary line reaches here (<see cref="ImplementationMarker.Is"/>:
	/// the grammar alone, openspec <c>bridge-refusal-review</c> D9); a line that only LOOKS like one — no language, one no
	/// body can state, a bare CFC, SFC or IL, code after the language — is no boundary, and a region holding no other is
	/// refused as <see cref="Unmarked"/>, naming that line and what it lacks. The one refusal here names
	/// <paramref name="what"/> and the line as written, and is raised before anything is written:
	/// <list type="bullet">
	/// <item>code under an UNSUPPORTED line (<c>IMPLEMENTATION CFC|SFC|IL|LD|FBD UNSUPPORTED</c>) —
	/// that body has no text form, the drivers write nothing for it, so the code would be dropped without a word and
	/// overwritten by the next pull.</item>
	/// </list>
	/// (Text under <c>LD</c>/<c>FBD</c> that is no network is the network reader's refusal, with its own code and line;
	/// network text under <c>ST</c> is an ST body like any other, written as sent: openspec <c>bridge-refusal-review</c> 1.1.)
	/// With the body, the language the line STATES (<see cref="StatedLanguage"/>, openspec <c>bridge-refusal-review</c>
	/// D6): the fact this reader already parsed, carried on the record so the push's guard reads no text to learn it.</summary>
	private static (string Body, StatedLanguage Stated) Body(string line, string code, string what)
	{
		var stated = line.Trim();
		// AN ABSTRACT MEMBER WITH NO CODE (`IMPLEMENTATION NONE`, openspec abstract-member-push / abstract-member-parity):
		// the line states that the member holds no code, so code under it is refused by name, as under an UNSUPPORTED one.
		if (ImplementationMarker.IsNone(line))
		{
			if (code.Trim().Length > 0)
				throw new BridgeException(BridgeErrorCodes.InvalidSt,
					$"{what} holds code under '{stated}'. That line states an abstract member, and an abstract member holds " +
					"no code (both compilers refuse it: \"must not contain any statements\"). Remove it — or, to give the " +
					$"member a body, make it concrete in the IDE and run `volt pull`.");
			return (ImplementationMarker.NoneLine, StatedLanguage.None);
		}
		if (ImplementationMarker.IsUnsupported(line))
		{
			if (code.Trim().Length > 0)
				throw new BridgeException(BridgeErrorCodes.InvalidSt,
					$"{what} holds code under '{stated}'. Volt shows no implementation for that body and never writes it, " +
					"so the code has nowhere to go and would be dropped. Remove it, and edit the body in the IDE (the " +
					"declaration above the line is yours to edit here).");
			var hidden = ImplementationMarker.Join(line, "");
			return (hidden, StatedLanguage.HiddenIn(ImplementationMarker.UnsupportedLanguageOf(hidden)!));
		}

		var lang = ImplementationMarker.LanguageOf(line)
			?? throw new VoltInvariantException($"'{stated}' reached the body read as a boundary line and states no language a reader reads");

		// The stated language picks the reader, and the body is not sniffed for another (openspec bridge-refusal-review
		// 1.1, 2.3): an ST body is ST whatever it holds — `NETWORK … END_NETWORK` under `IMPLEMENTATION ST` is written
		// as sent and the IDE's build reports it — and an LD/FBD body is network text, which the NETWORK reader reads and
		// refuses with its own code and line (NETWORK_PARSE for text that is no network).
		return (ImplementationMarker.Join(line, code), StatedLanguage.Shown(lang));
	}

	/// <summary>A DECLARATION is written into the IDE verbatim, so a line of Volt's own that ends up in one would
	/// reach the project as code. Two kinds of line, both refused by name:
	/// <list type="bullet">
	/// <item>a boundary line (<see cref="ImplementationMarker.Is"/>, the grammar alone). A kind that has no
	/// implementation (an interface and its members) has no boundary to consume it, and in any declaration it would read
	/// back as the boundary. A line that only looks like one — <c>Implementation</c> alone, the last enum value or a
	/// variable in a wrapped declaration — is code, the IDE's to compile (openspec <c>bridge-refusal-review</c> D9).</item>
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
				if (ImplementationMarker.Is(lines[i]))
					throw new BridgeException(BridgeErrorCodes.InvalidSt,
						$"{where} holds '{lines[i].Trim()}' in its declaration. That line opens a body and states its " +
						"language, so it stands only where a body starts: here it would read back as the boundary. Remove " +
						"it, or write what it names on a line with more than the words.");
			}
			RefusePropertyLinesIn(where, declaration);
		}
	}

	/// <summary>A property line (<see cref="PropertyLines"/> — <c>%CLASS</c>, <c>%FOLDER</c>, <c>%EXCLUDE_FROM_BUILD</c>, …)
	/// left in a DECLARATION after the peel: its place is fixed (directly under the object's IMPLEMENTATION line, else
	/// closing its declaration — <see cref="PeelPropertiesUnder"/>, <see cref="PeelPropertiesClosing"/>), and one anywhere
	/// else would be written into the IDE as code while the property it names read as absent. Refused by name (openspec
	/// bridge-one-to-one §1.2 "Placement"). A line inside a comment is the comment's.</summary>
	private static void RefusePropertyLinesIn(string where, string? declaration)
	{
		if (string.IsNullOrEmpty(declaration)) return;
		var lines = declaration!.Split('\n');
		var open = StTrivia.OpenAtStart(lines);
		for (int i = 0; i < lines.Length; i++)
		{
			if (open[i] || PropertyLines.KeyOf(lines[i]) is not { } key) continue;
			throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"{where} holds '{lines[i].Trim()}' in its declaration. A %{key} line stands directly under the object's " +
				"IMPLEMENTATION line, or closing its declaration (a DUT's, a GVL's, an interface's, a property's or an " +
				"interface member's); anywhere else it would be written into the IDE as code. Move it there, or remove it.");
		}
	}

	/// <summary>Peel the PROPERTY LINES off the top of the text under a boundary line — where the writer puts them, and
	/// the only place they are read there (openspec bridge-one-to-one §1.2): every leading line that is one
	/// (<see cref="PropertyLines.KeyOf"/>), up to the first that is not. <c>%FOLDER</c> belongs to a member's block
	/// (<paramref name="folderAllowed"/>); under a POU's own line it is code, as it always was. The rest is NOT trimmed:
	/// <see cref="SplitAtBoundary"/> has already decided which blank lines are separator and which are the engineer's.
	/// <paramref name="firstLine"/> is the file line of the text's first line.</summary>
	private static (ObjectProperties Props, string? Folder, string Remainder) PeelPropertiesUnder(string text, string what,
	                                                                                          int firstLine, bool folderAllowed)
	{
		var lines = text.Split('\n');
		var n = 0;
		while (n < lines.Length && IsPeeled(lines[n], folderAllowed)) n++;
		if (n == 0) return (ObjectProperties.None, null, text);
		var (props, folder) = PropertyLines.Read(lines.Take(n).ToList(), what, firstLine, folderAllowed);
		return (props, folder, string.Join("\n", lines.Skip(n)));
	}

	/// <summary>Peel the PROPERTY LINES off the end of a declaration that has no boundary to stand under — a DUT's, a
	/// GVL's, an interface's, a property's, an interface member's — where the writer puts them: every trailing line that is
	/// one, back to the first that is not, a line inside a comment excluded. <paramref name="firstLine"/> is the file line of
	/// the text's first line.</summary>
	private static (ObjectProperties Props, string? Folder, string Remainder) PeelPropertiesClosing(string text, string what,
	                                                                                            int firstLine, bool folderAllowed)
	{
		var lines = text.Split('\n');
		var open = StTrivia.OpenAtStart(lines);
		var start = lines.Length;
		while (start > 0 && !open[start - 1] && IsPeeled(lines[start - 1], folderAllowed)) start--;
		if (start == lines.Length) return (ObjectProperties.None, null, text);
		var (props, folder) = PropertyLines.Read(lines.Skip(start).ToList(), what, firstLine + start, folderAllowed);
		return (props, folder, string.Join("\n", lines.Take(start)));
	}

	/// <summary>Is this line one the peel takes: a property line, <c>%FOLDER</c> only in a member's block.</summary>
	private static bool IsPeeled(string line, bool folderAllowed) =>
		PropertyLines.KeyOf(line) is { } key && (folderAllowed || key != PropertyLines.FolderKey);

	// ─── Child blocks (composite POU's siblings) ─────────────────────

	/// <summary>The CHILD elements in <paramref name="after"/> — the one place push reads a header, because a child has
	/// no extension: its header line names it, says what it is and delimits it. Every refusal names the item
	/// (<paramref name="owner"/>) and the line IN THE FILE — <paramref name="offset"/> is where <paramref name="after"/>
	/// starts in it.</summary>
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
		if (splitOnly) return new Member(kind, name, "", "", ObjectProperties.None, ReturnType: returnType);

		// Split decl from impl inside the block (excluding the sigLine's own line and the trailing END_X).
		var inner = SliceLines(lines, blockStart, endLine.Value - 1); // includes pragmas + sig
		var what = $"{kind} '{name}'";
		if (!marked)
		{
			// An INTERFACE's members are SIGNATURES (the OWNER decides, which is why `marked` is passed down: an
			// interface's members arrive as kind `method` and are re-kinded afterwards). No boundary line, and the
			// whole block is declaration (see ItemKind.ShapeOf: an interface's members sit inside it).
			// Its property lines and %FOLDER close the declaration, where the writer puts them with no body to stand under.
			var (itfProps, itfFolder, itfDecl) = PeelPropertiesClosing(string.Join("\n", inner), what,
			                                                            at.Number(blockStart), folderAllowed: true);
			return new Member(kind, name, itfDecl, null, itfProps, Folder: itfFolder, ReturnType: returnType);   // a signature: no body slot (D26)
		}
		var (decl, impl, line, boundaryAt) = SplitAtBoundaryAt(inner, what, bodySeparator: false);
		if (kind == ItemKind.Kinds.Action) RefuseActionDeclaration(decl, blockStart, sigLine, name, at);
		// The property lines — %CLASS, %FOLDER (the child's sub-folder), the rest — are the first lines under the boundary
		// when there are any, and are peeled off before the body is checked against the language its line states.
		var (props, folder, bodyCode) = PeelPropertiesUnder(impl, what, at.Number(blockStart + boundaryAt + 1), folderAllowed: true);
		var (body, stated) = Body(line, bodyCode, what);
		return new Member(kind, name, decl, body, props, Folder: folder, ReturnType: returnType, Stated: stated);
	}

	private static Member ReadProperty(IList<string> lines, string[] code, ref int i, int blockStart, bool marked, bool splitOnly, ChildSite at)
	{
		int sigLine = i;
		RefuseEndAfterCode(code[sigLine], "END_PROPERTY", at, sigLine, HeaderNameAt(code[sigLine], MemberKeywords));

		int? endLine = null;
		var accessorBoundaries = new List<(int start, int end, string kind)>(); // GET/SET ranges within property
		int? currentAccessorStart = null;
		string? currentAccessorKind = null;
		// WHERE AN ACCESSOR KEYWORD CAN STAND (openspec lsp-accessor-keyword-at-line-start). GET and SET are legal NAMES
		// (the Standard RS FB declares `SET : BOOL`), so they are structural only OUTSIDE an accessor's VAR blocks and its
		// body — the body being everything from its IMPLEMENTATION line to its own END_GET/END_SET, as for every element.
		// `SET^.x := P;` in a setter is a statement, not a second SET refused INVALID_ST (a field FB was unreadable).
		var inVar = false;
		var inBody = false;
		for (int j = sigLine + 1; j < lines.Count; j++)
		{
			if (IsTrivia(code[j])) continue;
			if (LineStartsWithKeyword(code[j], "END_PROPERTY"))
			{
				RefuseTextAfter(lines[j], code[j], "END_PROPERTY", at, j);
				if (inBody) throw UnclosedAccessor(currentAccessorKind!, currentAccessorStart!.Value, "END_PROPERTY", at, j);
				endLine = j;
				break;
			}
			RefuseOpenedInside(code[j], ItemKind.Kinds.Property, "END_PROPERTY", at, j, sigLine);
			foreach (var end in PropertyEnds) RefuseEndAfterCode(code[j], end, at, j, nameAt: -1);
			var endsAccessor = LineStartsWithKeyword(code[j], "END_GET") ? "get" : LineStartsWithKeyword(code[j], "END_SET") ? "set" : null;
			if (inBody && endsAccessor is null) continue;          // body text, GET/SET lines included
			if (inBody && endsAccessor != currentAccessorKind)    // END_SET under a GET body: the getter was never closed
				throw UnclosedAccessor(currentAccessorKind!, currentAccessorStart!.Value, endsAccessor!.ToUpperInvariant() == "GET" ? "END_GET" : "END_SET", at, j);
			if (inVar) { if (LineStartsWithKeyword(code[j], "END_VAR")) inVar = false; continue; }
			if (currentAccessorStart is not null && endsAccessor is null)
			{
				if (VarOpener.IsMatch(code[j])) { inVar = true; continue; }
				if (ImplementationMarker.Is(lines[j])) { inBody = true; continue; }
			}
			var opens = LineStartsWithKeyword(code[j], "GET") ? "get"
					  : LineStartsWithKeyword(code[j], "SET") ? "set" : null;
			if (opens is not null)
			{
				RefuseTextAfter(lines[j], code[j], opens.ToUpperInvariant(), at, j);
				// A new accessor keyword while one is still OPEN closes the previous one as BARE (bodiless) —
				// `GET` immediately followed by `SET` is two empty accessors, not one accessor swallowing the
				// other; ignoring the second keyword would lose that accessor.
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
					inBody = false;
				}
			}
		}
		// A BARE `GET` (or `SET`) with no `END_GET` — the bodiless form the LSP documents — IS an accessor, just an
		// empty one: closed here, or it would come back null and the push would REMOVE the engineer's getter.
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
		if (splitOnly) return new Member(ItemKind.Kinds.Property, name, "", "", ObjectProperties.None, DataType: dataType);

		// Declaration of the property itself: from blockStart up to (but
		// excluding) the first accessor or END_PROPERTY — whichever is first.
		int declEnd = accessorBoundaries.Count > 0 ? accessorBoundaries[0].start - 1 : endLine.Value - 1;
		var declSlice = SliceLines(lines, blockStart, declEnd);
		// A property has no boundary of its own (its accessors do), so its property lines and %FOLDER close its declaration.
		var (props, folder, propDecl) = PeelPropertiesClosing(string.Join("\n", declSlice), $"property '{name}'",
		                                                      at.Number(blockStart), folderAllowed: true);

		Accessor? getter = null, setter = null;
		foreach (var (gStart, gEnd, gKind) in accessorBoundaries)
		{
			var inner = SliceLines(lines, gStart, gEnd); // includes GET/END_GET keywords
			var acc = ParseAccessor(inner, marked, $"property '{name}' {gKind.ToUpperInvariant()}");
			if (gKind == "get") getter = acc;
			else setter = acc;
		}

		return new Member(
			ItemKind.Kinds.Property, name, propDecl, null,   // its code is in its accessors: no body slot (D26)
			props,
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
		if (!marked) return new Accessor(string.Join("\n", inner), "");
		var (decl, impl, line) = SplitAtBoundary(inner, what);
		var (body, stated) = Body(line, impl, what);
		return new Accessor(decl, body, Stated: stated);
	}

	/// <summary>A region that does not say where its declaration ends. Refused, never guessed — see
	/// <see cref="ImplementationMarker"/> for the three bugs the guessing cost.</summary>
	private static BridgeException Unmarked(string what, IList<string> region)
	{
		var head = $"{what} has no '{ImplementationMarker.Keyword} <ST|LD|FBD>' line — the text does not say where its " +
		           "declaration ends or what language its body is in.";
		// A LINE THAT LOOKS LIKE THE BOUNDARY AND IS NONE (openspec bridge-refusal-review D9): the file forgot its language,
		// states one no body can, or keeps section 2b's bare line. Named, with what it lacks — the refusals the reader used
		// to raise for such a line wherever it stood, now raised only where it is what is missing.
		if (ImplementationMarker.LookalikeIn(region) is { } lookalike)
			return new BridgeException(BridgeErrorCodes.InvalidSt, $"{head} It holds '{lookalike.Line}', {Lacks(lookalike.Stated)}");
		return new BridgeException(BridgeErrorCodes.InvalidSt,
			$"{head} Run `volt pull` once to rewrite the workspace in the current format.");
	}

	/// <summary>What a line of the keyword's shape that is no boundary line lacks, by what it states (<paramref name="stated"/>,
	/// <see cref="ImplementationMarker.Stated"/>).</summary>
	private static string Lacks(string stated)
	{
		if (stated.Length == 0)
			return "which states no language — a body states its language on that line: " +
			       $"{ImplementationMarker.For(Languages.St)}, {ImplementationMarker.For(Languages.Ld)} or " +
			       $"{ImplementationMarker.For(Languages.Fbd)}.";
		// A body Volt does not show states UNSUPPORTED after its language, so a bare CFC, SFC or IL line states no body.
		var word = stated.ToUpperInvariant();
		if (ImplementationMarker.IsNeverShown(word))
			return $"but Volt shows no {word} body, so its line is '{ImplementationMarker.Unsupported(word)}', with nothing " +
			       "under it. Pull the item again to get it.";
		return $"and '{stated}' is no language a body can state. The line holds the keyword and one of ST, LD or FBD, or — " +
		       "for a body Volt does not show — its language (LD, FBD, CFC, SFC or IL) and " +
		       $"{ImplementationMarker.UnsupportedWord}, alone. Code goes under the line, and a body in another language is " +
		       "edited in the IDE.";
	}

	// ─── Signature parsing (METHOD/ACTION/PROPERTY headers) ─────────

	/// <summary>Read a member's NAME and (where it has one) its TYPE off its signature line.
	///
	/// <para><b>This is the only text in a declaration Volt still reads, and it cannot be removed the way the
	/// others were.</b> The kind comes from the wire name's extension and the decl/impl boundary is stated by
	/// <see cref="ImplementationMarker"/> — both because a FILE carries them. A method is not a file: it lives
	/// inside its POU's, exactly as a method lives inside its class in every other language, so its signature
	/// line is the only place its name exists. There is no second source for it to disagree with, which is what
	/// made the kind dangerous and makes this safe.</para>
	///
	/// <para><b>No regex</b>, for two reasons that both bite in production:
	/// <c>\w</c> is UNICODE in .NET, so `METHOD Ünit` would match and `Ünit` become a member name on the wire that
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
		//
		// A colon INSIDE BACKTICKS is the name's: CODESYS creates a backtick-quoted name whatever stands between the
		// backticks (DIALECT C28), so `METHOD `a:b` : INT` names `a:b` and types INT.
		string? type = null;
		var colon = OutsideBackticks(clean).IndexOf(':');
		if (colon >= 0)
		{
			type = clean.Substring(colon + 1).Trim();
			clean = clean.Substring(0, colon);
		}

		// THE NAME IS THE LAST WORD BEFORE THE COLON (openspec bridge-refusal-review D10), and no word between the keyword
		// and it is read: Volt holds no modifier vocabulary. A word there the IDE does not take is its build's to report
		// (`METHOD PUBLC Run` is the method `Run`, and the build names `PUBLC`), and a modifier typo keeps the member's
		// identity — 1,420 of 1,420 corpus signatures with modifiers carry them BEFORE the name, so that is the realistic
		// typo. A word AFTER the old name (`METHOD Run Walk`) renames the member by its header, as every header rename
		// does (ReconcileMembers renames the one member a kind dropped to the one it added, bridge-one-to-one 3.4), and pull reads names from the IDE's objects, so the round trip is
		// stable. That is an ACCEPTED LOSS, not the vendor's answer: both IDEs name such a header by its FIRST word
		// (`sig_unknown_word`), so over an existing Run this push renames Run to Walk (D10 option 3; known divergence
		// MEMBER_HEADER_NAMED_BY_ITS_LAST_WORD, niche: 0 corpus lines; `MemberHeaderLastWordTests`). A name the vendor refuses (`METHOD Run PUBLIC`) is the pre-flight's RefusedName. It refused every word
		// outside six modifiers — a code check on text the IDE takes.
		var words = Words(clean);
		if (words.Length < 2 || !string.Equals(words[0], keyword, StringComparison.OrdinalIgnoreCase))
			throw BadSignature(sig, keyword, $"it does not begin with '{keyword}' and a name", where);

		// The name is taken AS WRITTEN. Whether the IDE takes it is the driver's measured answer, asked by the push
		// pre-flight (`IVendorStore.RefusedName`): both vendors refuse every non-identifier shape themselves, and CODESYS
		// creates a backtick-quoted name — an ASCII check here refused that valid name and judged the rest unmeasured
		// (openspec bridge-refusal-review 3.1).
		return (words[words.Length - 1], type);
	}

	/// <summary>The line's words, split at blanks OUTSIDE backticks: a backtick-quoted name is one word whatever stands
	/// between the backticks — CODESYS creates <c>`a b`</c> for all six kinds and builds it clean (DIALECT C28,
	/// <c>scripts/vendor-facts.codesys.json, fact identifier-shapes</c>). Split at every blank, it read as the words <c>`a</c> and <c>b`</c> and was
	/// refused as a modifier: a member CODESYS holds that could be pulled and never pushed back (review 3a+3b). A
	/// backtick that never closes runs to the end of the line; the driver's name refusal judges that shape.</summary>
	private static string[] Words(string line)
	{
		var masked = OutsideBackticks(line);
		var words = new List<string>();
		var start = -1;
		for (var i = 0; i <= line.Length; i++)
		{
			var blank = i == line.Length || masked[i] == ' ' || masked[i] == '\t';
			if (blank && start >= 0) { words.Add(line.Substring(start, i - start)); start = -1; }
			else if (!blank && start < 0) start = i;
		}
		return words.ToArray();
	}

	/// <summary>The line with every character between a backtick and the next one (the backticks kept) replaced by
	/// <c>x</c>, so a search for a blank or a colon finds only the ones outside a quoted name. Same length, same
	/// positions.</summary>
	private static string OutsideBackticks(string line)
	{
		var chars = line.ToCharArray();
		var quoted = false;
		for (var i = 0; i < chars.Length; i++)
		{
			if (chars[i] == '`') quoted = !quoted;
			else if (quoted) chars[i] = 'x';
		}
		return new string(chars);
	}

	/// <summary>The refusal. It names the line AND what is wrong with it — a member signature is something the
	/// engineer typed, so "Cannot parse" alone sends them looking at the whole file.</summary>
	private static BridgeException BadSignature(string sig, string keyword, string why, string where) =>
		new BridgeException(BridgeErrorCodes.InvalidSt,
			$"{where}: Cannot parse {keyword} signature: {why} — {Truncate(sig.Trim(), 80)}");

	private static (string name, string? returnType) ParseMethodOrActionSignature(string sig, string code, string kind, string where)
	{
		if (kind == ItemKind.Kinds.Method) return ParseSignature(sig, code, "METHOD", where);

		// AN ACTION'S LINE IS COMPOSED, NOT STORED (openspec bridge-refusal-review D10): CODESYS writes an action no
		// declaration (`WriteMembers`: `Action ? null`) and TwinCAT composes `ACTION <name>`. So the line holds the keyword
		// and a name and NOTHING else — a modifier, a type (an action has no return type: a `:` is a method signature under
		// the wrong keyword), a comment, a `;` — or that text is dropped without a word and the next pull deletes it. Refused
		// by name; needed to write, and measured on 0 of 46 corpus action lines.
		var (name, type) = ParseSignature(sig, code, "ACTION", where);
		var onLine = Words(sig.Trim());
		if (type != null || onLine.Length != 2 || !string.Equals(onLine[1], name, StringComparison.Ordinal))
			throw BadSignature(sig, "ACTION",
				(type != null ? "an action has no return type, and " : "") +
				$"an action has no declaration the IDE stores — its line is 'ACTION {name}', so anything else on it would be " +
				"dropped", where);
		return (name, null);
	}

	/// <summary>An action's DECLARATION is its ACTION line and nothing else (openspec bridge-refusal-review D10, review 4b):
	/// neither write stores one (CODESYS and TwinCAT both write an action <c>null</c> for it, and a pull composes
	/// <c>ACTION &lt;name&gt;</c>), so a comment or pragma ABOVE the line, or a VAR section or comment under it before the body,
	/// would be dropped without a word, exactly as text on the line is (<see cref="ParseMethodOrActionSignature"/>). Refused
	/// naming the first such line. A blank line is layout.</summary>
	private static void RefuseActionDeclaration(string decl, int blockStart, int sigLine, string name, ChildSite at)
	{
		var lines = decl.Split('\n');
		for (int k = 0; k < lines.Length; k++)
		{
			if (blockStart + k == sigLine || lines[k].Trim().Length == 0) continue;
			throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"{at.Line(blockStart + k)}: '{Truncate(lines[k].Trim(), 80)}' would be part of action '{name}'s declaration, " +
				$"and an action has no declaration the IDE stores — its line is 'ACTION {name}', so this would be dropped. " +
				"Move it into the action's body or the owner's declaration.");
		}
	}

	private static (string name, string? dataType) ParsePropertySignature(string sig, string code, string where) =>
		// A property with no type is the build's error, not the push's (openspec bridge-refusal-review 2.6): its
		// declaration is written as sent. A TwinCAT INTERFACE property takes its type as
		// the create argument, and that driver refuses one with none, by name.
		ParseSignature(sig, code, "PROPERTY", where);

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
	/// <see cref="HeaderNameAt"/>): <c>METHOD END_METHOD : INT</c> names a method END_METHOD, and the name is the IDE's
	/// to take or refuse (TcXaeShell takes it, CODESYS refuses it; openspec push-keeps-what-landed 3.G). Any OTHER
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


	/// <summary>Where a header's NAME starts on this line of CODE — with a colon on the line, the last word before it (as
	/// <see cref="ParseSignature"/> reads it); without one, the first word after a leading <paramref name="keywords"/> word
	/// and any of the six measured modifier words (<see cref="HeaderModifiers"/>, the list the pull's END-line mirror holds)
	/// — or -1 when the line leads with none of them. ONLY the position, for the END-after-code exemption, which runs
	/// before any name is read: a colon-less line is the one place the text alone cannot say which
	/// word an END word is — <c>METHOD PUBLIC end_method</c> names a method, <c>METHOD Foo END_METHOD</c> is an END line
	/// read where a name should be. It decides no name: an item's is its file's, and a member's is the last word before the
	/// colon (<see cref="ParseSignature"/>, openspec <c>bridge-refusal-review</c> D10), with no vocabulary.</summary>
	private static int HeaderNameAt(string code, string[] keywords)
	{
		int i = code.Length - code.TrimStart().Length;
		var first = WordAt(code, i);
		if (first is null || Array.FindIndex(keywords, k => string.Equals(k, first, StringComparison.OrdinalIgnoreCase)) < 0) return -1;
		i += first.Length;
		// A COLON on the line says where the name ends, and the name is the last word before it — the word ParseSignature
		// reads (D10), with no vocabulary, so on such a line the two agree (review 4b: `METHOD PUBLC end_method : INT` was the
		// method end_method to the signature and "END_METHOD stands after code" here). Only a colon-less line is ambiguous,
		// and there they DO disagree: past the six measured modifiers this names the first other word, ParseSignature the
		// last. `METHOD PUBLC end_method` and `METHOD Foo END_METHOD` are one text to IEC (case is not read), and both are
		// refused here as an END line after code — by name, before ParseSignature reads either (gate 2, review finding 3;
		// `ChildSplitterTableTests`). This is the one vocabulary D10 leaves, and it decides only that exemption, never a
		// name. Niche: 0 colon-less END-keyword names in the six corpora.
		var colon = OutsideBackticks(code).IndexOf(':', i);
		if (colon >= 0)
		{
			int end = colon;
			while (end > i && char.IsWhiteSpace(code[end - 1])) end--;
			int start = end;
			while (start > i && (char.IsLetterOrDigit(code[start - 1]) || code[start - 1] == '_')) start--;
			return start == end ? -1 : start;
		}
		while (true)
		{
			while (i < code.Length && char.IsWhiteSpace(code[i])) i++;
			var word = WordAt(code, i);
			if (word is null) return -1;
			if (Array.FindIndex(HeaderModifiers, m => string.Equals(m, word, StringComparison.OrdinalIgnoreCase)) < 0) return i;
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

	/// <summary>A line of CODE opening a VAR block (<c>VAR</c>, <c>VAR_INPUT</c>, <c>VAR_INST</c>, <c>VAR CONSTANT</c>, …).</summary>
	private static readonly System.Text.RegularExpressions.Regex VarOpener =
		new(@"^\s*VAR(_[A-Z]+)*\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant);

	/// <summary>An accessor whose body reached <paramref name="reached"/> before its own END line. Inside a body only that
	/// END closes it (a GET/SET there is text), so the block above the next accessor was never closed — refused naming
	/// both lines, as an unclosed METHOD is (<see cref="RefuseOpenedInside"/>).</summary>
	private static BridgeException UnclosedAccessor(string kind, int start, string reached, ChildSite at, int line)
	{
		var kw = kind.ToUpperInvariant();
		return new BridgeException(BridgeErrorCodes.InvalidSt,
			$"{at.Line(line)}: {reached} reached while the {kw} starting at line {at.Number(start)} is still open — its body " +
			$"runs to its own END_{kw}. Close it with END_{kw} on a line of its own.");
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
