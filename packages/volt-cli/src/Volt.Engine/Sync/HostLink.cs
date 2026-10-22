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
/// composes over its primitives (<see cref="ComposedSession"/>, F5). <see cref="Of(DriverBase)"/>: an old-contract host —
/// the two shipped ones and the test double — through the adapter (<see cref="LegacyDriver"/>), its session its own
/// <see cref="DriverBase"/>. The implicit conversion keeps every old-contract call site compiling; it goes with the
/// adapter in step 6.</para>
/// </summary>
public sealed class HostLink
{
    private HostLink(IVendorDriver driver, IIdeSession session)
    {
        Driver = driver;
        Session = session;
        Catalog = Catalog.Of(driver.Declaration);
    }

    public IVendorDriver Driver { get; }
    public IIdeSession Session { get; }
    public Catalog Catalog { get; }

    public static HostLink Of(IVendorDriver host) =>
        new(host ?? throw new ArgumentNullException(nameof(host)), new ComposedSession(host));

    public static HostLink Of(DriverBase old) =>
        old is IIdeDriver driver
            ? new HostLink(new LegacyDriver(driver), old)
            : throw new ArgumentException($"{old?.GetType().Name ?? "null"} is no old-contract driver (IIdeDriver)", nameof(old));

    public static implicit operator HostLink(DriverBase old) => Of(old);
}

/// <summary>The session composition (<see cref="DriverBase"/>) over the PRIMITIVES a new-contract host supplies (F5):
/// its marshal, its project rows, its probe floor. Everything else is the host's, forwarded. The one member only an
/// old-contract driver is asked through its session (its walk-based build diagnostics) is never asked here: the engine
/// asks the host itself.</summary>
public sealed class ComposedSession : DriverBase
{
    private readonly IVendorDriver _host;

    public ComposedSession(IVendorDriver host)
    {
        _host = host;
        RunOnStaThread(() => { SnapshotHealth(); return 0; });   // what a host's connect does: the rows show at once
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
    public override void Disconnect() => _host.Disconnect();
    public override bool ShouldMarkDegraded(Exception ex) => _host.ShouldMarkDegraded(ex);
    public override void Recover() => _host.Recover();
    protected override T MarshalToIdeThread<T>(Func<T> fn) => _host.MarshalToIdeThread(fn);
    protected override long ProbeThrottleMs => _host.HealthProbeFloorMs;
    protected override void SnapshotHealth() => PublishRows(_host.ProjectRows().ToList());
    public override void SelectProject(ConnectRequest sel) => _host.SelectProject(sel);
    public override bool Build(IReadOnlyCollection<string>? applications) => _host.Build(applications);
    public override IReadOnlyList<LibSignature> ExtractLibrarySignatures() => _host.ExtractLibrarySignatures();
    public override string? RefusedLanguageChange(string site, string from, string to) => _host.RefusedLanguageChange(site, from, to);

    public override IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics(Func<WalkResult> walk) =>
        throw new InvalidOperationException("a new-contract host's build diagnostics are asked of the host, with its own walk");
}
