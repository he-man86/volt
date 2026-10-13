using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using Volt.Contracts;
using Volt.Engine.Format.Task;

namespace Volt.Ide.Codesys
{
    /// <summary>
    /// A TASK, read and written member for member (openspec <c>bridge-one-to-one</c> §1.1 "Tasks", §1.2 "Task
    /// descriptor"). The scheduling members travel through the scripting facet (<c>ScriptTaskObject</c>: kind, interval,
    /// priority, event, external event, watchdog); the members the facet does not expose — the call list with each call's
    /// comment, <c>Core</c>, <c>Core2</c>, <c>TaskGroup</c>, <c>AllowEmpty</c>, <c>Implicit</c>, <c>WithinSPSTimeSlicing</c>,
    /// <c>SynchTask</c> and the <c>*Parameters</c> lists — through the task object's own archive
    /// (<c>IArchivable.GetSerializableValue</c>, the census's names). Every member is READ, never defaulted: one the
    /// vendor does not answer refuses the task by name.
    /// </summary>
    internal sealed partial class CodesysObjectModel
    {
        /// <summary>The members off their measured value become labels; this is that value, measured on 13 of 13 corpus
        /// tasks (design §0.1 finding 5), keyed by the label and the archive member.</summary>
        private static readonly (string Label, string Member, string Measured)[] TaskMembers =
        {
            (TaskDescriptorFormat.LabelCore, "Core", "-1"),
            (TaskDescriptorFormat.LabelCore2, "Core2", "-2"),
            (TaskDescriptorFormat.LabelTaskGroup, "TaskGroup", "IEC-Tasks"),
            (TaskDescriptorFormat.LabelAllowEmpty, "AllowEmpty", "false"),
            (TaskDescriptorFormat.LabelImplicit, "Implicit", "false"),
            (TaskDescriptorFormat.LabelWithinSpsTimeSlicing, "WithinSPSTimeSlicing", "true"),
            (TaskDescriptorFormat.LabelSynchTask, "SynchTask", ""),
        };

        /// <summary>The parameter lists empty on 13 of 13 tasks: a non-empty one has no text form and refuses the task.</summary>
        private static readonly string[] TaskParameterLists =
            { "CustomParameters", "IntervalParameters", "EventParameters", "ExternalEventParameters", "FreewheelingParameters" };

        /// <summary>A task's settings, as data — the vendor half; the FILE LAYOUT is the engine's
        /// (<see cref="TaskDescriptorFormat"/>).
        ///
        /// <para><b>The external event is its own member</b> and is read as such: it used to be read as a fallback of
        /// <c>event</c>, so an external-event task pulled as an event task and a push then MOVED the trigger into
        /// <c>event</c> (finding 4). <b>A disabled watchdog's values are read too</b> — the vendor keeps them behind the
        /// flag across a reload (<c>watchdog-off-values</c>), so they are content, not stale numbers.</para></summary>
        private TaskSettings ReadTask(object node)
        {
            var f = Facet(node, "ScriptTaskObject");
            const string what = "CODESYS task";
            var wd = TaskMember(f, "watchdog", what) ?? throw TaskUnreadable(what, "watchdog");
            var watchdog = new TaskWatchdog(TaskText(wd, "time", what), TaskText(wd, "time_unit", what),
                                            TaskText(wd, "sensitivity", what),
                                            TaskMember(wd, "enabled", what) is bool on ? on : throw TaskUnreadable(what, "watchdog.enabled"));
            var kind = TaskText(f, "kind_of_task", what);
            var interval = TaskText(f, "interval", what);
            var unit = TaskText(f, "interval_unit", what);
            var priority = TaskText(f, "priority", what);
            var ev = TaskText(f, "event", what);
            var external = TaskText(f, "external_event", what);

            var task = ReadObject(node) ?? throw new InvalidOperationException("CODESYS: the task object could not be read");
            foreach (var list in TaskParameterLists)
                if (Count(ArchivedObject(task, list, what)) > 0)
                    throw new Volt.Engine.BridgeException(BridgeErrorCodes.Unsupported,
                        $"the task's {list} list is not empty — Volt has no text form for task parameters (0 of 13 corpus " +
                        "tasks hold one: niche, accepted loss), so the task is not pulled without them.");
            var (calls, comments) = ReadCalls(task, what);
            var members = new List<TaskMember>();
            foreach (var (label, member, measured) in TaskMembers)
            {
                var value = Archived(task, member, what);
                if (value != measured) members.Add(new TaskMember(label, value));
            }

            return new TaskSettings(kind, interval, unit, priority, ev.Length == 0 ? null : ev, watchdog, calls,
                                    external.Length == 0 ? null : external,
                                    comments.Any(c => c.Length > 0) ? comments : null,   // none: the measured absence
                                    members);
        }

