using System;
using System.Collections.Generic;
using System.Linq;
using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Library;
using Volt.Engine.Seam;

namespace Volt.Engine.Sync;

/// <summary>
/// What the Engine holds of the ONE host it serves (openspec <c>volt-cli-rework</c> step 5, design "What the Engine holds
/// of one host"): the host as the new contract (<see cref="Driver"/>), the catalog of ITS declaration alone
/// (<see cref="Catalog"/>: a kind no other host declared is no kind here, F3), and the session composition every vendor
/// shares (<see cref="Session"/>: degraded state, IDE-thread bracketing, the single-flight health probe and the health
/// response, the library-signature cache).
///
/// <para>Two ways in. <see cref="Of(IVendorDriver)"/>: a host that speaks only the new contract, whose session the engine
/// composes over its primitives (<see cref="ComposedSession"/>, F5). <see cref="Of(IIdeDriver)"/>: an old-contract host —
/// the two shipped ones and the test double — through the adapter (<see cref="LegacyDriver"/>), its session its own
/// <see cref="DriverBase"/>. The implicit conversion keeps every old-contract call site compiling; it goes with the
/// adapter in step 6.</para>
/// </summary>
public sealed class HostLink
{
    private readonly Lazy<IVendorDriver> _driver;
    private readonly Lazy<Catalog> _catalog;

    /// <summary>The driver and its catalog are made when an op first asks for them: a host's session answers <c>health</c>
    /// before (and without) its declaration.</summary>
    private HostLink(Func<IVendorDriver> driver, IIdeSession session)
    {
        _driver = new Lazy<IVendorDriver>(driver);
        _catalog = new Lazy<Catalog>(() => Catalog.Of(Driver.Declaration));
        Session = session;
    }

    public IVendorDriver Driver => _driver.Value;
    public IIdeSession Session { get; }
    public Catalog Catalog => _catalog.Value;

    public static HostLink Of(IVendorDriver host)
    {
        if (host is null) throw new ArgumentNullException(nameof(host));
        return new HostLink(() => host, new ComposedSession(host));
    }

    /// <summary>The host's start, on its IDE thread right after its connect: the rows show in <c>health</c> at once
    /// (<see cref="ComposedSession.Refresh"/>).</summary>
    public void RefreshHealth() =>
        (Session as ComposedSession ?? throw new InvalidOperationException("an old-contract host refreshes its own session"))
            .Refresh();

    public static HostLink Of(IIdeDriver old) =>
        new(() => new LegacyDriver(old), old ?? throw new ArgumentNullException(nameof(old)));

    public static implicit operator HostLink(DriverBase old) =>
        Of(old as IIdeDriver ?? throw new ArgumentException($"{old?.GetType().Name ?? "null"} is no old-contract driver (IIdeDriver)", nameof(old)));
}

/// <summary>The session composition (<see cref="DriverBase"/>) over the PRIMITIVES a new-contract host supplies (F5):
/// its marshal, its probe, its probe floor. Everything else is the host's, forwarded. What each host's own session did
/// around its snapshot is done here once: a live binding clears degraded, an ambient probe whose IDE did not answer fails,
/// a <c>select</c> refreshes the rows after the host's own, a <c>disconnect</c> clears degraded. The one member only an
/// old-contract driver is asked through its session (its walk-based build diagnostics) is never asked here: the engine
/// asks the host itself.</summary>
public sealed class ComposedSession : DriverBase
{
    private readonly IVendorDriver _host;

    public ComposedSession(IVendorDriver host) => _host = host;

    /// <summary>The rows, read NOW on the calling thread: the host's start, already on its IDE thread right after its
    /// connect, so the rows show at once. The liveness verdict is not acted on — a request-path refresh never fails.</summary>
    public void Refresh() => Probe();

    /// <summary>One probe: a live binding clears degraded (as each host's own snapshot did), then the rows are published.</summary>
    private ProjectProbe Probe()
    {
        var probe = _host.ProbeProjects();
        if (probe.Bound && IsDegraded) ClearDegraded();
        PublishRows(probe.Rows.ToList());
        return probe;
    }

    public override bool IsConnected => _host.IsConnected;
    public override string Vendor => _host.Vendor;
    public override string? ServedProjectName => _host.ServedProjectName;
    public override string? IdeVersion => _host.IdeVersion;
    public override string? ProductName => _host.ProductName;
    public override string? ProductVersion => _host.ProductVersion;
    public override string? ProductVendor => _host.ProductVendor;
    public override string? Unsupported => _host.Unsupported;
    public override string? NotServedBecause => _host.NotServedBecause;
    public override void Disconnect() { _host.Disconnect(); ClearDegraded(); }
    public override bool ShouldMarkDegraded(Exception ex) => _host.ShouldMarkDegraded(ex);
    public override void Recover() => _host.Recover();
    protected override T MarshalToIdeThread<T>(Func<T> fn) => _host.MarshalToIdeThread(fn);
    protected override long ProbeThrottleMs => _host.HealthProbeFloorMs;
    protected override void SnapshotHealth() => Probe();

    /// <summary>The ambient probe FAILS when the host's IDE did not answer — inside the marshalled closure, so the
    /// freshness clock is not restamped, and the failure is logged and marks the session degraded.</summary>
    public override void TriggerAsyncProbe() =>
        RunProbeOnce(() => RunOnStaThread(() =>
        {
            if (Probe().NotAnswering is { } why) throw new BridgeException(BridgeErrorCodes.PlcDisconnected, why);
            return 0;
        }));

    /// <summary>The host's select, then its rows at once (both hosts refreshed on select).</summary>
    public override void SelectProject(ConnectRequest sel) { _host.SelectProject(sel); Probe(); }
    public override bool Build(IReadOnlyCollection<string>? applications) => _host.Build(applications);
    public override IReadOnlyList<LibSignature> ExtractLibrarySignatures() => _host.ExtractLibrarySignatures();
    public override string? RefusedLanguageChange(string site, string from, string to) => _host.RefusedLanguageChange(site, from, to);

    public override IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics(Func<WalkResult> walk) =>
        throw new InvalidOperationException("a new-contract host's build diagnostics are asked of the host, with its own walk");
}
