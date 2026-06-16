using Volt.Bridge.Beckhoff;
using Volt.Bridge.Core.Wire;

// Standalone headless worker. ExternalAttach: don't crash if TwinCAT isn't open yet (the connector
// starts us at login, before any IDE). Start DEGRADED and let the health probe attach when TwinCAT
// appears, so the supervisor keeps one stable worker across IDE restarts instead of crash-looping.
var driver = new BeckhoffDriver();
var cts = new CancellationTokenSource();
var sta = new Thread(() =>
{
    ComMessageFilter.Register();
    try { driver.Connect(); }
    catch (Exception ex) { driver.MarkDegraded($"waiting for TwinCAT XAE ({ex.Message})"); }
    driver.RunStaMessageLoop(cts.Token);
})
{ IsBackground = true };
sta.SetApartmentState(ApartmentState.STA);
sta.Start();

// The same shared server the in-proc CODESYS bridge uses. Port 8555 by default; overridable via
// VOLT_BRIDGE_PORT (e.g. to run a dev instance alongside an existing worker that already holds 8555).
var port = int.TryParse(Environment.GetEnvironmentVariable("VOLT_BRIDGE_PORT"), out var p) ? p : 8555;
try { BridgeHttpServer.RunStandalone(driver, "Volt Bridge Beckhoff", port); }
finally { cts.Cancel(); }
