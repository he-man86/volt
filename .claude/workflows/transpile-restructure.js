export const meta = {
  name: 'transpile-restructure',
  description: 'Execute openspec transpile-restructure (the four transpiler models, then the lean groups) — only after frontend-conformance and analysis-conformance are archived; resumable',
  whenToUse: 'Run any time; it refuses to start until frontend-conformance is archived, then continues at the first unticked task. Order: frontend-conformance -> transpile-restructure -> the rest of the LSP review.',
  phases: [{ title: 'Run', detail: 'execute-change with change=transpile-restructure, requires=frontend-conformance' }],
}

phase('Run')
return await workflow('execute-change', { ...(args ?? {}), change: 'transpile-restructure', requires: ['frontend-conformance', 'analysis-conformance'] })
