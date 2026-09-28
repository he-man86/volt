using System.Collections.Generic;

namespace Volt.Engine.Item;

/// <summary>
/// ONE model for an item's content, in BOTH directions. A read builds it from the IDE's PLCopen document; the ST
/// writer renders it to canonical workspace text; the ST reader parses that text back into it; a push splices it
/// into a document. Same record, four users.
/// <para><b>It used to be two records that were the same record.</b> The read path had
/// <c>PouData</c>/<c>ChildData</c> and the write path had <c>StSplitResult</c>/<c>StChild</c>, differing only in
/// field names (<c>BodyText</c> vs <c>Implementation</c>, <c>Kind</c> vs <c>PouKind</c>) and in how they spelled an
/// accessor. Two spellings of one fact is how the read and the write come to disagree, and this layer has already
/// paid for that three times — a graphical child flattened because the read said "graphical" and the write decided
/// from text; a body spliced over a sibling method because the read scoped by name and the write by document
/// order. Neither is possible between two users of the same record.</para>
/// <para>This is a TEXT-level model, deliberately: a body is workspace text — ST verbatim, a graphical body as
/// network text, a body Volt cannot write as its UNSUPPORTED <c>IMPLEMENTATION</c> line. It is what the workspace stores
/// and what the ST layer round-trips, and it is ALL the engine ever sees of a body. Whatever shape a vendor's own
/// storage has stops at the driver; this record is the boundary.</para>
/// <para><b><c>Unsupported</c></b>, here and on <see cref="Member"/> and <see cref="Accessor"/>: WHY a body is
/// <c>IMPLEMENTATION LD|FBD UNSUPPORTED</c> — the fact network text has no spelling for, as the driver's reader or writer
/// refused it — and null for every other body. The file does not carry it (the line says only that the body is
/// hidden), so it is set by the driver that read the body, for the pull to report, and is null on a body read from
/// a file. It is not content: nothing compares it, and the version is the file's.</para>
/// </summary>
public sealed record ItemContent(
    string Kind,
    string Declaration,
    string? Body,
    List<Member> Members,
    string? Unsupported = null);

/// <summary>A method, action or property. A PROPERTY is a member like any other — it used to be a member in two of
/// the four models and a separate list in the third, which forced <c>PouDocument.Splice</c> to union them back
/// together before it could ask "what does this item have".
/// <para><see cref="ReturnType"/> and <see cref="DataType"/> are WRITE-only and vendor-driven: TwinCAT wants an
/// interface member's type as the create's vInfo. They are read off the declaration by the ST reader and are null
/// coming from the IDE, where nothing needs them.</para></summary>
public sealed record Member(
    string Kind,
    string Name,
    string Declaration,
    string? Body,
    string? Folder = null,
    Accessor? Getter = null,
    Accessor? Setter = null,
    string? ReturnType = null,
    string? DataType = null,
    string? Unsupported = null);

/// <summary>A property's GET or SET. <b>Presence is the object</b> — null means the property has no such accessor,
/// and a push of that REMOVES it. That used to be a two-field convention on the read side (a getter existed if
/// either its code or its declaration was non-null), which is a rule every reader of the record had to know and
/// apply identically. A bodiless accessor — the interface case, where an accessor declares that a getter exists
/// and nothing more — is an Accessor with an empty <see cref="Body"/>, NOT a null one.</summary>
/// <summary>An accessor's declaration, as the IDE holds it — minus only the trailing NEWLINES the file format
/// cannot carry.
///
/// <para><b>It used to drop a bare <c>VAR</c>/<c>END_VAR</c> entirely</b>, justified in this very comment as "an
/// empty VAR block the engineer did not author". CENSUSED against live SP21 over pro2193's 464 accessor nodes
/// (<c>scripts/probe-accessor-census.py</c>): the vendor returns 35 DISTINCT declaration values, including 263
/// bare <c>VAR\nEND_VAR\n</c>, 107 genuinely EMPTY, and 6 with a LEADING newline. A synthesized default would be
/// one constant for every accessor that has none; three different "empty-looking" values, kept distinct, is
/// STORED CONTENT. Dropping the block put 223 of pro2193's getters at odds with the project.</para>
///
/// <para><b>And <c>Trim()</c> was the same bug one layer down.</b> A trailing newline is not representable —
/// <see cref="Volt.Engine.Format.St.StWriter"/> joins an accessor's parts with one — but a LEADING one is, and
/// six accessors in that census hold one. Same rule as everywhere else in the format: drop the newlines the
/// format cannot express, keep every other character.</para>
///
/// <para>Whitespace-only stays "no declaration": the writer would emit it as a blank line, which is
/// indistinguishable from absence in the file, so claiming to preserve it would be a promise the format cannot
/// keep.</para></summary>
public static class AccessorDeclaration
{
    public static string? Keep(string? decl) =>
        string.IsNullOrWhiteSpace(decl) ? null : decl!.TrimEnd('\n');
}

public sealed record Accessor(string? Declaration, string? Body, string? Unsupported = null)
{
    /// <summary>The code to WRITE for this accessor — never null, because the accessor exists.
    /// <para>This exists to keep one hazard closed. On the write path a null body means "remove the accessor",
    /// while the read path can legitimately produce an accessor whose body is null (a getter declared with no
    /// code). Passing <c>Body</c> straight through would silently DELETE such a getter on the next push — the
    /// exact bug the old two-field spelling had, arriving from the other direction. Absence is the null
    /// Accessor; an empty body is <c>""</c>.</para></summary>
    public string Code => Body ?? "";
}
