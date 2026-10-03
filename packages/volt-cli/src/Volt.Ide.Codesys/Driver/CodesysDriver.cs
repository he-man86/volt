using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

using Volt.Contracts;
using Volt.Engine.Ide;
using Volt.Engine.Item;
using Volt.Engine.Library;

namespace Volt.Ide.Codesys;

/// <summary>
/// The CODESYS IDE driver: implements the Core <see cref="IIdeDriver"/> over the live project reached
/// in-process through the .NET object model (<see cref="CodesysObjectModel"/>, reflection-only — no
/// CODESYS assembly references). Object-model touches are marshalled onto the CODESYS primary thread via
/// <see cref="RunOnStaThread{T}"/>: Core's <c>Wire/BridgePipeHost</c> wraps every project-touching op in it
/// (its <c>RunOp</c>/<c>RunRead</c>). The two exceptions are <see cref="Connect"/> and
/// <see cref="SelectProject"/>, which call <see cref="SnapshotHealth"/> directly because they already run ON
/// that thread. Split across partial
/// files by interface facet: this file is the session; <c>.Tree</c> and <c>.Code</c> are the others.
/// </summary>
public sealed partial class CodesysDriver : DriverBase, IIdeDriver
{
    private readonly CodesysObjectModel _om;
    private readonly CodesysDispatcher? _dispatcher;

    private volatile bool _hasProject; // cached from the primary thread (HasPrimaryProject); read off-thread by IsConnected

    private readonly string? _platformVersion;   // DIALECT V1: the platform's, not an OEM exe's
    private readonly string? _unsupported;       // CodesysPlatform.Refusal — null when nothing is missing

    public CodesysDriver(object? projects) : this(projects, CodesysPlatform.ReadHostExe) { }

    /// <summary>Over a given host-exe read — the offline tests hand an OEM-shaped one; production reads the current
    /// process (in-proc, so the IDE's own exe).</summary>
    internal CodesysDriver(object? projects, Func<CodesysPlatform.HostExe> readHostExe)
    {
        _om = new CodesysObjectModel(projects);
        _dispatcher = CodesysDispatcher.TryCreate();

        // Read ONCE: neither the platform nor its capabilities change under a running IDE. Each capability is the
        // very thing the bridge binds — not a probe of something adjacent — so "missing" here is exactly what would
        // otherwise surface as "no IDE engine" and a PLC_DISCONNECTED on every op.
        _platformVersion = CodesysPlatform.ReadVersion();
        var missing = new List<CodesysPlatform.Capability>();
        if (_platformVersion == null) missing.Add(CodesysPlatform.Core);
        if (_dispatcher == null) missing.Add(CodesysPlatform.Dispatcher);
        if (!_om.HasObjectManager) missing.Add(CodesysPlatform.ObjectManager);
        _unsupported = CodesysPlatform.Refusal(_platformVersion, missing);
        // The product name is a display nicety, never a capability: an OEM build whose getter throws or whose
        // property is shadowed must not abort construction (that would leave no bridge and no IDE_UNSUPPORTED
        // answer at all). Its failure is kept, by name, for the start log.
        // Read once, kept twice: verbatim for the start log (what an OEM answers — whitespace included — is the
        // evidence) and for OemProduct as it always was; Stated for the wire, where an empty answer is null.
        try { ProductNameAsRead = CodesysPlatform.ReadProductName(CodesysPlatform.ReadEngine()); }
        catch (Exception e)
        {
            var cause = e is TargetInvocationException { InnerException: { } inner } ? inner : e;
            ProductNameUnreadable = $"{cause.GetType().Name}: {cause.Message}";
        }
        ProductName = CodesysPlatform.Stated(ProductNameAsRead);
        OemProduct = CodesysPlatform.OemProduct(ProductNameAsRead);
        // The product's own version and maker (DIALECT V4) — like the name, report only: a failing read leaves both
        // null and is kept by name for the start log, never a reason not to serve.
        try
        {
            var exe = readHostExe();
            ExeProductName = exe.ProductName;
            ProductVersion = exe.ProductVersion;
            ProductVendor = exe.CompanyName;
        }
        catch (Exception e)
        {
            HostExeUnreadable = $"{e.GetType().Name}: {e.Message}";
        }
    }

    /// <summary>The product name as the IDE states it (<c>OEMCustomization.ProductName</c>, <c>health.productName</c>)
    /// — `CODESYS` included; null when the platform has no such member or states nothing.</summary>
    public override string? ProductName { get; }

    /// <summary>The product name exactly as <c>OEMCustomization.ProductName</c> answered, unfiltered — logged at start
    /// (an empty or whitespace answer differs from a platform with no such member) and the input to
    /// <see cref="OemProduct"/>. Null when there is no such member or the read threw.</summary>
    public string? ProductNameAsRead { get; }

