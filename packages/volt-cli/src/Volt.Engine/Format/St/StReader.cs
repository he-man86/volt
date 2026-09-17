using System;
using System.Linq;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

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
	/// <param name="expectedKind">The kind the WIRE NAME says this item is (<see cref="ItemKind.KindForWireName"/>).
	/// When given it DECIDES, and a header that disagrees is refused rather than followed — see the class remark.
	/// Null only where no wire name exists (the format's own round-trip, and tests).</param>
	public static ItemContent Read(string sourceText, string? expectedKind = null)
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
		if (expectedKind != null && !string.Equals(declared, expectedKind, System.StringComparison.Ordinal))
			throw new BridgeException(BridgeErrorCodes.InvalidSt,
				$"the item's extension says '{expectedKind}' and its text declares a '{declared}'. The extension is " +
				"the kind — rename the file to match the code, or change the code to match the file. (Writing it " +
				"anyway would silently replace the item with one of the other kind, under a different name.)");
		var kind = expectedKind ?? declared;

		// 2. Branch on kind: composite POUs have children, simple
		// ones (gvl / dut) are single text blobs.
		if (kind is ItemKind.Kinds.Gvl or ItemKind.Kinds.Dut)
		{
			return new ItemContent(kind, sourceText.TrimEnd('\n'), "", new List<Member>());
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
		// SplitDeclImplOfChild handles that case naturally.
		var childRegion = SliceLines(bodyLines, interfaceHeaderLineIdx + 1, bodyLines.Count - 1);
		// THE OWNER DECIDES THE MEMBER KIND, here exactly as it does on the IDE side
		// (CodesysDriver.MemberKind). `SplitChildren` is shared with function blocks and can only see
		// `METHOD`/`PROPERTY`, so without this an interface read from TEXT reported `method` while the same
		// interface read from the IDE reported `interface_method` - and StWriter, knowing only the latter,
		// threw "No END keyword for POU child kind 'interface_method'". The whole interface then materialized
		// as UNREADABLE: created in the project, accepted by push, and absent from /refs.
		var children = SplitChildren(childRegion).Select(InterfaceMember).ToList();
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
	/// after are the implementation.
	///
	/// <para><paramref name="separatorLines"/> is how many blank lines <see cref="StWriter"/> puts BETWEEN the
	/// two — one for a top-level POU, none for a member or an accessor — and exactly that many are dropped here.
	/// Every OTHER blank line at the boundary is the engineer's and belongs to the implementation. Dropping all
	/// of them (a bare <c>Trim()</c>) flattened `END_VAR` / blank / blank / `(*` down to one blank line in
	/// `Round.fun`, and swallowed the blank under a method's opening comment in five more files.</para>
	///
	/// <para><c>TrimEnd('\n')</c>, never <c>TrimEnd()</c>: the trailing SPACES on a real line are text, not
	/// separator. Trimming whitespace deleted them — `//Selection of the cam. ` came back a character shorter in
	/// four Lenze files — and a pull that silently edits a line is a pull that cannot round-trip.</para></summary>
	private static (string decl, string impl) SplitAtLine(IList<string> lines, int implStart, int separatorLines = 0)
	{
		var d = new StringBuilder();
		for (int i = 0; i < implStart; i++) { if (i > 0) d.Append('\n'); d.Append(lines[i]); }
		var im = new StringBuilder();
		for (int i = implStart; i < lines.Count; i++) { if (i > implStart) im.Append('\n'); im.Append(lines[i]); }

		var impl = im.ToString();
		for (int i = 0; i < separatorLines && impl.StartsWith("\n", StringComparison.Ordinal); i++)
			impl = impl.Substring(1);
		return (d.ToString().TrimEnd('\n'), impl.TrimEnd('\n'));
	}

	/// <summary>Split at the marker line: everything above it is the declaration, everything below the
	/// implementation, and the marker itself belongs to neither. No trivia is classified and no keyword is
	/// looked for — that is the whole point of it (see <see cref="ImplementationMarker"/>).</summary>
	private static (string decl, string impl) SplitAtMarker(IList<string> lines, int markerIdx)
	{
		var decl = string.Join("\n", SliceLines(lines, 0, markerIdx - 1));
		var impl = string.Join("\n", SliceLines(lines, markerIdx + 1, lines.Count - 1));
		return (decl.TrimEnd('\n'), impl.TrimEnd('\n'));
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
		// THE MARKER DECIDES. Everything below it is the legacy inference, kept only until every workspace has
		// been re-pulled; `MigrateLayout` is what rewrites a file to carry one.
		int marked = ImplementationMarker.IndexIn(pouLines);
		if (marked >= 0) return SplitAtMarker(pouLines, marked);

		int gfx = FirstMarkerLine(pouLines, includeFolder: false);
		if (gfx >= 0) return SplitAtLine(pouLines, gfx);

		// Walk backward: the declaration's STRUCTURE ends at the LAST END_VAR (the parent POU's own var
		// sections, not a child's); with no VAR section at all it ends at the end of the wrapped header.
		// Trailing trivia then belongs to the declaration too — see DeclarationEnd.
		// NOT DeclarationEnd here, unlike a child: StWriter separates a TOP-LEVEL declaration from its body with
		// a BLANK LINE, so `END_VAR` / blank / comment / code means the comment is the body's first line and the
		// blank is the separator. A child is joined with a single newline, so the same shape there means the
		// blank and the comment are both inside the declaration. Identical text, different split — which is the
		// price of the separator being implicit, and the reason the two cases cannot share one rule.
		int lastEndVar = LastCodeLine(pouLines, "END_VAR");
		return SplitAtLine(pouLines, lastEndVar >= 0 ? lastEndVar + 1 : HeaderEnd(pouLines), separatorLines: 1);
	}

	/// <summary>Where the IMPLEMENTATION starts, given the line after the declaration's last STRUCTURAL line.
	///
	/// <para><b>Trailing trivia belongs to the DECLARATION</b>, because that is where the vendor keeps it —
	/// measured on live SP21 against `pro2193`, whose `BitLogic` has fourteen members: several of their
	/// declarations end `END_VAR`, a blank line, then a comment, and NOT ONE body begins with a comment. Reading
	/// that comment as the first line of the implementation moved it across the boundary on push, and the next
	/// pull then wrote it back one line higher — twenty files in one project drifted on exactly this.</para>
	///
	/// <para>Blank lines, line comments, block comments and pragmas are all trivia; the implementation begins at
	/// the first line carrying CODE. A declaration-only item (everything after the header is trivia) keeps all of
	/// it and gets an empty body.</para></summary>
	private static int DeclarationEnd(IList<string> lines, int structuralEnd)
	{
		var ctx = new ScanContext();
		int end = structuralEnd;
		for (int i = 0; i < lines.Count; i++)
		{
			ctx.Update(lines[i]);           // from line 0, so an open block comment is tracked correctly
			if (i < structuralEnd) continue;
			// The unauthorable-body MARKER is a comment by spelling and a BODY by meaning: it is what stands in
			// for a CFC/SFC/IL implementation, and the push reads the body to decide whether the item can be
			// written at all. Swept into the declaration it left an empty body, and a POU holding a read-only
			// child stopped being editable.
			if (BodyMarker.Is(lines[i])) break;
			// A conditional-compile or define DIRECTIVE is trivia by spelling and CODE by meaning: `{IF defined(X)}`
			// guards what follows and is closed by an `{END_IF}` further down, in the body. Swept into the
			// declaration it left the opener on one side of the boundary and its closer on the other, and CODESYS
			// said so — "This code is not supported in declaration part", "Unexpected End-of-file found: 'ELSIF',
			// 'ELSE' or 'END_IF' expected", "'ELSE' found without matching 'if'". A text round-trip cannot see it:
			// the two halves are re-joined on read. (See ConditionalPragmaSplitTests.)
			if (IsDirectivePragma(lines[i])) break;                        // the body starts here
			if (!ctx.InsideTrivia) break;                                  // real code — the body starts here
			if (lines[i].Trim().Length > 0) end = i + 1;                   // a comment or pragma — declaration
		}
		return end;
	}

	/// <summary>A pragma that DIRECTS compilation rather than documenting a declaration: the conditional family
	/// (<c>{IF}</c>, <c>{ELSIF}</c>, <c>{ELSE}</c>, <c>{END_IF}</c>) and <c>{define}</c>/<c>{undefine}</c>, which
	/// act on the code after them. An <c>{attribute …}</c> decorates what follows and is NOT one of these — it
	/// stays declaration trivia, which is the rule this narrows rather than replaces.</summary>
	private static bool IsDirectivePragma(string line)
	{
		var t = line.TrimStart();
		if (t.Length < 2 || t[0] != '{') return false;
		var word = t.Substring(1).TrimStart();
		foreach (var d in DirectivePragmas)
			if (word.StartsWith(d, System.StringComparison.OrdinalIgnoreCase) &&
			    (word.Length == d.Length || !char.IsLetterOrDigit(word[d.Length]) && word[d.Length] != '_'))
				return true;
		return false;
	}

	private static readonly string[] DirectivePragmas = { "IF", "ELSIF", "ELSE", "END_IF", "define", "undefine" };

	/// <summary>The line after a POU header that has NO var section — and the header LEGALLY WRAPS.
	///
	/// <para>`FUNCTION_BLOCK PUBLIC Cylinder_52Valve_InvertedFB` / `EXTENDS Cylinder_52ValveFB` /
	/// `IMPLEMENTS IActuator` is ONE declaration on three lines, and CODESYS stores it that way. Ending the
	/// declaration at the first line put `EXTENDS`/`IMPLEMENTS` into the IMPLEMENTATION, so a push wrote a
	/// derived function block's base class into its body — measured migrating `pro2193` into a blank project,
	/// where four function blocks came back with the clause below a blank line instead of in the header.</para></summary>
	private static int HeaderEnd(IList<string> lines)
	{
		int header = FirstCodeLine(lines);
		if (header < 0) return 0;           // the whole block reads as trivia

		var ctx = new ScanContext();
		int end = header + 1;
		for (int i = 0; i < lines.Count; i++)
		{
			ctx.Update(lines[i]);
			if (i <= header || ctx.InsideTrivia) continue;
			// `EXTENDS` / `IMPLEMENTS` / a wrapped `: type`. The colon form is not a keyword and not a guess at
			// "is this a statement?": NO valid ST statement begins with a colon, so a line that does is a
			// continuation of the header above it and nothing else. `FUNCTION Compute` / `: REAL` is a real
			// CODESYS export shape, and without this its return type became the first line of the body.
			if (!LineStartsWithKeyword(ctx.Code, "EXTENDS") && !LineStartsWithKeyword(ctx.Code, "IMPLEMENTS")
				&& !ctx.Code.TrimStart().StartsWith(":", StringComparison.Ordinal)) break;
			end = i + 1;
		}
		return end;
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
					if (LineStartsWithKeyword(ctx.Code, "METHOD")) { children.Add(ReadMethodOrAction(after, ref i, blockStart, ItemKind.Kinds.Method, "END_METHOD")); break; }
					if (LineStartsWithKeyword(ctx.Code, "ACTION")) { children.Add(ReadMethodOrAction(after, ref i, blockStart, ItemKind.Kinds.Action, "END_ACTION")); break; }
					if (LineStartsWithKeyword(ctx.Code, "PROPERTY")) { children.Add(ReadProperty(after, ref i, blockStart)); break; }
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
		var (decl, impl) = SplitDeclImplOfChild(inner, kind);
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
		int marked = ImplementationMarker.IndexIn(inner);
		var (decl, impl) = marked >= 0
			? SplitAtMarker(inner, marked)
			: SplitAtLine(inner, DeclarationEnd(inner, LastCodeLine(inner, "END_VAR") + 1));
		return new Accessor(decl, impl);
	}

	private static (string decl, string impl) SplitDeclImplOfChild(IList<string> innerLines, string kind)
	{
		// Same guard as the root POU, plus %FOLDER: a child's impl is everything from the first
		// %FOLDER/graphical marker (its network-text body — incl. VAR_TEMP — and the %FOLDER directive that
		// PeelFolderDirective will strip). Real VAR sections stay in the decl before it.
		int marked = ImplementationMarker.IndexIn(innerLines);
		if (marked >= 0) return SplitAtMarker(innerLines, marked);

		int gfx = FirstMarkerLine(innerLines, includeFolder: true);
		if (gfx >= 0) return SplitAtLine(innerLines, gfx);

		// AN ACTION HAS NO DECLARATION TO PUT TRIVIA IN, so for an action the split stops at the signature line
		// and everything below it — comments included — is BODY.
		//
		// IEC gives an action a name and a body and nothing else, and both drivers say so by writing
		// `m.Kind == Kinds.Action ? null : m.Declaration` (CodesysDriver.Content.cs, BeckhoffDriver.Content.cs).
		// So a line that lands in an action's declaration is not moved, it is DELETED from the project on the
		// next push. Extending an action's declaration over its trailing comments therefore silently dropped
		// them: 25 actions across the corpora, 12 of them comment-only, would have lost their entire content.
		// The file still round-trips byte for byte either way — AssembleChild joins the two with one newline —
		// which is why the fixed-point gate cannot see this and a driver-level test has to.
		//
		// AFTER the marker check above, never before: an action with a graphical body needs its `%FOLDER` and
		// `NETWORK` lines in the body, and splitting at the signature first would leave them in a declaration
		// nobody writes.
		if (kind == ItemKind.Kinds.Action)
			return SplitAtLine(innerLines, Math.Max(FirstCodeLine(innerLines), 0) + 1);

		// No VAR sections — the declaration is the signature line (first non-trivia line) + any preceding
		// pragmas. Either way the trailing trivia after it is declaration, not body (see DeclarationEnd).
		int lastEndVar = LastCodeLine(innerLines, "END_VAR");
		return SplitAtLine(innerLines,
			DeclarationEnd(innerLines, lastEndVar >= 0 ? lastEndVar + 1 : HeaderEnd(innerLines)));
	}

	// ─── Signature parsing helpers (METHOD/ACTION/PROPERTY headers) ──

	/// <summary>The access/abstractness keywords a member signature may carry between its keyword and its name.
	///
	/// <para>Spelled ONCE. It used to be written out in both parsers below, and they had already drifted: the
	/// property pattern allowed <c>?</c> over four keywords where the method pattern allowed <c>*</c> over six,
	/// so `PROPERTY PUBLIC ABSTRACT Ready : INT` — ordinary CODESYS, and a file Volt itself had written — threw
	/// <c>InvalidSt</c> from inside the write, mid-batch. A constant cannot drift from itself.</para>
	///
	/// <para>They stay TWO patterns, deliberately. A method's <c>: type</c> is optional and a property's is
	/// mandatory, and merging them would have to make one of those wrong.</para></summary>
	private const string Modifiers = @"(?:(?:PUBLIC|PRIVATE|PROTECTED|INTERNAL|FINAL|ABSTRACT)\s+)*";

	/// <summary>Name + (methods only) return type off the signature line. The access-modifier group is
	/// matched but not captured into a field — nothing on the write path tells the IDE a member's
	/// visibility on create, so an extracted modifier would have no reader.</summary>
	private static (string name, string? returnType) ParseMethodOrActionSignature(string sig, string kind)
	{
		// COMMENTS OFF FIRST. An engineer documents a method on its signature line — `METHOD INTERNAL _mStrConcatA
		// //Concats string to sContent` — and CODESYS stores it exactly there. Every pattern below anchors at `$`,
		// so anything trailing failed the match outright: Volt PULLED such an FB and then refused its own text,
		// which means the POU could be pulled and never pushed back. Found by sweeping a real customer project.
		//
		// `CodeHelper.CodeOn` is the one definition of "the code on this line" and already handles `//` and
		// `(* … *)`; re-implementing the strip here is how the two would drift.
		var clean = CodeHelper.WithoutComments(sig);
		if (kind == ItemKind.Kinds.Method)
		{
			var m = Regex.Match(clean, $@"^METHOD\s+{Modifiers}(\w+)(?:\s*:\s*(.+?))?\s*;?\s*$",
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
		// COMMENTS OFF FIRST, exactly as the METHOD parser does — and for a sharper reason than symmetry. This
		// matched the RAW line, so `PROPERTY Ready : BOOL // the ready flag` yielded a DATA TYPE of
		// `BOOL // the ready flag`, which `PushService.CreateSeed` hands to TwinCAT as the property's type; and
		// a leading `(* … *)` threw `InvalidSt` mid-push. No corpus property carries a comment today while 207
		// method signatures do, so this is the same habit arriving at the one parser that could not take it.
		var m = Regex.Match(CodeHelper.WithoutComments(sig),
			$@"^PROPERTY\s+{Modifiers}(\w+)\s*:\s*(.+?)\s*;?\s*$",
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
		// NOT `.Trim()`. Peeling a directive is not licence to reformat what is left: SplitAtLine has already
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
			if (LineStartsWithKeyword(ctx.Code, keyword)) last = i;
		}
		return last;
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
