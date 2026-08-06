using Volt.Engine.Wire;

namespace Volt.Cli.Sync;

/// <summary>
/// Composes a multi-phase CLI operation's progress into ONE monotonic stream. The real sequences are
/// <c>pull</c> = fetch → import objects → merge, and <c>init</c> = fetch → import objects → write files →
/// finalize. (Materialize is folded into its caller — a fast in-memory transform gets no phase of its own.) A
/// phase either streams its own <c>done/total</c> or is indeterminate (<c>Enter</c>).
/// The bridge only knows its own fetch, so phase composition can't live there; it lives here,
/// where the command orchestrates the phases. Every frame is stamped with the phase label + its
/// <c>index</c>/<c>count</c>, so the frontend folds them into one 0–100 bar — <c>(index + done/total) / count</c> —
/// while the human CLI still sees the real per-phase counts. Single-phase commands don't need this: their frames
/// carry no phase index, and <c>done/total</c> alone is the whole bar.
/// </summary>
internal sealed class PhaseProgress
{
    private readonly Action<ProgressFrame>? _sink;
    private readonly string _operation;
    private readonly int _count;

    public PhaseProgress(Action<ProgressFrame>? sink, string operation, int phaseCount)
    {
        _sink = sink;
        _operation = operation;
        _count = phaseCount;
    }

    /// <summary>An <c>onProgress</c> for phase <paramref name="index"/> that re-tags a wrapped sub-op's own frames
    /// (e.g. the bridge fetch), preserving their <c>done/total</c>.</summary>
    public Action<ProgressFrame>? Wrap(int index, string label) =>
        _sink is null ? null : f => Send(index, label, f.Done, f.Total);

    /// <summary>Report phase <paramref name="index"/> progress from a CLI-driven loop.</summary>
    public void Report(int index, string label, int done, int total) => Send(index, label, done, total);

    /// <summary>Enter an indeterminate phase (no total) — marks the phase active at its slice start.</summary>
    public void Enter(int index, string label) => Send(index, label, 0, null);

    private void Send(int index, string label, int done, int? total) =>
        _sink?.Invoke(new ProgressFrame
        {
            Operation = _operation,
            Phase = label,
            Done = done,
            Total = total,
            PhaseIndex = index,
            PhaseCount = _count,
        });
}
