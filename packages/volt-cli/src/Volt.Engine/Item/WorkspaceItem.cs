using System.Collections.Generic;

namespace Volt.Engine.Item;

/// <summary>An item's materialized workspace content: the exact text the CLI writes to the file, plus
/// the full filename (name.ext). The single source of truth that both the content version (hashed)
/// and the fetched source are derived from, so they can't diverge.
/// <para><see cref="Hidden"/> is the one thing about the item the text does NOT say in full: which of its bodies read
/// <c>IMPLEMENTATION &lt;LANG&gt; UNSUPPORTED</c>, and, for an LD/FBD one, why (<see cref="ItemContent.Unsupported"/>).
/// It rides beside the text to the pull message and to <c>grep</c>'s <c>notSearched</c>, and is no part of the
/// version — the file is.</para></summary>
public sealed record WorkspaceItem(string Text, string FullName, IReadOnlyList<HiddenBody> Hidden);

/// <summary>A body of the item that reads <c>IMPLEMENTATION &lt;LANG&gt; UNSUPPORTED</c>: the member whose body it is
/// (<c>Reset</c>, <c>Ready GET</c>; null for the item's own), the language its line states, and — for an LD/FBD body,
/// a language Volt does read — the fact network text had no spelling for. A CFC, SFC or IL body carries no reason: its
/// line states the language, and "Volt does not read that language" is the whole reason.</summary>
public sealed record HiddenBody(string? Member, string Language, string? Reason);
