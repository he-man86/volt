using System;
using System.Xml.Linq;

namespace Volt.Engine.Source.Body
{
    /// <summary>What a body write is allowed to do to the body already there.</summary>
    internal enum BodyWrite
    {
        /// <summary>Write it.</summary>
        Proceed,
        /// <summary>Write NOTHING and report no change — the push restated the marker an unsupported body
        /// materializes as, which is the ordinary round-trip of a CFC/SFC/IL POU, not an edit.</summary>
        NoOp,
    }

    /// <summary>
    /// The ONE gate every body write passes, wherever the body sits.
    ///
    /// <para>There were four call sites and three different gates. The root body ran five checks; a property
    /// accessor and an existing child ran two each; a CREATED child ran none at all. They were not variations on
    /// a theme — they gave DIFFERENT ANSWERS to the same input. A restated unsupported-body marker was the
    /// ordinary no-op at the root and a hard refusal on a child, while the root's own comment called that same
    /// asymmetry, in the other direction, unjustified.</para>
    ///
    /// <para>Every check here is load-bearing and each was added after something broke. Skipping the
    /// unmodelled-language check is how a body no codec owns got written straight over. Skipping the marker's
    /// SECOND arm is how a stale marker over a real body replaced an engineer's code with a comment. Getting
    /// <paramref name="establishing"/> wrong is how every LD create on TwinCAT failed. Four copies of that is
    /// four chances to omit one, and the omissions are exactly what happened.</para>
    /// </summary>
    internal static class BodyGuard
    {
        /// <summary>Decide whether <paramref name="pushed"/> may write over what is in <paramref name="body"/>.
        ///
        /// <para><paramref name="present"/> is the codec owning the body element as it stands, or null when the
        /// element records no language decision (a blank ST — what a fresh POU is created with).
        /// <paramref name="establishing"/> says the caller CREATED this item in the same push, so the body
        /// present is Volt's own seed rather than an engineer's choice — the one thing the document cannot tell.
        /// <paramref name="what"/> names the item in every refusal, so a push receipt is actionable on its
        /// own.</para></summary>
        public static BodyWrite Require(XElement body, string bodyText, BodyCodec pushed, BodyCodec? present,
                                        bool establishing, string what)
        {
            if (present is not null && present.Unsupported)
            {
                // Restating the MARKER is the ordinary round-trip, not an edit: it is what an unsupported body
                // materializes as, so it is exactly what comes back on the next push of that file. The caller
                // writes nothing and keeps going — its declaration edit to a CFC POU still lands. Refusing here
                // made that edit unreachable: the whole push was rejected over a body nobody wrote.
                if (BodyMarker.Is(bodyText)) return BodyWrite.NoOp;
                throw new InvalidOperationException(
                    $"{what} has a {present.Language} body, which Volt does not support — edit it in the IDE, " +
                    "not via push.");
            }

            // The OTHER arm of the same rule, and the reason the marker cannot simply be waved through above: a
            // marker over a body that is NOT unsupported is stale or hand-written, and Volt would otherwise treat
            // it as ordinary ST — `NetworkText.LanguageOf` sees no network text, the ST codec takes it, and the
            // engineer's real body is replaced by a COMMENT.
            if (BodyMarker.Is(bodyText))
                throw new InvalidOperationException(
                    $"{what} carries an unsupported-body marker but its body in the IDE is " +
                    $"{present?.Language ?? "textual"} — remove the marker and push real source, or pull first.");

            // A body element NO codec owns is a language Volt does not model — refuse it, and for a stronger
            // reason than a CFC: with a CFC we at least know what we are declining to touch. `present` is null
            // here, so every check below would pass and the write would proceed straight over it.
            // `establishing` does not exempt this one: `CreateChild` seeds a language Volt asked for, so an
            // unmodelled body on a create is not our seed — it is somebody else's body under our name.
            if (BodyCodec.UnmodelledLanguageIn(body) is { } unmodelled)
                throw new InvalidOperationException(
                    $"{what} has a {unmodelled} body, which Volt does not model — it would be overwritten. " +
                    "Edit it in the IDE.");

            // The language guard protects a body the ENGINEER made. On a create there is no such body — the only
            // one present is the seed laid down microseconds ago, in this same push.
            //
            // That distinction cannot be read off the document, and assuming it could cost every LD create on
            // TwinCAT: `CreateChild` is handed the pushed language and TwinCAT REFUSES "LD" (DIALECT C6), so the
            // driver creates FBD. The document then shows an empty <FBD/> — by content "made graphical on
            // purpose" — and the guard refused the very LD body the push was creating. Volt refusing a Volt
            // decision, one line after making it.
            if (!establishing && present is not null
                && !string.Equals(present.Language, pushed.Language, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    $"{what} has a {present.Language} body in the IDE but the push carries {pushed.Language} — " +
                    "edit it in the IDE, or delete it first to replace it.");

            return BodyWrite.Proceed;
        }
    }
}
