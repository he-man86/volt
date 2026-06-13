using VoltBridge.Beckhoff;
using VoltBridge.Core.Http;

var adapter = new BeckhoffAdapter();
var cts = new CancellationTokenSource();
var sta = new Thread(() => { ComMessageFilter.Register(); adapter.Connect(); adapter.RunStaMessageLoop(cts.Token); })
    { IsBackground = true };
sta.SetApartmentState(ApartmentState.STA);
sta.Start();
// Same shared server the in-proc CODESYS bridge uses.
try { HttpBridgeServer.RunStandalone(adapter, "VoltBridge Beckhoff", 8555); }
finally { cts.Cancel(); }
