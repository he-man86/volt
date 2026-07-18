using System.Collections.Generic;

namespace Volt.Cli.Core.Workspace;

/// <summary>Canonical representation of a POU (program, FB, function, interface) with all its children
/// — the single data model shared between read (XML→Pou) and write (StText→Pou→XML) paths.</summary>
public sealed record PouData(
    string Kind,
    string Declaration,
    string? BodyLanguage,
    string? BodyText,
    List<ChildData> Children
);

public sealed record ChildData(
    string Kind,
    string Name,
    string Declaration,
    string? BodyLanguage,
    string? BodyText,
    string? Folder,
    string? GetterCode,
    string? SetterCode,
    string? GetterDeclaration,
    string? SetterDeclaration
);