        /// <summary>The calls in order, each with its comment — the task object's <c>PouList</c> (<c>Name</c>,
        /// <c>Comment</c>: the entry's whole persisted contract). A comment the descriptor cannot hold on its <c>Calls:</c>
        /// line — a comma, a line break, a <c>//</c> — refuses the task by name rather than spelling it wrongly.</summary>
        private static (List<string> Names, List<string> Comments) ReadCalls(object task, string what)
        {
            var names = new List<string>();
            var comments = new List<string>();
            if (ArchivedObject(task, "PouList", what) is not IEnumerable list) throw TaskUnreadable(what, "PouList");
            foreach (var entry in list)
            {
                if (entry is null) continue;
                var name = (NwlInterop.Has(entry, "Name") ? NwlInterop.Get(entry, "Name") as string : null)
                    ?? throw TaskUnreadable(what, "PouList[].Name");
                var comment = (NwlInterop.Has(entry, "Comment") ? NwlInterop.Get(entry, "Comment") as string : null)
                    ?? throw TaskUnreadable(what, "PouList[].Comment");
                // AS STORED, or refused by name (gate review of step 3, finding 8): the `Calls:` line trims what stands
                // around a name and a comment, so a stored one with surrounding blanks cannot be spelled — it was trimmed
                // here and pushed back without them, an unrefused change of stored characters. 0 in the corpora.
                if (comment.IndexOfAny(new[] { ',', '\n', '\r' }) >= 0 || comment.Contains("//") || comment != comment.Trim())
                    throw new Volt.Engine.BridgeException(BridgeErrorCodes.Unsupported,
                        $"the call '{name}' carries the comment '{comment.Replace("\n", " ")}', which holds a comma, a line " +
                        "break, '//' or surrounding blanks — the `Calls:` line cannot spell it (0 of 19 corpus calls carry " +
                        "any comment), so the task is not pulled rather than pulled with it misread.");
                if (name != name.Trim())
                    throw new Volt.Engine.BridgeException(BridgeErrorCodes.Unsupported,
                        $"the call '{name}' is stored with surrounding blanks — the `Calls:` line cannot spell them, so the " +
                        "task is not pulled rather than pulled with them dropped.");
                names.Add(name);
                comments.Add(comment);
            }
            return (names, comments);
        }

        /// <summary>A scripting member that MUST be there — its absence is an object model Volt was not built against,
        /// refused by name (it used to read as <c>""</c>: a task with no priority, written back as one).</summary>
        private static object? TaskMember(object o, string member, string what) =>
            NwlInterop.Has(o, member) ? NwlInterop.Get(o, member) : throw TaskUnreadable(what, member);

        /// <summary>A task member's text AS STORED — a value with surrounding blanks is refused by name, never trimmed (gate
        /// review of step 3, finding 8): the descriptor's labels trim what stands around a value, so it cannot be spelled.
        /// 0 in the corpora (census §0.1: every task value bare).</summary>
        private static string TaskText(object o, string member, string what)
        {
            var text = System.Convert.ToString(TaskMember(o, member, what), CultureInfo.InvariantCulture)
                       ?? throw TaskUnreadable(what, member);
            if (text != text.Trim())
                throw new Volt.Engine.BridgeException(BridgeErrorCodes.Unsupported,
                    $"the {what} member '{member}' holds '{text}', with surrounding blanks — the descriptor's label cannot " +
                    "spell them, so the task is not pulled rather than pulled with them dropped.");
            return text;
        }

        private static Volt.Engine.BridgeException TaskUnreadable(string what, string member) =>
            new(BridgeErrorCodes.Unsupported,
                $"the {what} member '{member}' could not be read — Volt reads every member of a task rather than " +
                "assume one, so the task is not pulled.");

