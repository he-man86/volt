namespace Volt.Bridge.Core.Workspace;

/// <summary>An item's materialized workspace content: the exact text the CLI writes to the file, plus
/// the body language (drives the file extension) for source kinds. The single source of truth that
/// both the content version (hashed) and the fetched source are derived from, so they can't diverge.</summary>
public sealed record WorkspaceItem(string Text, string? Language);
