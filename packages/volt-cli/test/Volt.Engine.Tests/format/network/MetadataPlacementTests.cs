using Xunit;
using Volt.Engine.Format.Network;

namespace Volt.Engine.Tests;

/// <summary>
/// WHAT THE PUSH GATE ALREADY DOES with a label or comment the model cannot hold — measured, because the
/// proposal that asked for LSP diagnostics assumed the answer and got it wrong in both directions.
///
/// <para>A network carries exactly ONE label, one title and one comment: per-network metadata on `INetwork` on
/// both vendors, not items in the statement list. The text grammar admits them as ordinary statements, so it
/// accepts bodies the model cannot represent — and `network-text-placement-rules` §1.1 exists to establish what
/// happens to those TODAY, before designing anything.</para>
///
/// <para><b>The answer is not "nothing", and it is not uniform.</b> Four of the five shapes are already refused
/// by the canonical-form check — it re-emits the parsed model and compares, so metadata that cannot round-trip
/// comes back spelled differently and the comparison fails. One is not. That asymmetry is the finding, and it
/// shrinks the change: the LSP is mostly moving an existing refusal earlier, not inventing a rule.</para>
/// </summary>
public class MetadataPlacementTests
{
    private static string Verdict(string body)
    {
        var ex = Record.Exception(() => NetworkTextGate.Validate(body));
        return ex?.Message ?? "<ACCEPTED>";
    }

    /// <summary>The shape that round-trips: label at the head, one comment under it. The control — without it,
    /// "everything is refused" would look like a pass.</summary>
    [Fact]
    public void The_canonical_shape_is_accepted()
        => Assert.Equal("<ACCEPTED>",
            Verdict("NETWORK 0 LD LABEL: Guard TITLE: \"interlock\"\n  // holds the drive off\n  out := (a AND b);\nEND_NETWORK\n"));

    /// <summary>TWO LABELS — refused, and the message NAMES THE DUPLICATE.
    ///
    /// <para>The proposal assumed this produced a generic "not in canonical form" and argued the LSP was needed
    /// to say what was actually wrong. It is not: the reader refuses before the canonical check gets a chance,
    /// with `label 'Second' — the network already declares one`. The LSP would move that message earlier, into
    /// the editor; it would not improve it.</para></summary>
    [Fact]
    public void Two_labels_are_refused_and_the_message_names_the_second_one()
    {
        var message = Verdict("NETWORK 0 LD LABEL: First LABEL: Second\n  out := a;\nEND_NETWORK\n");

        Assert.NotEqual("<ACCEPTED>", message);
        Assert.Contains("Second", message);
        Assert.Contains("label", message, System.StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>A LABEL AFTER A STATEMENT — refused. Its position is not represented, so the re-emit moves it to
    /// the network head and the text no longer matches.</summary>
    [Fact]
    public void A_label_after_a_statement_is_refused()
        => Assert.NotEqual("<ACCEPTED>",
            Verdict("NETWORK 0 LD\n  out := a;\n  Later:\n  b := c;\nEND_NETWORK\n"));

    /// <summary>A COMMENT AFTER A STATEMENT — refused, same mechanism.</summary>
    [Fact]
    public void A_comment_after_a_statement_is_refused()
        => Assert.NotEqual("<ACCEPTED>",
            Verdict("NETWORK 0 LD\n  out := a;\n  // trailing\nEND_NETWORK\n"));

    /// <summary>TWO COMMENTS ARE ACCEPTED, AND NOTHING IS LOST — they are JOINED, not collapsed.
    ///
    /// <para><c>Network.Comment</c> is a multi-line string, and consecutive `//` lines before the first
    /// statement are read into it as separate lines. The writer re-emits one `//` per line, so the round trip is
    /// exact and the canonical gate has nothing to object to.</para>
    ///
    /// <para><b>This refutes the proposal's sharpest claim.</b> It listed "several comments … all collapse into
    /// the single `Network.Comment`" as silent data loss and made `network-duplicate-comment` a diagnostic. There
    /// is no collapse and no loss: one comment BOX in the IDE holds multiple lines, which is exactly what the
    /// engineer sees. A warning here would fire on correct, round-tripping text.</para></summary>
    [Fact]
    public void Two_comment_lines_are_joined_into_one_multi_line_comment_losslessly()
    {
        var twoComments = "NETWORK 0 LD\n  // first\n  // second\n  out := a;\nEND_NETWORK\n";

        Assert.Equal("<ACCEPTED>", Verdict(twoComments));

        var network = Assert.Single(NetworkTextReader.Parse(twoComments).Networks);
        Assert.Contains("first", network.Comment);
        Assert.Contains("second", network.Comment);          // BOTH survive

        // And the round trip is exact — which is why the canonical gate accepts it.
        Assert.Equal(twoComments, NetworkTextWriter.Write(NetworkTextReader.Parse(twoComments)));
    }
}