        /// <summary>Apply a task's settings to the vendor — the mirror of <see cref="TaskDescriptor"/>, member for member.
        ///
        /// <para>Every field written here is a real setter, MEASURED rather than assumed (<c>probe-task-writable.py</c>
        /// and <c>probe-task-kind.py</c>, deleted; <c>git show b2496efb4b:packages/volt-cli/scripts/…</c>). Three carry a
        /// trap: <c>kind_of_task</c> takes ONLY the vendor enum (<see cref="TaskKind"/>), <c>priority</c> is a STRING, and
        /// <c>interval</c> / <c>interval_unit</c> are separate, so a TIME literal (`t#4ms`) carries no unit.</para>
        ///
        /// <para><b>The external event is written to its own member</b> (it used to be written into <c>event</c>), and the
        /// watchdog's values are written enabled or not (<c>watchdog-off-values</c>: kept behind the flag). The members the
        /// descriptor states only off their measured value (<see cref="TaskSettings.Members"/>) have no measured write:
        /// a change to one is refused by name (0 of 13 corpus tasks hold one off its value — niche, accepted loss).</para></summary>
        public void WriteTask(object node, TaskSettings t)
        {
            RequireWatchdog(t);
            var task = ReadObject(node) ?? throw new InvalidOperationException("CODESYS: the task object could not be read");
            foreach (var (label, member, measured) in TaskMembers)
            {
                var held = Archived(task, member, "CODESYS task");
                var pushed = (t.Members ?? Array.Empty<TaskMember>()).FirstOrDefault(m => m.Label == label)?.Value ?? measured;
                if (held != pushed)
                    throw new Volt.Engine.BridgeException(BridgeErrorCodes.Unsupported,
                        $"CODESYS: the task's `{label}:` ({member}) has no measured write — it holds '{held}' and the push " +
                        $"states '{pushed}' (0 of 13 corpus tasks hold it off '{measured}': niche, accepted loss). Change it " +
                        "in the IDE and pull.");
            }

            var f = Facet(node, "ScriptTaskObject");
            SetMember(f, "kind_of_task", TaskKind(t.Type));
            SetMember(f, "priority", t.Priority);
            SetMember(f, "interval", t.Interval);
            if (t.IntervalUnit.Length > 0) SetMember(f, "interval_unit", t.IntervalUnit);
            SetMember(f, "event", t.Event ?? "");
            SetMember(f, "external_event", t.ExternalEvent ?? "");

            var wd = GetMember(f, "watchdog") ?? throw new InvalidOperationException("CODESYS: the task facet has no watchdog");
            var w = t.Watchdog!;
            SetMember(wd, "time", w.Time);
            SetMember(wd, "time_unit", w.Unit);
            SetMember(wd, "sensitivity", w.Sensitivity);
            SetMember(wd, "enabled", w.Enabled);

            if (GetMember(f, "pous") is { } pous)
            {
                if (t.CallComments is { Count: > 0 } said && said.Count != t.Calls.Count)
                    throw new InvalidOperationException($"a task's {t.Calls.Count} call(s) carry {said.Count} comment(s)");
                WriteCallList(f, pous, t.Calls, t.Calls.Select((_, i) => t.CommentOf(i)).ToList());
            }
        }

        /// <summary>On CODESYS a task HAS a watchdog member, and its values behind the flag are content (§1.2 "One
        /// watchdog spelling"): a bare <c>Watchdog: off</c> — TwinCAT's spelling, whose task has none — cannot say what
        /// to write, so it is refused by name.</summary>
        internal static void RequireWatchdog(TaskSettings t)
        {
            if (t.Watchdog is null)
                throw new Volt.Engine.BridgeException(BridgeErrorCodes.BadRequest,
                    "CODESYS: `Watchdog: off` alone — a CODESYS task keeps its watchdog's time, unit and sensitivity behind " +
                    "the flag, so the line states them: `Watchdog: off <time> <unit> (sensitivity <n>)` (`''` for an empty " +
                    "one). Pull the task to see its values.");
        }

