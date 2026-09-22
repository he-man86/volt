using System.Collections.Generic;
using Volt.Engine.Item;

namespace Volt.Engine.Ide
{
    /// <summary>
    /// EVERY BODY A DOCUMENT CARRIES, PAIRED WITH THE DECLARATION IT RESOLVES AGAINST.
    ///
    /// <para>Pure, and above the vendor seam because BOTH drivers need it for the same reason: a push pre-flight
    /// has to reach every body a source file holds, and each body resolves its names in its own scope. It lived
    /// in the TwinCAT driver, so when the CODESYS driver needed the same walk the choice was a second copy or a
    /// missing pre-flight — and for a while it was the missing pre-flight.</para>
    ///
    /// <para><b>Pairing it wrong is a pre-flight that invents refusals</b>, which is the one failure mode a
    /// pre-flight must not have: a method's <c>t1(IN := a)</c> resolves <c>t1</c> in the METHOD's VAR block
    /// first and the POU's after, so handing a validator only the POU's declaration refuses a body the write
    /// itself would take.</para>
    /// </summary>
    public static class SourceScopes
    {
        /// <summary>Every body in the document — the POU's own, each member's, and a property's ACCESSORS,
        /// which have no body of their own and are the half a plain <c>m.Body</c> walk silently skips.</summary>
        public static IEnumerable<(string? Body, string? Declaration)> BodiesOf(ItemContent split)
        {
            yield return (split.Body, split.Declaration);
            foreach (var m in split.Members)
            {
                // An ACTION has NO declaration of its own — IEC gives it a name and a body and nothing else —
                // so it resolves purely against the POU's.
                var scope = Scope(m.Kind == ItemKind.Kinds.Action ? null : m.Declaration, split.Declaration);
                yield return (m.Body, scope);
                yield return (m.Getter?.Body, Scope(m.Getter?.Declaration, scope));
                yield return (m.Setter?.Body, Scope(m.Setter?.Declaration, scope));
            }
        }

        /// <summary>The declarations a body resolves against: the member's own FIRST, then the owner's.
        ///
        /// <para><b>A stateful FB instance lives in the enclosing POU's VAR block, not in the member's.</b> A
        /// graphical body naming <c>t1(IN := a)</c> needs <c>t1 : TON;</c> to resolve the call's TYPE, and that
        /// declaration is one level up — so resolving against the member alone reports "names a function-block
        /// instance that is not declared in this POU", advice pointing at work the engineer already did.</para>
        ///
        /// <para>Member FIRST, because the lookup takes the first match and an inner scope must win: a member's
        /// own <c>VAR_INPUT p : TON;</c> shadows a POU-level <c>p</c> exactly as IEC says it does.</para></summary>
        public static string? Scope(string? member, string? owner) =>
            string.IsNullOrWhiteSpace(member) ? owner
            : string.IsNullOrWhiteSpace(owner) ? member
            : member + "\n" + owner;
    }
}