    /// <summary>The IDE exe's own <c>ProductVersion</c>, verbatim (<c>health.productVersion</c>, DIALECT V4).</summary>
    public override string? ProductVersion { get; }

    /// <summary>The IDE exe's <c>CompanyName</c> (<c>health.productVendor</c>, DIALECT V4).</summary>
    public override string? ProductVendor { get; }

    /// <summary>The IDE exe's own <c>ProductName</c> — logged only, beside <see cref="ProductName"/> (design B2).</summary>
    public string? ExeProductName { get; }

    /// <summary>Why the IDE exe's version-info could not be read, or null.</summary>
    public string? HostExeUnreadable { get; }

    /// <summary>The start log's identity line — every value as read (the product name unfiltered), so an OEM's answer is
    /// on record verbatim. Logged once by <c>PipeHost</c>.</summary>
    internal string IdentityLine() =>
        $"CODESYS platform {IdeVersion ?? "(version unreadable)"}; product name as stated: " +
        (ProductNameAsRead is { } pn ? $"\"{pn}\""
         : ProductNameUnreadable is { } why ? $"(unreadable: {why})" : "(none)") +
        (HostExeUnreadable is { } exeWhy
            ? $"; exe version-info unreadable: {exeWhy}"
            : $"; exe product {Q(ExeProductName)} version {Q(ProductVersion)} vendor {Q(ProductVendor)}") +
        $"; bridge {Volt.Engine.Host.BridgePipeHost.Release ?? "(release unreadable)"}";

    private static string Q(string? stated) => stated is null ? "(none)" : $"\"{stated}\"";

    /// <summary>Why <see cref="ProductName"/> could not be read (the exception, by type and message), or null.</summary>
    public string? ProductNameUnreadable { get; }

    /// <summary>The OEM product this CODESYS platform is (WAGO, Lenze, …), or null for plain CODESYS.</summary>
    public string? OemProduct { get; }

    public override string? Unsupported => _unsupported;

    // Keyed on whether a project is actually OPEN (cached _hasProject), not just the persistent projects
    // collection (HasProjects) — otherwise a closed project still reports "connected" with a null project name.
    // A reopen recovers on its own: the live PrimaryProject lookup makes the next probe flip _hasProject back.
    public override bool IsConnected => _dispatcher != null && _hasProject && _om.HasObjectManager;
    public override string Vendor => Vendors.Codesys;
    // LIVE, not the cached row: reads the primary project's path off the object model, so it must only be called on
    // the primary thread — which is where the in-op guard runs. Same value BuildProjects() snapshots.
    public override string? ServedProjectName => IsConnected ? _om.ProjectName : null;
    // The PLATFORM version, pure (`3.5.21.40`) — a client may parse it. Was the constant "3.5", so nothing — bridge
    // or client — knew which CODESYS it was in (openspec codesys-minimum-version). An OEM product's name is a separate
    // fact (OemProduct): the start log and the message-window line carry it, never this field.
    public override string? IdeVersion => _platformVersion;

    /// <summary>CODESYS startup attach: snapshot health on the primary thread (called by its own PipeHost, not Core).</summary>
    public void Connect() => SnapshotHealth();
    public override void Disconnect() { ClearDegraded(); }

    /// <summary>Refresh the cached health snapshot from the in-proc object model's TOP-LEVEL state (project
    /// name/dirty/open + the one-project instances list) — no tree walk. MUST run on the primary thread:
    /// <see cref="Connect"/> / <see cref="SelectProject"/> call it directly (already on it), the async probe via
    /// <see cref="RunOnStaThread{T}"/>. So a new binding shows in health at once. Parallels the TwinCAT driver's
    /// SnapshotHealth. Cheap here (the one in-proc primary project), so the instances list rides along with health;
    /// on TwinCAT the same snapshot carries the heavier ROT walk.</summary>
    protected override void SnapshotHealth()
    {
        bool has = _om.HasPrimaryProject;
        // `serving` must reflect THIS snapshot's freshly-read state, not the cached _hasProject (still the old value
        // until the publication below). Reading IsConnected inside BuildProjects would lag one cycle on the
        // project-open transition — reporting serving=false for ~4s after Connect and bouncing a pull/push with
        // PLC_DISCONNECTED.
        bool connected = _dispatcher != null && has && _om.HasObjectManager;
        var projects = BuildProjects(connected);
        // _hasProject FIRST, THEN the rows. The row cache lives in DriverBase now, so these are two publication
        // instants where they used to be one lock scope — and the order is not free. Publishing rows first opens
        // exactly the window the comment above records: a row visible as `serving` while IsConnected still reads
        // false, i.e. OpGuard bouncing a pull/push with PLC_DISCONNECTED. This order can only make IsConnected
        // early, never late. (_hasProject is volatile, so the write is its own release.)
        _hasProject = has;
        PublishRows(projects);
        if (has && IsDegraded) ClearDegraded();
    }

