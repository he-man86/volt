namespace Volt.Engine.Format.Body
{
    /// <summary>The stand-in text a body Volt cannot write materializes as: <c>(* @volt-graphical: CFC *)</c>.
    /// <para>A read-only language (CFC, SFC, IL) has no text form Volt can produce or accept, so its file carries
    /// this marker instead of source. Pushing the marker back is the ordinary no-op — the splice leaves that body
    /// exactly as it is — which is what makes a POU that merely CONTAINS a read-only member editable at all.</para>
    /// <para><b>Level 0: this file has no Volt dependency, and that is the point.</b> The marker is written by the
    /// body codec, read by the push service and by the document splice, and produced during materialization —
    /// three layers that do not otherwise know about each other. It used to live on <c>Workspace.Materializer</c>,
    /// which made the CODEC depend on Workspace and closed a <c>Body → Workspace → Body</c> namespace cycle
    /// invisible to the build. A shared vocabulary belongs below every layer that shares it, not inside whichever
    /// one happened to need it first.</para>
    /// <para>The literal is a FILE FORMAT — it sits in source files in users' git history — so it cannot change
    /// without breaking recognition of already-pulled workspaces. The word "graphical" is therefore kept even
    /// though IL is textual; what the marker actually means is "no editable text form".</para></summary>
    public static class BodyMarker
    {
        private const string Prefix = "(* @volt-graphical:";

        /// <summary>The marker for a language, e.g. <c>(* @volt-graphical: CFC *)</c>.</summary>
        public static string For(string language) => $"{Prefix} {language} *)";

        /// <summary>The language a marker names, e.g. <c>CFC</c> for <c>(* @volt-graphical: CFC *)</c>, or null
        /// when the text is not a marker. A refusal has to NAME the language: "Volt does not support CFC" tells
        /// an engineer this is a Volt limit, where a bare "refused" leaves them looking for a mistake in what
        /// they pushed.</summary>
        public static string? LanguageOf(string? impl)
        {
            if (!Is(impl)) return null;
            var text = impl!.TrimStart().Substring(Prefix.Length);
            var end = text.IndexOf("*)", System.StringComparison.Ordinal);
            return (end < 0 ? text : text.Substring(0, end)).Trim() is { Length: > 0 } lang ? lang : null;
        }

        /// <summary>Is this body text the marker rather than real source? A prefix test against the same literal
        /// the writer uses, so reader and writer cannot drift apart.</summary>
        public static bool Is(string? impl) =>
            impl != null && impl.TrimStart().StartsWith(Prefix, System.StringComparison.Ordinal);
    }
}
