using System.Collections.Generic;

namespace Volt.Engine.Workspace;

/// <summary>Canonical representation of a POU (program, FB, function, interface) with all its children —
/// the READ path's data model: <c>Materializer.BuildSource</c>/<c>BuildPouFromXml</c> builds it from the
/// item's PLCopen XML, <c>PouToStText.Convert</c> renders it to canonical workspace ST. There is no
/// StText→Pou→XML write path: push writes each item through <c>Ide/ICodeStore</c> (<c>WriteText</c>/
/// <c>WriteXml</c>), so nothing assembles a <see cref="PouData"/> from ST.
/// <para>There is deliberately no body-LANGUAGE field: the language is already baked into
/// <see cref="BodyText"/> by <c>Materializer.BodyTextOf</c> (VG for FBD/LD, the `@volt-graphical` marker for
/// CFC/SFC), so <c>PouToStText</c> has nothing to read it for.</para></summary>
public sealed record PouData(
    string Kind,
    string Declaration,
    string? BodyText,
    List<ChildData> Children
);

public sealed record ChildData(
    string Kind,
    string Name,
    string Declaration,
    string? BodyText,
    string? Folder,
    string? GetterCode,
    string? SetterCode,
    string? GetterDeclaration,
    string? SetterDeclaration
);