    protected override T MarshalToIdeThread<T>(Func<T> fn) => _dispatcher == null ? fn() : _dispatcher.Run(fn);

    /// <summary>The in-proc host serves ONE CODESYS's PRIMARY project, so it reports a single project row (CODESYS has
    /// no sub-projects); nothing open → an empty list. This is the InIdeLoad analogue of TwinCAT's multi-instance ROT
    /// enumeration — the connector concatenates both into the same unified list. A project is identified by its NAME;
    /// two running CODESYS on the same-named project reach the same wire identity (the per-pid PIPE, not a row field,
    /// is what still routes each). The one project is always `serving` when connected (the in-proc host is bound to
    /// it). CODESYS never AUTO-degrades from an op exception (<see cref="ShouldMarkDegraded"/> is always false), but a
/// failing ambient probe still marks it degraded — <c>DriverBase.OnProbeFailed</c> calls <c>MarkDegraded</c> for
/// every vendor, and a degraded row IS wire-visible. That is why <see cref="Disconnect"/> and
/// <see cref="SnapshotHealth"/> still call <c>ClearDegraded()</c>.</summary>
    private List<ProjectEntry> BuildProjects(bool serving)
    {
        var name = _om.ProjectName;
        if (string.IsNullOrEmpty(name)) return new List<ProjectEntry>();
        return new List<ProjectEntry>
        {
            new ProjectEntry(Vendors.Codesys, IdeVersion, name!, RowStatus(serving), _om.ProjectDirty),
        };
    }

    /// <summary>The in-proc host can only serve the primary project of the CODESYS it was loaded into (it can't
    /// switch to another process's project), so `select` confirms/refreshes that binding rather than switching —
    /// and the connector only ever offers this one CODESYS project. Selecting anything else is a no-op refresh.</summary>
    public override void SelectProject(ConnectRequest sel) => SnapshotHealth();   // confirm/refresh the one primary project

    // In-process: no transport that can die mid-call, so never auto-degrade.
    public override bool ShouldMarkDegraded(Exception ex) => false;

    // No BuildHealthResponse/TriggerAsyncProbe/ProbeThrottleMs here: DriverBase composes the response and owns the
    // probe, and this driver takes Core's default floor (DriverBase.DefaultProbeThrottleMs) instead of overriding it.
    // The in-proc snapshot is cheap, but it still runs on the engineer's PRIMARY thread, and it used to run once per
    // poll per frontend — tray + every VS Code workspace + the desktop window, each on its own 4s clock. NB the floor
    // is well BELOW that 4s: _hasProject (the OpGuard precondition, written by SnapshotHealth — the ambient probe plus
    // the on-thread Connect/SelectProject refreshes) is refreshed by every client poll exactly as before, so its
    // staleness stays bounded by the slowest client's poll, not by the floor — which is why the number is 1000 and not
    // TwinCAT's 5000. Cached list, live verdict: CODESYS never AUTO-degrades from an op (ShouldMarkDegraded => false),
    // and a CLOSED project makes the next probe publish an empty row list. A HUNG primary thread is NOT demoted today:
    // the probe marshals through RunOnStaThread too, so it pins DriverBase._opInFlight above 0 and DeriveServedStatus
    // keeps answering "healthy" — that is DriverBase's open _opInFlight ARCH FOLLOW-UP, not a guarantee this driver
    // gets. See DriverBase.OverlayLiveHealth.

    public override void FlushPendingWrites() { /* writes commit immediately via SetObject */ }

    public override bool Build() =>
        _om.Build(_om.FindApplication() ?? throw new InvalidOperationException("CODESYS: no Application to build"));

    // The precompile + read — FetchService calls this only when a .library version changed.
    public override IReadOnlyList<Volt.Engine.Library.LibSignature> ExtractLibrarySignatures() =>
        _om.ExtractLibrarySignatures();

    public override IReadOnlyList<BridgeDiagnostic> GetBuildDiagnostics()
    {
        var raw = _om.GetBuildDiagnostics().Cast<Dictionary<string, object?>>().ToList();
        var names = NamesFor(raw);
        return raw.Select(m =>
        {
            var placed = m.TryGetValue("objectGuid", out var g) && g is Guid guid && names.TryGetValue(guid, out var p) ? p : null;
            return new BridgeDiagnostic
            {
                Severity = m.TryGetValue("severity", out var s) ? s as string ?? Severity.Info : Severity.Info,
                Message = m.TryGetValue("message", out var msg) ? msg as string ?? "" : "",
                Line = m.TryGetValue("line", out var l) && l is int li ? li : 0,
                Column = m.TryGetValue("column", out var c) && c is int ci ? ci : 0,
                Code = m.TryGetValue("code", out var code) ? code as string : null,
                // The BARE name — BuildService promotes it to the wire's full `name.kind`. See its PromoteNames.
                Name = placed?.Name,
                Member = placed?.Member,
            };
        }).ToList();
    }

