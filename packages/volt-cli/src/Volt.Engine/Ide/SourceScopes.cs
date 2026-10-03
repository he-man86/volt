using System;
using System.Collections.Generic;
using Volt.Engine.Format.Network;
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
            foreach (var (_, body, declaration) in SitesOf(split)) yield return (body, declaration);
        }

        /// <summary><see cref="BodiesOf"/>, each body with WHERE it sits (<see cref="BodySite"/>) — what a pre-flight
        /// hands a driver beside the body's model, so the driver can find the live body it would write into.
        ///
        /// <para>Only the sites the kind's row says exist (<see cref="ItemKind.ShapeOf"/>, openspec
        /// <c>bridge-refusal-review</c> D11): an item's or a member's body where it has one, and a property's GET and SET
        /// where they carry bodies. An interface and its members have none, a GVL and a DUT none.</para></summary>
        public static IEnumerable<(BodySite Site, string? Body, string? Declaration)> SitesOf(ItemContent split)
        {
            if (ItemKind.ShapeOf(split.Kind).Body) yield return (BodySite.Item, split.Body, split.Declaration);
            foreach (var m in split.Members)
            {
                // An ACTION has NO declaration of its own — IEC gives it a name and a body and nothing else —
                // so it resolves purely against the POU's.
                var scope = Scope(m.Kind == ItemKind.Kinds.Action ? null : m.Declaration, split.Declaration);
                var shape = ItemKind.ShapeOf(m.Kind);
                if (shape.Body) yield return (new BodySite(m.Name, m.Kind, null), m.Body, scope);
                if (shape.Accessors != AccessorShape.WithBodies) continue;
                yield return (new BodySite(m.Name, m.Kind, BodySite.Get), m.Getter?.Body, Scope(m.Getter?.Declaration, scope));
                yield return (new BodySite(m.Name, m.Kind, BodySite.Set), m.Setter?.Body, Scope(m.Setter?.Declaration, scope));
            }
        }

        /// <summary>EVERY NETWORK-TEXT BODY OF <paramref name="content"/>, VALIDATED ONCE — each against its own scope
        /// (<paramref name="scopeFor"/>, handed the declarations <see cref="SitesOf"/> pairs it with), with its model, that
        /// scope and where it sits (openspec <c>bridge-refusal-review</c> D8/D12). The ONE door every network body of a
        /// push passes through: the push pre-flight calls it, the drivers' writes take what it returns and never read the
        /// text again, and a test that calls a driver's write directly builds its bodies here, as the push does.
        /// Throws what <see cref="NetworkText.Validate"/> throws, at the first body that does not read.</summary>
        public static IReadOnlyList<PushedNetworkBody> Validated(ItemContent content, Func<string?, NetworkScope> scopeFor)
        {
            if (scopeFor is null) throw new ArgumentNullException(nameof(scopeFor));
            var bodies = new List<PushedNetworkBody>();
            foreach (var (site, body, declaration) in SitesOf(content))
            {
                if (body is not { } b || !NetworkText.Is(b)) continue;
                var scope = scopeFor(declaration);
                bodies.Add(new PushedNetworkBody(site, NetworkText.Validate(b, scope), scope));
            }
            return bodies;
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

    /// <summary>Where a body sits in a pushed item: the item's own (<see cref="Item"/>), a member's — its name and
    /// kind — or a property accessor's (<see cref="Accessor"/> <c>Get</c> or <c>Set</c>).</summary>
    public sealed record BodySite(string? Member, string? MemberKind, string? Accessor)
    {
        public const string Get = "Get";
        public const string Set = "Set";

        /// <summary>The item's own body.</summary>
        public static readonly BodySite Item = new(null, null, null);

        /// <summary>The same site — a member by name as IEC compares names, case-insensitively, and the same kind and
        /// accessor.</summary>
        public bool Matches(BodySite other) =>
            string.Equals(Member, other.Member, StringComparison.OrdinalIgnoreCase)
            && MemberKind == other.MemberKind && Accessor == other.Accessor;

        /// <summary>The body as a refusal names it: <c>the item</c>, <c>'Run'</c>, <c>'Ready' GET</c>.</summary>
        public override string ToString() =>
            Member is null ? "the item" : Accessor is null ? $"'{Member}'" : $"'{Member}' {Accessor.ToUpperInvariant()}";
    }

    /// <summary>A network-text body of a pushed item, as the push PRE-FLIGHT validated it (<see cref="SourceScopes.Validated"/>),
    /// the scope it was read against, and where it sits — what a driver's pre-flight and its WRITE are handed, so neither
    /// parses the body again (openspec <c>bridge-refusal-review</c> 2.27, D8/D12). The scope travels with its model: the
    /// writer resolves the boxes against the same declarations the reader did, and the driver builds none of its own.</summary>
    public sealed record PushedNetworkBody(BodySite Site, NetworkBody Model, NetworkScope Scope)
    {
        /// <summary>The validated body at <paramref name="site"/> whose text is <paramref name="body"/> — or null when that
        /// body is no network text (ST, a hidden body, none). A network-text body with NO entry is Volt's bug: every one
        /// the push writes passed the pre-flight (<see cref="SourceScopes.Validated"/>), so a write handed one without its
        /// model would have to read the text again — <see cref="InvalidOperationException"/>, naming the site. Nothing is
        /// guessed. Asked only for a body the write touches: one it leaves alone (null) is never looked up.</summary>
        public static PushedNetworkBody? At(IReadOnlyList<PushedNetworkBody> bodies, BodySite site, string? body)
        {
            if (bodies is null) throw new ArgumentNullException(nameof(bodies));
            if (body is null || !NetworkText.Is(body)) return null;
            foreach (var b in bodies)
                if (b.Site.Matches(site)) return b;
            throw new InvalidOperationException(
                $"{site}: a network-text body reached the write with no validated model — every network body a push writes " +
                "is validated once by the pre-flight (SourceScopes.Validated) and handed over with its scope (openspec " +
                "bridge-refusal-review D8). Volt's bug, not the text's.");
        }
    }

    /// <summary>A pushed item and every network-text body in it, validated once (<see cref="SourceScopes.Validated"/>):
    /// what the push pre-flight keeps per set op and the apply writes from, so the text is read once (openspec
    /// <c>bridge-refusal-review</c> D8).</summary>
    public sealed record ValidatedSource(ItemContent Content, IReadOnlyList<PushedNetworkBody> Bodies);
}
