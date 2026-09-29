export const meta = {
  name: 'frontend-conformance',
  description: 'Execute openspec frontend-conformance: measure the LSP front-end (syntax, symbols, types), restructure it design-first, then make it conform to CODESYS rule by rule; resumable',
  whenToUse: 'Run any time; FIRST in the order frontend-conformance -> transpile-restructure -> the rest of the LSP review. Continues at the first unticked task.',
  phases: [{ title: 'Run', detail: 'execute-change with change=frontend-conformance' }],
}

phase('Run')
return await workflow('execute-change', { ...(args ?? {}), change: 'frontend-conformance' })
