using System.Collections.Generic;

namespace Volt.Engine.Item;

/// <summary>
/// ONE model for an item's content, in BOTH directions. A driver's read builds it from the IDE; the ST writer renders
/// it to canonical workspace text; the ST reader parses that text back into it; a driver's write applies it to the
/// IDE. Same record, four users — one spelling of each fact, so the read and the write cannot disagree about it.
/// <para>This is a TEXT-level model, deliberately: a body is workspace text — ST verbatim, a graphical body as
/// network text, a body Volt cannot write as its UNSUPPORTED <c>%LANGUAGE</c> line. It is what the workspace stores
/// and what the ST layer round-trips, and it is ALL the engine ever sees of a body. Whatever shape a vendor's own
/// storage has stops at the driver; this record is the boundary.</para>
/// <para><b><c>Unsupported</c></b>, here and on <see cref="Member"/> and <see cref="Accessor"/>: WHY a body is
/// <c>%LANGUAGE LD|FBD UNSUPPORTED</c> — the fact network text has no spelling for, as the driver's reader or writer
/// refused it — and null for every other body. The file does not carry it (the line says only that the body is
/// hidden), so it is set by the driver that read the body, for the pull to report, and is null on a body read from
/// a file. It is not content: nothing compares it, and the version is the file's.</para>
/// <para><b><c>Stated</c></b>, here and on <see cref="Member"/> and <see cref="Accessor"/>: the body's language as a
/// FACT (<see cref="StatedLanguage"/>, openspec <c>bridge-refusal-review</c> D6) — set by whoever knows it, a driver
/// from the vendor's own aspect or archive, the ST reader from the line it parsed (or from its absence:
/// <see cref="StatedLanguage.NoSlot"/>) — and null exactly where there is no body text and nothing stated.
/// The push's guard compares it (<c>BodyFormatGuard</c>) instead of decoding the language back out of the
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
/// A body's language, as its <c>%LANGUAGE</c> line states it: <see cref="Language"/> in its one spelling (<c>ST</c>,
/// <c>LD</c>, <c>FBD</c>, or a hidden body's <c>CFC</c> / <c>SFC</c> / <c>IL</c> / the vendor's own word), and whether
/// Volt shows it (<see cref="Hidden"/>: the body is its <c>%LANGUAGE &lt;LANG&gt; UNSUPPORTED</c> line).
///
/// <para><b>Why a record and not the text (D6).</b> The driver knows a body's language as a vendor fact — CODESYS from
/// the aspect class and its view mode, TwinCAT from its archive. Encoded into the text and decoded back by the push's
/// guard, it would hold only while every reader kept the encoding lossless; so the fact travels as a fact.</para>
/// <para><b><see cref="IsNoSlot"/></b> is no language: a METHOD or a property's GET/SET whose IDE object has NO body
/// slot (CODESYS's <c>AbstractPOUMethodObject</c>, an abstract property's slotless accessor; DIALECT C2n), written with
/// no <c>%LANGUAGE</c> line and nothing after its declaration (openspec <c>language-line</c>). Its body is null; the
/// fact is stated by the driver that found no slot and by the reader that found no line, and the guard reads it before
/// any language rule.</para>
/// </summary>
public sealed record StatedLanguage(string Language, bool Hidden, bool IsNoSlot = false)
{
    /// <summary>A body Volt shows as ST.</summary>
    public static readonly StatedLanguage St = new(Volt.Engine.Format.Body.Languages.St, false);

    /// <summary>A member with no body slot: no <c>%LANGUAGE</c> line, no code, nothing written (its body is null).</summary>
    public static readonly StatedLanguage NoSlot = new("", true, IsNoSlot: true);

    /// <summary>A body Volt shows in <paramref name="language"/> (ST, LD or FBD).</summary>
    public static StatedLanguage Shown(string language) => new(language, false);

    /// <summary>A body Volt hides — its UNSUPPORTED line names <paramref name="language"/>.</summary>
    public static StatedLanguage HiddenIn(string language) => new(language, true);

    /// <summary>Whether Volt shows this body as network text (LD or FBD).</summary>
    public bool IsNetwork => !Hidden && Volt.Engine.Format.Body.Languages.IsNetwork(Language);

    /// <summary>The language as its line states it: <c>LD</c>, or <c>%LANGUAGE CFC UNSUPPORTED</c> for a hidden body —
    /// and, for a member with no body slot, that it states no line.</summary>
    public override string ToString() =>
        IsNoSlot ? "no %LANGUAGE line (no body slot)"
        : Hidden ? Volt.Engine.Format.St.PropertyLines.UnsupportedLine(Language) : Language;
}

/// <summary>A method, action or property. A PROPERTY is a member like any other, in the one member list.
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
/// and a push of that REMOVES it — no reader infers presence from its fields. A bodiless accessor — the interface case, where an accessor declares that a getter exists
/// and nothing more — is an Accessor with an empty <see cref="Body"/>, NOT a null one.
/// <para>Its declaration travels VERBATIM (openspec <c>bridge-one-to-one</c> §1.1), a bare <c>VAR</c>/<c>END_VAR</c>,
/// an empty one and a leading newline included: the writer puts the text and then its own separator, and the reader
/// strips only that.</para></summary>
public sealed record Accessor(string? Declaration, string? Body, string? Unsupported = null, StatedLanguage? Stated = null)
{
    /// <summary>The code to WRITE for this accessor — never null, because the accessor exists.
    /// <para>This exists to keep one hazard closed. On the write path a null body means "remove the accessor",
    /// while the read path can legitimately produce an accessor whose body is null (a getter declared with no
    /// code). Passing <c>Body</c> straight through would silently DELETE such a getter on the next push. Absence is
    /// the null Accessor; an empty body is <c>""</c>.</para></summary>
    public string Code => Body ?? "";
}
