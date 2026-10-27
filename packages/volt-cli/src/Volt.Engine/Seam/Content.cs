using System;
using System.Collections.Generic;

namespace Volt.Engine.Seam;

/// <summary>How a body is stated on its <c>%LANGUAGE</c> line — or that there is none.</summary>
public enum BodyForm
{
    /// <summary><c>%LANGUAGE &lt;LANG&gt;</c>: the code is shown and editable.</summary>
    Shown,
    /// <summary><c>%LANGUAGE &lt;LANG&gt; UNSUPPORTED</c>: the IDE holds a body Volt does not show; no code.</summary>
    Hidden,
    /// <summary>No line: a member whose IDE object has no body slot (DIALECT C2n); no language, no code.</summary>
    NoSlot,
}

/// <summary>A body as a FACT, keyed by its language (vendor-neutrality S2): the language its line states, the code under
/// the line (empty for a hidden body or a member with no slot), how it is stated, and — for a hidden body only — why the host hides it.
/// The code never encodes its language; there is no "ST unless the first line says otherwise".</summary>
public sealed record BodyText(string Language, string Code, BodyForm Form, string? Why = null)
{
    public static BodyText Shown(string language, string code) => new(language, code ?? "", BodyForm.Shown);

    public static BodyText Hidden(string language, string why) => new(language, "", BodyForm.Hidden, why);

    public static readonly BodyText NoSlot = new("", "", BodyForm.NoSlot);
}

/// <summary>ONE model for an item's content, both directions, as the contract speaks it: what a host's
/// <c>Read</c> builds, a kind's <see cref="IItemFormat"/> renders and parses, and a host's <c>Write</c> applies.
/// <see cref="Body"/> is null where the kind has no body (<c>KindShape.Body</c> false); <see cref="Properties"/> is
/// required, so a host that has not read them cannot build the content.</summary>
public sealed record Content(
    string Kind,
    string Declaration,
    BodyText? Body,
    IReadOnlyList<ContentMember> Members,
    PropertySet Properties)
{
    /// <summary>A content with no members.</summary>
    public static Content Of(string kind, string declaration, BodyText? body, PropertySet properties) =>
        new(kind, declaration, body, Array.Empty<ContentMember>(), properties);
}

/// <summary>A member of a source item (a method, an action, a property, a routine), with its own body and properties.
/// <see cref="Folder"/> is its place inside the item; <see cref="Get"/>/<see cref="Set"/> are a property's accessors,
/// present exactly when the member has one. <see cref="Signature"/> is the declared type of a signature member (the
/// return type of a method, the type of a property) as a FORMAT read it off the text, for the create that needs it
/// (<see cref="CreateArgs.Signature"/>); null from a host, which reads no text for it.</summary>
public sealed record ContentMember(
    string Kind,
    string Name,
    string Declaration,
    BodyText? Body,
    PropertySet Properties,
    string? Folder = null,
    ContentAccessor? Get = null,
    ContentAccessor? Set = null,
    string? Signature = null);

/// <summary>A property's GET or SET: its own declaration and body (a signature-only accessor has a null body).</summary>
public sealed record ContentAccessor(string? Declaration, BodyText? Body);
