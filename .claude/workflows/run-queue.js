export const meta = {
  name: 'run-queue',
  description: 'Work through the queued openspec changes in their fixed order, each via execute-change (resumable; a finished change is skipped, a blocked one stops the queue)',
  whenToUse: 'Run to continue all queued work unattended. Order: push-without-header-check -> bridge-refusal-review -> frontend-conformance -> transpile-restructure. Before a long run: keep the laptop awake and check /usage; if the weekly limit is hit the current change stops and resumes from its tasks.md next time.',
  phases: [{ title: 'Queue', detail: 'one execute-change per change, in order' }],
}

// args (optional): { from: 'bridge-refusal-review' } to start later in the queue; { only: ['push-without-header-check'] }.
const QUEUE = [
  { change: 'push-without-header-check' },
  { change: 'bridge-refusal-review', requires: ['push-without-header-check'] },
  { change: 'frontend-conformance' },
  { change: 'transpile-restructure', requires: ['frontend-conformance'] },
]

let queue = QUEUE
if (args?.from) queue = queue.slice(Math.max(0, queue.findIndex(q => q.change === args.from)))
if (args?.only?.length) queue = queue.filter(q => args.only.includes(q.change))

phase('Queue')
const results = []
for (const q of queue) {
  log(`queue: ${q.change}`)
  const r = await workflow('execute-change', q)
  results.push({ change: q.change, result: r })
  if (r?.blockedBy?.length) { log(`queue stops: ${q.change} is blocked by ${r.blockedBy.join(', ')}`); break }
}
return results
