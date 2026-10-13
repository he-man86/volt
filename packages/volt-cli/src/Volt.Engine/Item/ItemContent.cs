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
/// <para><b><c>Stated</c></b>, here and on <see cref="Member"/> and <see cref="Accessor"/>: the body's language as a
/// FACT (<see cref="StatedLanguage"/>, openspec <c>bridge-refusal-review</c> D6) — set by whoever knows it, a driver
/// from the vendor's own aspect or archive, the ST reader from the line it parsed — and null exactly where there is no
/// body text. The push's guard compares it (<c>BodyFormatGuard</c>) instead of decoding the language back out of the
/// text. Like <c>Unsupported</c> it is not content: nothing hashes it, and the version is the file's.</para>
/// <para><b><c>Properties</c></b>, here and on <see cref="Member"/>: the object's <see cref="ObjectProperties"/> — its
/// class where the text cannot tell it, its build properties, its comment, its network-variable settings, its file link
/// (openspec <c>bridge-one-to-one</c> §1.2), spelled as the <c>%</c>-lines (<see cref="Volt.Engine.Format.St.PropertyLines"/>).
/// REQUIRED and never defaulted: a driver that has not read an object's properties cannot build its content, so a push
/// can never write "not excluded" over an excluded object because a reader forgot to look. It IS content: the file
/// spells it, so the version hashes it.</para>
/// </summary>
public sealed record ItemContent(
    string Kind,
    string Declaration,
    string? Body,
    List<Member> Members,
    ObjectProperties Properties,
    string? Unsupported = null,
    StatedLanguage? Stated = null);

/// <summary>
/// A body's language, as its <c>IMPLEMENTATION</c> line states it: <see cref="Language"/> in its one spelling (<c>ST</c>,
/// <c>LD</c>, <c>FBD</c>, or a hidden body's <c>CFC</c> / <c>SFC</c> / <c>IL</c> / the vendor's own word), and whether
/// Volt shows it (<see cref="Hidden"/>: the body is its <c>IMPLEMENTATION &lt;LANG&gt; UNSUPPORTED</c> line).
///
/// <para><b>Why a record and not the text (D6).</b> The driver knows a body's language as a vendor fact — CODESYS from
/// the aspect class and its view mode, TwinCAT from its archive — and encoded it into the text (no line for ST, the
/// keyword line for network text, the UNSUPPORTED line for a hidden body), and the push's guard decoded it back. That
/// held only while every reader kept the encoding lossless, in three places; one that forgot made the guard misjudge
/// silently. The fact travels as a fact now.</para>
/// <para><b><see cref="IsNone"/></b> is no language: the NONE line, an abstract member with no code (<c>IMPLEMENTATION
/// NONE</c>, openspec <c>abstract-member-push</c> / <c>abstract-member-parity</c>). It was <c>NoSlot</c> while only a
/// CODESYS object with no body slot read so; since the engine folds every ABSTRACT member with no code into it
/// (<c>AbstractMemberFold</c>) it says nothing about a slot. It is a value of its own — not <c>HiddenIn("NONE")</c>, the
/// hidden body of a vendor language spelled NONE (<c>IMPLEMENTATION NONE UNSUPPORTED</c>) — and the guard reads it
/// before any language rule.</para>
/// </summary>
public sealed record StatedLanguage(string Language, bool Hidden, bool IsNone = false)
{
    /// <summary>A body Volt shows as ST.</summary>
    public static readonly StatedLanguage St = new(Volt.Engine.Format.Body.Languages.St, false);

    /// <summary>An abstract member with no code: its line is <c>IMPLEMENTATION NONE</c>. Hidden (no code is shown) and
    /// naming no language; written as an empty ST body where the object has a slot (<c>ImplementationMarker.Written</c>).</summary>
    public static readonly StatedLanguage None = new(Volt.Engine.Format.St.ImplementationMarker.NoneWord, true, IsNone: true);

    /// <summary>A body Volt shows in <paramref name="language"/> (ST, LD or FBD).</summary>
    public static StatedLanguage Shown(string language) => new(language, false);

    /// <summary>A body Volt hides — its UNSUPPORTED line names <paramref name="language"/>.</summary>
    public static StatedLanguage HiddenIn(string language) => new(language, true);

    /// <summary>Whether Volt shows this body as network text (LD or FBD).</summary>
    public bool IsNetwork => !Hidden && Volt.Engine.Format.Body.Languages.IsNetwork(Language);

    /// <summary>The language as its line states it: <c>LD</c>, or <c>IMPLEMENTATION CFC UNSUPPORTED</c> for a hidden body.</summary>
    public override string ToString() =>
        IsNone ? Volt.Engine.Format.St.ImplementationMarker.NoneLine
        : Hidden ? Volt.Engine.Format.St.ImplementationMarker.Unsupported(Language) : Language;
}

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
    ObjectProperties Properties,
    string? Folder = null,
    Accessor? Getter = null,
    Accessor? Setter = null,
    string? ReturnType = null,
    string? DataType = null,
    string? Unsupported = null,
    StatedLanguage? Stated = null);

/// <summary>A property's GET or SET. <b>Presence is the object</b> — null means the property has no such accessor,
/// and a push of that REMOVES it. That used to be a two-field convention on the read side (a getter existed if
/// either its code or its declaration was non-null), which is a rule every reader of the record had to know and
/// apply identically. A bodiless accessor — the interface case, where an accessor declares that a getter exists
/// and nothing more — is an Accessor with an empty <see cref="Body"/>, NOT a null one.</summary>
// <para><b>An accessor's declaration travels VERBATIM</b>, as every text does (openspec <c>bridge-one-to-one</c> §1.1
// "every character"). It used to pass <c>AccessorDeclaration.Keep</c>, which first dropped a bare <c>VAR</c>/<c>END_VAR</c>
// (CENSUSED against live SP21 over pro2193's 464 accessor nodes — <c>probe-accessor-census.py</c>, deleted: 35 DISTINCT
// declaration values, 263 bare <c>VAR\nEND_VAR\n</c>, 107 EMPTY, 6 with a LEADING newline — all stored content), and
// then still dropped the TRAILING newlines and read a whitespace-only one as none, on the reasoning that the file could not
// carry them. It can: the writer puts the text and then its own separator, and the reader strips only that.</para>

public sealed record Accessor(string? Declaration, string? Body, string? Unsupported = null, StatedLanguage? Stated = null)
{
    /// <summary>The code to WRITE for this accessor — never null, because the accessor exists.
    /// <para>This exists to keep one hazard closed. On the write path a null body means "remove the accessor",
    /// while the read path can legitimately produce an accessor whose body is null (a getter declared with no
    /// code). Passing <c>Body</c> straight through would silently DELETE such a getter on the next push — the
    /// exact bug the old two-field spelling had, arriving from the other direction. Absence is the null
    /// Accessor; an empty body is <c>""</c>.</para></summary>
    public string Code => Body ?? "";
}
