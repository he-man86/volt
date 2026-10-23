using System;
using Volt.Engine.Seam;

namespace Volt.Engine.Sync;

/// <summary>
/// What the Engine holds of the ONE host it serves (openspec <c>volt-cli-rework</c>, design "What the Engine holds of one
/// host"): the host (<see cref="Driver"/>), the catalog of ITS declaration alone (<see cref="Catalog"/>: a kind no other
/// host declared is no kind here, F3), and the session every vendor shares, composed over the host's primitives
/// (<see cref="Session"/>, F5).
/// </summary>
public sealed class HostLink
{
    private readonly Lazy<Catalog> _catalog;

    /// <summary>The catalog is made when an op first asks for it: a session answers <c>health</c> before (and without)
    /// the host's declaration.</summary>
    private HostLink(ComposedSession session)
    {
        Session = session;
        _catalog = new Lazy<Catalog>(() => Catalog.Of(Driver.Declaration));
    }

    public IVendorDriver Driver => Session.Host;
    public ComposedSession Session { get; }
    public Catalog Catalog => _catalog.Value;

    /// <summary>A host, with the engine's session composed over it.</summary>
    public static HostLink Of(IVendorDriver host) => new(new ComposedSession(host));

    /// <summary>A host whose session is already composed (the one a link keeps for the host's lifetime).</summary>
    public static HostLink Of(ComposedSession session) => new(session ?? throw new ArgumentNullException(nameof(session)));

    /// <summary>The host's start, on its IDE thread right after its connect: the rows show in <c>health</c> at once
    /// (<see cref="ComposedSession.Refresh"/>).</summary>
    public void RefreshHealth() => Session.Refresh();
}
