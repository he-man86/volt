using VoltBridge.Beckhoff;
using VoltBridge.Core.Http;

var adapter = new BeckhoffAdapter();
var cts = new CancellationTokenSource();
var sta = new Thread(() =>
{
    ComMessageFilter.Register();
    // ExternalAttach: don't crash if TwinCAT isn't open yet (the connector starts us at login,
    // before any IDE). Start DEGRADED and let the health probe attach when TwinCAT appears, so the
    // supervisor keeps one stable worker across IDE restarts instead of crash-looping.
    try { adapter.Connect(); }
    catch (Exception ex) { adapter.MarkDegraded($"waiting for TwinCAT XAE ({ex.Message})"); }
    adapter.RunStaMessageLoop(cts.Token);
})
    { IsBackground = true };
sta.SetApartmentState(ApartmentState.STA);
sta.Start();
// Same shared server the in-proc CODESYS bridge uses.
try { HttpBridgeServer.RunStandalone(adapter, "VoltBridge Beckhoff", 8555); }
finally { cts.Cancel(); }
