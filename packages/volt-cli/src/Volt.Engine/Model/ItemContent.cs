using System.Collections.Generic;

namespace Volt.Engine.Model;

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
/// <para>This is a TEXT-level model, deliberately: bodies are workspace text, not XML. The document's own view
/// (with its <c>XElement</c> bodies) is <c>Document.PouReader.ParsedPou</c>, and it stays separate — it is the
/// shape of the vendor's file, and collapsing the two would put XML in the push path's vocabulary.</para>
/// </summary>
public sealed record ItemContent(
    string Kind,
    string Declaration,
    string? Body,
    List<Member> Members);

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
    string? DataType = null);

/// <summary>A property's GET or SET. <b>Presence is the object</b> — null means the property has no such accessor,
/// and a push of that REMOVES it. That used to be a two-field convention on the read side (a getter existed if
/// either its code or its declaration was non-null), which is a rule every reader of the record had to know and
/// apply identically. A bodiless accessor — the interface case, where an accessor declares that a getter exists
/// and nothing more — is an Accessor with an empty <see cref="Body"/>, NOT a null one.</summary>
public sealed record Accessor(string? Declaration, string? Body)
{
    /// <summary>The code to WRITE for this accessor — never null, because the accessor exists.
    /// <para>This exists to keep one hazard closed. On the write path a null body means "remove the accessor",
    /// while the read path can legitimately produce an accessor whose body is null (a getter declared with no
    /// code). Passing <c>Body</c> straight through would silently DELETE such a getter on the next push — the
    /// exact bug the old two-field spelling had, arriving from the other direction. Absence is the null
    /// Accessor; an empty body is <c>""</c>.</para></summary>
    public string Code => Body ?? "";
}
