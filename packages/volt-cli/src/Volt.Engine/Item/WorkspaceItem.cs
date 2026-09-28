using System.Collections.Generic;
using Volt.Contracts;

namespace Volt.Engine.Item;

/// <summary>An item's materialized workspace content: the exact text the CLI writes to the file, plus
/// the full filename (name.ext). The single source of truth that both the content version (hashed)
/// and the fetched source are derived from, so they can't diverge.
/// <para><see cref="Unsupported"/> is the one thing about the item the text does NOT say: why each of its
/// <c>IMPLEMENTATION LD|FBD UNSUPPORTED</c> bodies is read-only (<see cref="ItemContent.Unsupported"/>). It rides beside
/// the text to the pull message, and is no part of the version — the file is.</para></summary>
public sealed record WorkspaceItem(string Text, string FullName, IReadOnlyList<UnsupportedBody> Unsupported);
