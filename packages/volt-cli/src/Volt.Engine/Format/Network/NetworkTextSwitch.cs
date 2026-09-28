namespace Volt.Engine.Format.Network;

/// <summary>
/// Whether this process shows LD and FBD bodies as network text at all — the production switch (openspec
/// <c>implementation-keyword</c> 3c). ON only when the process environment holds <c>VOLT_GRAPHICAL=1</c>; the shipped
/// build does not set it, and development (<c>ide.ps1</c>, the test suites, the e2e and recording scripts) does.
///
/// <para><b>Why a switch.</b> Network text is not ready to ship, and ST is. Off, every LD and FBD body is what a body
/// the text cannot spell already is — <c>IMPLEMENTATION LD|FBD UNSUPPORTED</c>, with <see cref="DisabledReason"/> in the
/// pull message (<see cref="NetworkText.Pulled"/>) — so the item's declaration stays editable, pull and push are never
/// blocked, and the IDE's ladder is never written (<c>ImplementationMarker.Written</c>). Network text pushed at such a
/// bridge is refused by name (<see cref="NetworkText.Validate"/>). Nothing new had to be built for "off": it is the
/// hidden-body path section 3b already holds to "nothing in the IDE is overwritten".</para>
///
/// <para><b>Why the process environment, read once.</b> The bridge is where a body is read and written, and it runs in
/// the vendor's process: IN CODESYS (so CODESYS must be started with the variable — <c>ide.ps1</c> does), and in the
/// TwinCAT worker. One read at first use makes it one answer for the process's life — a switch that could flip between
/// the pull and the push of one body would hand back a file the next push reads differently. This is the ONE place
/// the C# runtime reads the variable, and a repo gate holds that. The LSP has its own twin
/// (<c>NETWORK_TEXT_ENABLED</c>), read in the EDITOR's process: two processes, so they can differ, and neither claims
/// the other's answer — the bridge reports its own in <c>health</c> (<c>HealthResponse.NetworkText</c>) for a client that
/// needs network text (the corpus refresh, the language recorder), which setting the variable in its OWN process would
/// not turn on.</para>
///
/// <para><b>Off never blocks a push.</b> A workspace pulled while this was off states its ladders
/// <c>IMPLEMENTATION LD|FBD UNSUPPORTED</c>; pushed at a bridge with it on, that line over the same ladder is the same
/// body hidden, never written (<c>BodyFormatGuard</c>), so the ST and declaration edits beside it land.</para>
/// </summary>
public static class NetworkTextSwitch
{
    /// <summary>The environment variable that turns LD and FBD on: <c>VOLT_GRAPHICAL=1</c>, and nothing else.</summary>
    public const string Variable = "VOLT_GRAPHICAL";

    /// <summary>Why an LD or FBD body is hidden while the switch is off — the reason the pull message names.</summary>
    public const string DisabledReason = "LD and FBD are not enabled in this build";

    /// <summary>Is network text on in this process? The setter is the test suites' alone: they run with the switch on
    /// and turn it off around a test that proves the production build — there is no other way to have both in one
    /// process.</summary>
    public static bool Enabled { get; internal set; } = System.Environment.GetEnvironmentVariable(Variable) == "1";
}
