using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Volt.Contracts;

/// <summary><c>logs</c>: the tail of this host's own durable log.
///
/// <para>It exists because "why did the bridge do that" is the first question every support report asks, and
/// the answer sits in a file on a machine the asker cannot reach. A local client can be told to zip
/// <c>%LOCALAPPDATA%\Volt\logs</c>; a remote one cannot, and neither can a connector UI that wants to show the
/// last few lines without shelling out.</para>
///
/// <para>A PIPE op, not something the tunnel answers for itself. There is one entry point to this bridge and
/// every guard is on it; an op that existed only over the tunnel would be a second one, and the first guard
/// added to only one of them is the bug.</para></summary>
public sealed class LogsRequest
{
    /// <summary>How much of the tail to return. Optional; defaults to 64 KiB and is capped at 1 MiB.
    ///
    /// <para>Capped rather than unbounded because this crosses a pipe and possibly a network, and a caller
    /// asking for "everything" on a bridge that has been up for a fortnight is asking for the retention
    /// window. <see cref="LogsResponse.Truncated"/> says when there was more.</para></summary>
    [JsonPropertyName("maxBytes")]
    public int? MaxBytes { get; set; }
}

/// <summary>The tail, newest lines last, with the files it came from.</summary>
public sealed class LogsResponse
{
    /// <summary>The log source this host writes under — <c>codesys</c>, <c>twincat</c>, <c>connector</c>.
    /// Echoed so a caller holding several tails can tell them apart without parsing a filename.</summary>
    [JsonPropertyName("source")]
    public string Source { get; set; } = "";

    /// <summary>The tail itself, whole lines only. Empty string when nothing has been logged yet — which is a
    /// real answer, not an error.</summary>
    [JsonPropertyName("text")]
    public string Text { get; set; } = "";

    /// <summary>True when older lines exist beyond what was returned. A caller that sees this and needs more
    /// asks again with a larger <see cref="LogsRequest.MaxBytes"/>.</summary>
    [JsonPropertyName("truncated")]
    public bool Truncated { get; set; }

    /// <summary>The files the text came from, newest first. Empty when there are none.</summary>
    [JsonPropertyName("files")]
    public List<string> Files { get; set; } = new List<string>();
}