        /// <summary>The member labels a CODESYS task has — a TwinCAT label (<c>Auto start:</c>, …) is no member of it.</summary>
        internal static void RequireCodesysMembers(TaskSettings t)
        {
            foreach (var m in t.OffDefault)
                if (!TaskMembers.Any(x => x.Label == m.Label))
                    throw new Volt.Engine.BridgeException(BridgeErrorCodes.BadRequest,
                        $"CODESYS: `{m.Label}:` is no member of a CODESYS task (a TwinCAT task's) — remove the line.");
        }

        /// <summary>Replace a task's call list with exactly the POUs named, in order, each with the comment the descriptor
        /// states.
        ///
        /// <para><b>The list `pous` hands out is a VIEW, and mutating it is not an error — it is a NO-OP.</b> Measured on
        /// live SP21 (<c>probe-task-calllist.py</c>, deleted): the mutation goes through <c>PerformWithWriteableCopy</c>,
        /// which takes an <c>Action&lt;T&gt;</c> of a vendor type (built as an expression tree) and hands back the RAW
        /// <c>PouObjectList</c> — an ordinary <see cref="System.Collections.IList"/> of vendor POU objects, a new entry minted
        /// by the task facet's own <c>CreatePouObject(name)</c>.</para></summary>
        private static void WriteCallList(object taskFacet, object pous, IReadOnlyList<string> calls, IReadOnlyList<string> comments)
        {
            // Every refusal of the rebuild is UNSUPPORTED: the IDE did not take the write.
            var perform = pous.GetType().GetMethod("PerformWithWriteableCopy", BF)
                ?? throw new Volt.Engine.BridgeException(BridgeErrorCodes.Unsupported,
                    $"CODESYS: no PerformWithWriteableCopy on {pous.GetType().FullName} — a task's call list " +
                    "cannot be rebuilt, and mutating the read-only view would silently do nothing.");

            var actionType = perform.GetParameters()[0].ParameterType;      // Action<TWriteable>
            var param = System.Linq.Expressions.Expression.Parameter(actionType.GetGenericArguments()[0], "list");
            var body = System.Linq.Expressions.Expression.Call(
                typeof(CodesysObjectModel).GetMethod(nameof(RebuildCallList), BindingFlags.NonPublic | BindingFlags.Static)!,
                System.Linq.Expressions.Expression.Convert(param, typeof(object)),
                System.Linq.Expressions.Expression.Constant(taskFacet),
                System.Linq.Expressions.Expression.Constant(calls, typeof(IReadOnlyList<string>)),
                System.Linq.Expressions.Expression.Constant(comments, typeof(IReadOnlyList<string>)));
            var callback = System.Linq.Expressions.Expression.Lambda(actionType, body, param).Compile();

            try { perform.Invoke(pous, new object?[] { callback }); }
            catch (TargetInvocationException tie)
            {
                var inner = tie.InnerException ?? tie;
                throw new Volt.Engine.BridgeException(BridgeErrorCodes.Unsupported, $"CODESYS refused a task call-list rebuild: {inner.Message}", inner);
            }
        }

        /// <summary>The mutation itself, against the WRITEABLE copy: clear, then append in call order, each entry's
        /// <c>Comment</c> the one the descriptor states (<c>Calls: A // comment</c>). An entry's whole persisted contract is
        /// <c>Name</c> and <c>Comment</c> (<c>PouObject.SerializableValueNames</c>, measured on 21 call entries), and the text
        /// now spells both — the comment used to be carried by NAME from the old list, invisible in the file.</summary>
        private static void RebuildCallList(object writeable, object taskFacet, IReadOnlyList<string> calls,
                                            IReadOnlyList<string> comments)
        {
            if (writeable is not System.Collections.IList list)
                throw new Volt.Engine.BridgeException(BridgeErrorCodes.Unsupported,
                    $"CODESYS: the writeable call list is a {writeable.GetType().FullName}, which is not an IList " +
                    $"— it offers: {string.Join(", ", writeable.GetType().GetMethods(BF).Select(m => m.Name).Distinct().OrderBy(n => n))}");

            list.Clear();
            for (var i = 0; i < calls.Count; i++)
            {
                var entry = InvokeMethod(taskFacet, "CreatePouObject", calls[i])
                            ?? throw new InvalidOperationException($"CODESYS: CreatePouObject('{calls[i]}') returned nothing");
                SetMember(entry, "Comment", comments[i]);
                list.Add(entry);
            }
        }
    }
}
