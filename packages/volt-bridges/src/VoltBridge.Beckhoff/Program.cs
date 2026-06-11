using VoltBridge.Beckhoff;
using VoltBridge.Beckhoff.Adapters;
using VoltBridge.Beckhoff.Http;

var adapter = new BeckhoffAdapter();
var cts = new CancellationTokenSource();
var sta = new Thread(() => { ComMessageFilter.Register(); adapter.Connect(); adapter.RunStaMessageLoop(cts.Token); })
    { IsBackground = true };
sta.SetApartmentState(ApartmentState.STA);
sta.Start();
try { BridgeServer.Run(adapter, "VoltBridge Beckhoff", 8555); }
finally { cts.Cancel(); }