    /// <summary>Where a diagnostic's object sits on the wire: the top-level item that owns it (BARE name), and the
    /// child of that item it is inside — null when the object IS the item.</summary>
    private sealed class Placement
    {
        public Placement(string name, string? member) { Name = name; Member = member; }
        public string Name { get; }
        public string? Member { get; }
    }

    /// <summary>The item (bare name) and member every object a diagnostic points at belongs to, by guid.
    ///
    /// <para>`IMessage.ObjectGuid` is the only handle CODESYS gives on WHICH object a diagnostic is about, and
    /// the object model has no guid lookup that does not also need the object's project handle — so the tree
    /// walk is how a guid becomes a name. It runs only when at least one diagnostic carried a guid, i.e. never
    /// on a clean build, and a build is seconds where a walk is milliseconds.</para>
    ///
    /// <para>A CHILD OBJECT IS NOT A TOP-LEVEL ITEM, and its diagnostic carries ITS OWN guid. Measured live on SP21
    /// 3.5.21.40 (DIALECT C27, openspec <c>codesys-diagnostic-child-names</c> 1.2, <c>scripts/diagnostic-child-guid.log</c>): an
    /// error in a METHOD body points at the method (`FB_DcnMeth/MExecute`), one in a property GET at the accessor
    /// (`FB_DcnMeth/PProp/Get`), one in an action at the action — never at the FB, never `Guid.Empty`. Resolved
    /// against <see cref="WalkItems"/> alone, which lists top-level items, every one of them was published with no
    /// name (field case <c>c802b74d</c>). So a guid the walk does not place is looked for UNDER the items: the item
    /// is the file the client opens, and the member is the child directly under it (through any POU-internal
    /// folder), which is how an accessor names its property.</para>
    ///
    /// <para>Children are read only for a guid the top-level walk did not place, so a build whose errors are all in
    /// item bodies opens no POU. The descent is structural - names, guids and folder flags, no object reads - and is
    /// limited to the kinds that HOLD members (<see cref="ItemKind.HoldsMembers"/>).</para></summary>
    private Dictionary<Guid, Placement> NamesFor(List<Dictionary<string, object?>> raw)
    {
        var wanted = new HashSet<Guid>(raw.Select(m => m.TryGetValue("objectGuid", out var g) ? g as Guid? : null)
                                          .Where(g => g is not null).Select(g => g!.Value));
        var names = new Dictionary<Guid, Placement>();
        if (wanted.Count == 0) return names;
        var items = WalkItems().Items;
        foreach (var pi in items)
        {
            var guid = _om.GuidOf(pi.Item.Native);
            if (guid != Guid.Empty && wanted.Contains(guid)) names[guid] = new Placement(pi.Name, null);
            // STOP once every guid is placed. This runs on the IDE's primary thread, and a failing build on a
            // real project asks about a handful of items out of hundreds.
            if (names.Count == wanted.Count) return names;
        }
        foreach (var pi in items)
        {
            if (!ItemKind.HoldsMembers(pi.KindCode)) continue;
            foreach (var child in _om.GetChildren(pi.Item.Native))
            {
                if (PlaceUnder(child, pi.Name, wanted, names) && names.Count == wanted.Count) return names;
            }
        }
        return names;
    }

    /// <summary>Place every wanted guid in <paramref name="node"/>'s subtree under <paramref name="item"/>, with the
    /// member the subtree belongs to: the node's own name, or - for a POU-internal folder - each child's.</summary>
    private bool PlaceUnder(object node, string item, HashSet<Guid> wanted, Dictionary<Guid, Placement> names)
    {
        if (_om.IsFolder(node))
        {
            var placed = false;
            foreach (var child in _om.GetChildren(node)) placed |= PlaceUnder(child, item, wanted, names);
            return placed;
        }
        var member = _om.GetName(node);
        var found = false;
        foreach (var guid in Subtree(node))
        {
            if (!wanted.Contains(guid) || names.ContainsKey(guid)) continue;
            names[guid] = new Placement(item, member);
            found = true;
        }
        return found;
    }

    private IEnumerable<Guid> Subtree(object node)
    {
        yield return _om.GuidOf(node);
        foreach (var child in _om.GetChildren(node))
            foreach (var g in Subtree(child)) yield return g;
    }
}
