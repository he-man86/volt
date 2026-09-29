export const meta = {
  name: 'transpile-restructure',
  description: 'Execute openspec transpile-restructure step by step: the four transpiler models design-first, then the lean groups; resumable — skips every ticked task',
  whenToUse: 'Run any time to continue the transpiler restructure; it picks up at the first unticked task in openspec/changes/transpile-restructure/tasks.md. Before a long run: keep the laptop awake (hibernate after 3 h idle on AC) and check /usage.',
  phases: [
    { title: 'Status', detail: 'read tasks.md: which steps are still open, in order' },
    { title: 'Design', detail: 'a model step writes its design.md section first, measured against the recorded fixtures, and commits it' },
    { title: 'Implement', detail: 'one agent per step, test-first' },
    { title: 'Review', detail: 'one data-lens review; a second round only on a high finding' },
    { title: 'Gate', detail: 'full suite, map regenerated, delta recorded, commit' },
    { title: 'Close', detail: 'final spec + layering review, archive' },
  ],
}

// args (optional): { only: ['1', '5.2'] } to run just those step ids; { stopAfter: '4' } to stop after a step.

const CHANGE = 'openspec/changes/transpile-restructure'
const RULES = `Repo C:\\Users\\marce\\Github\\volt (Windows; Bash + PowerShell). You are executing ${CHANGE} (proposal.md, tasks.md, design.md,
specs/) on packages/volt-lsp-iec's transpiler (src/transpile/**, src/types/** where a model needs a type fact). Read the proposal, the
tasks and design.md first, then packages/volt-lsp-iec/docs/architecture.md and data-model.md. Background: openspec/changes/
transpile-review-2026-09-29 (root causes, each pinned by a CODESYS-recorded fixture) and transpile-lean-candidates (the lean groups).

Rules: CODESYS's recorded answer (test/conformance/recordings) is the oracle — never adapt a test or a recording to the code; a new
answer comes only from the recorder (bun run record:exec, RECORD_ONLY=<fixture>; it starts its own headless CODESYS; every wait has a
timeout). Known divergences run as expected failures and FAIL the suite when they start matching — remove the mark when your step fixes
one. map.generated.ts changes only through bun run rate:fixtures and is the one-file truth about fixtures. Tests from
packages/volt-lsp-iec, never the repo root. Compile scratch Rust only outside the repo (-o into a temp folder); delete any stray
.exe/.pdb/.rs you create in the repo. No fallbacks or defaults that hide a missing fact. Stage explicit paths only (never git add -A);
commit messages end with "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". No push.`

const STEP = { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' },
  kind: { type: 'string', enum: ['baseline', 'structure', 'model', 'fix', 'lean', 'close'] }, openTasks: { type: 'array', items: { type: 'string' } },
  designWritten: { type: 'boolean', description: 'for a model step: its design.md section is already committed' } },
  required: ['id', 'title', 'kind', 'openTasks'] }
const FIND = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: {
  file: { type: 'string' }, problem: { type: 'string' }, repro: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] } },
  required: ['problem', 'repro', 'severity'] } } }, required: ['findings'] }

phase('Status')
const status = await agent(`${RULES}

STATUS ONLY — change nothing. Read ${CHANGE}/tasks.md and design.md. Return every STEP (a numbered section, or a sub-section where
the file groups tasks that belong together) that still has an unticked task, in the file's order, with its unticked task ids and its
kind: baseline, structure (folder/file moves and splits — output-neutral), model (one of the four models), fix (a root cause not owned by
a model), lean (same output, less Rust), close. For a model step say whether its design.md section is complete and committed.`,
  { label: 'status', phase: 'Status', schema: { type: 'object', properties: { steps: { type: 'array', items: STEP } }, required: ['steps'] } })

let steps = status?.steps ?? []
if (args?.only?.length) steps = steps.filter(s => args.only.includes(s.id))
const stopAt = args?.stopAfter ? steps.findIndex(s => s.id === args.stopAfter) : -1
if (stopAt >= 0) steps = steps.slice(0, stopAt + 1)
log(steps.length ? `open steps: ${steps.map(s => s.id).join(', ')}` : 'nothing open — the restructure is done')

