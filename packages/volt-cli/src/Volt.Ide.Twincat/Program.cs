using System.Globalization;
using System;
using System.Threading;
using Volt.Ide.Twincat;
using Volt.Contracts;

// Per-XAE headless worker: the connector spawns one per running XAE window with `--xae-pid <pid>` (CODESYS-symmetric:
// one host per IDE, one pipe each). ExternalAttach — it does NOT crash if the XAE isn't attachable yet: it starts
// DEGRADED and the driver re-attaches to its window, so the worker is stable across a DTE re-registration.
VoltLog.Init(Vendors.Twincat);

// `--list-xae-pids`: one-shot XAE discovery for the connector's supervisor — print each running XAE window's
// process id (one per line) and exit. The COM ROT walk runs in THIS short-lived process so a hang dies with it and
// the always-on tray never holds a COM apartment (the isolation the supervisor design requires). Exit 0 = the
// enumeration ran AND EVERY live XAE answered (empty output = "no XAE open"); exit 1 = it FAILED **or came back
// PARTIAL**, so the connector can tell a real "no XAE" (reap workers) from a list it must not trust (leave the fleet
// alone) — see TwincatXaeProbe. A partial result reported as exit 0 would be a LIE in exactly the shape the reap
// policy consumes: a busy XAE — pinned by a `volt push` or a full `volt build` for tens of seconds, the normal case
// on a large project — would vanish from the list and its healthy worker be reaped, taking the pipe out from under
// the very push that was holding the IDE.
//
// COST, deliberately accepted and monotone in the reap direction only: TrayContext reads a non-zero probe as "leave
// the fleet as-is" BEFORE the spawn loop as well as the reap loop, so for as long as one XAE stays unreadable a
// NEWLY-OPENED XAE gets no worker and a CRASHED worker is not restarted — undebounced, from the first failed probe,
// where the reap it now prevents cost three. The narrower answer is exit 2 = "partial: do not reap, but DO spawn",
// which needs a third verdict in TwincatXaeProbe.ListPids (today `IReadOnlyList<int>?` — two states, it cannot carry
// one) plus the matching arm in TrayContext. Take that if the spawn stall is ever observed in the field; the symptom
// to watch for is XAE B opened during a long build in XAE A never getting `volt.bridge.twincat.<pidB>`.
foreach (var a in args)
    if (a == WorkerCli.ListXaePids)
    {
        int rc = 0;
        var probe = new Thread(() =>
        {
            try
            {
                ComMessageFilter.Register();
                var complete = RotInstances.TryEnumeratePids(out var pids);
                foreach (var id in pids) Console.WriteLine(id); // print the readable half either way — it is correct, just partial
                if (!complete)
                {
                    Console.Error.WriteLine("list-xae-pids: a running XAE did not answer — enumeration INCOMPLETE, do not reap");
                    rc = 1;
                }
            }
            catch (Exception ex) { Console.Error.WriteLine($"list-xae-pids: {ex.Message}"); rc = 1; }
        });
        probe.SetApartmentState(ApartmentState.STA);
        probe.Start();
        probe.Join();
        return rc;
    }

// `--xae-pid <pid>`: the ONE XAE window this worker owns, named by the connector's supervisor (one worker per pid).
// Without it, a person ran the exe: the start finds a window whose pipe name it can claim (WorkerStart).
int xaePid = 0;
for (int i = 0; i + 1 < args.Length; i++)
    if (args[i] == WorkerCli.XaePid && int.TryParse(args[i + 1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var p)) xaePid = p;
var start = new WorkerStart(WorkerStart.Production());
return xaePid == 0 ? start.RunDoubleClick() : start.RunSupervised(xaePid);