const done = []
for (const s of steps) {
  if (s.kind === 'close') break

  if (s.kind === 'model' && !s.designWritten) {
    phase('Design')
    done.push(await agent(`${RULES}

DESIGN step ${s.id} — ${s.title}. Write its section in ${CHANGE}/design.md (create the file if missing): the target representation;
how the interpreter AND the emitted Rust implement it identically; what CODESYS does, citing the recorded fixtures of the root causes
this model owns; every realistic option, each MEASURED (prototype in a scratch copy if needed) against those fixtures and against the
emitted-Rust cost; the choice and why; what stays refused, by name; the migration of existing emitted code. Commit design.md alone as
"docs(openspec): transpile-restructure design — <model>". Do not change code. Return the choice in three lines.`,
      { label: `design:${s.id}`, phase: 'Design' }))
  }

  phase('Implement')
  const impl = await agent(`${RULES}

IMPLEMENT step ${s.id} — ${s.title} (tasks ${s.openTasks.join(', ')}). ${s.kind === 'model'
    ? 'Follow its design.md section exactly; if reality forces a different choice, update design.md in the same commit and say why. The root causes it owns must turn from known divergences into passes.'
    : s.kind === 'structure'
      ? 'This is a STRUCTURE step: move or split files exactly as design.md (target structure, old -> new map) says. Program output must not change: take the corpus-output snapshot (task 0.2) before and after and prove it byte-identical; update every import; nothing else changes in the same commit.'
    : s.kind === 'fix'
      ? 'This is a FIX step: each root cause, failing test first against its CODESYS-recorded fixtures, in the file the new structure gives it; remove the divergence mark it clears.'
    : s.kind === 'lean'
      ? 'This is a LEAN step: program output must not change. Before and after, take the corpus-output snapshot (task 0.2) and prove it byte-identical; the map\'s size / pedantic / lint totals must move the way the step claims, and the ALLOWED lint list shrinks where it can.'
      : 'Baseline step: record the numbers and build the snapshot tool the lean steps depend on.'}
Test-first where there is logic. Do not start a later step. Do not commit yet (the gate commits). Return: what changed, tests added, the
snapshot result (lean) or the fixtures that now pass (model).`, { label: `impl:${s.id}`, phase: 'Implement' })

  phase('Review')
  let findings = (await agent(`${RULES}

REVIEW step ${s.id} (uncommitted in the working tree) with the DATA lens: can any program now compute a different value than CODESYS,
or than before (for a lean step), on any input — including the edge inputs? Did a test or a recording get adapted to the code? Is
anything silently dropped? READ-ONLY; every finding needs a repro. Implementer's report:
${impl}`, { label: `review:${s.id}`, phase: 'Review', schema: FIND }))?.findings ?? []

  const fix = findings.length ? await agent(`${RULES}

FIX the confirmed review findings for step ${s.id} (failing test first; skip a wrong one with the reason). Do not commit.
${JSON.stringify(findings, null, 1)}`, { label: `fix:${s.id}`, phase: 'Review' }) : 'no findings'

  if (findings.some(f => f.severity === 'high')) {
    const again = (await agent(`${RULES}

SECOND data-lens review of step ${s.id} after the fixes below. READ-ONLY, repro per finding.
${fix}`, { label: `review:${s.id}:r2`, phase: 'Review', schema: FIND }))?.findings ?? []
    if (again.length) await agent(`${RULES}

FIX these for step ${s.id} (failing test first). Do not commit.
${JSON.stringify(again, null, 1)}`, { label: `fix:${s.id}:r2`, phase: 'Review' })
  }

  phase('Gate')
  done.push(await agent(`${RULES}

GATE step ${s.id}. bun typecheck; bun run rate:fixtures; the FULL bun test — green. Write the step's delta under its task in tasks.md
(fixtures changed, edge verdicts, median size, pedantic total, notes resolved, divergence marks removed) and tick the tasks that are done.
Commit exactly the paths this step changed as "refactor(lsp): transpile-restructure ${s.id} — <what>" (or feat/fix if it changes
behaviour to match CODESYS). If you cannot get green, do NOT commit: restore the working tree to the last commit and write in the task
what blocks it. Return: committed yes/no, hash, the delta.`, { label: `gate:${s.id}`, phase: 'Gate' }))
}

if (!steps.length || steps[steps.length - 1]?.kind === 'close') {
  phase('Close')
  done.push(await agent(`${RULES}

CLOSE (step 6). If every step 0-5 is ticked: the final map delta against the 0.1 baseline in tasks.md; architecture.md and data-model.md
describe the four models; a final review with the SPEC and LAYERING lenses over the whole change (fix what it finds, test-first);
then archive ${CHANGE} and openspec/changes/transpile-lean-candidates (npx --yes openspec archive <name> -y), delete the recreated
openspec/specs/, and commit. If any step is still open, say which and stop.`, { label: 'close', phase: 'Close' }))
}

return { steps: steps.map(s => `${s.id} [${s.kind}] ${s.title}`), done }
