export const meta = {
  name: 'execute-change',
  description: 'Execute an openspec change step by step from its tasks.md (resumable: skips ticked tasks), refusing to start before the changes it requires are archived',
  whenToUse: 'Called by the per-change workflows (frontend-conformance, transpile-restructure) or directly with args { change, requires?, only?, stopAfter? }. Before a long run: keep the laptop awake (it hibernates after 3 h idle on AC) and check /usage.',
  phases: [
    { title: 'Status', detail: 'prerequisites archived? which steps are open, of which kind' },
    { title: 'Design', detail: 'a design-first step writes and commits its design.md section before any code' },
    { title: 'Implement', detail: 'one agent per step, test-first' },
    { title: 'Review', detail: 'one data-lens review; a second round only on a high finding' },
    { title: 'Gate', detail: 'full suite, map regenerated, delta recorded, commit' },
    { title: 'Close', detail: 'final spec + layering review, archive' },
  ],
}

// args: { change: 'frontend-conformance', requires: ['…'], only: ['1.3'], stopAfter: '2', maxSteps: 4 }
// Cost standard (memory: workflow-cost-standard): consecutive small steps of the same kind run in ONE agent (context read once),
// each task still test-first with its own commit; one data review per group, a second only on a high finding.
if (!args?.change) throw new Error('execute-change needs args.change (an openspec change name)')
const CHANGE = `openspec/changes/${args.change}`
const REQUIRES = args.requires ?? []

const RULES = `Repo C:\\Users\\marce\\Github\\volt (Windows; Bash + PowerShell). You are executing ${CHANGE} (proposal.md, tasks.md, design.md,
specs/). Read those first, then the package docs the change names (for packages/volt-lsp-iec: docs/architecture.md, data-model.md,
test/README.md / TESTING.md).

Rules: CODESYS (and TwinCAT) recordings are the oracle — never adapt a test or a recording to the code; a new answer comes only from the
recorders (packages/volt-lsp-iec: bun run record:exec / record:language, RECORD_ONLY=<fixture>; every wait has a timeout; every recorder starts its OWN
CODESYS; another workflow may run a CODESYS of its own in parallel — never kill a CODESYS/XAE process you did not start;
if you use packages/volt-cli/scripts/ide.ps1, always pass -Instance ${args.change} to up AND down (and run the live e2e suites, the LSP recorders and any probe with VOLT_E2E_INSTANCE=${args.change}: they only talk to their own
fixture IDE and refuse any other pipe; a TwinCAT instance opened with -Fixture both needs VOLT_PIPE or -Fixture 13|14), so its pid file is yours alone, and -Fixture <the one you need> on TwinCAT (default "both" opens two IDEs)). Known divergences run as expected failures and FAIL the suite when they start matching — remove
the mark when your step fixes one. test/conformance/fixtures/map.generated.ts changes only through bun run rate:fixtures and is the
one-file truth about fixtures. Tests from the package directory, never the repo root. Compile scratch Rust only outside the repo; delete
any stray .exe/.pdb/.rs you create in the repo. No fallbacks or defaults that hide a missing fact; fail loud, refuse by name.
SPEED (measured 2026-10-01: a full LSP suite is ~8.5 min and steps ran it ~10 times; recordings ran one fixture at a time):
- ONLY the GATE runs the FULL suite. Implement and fix agents run TARGETED tests: the tests next to the files they changed, and
  for the fixtures they touched VOLT_FIXTURES=<name,name> bun test test/conformance (if fixtures.test.ts supports VOLT_FIXTURES;
  otherwise bun test test/conformance -t "<fixture names>"); of test/frontend only the baseline FILE(S) their change affects.
- INNER LOOP vs END: while working, never re-run the whole test/frontend, the whole test/conformance or rate:fixtures after
  each edit. At the END of an implement/fix agent's work, run each of those three ONCE (then fix and re-run only what failed).
  A gate or close never uses VOLT_FIXTURES.
- RECORD IN ONE BATCH per vendor: write all of the step's fixtures first, then record them in ONE recorder run per vendor
  (RECORD_ONLY with the comma-separated list), not one run per fixture.
- The rustc cache (VOLT_RUSTC_CACHE) speeds up gates; it is verified by sampling on every run. The CLOSE step of a change runs
  the full suite COLD (VOLT_RUSTC_CACHE=0) once, so no change is archived on cached results alone.
TRIAGE (owner): a finding that is cheap to fix is fixed. A NICHE finding — about zero occurrences in the six real corpora
(packages/volt-lsp-iec/test-corpus; count them) and not trivial to fix — is recorded as a known divergence with the reason
"niche: accepted loss (N occurrences in the corpora)" and not worked on. Stage
explicit paths only (never git add -A); commit messages end with "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". No push.`

const STEP = { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' },
  kind: { type: 'string', enum: ['measure', 'baseline', 'structure', 'model', 'conformance', 'fix', 'lean', 'downstream', 'close'] },
  openTasks: { type: 'array', items: { type: 'string' } },
  designFirst: { type: 'boolean', description: 'the step needs a design.md section that is not written and committed yet' } },
  required: ['id', 'title', 'kind', 'openTasks'] }
const FIND = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: {
  file: { type: 'string' }, problem: { type: 'string' }, repro: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] } },
  required: ['problem', 'repro', 'severity'] } } }, required: ['findings'] }

phase('Status')
const status = await agent(`${RULES}

STATUS ONLY — change nothing.
1. Prerequisites: ${REQUIRES.length ? REQUIRES.map(r => `"${r}"`).join(', ') + ' must each be ARCHIVED (a folder openspec/changes/archive/<date>-<name> exists and openspec/changes/<name> does not).' : 'none.'}
2. Read ${CHANGE}/tasks.md and design.md. Return every STEP that still has an unticked task, in the file's order. A STEP is a
   numbered section or sub-section — but NEVER more than 5 unticked tasks: split a larger section into consecutive steps of at most
   5 tasks (ids like 1a, 1b, …), so no agent carries a whole big section and every step gets its own commit. For each step: its unticked task ids, its kind — measure (mechanical measurement),
   baseline, structure (moves/splits, output-neutral), model (a representation change), conformance (an area reviewed against CODESYS,
   rule by rule, with recorded fixtures), fix (root causes), lean (same output, less code), downstream (re-run consumers), close (ONLY the final cold-suite + archive task; a 'Verify' section of live
   checks, e2e runs or suite numbers is NOT close — give it kind conformance if it runs a live IDE, else measure) — and
   whether it needs a design.md section that is not written yet.`,
  { label: 'status', phase: 'Status', schema: { type: 'object', properties: {
    blockedBy: { type: 'array', items: { type: 'string' }, description: 'required changes not archived yet' },
    steps: { type: 'array', items: STEP } }, required: ['blockedBy', 'steps'] } })

if (status?.blockedBy?.length) {
  log(`NOT STARTED: ${args.change} requires ${status.blockedBy.join(', ')} to be archived first`)
  return { change: args.change, blockedBy: status.blockedBy }
}

let steps = status?.steps ?? []
if (args.only?.length) steps = steps.filter(s => args.only.includes(s.id))
const stopAt = args.stopAfter ? steps.findIndex(s => s.id === args.stopAfter) : -1
if (stopAt >= 0) steps = steps.slice(0, stopAt + 1)
if (args.maxSteps) steps = steps.slice(0, args.maxSteps)
// Group consecutive structure/fix/lean/measure steps (never model, conformance or design-first steps).
const GROUPABLE = new Set(['structure', 'fix', 'lean', 'measure', 'conformance'])
// Group sizes by risk: mechanical moves 5; fixes and lean items 3 (an agent gets sloppier after ~4-5 substantial items).
// Owner 2026-10-02: bigger chunks per cycle — up to ~15 tasks share one implement/review/gate cycle and one recorder batch
// per vendor (sub-steps keep their own commits). The 2026-09-30 cap (one agent ran 41 tasks) stays: never a whole phase.
const GROUP_MAX = { structure: 8, measure: 4, fix: 5, lean: 5, conformance: 3 }
// args.light (owner 2026-10-03, "a bit less is also good enough"): double the chunk sizes and no second review round —
// for changes like bridge-refusal-review where the gate's full suites are the safety net, not a second pair of eyes.
if (args.light) for (const k of Object.keys(GROUP_MAX)) GROUP_MAX[k] *= 2
// A round never carries more than TASK_CAP tasks, whatever the step counts say (one agent ran 41 on 2026-09-30).
const TASK_CAP = args.light ? 25 : 15
const grouped = []
for (const s of steps) {
  const last = grouped[grouped.length - 1]
  if (last && GROUPABLE.has(s.kind) && !s.designFirst && last.kind === s.kind && (last.parts?.length ?? 1) < (GROUP_MAX[s.kind] ?? 3) && !last.designFirst
      && last.openTasks.length + s.openTasks.length <= TASK_CAP) {
    last.parts = [...(last.parts ?? [{ ...last }]), s]
    last.id = `${last.parts[0].id}+${s.id}`
    last.title = last.parts.map(p => p.title).join(' | ')
    last.openTasks = [...last.openTasks, ...s.openTasks]
  } else grouped.push({ ...s })
}
steps = grouped
log(steps.length ? `${args.change}: open steps ${steps.map(s => `${s.id}(${s.kind})`).join(', ')}` : `${args.change}: nothing open`)

const KIND = {
  measure: 'MEASURE step: mechanical only — write the measuring scripts under the package\'s scripts/ or a scratch folder, record the numbers and findings in tasks.md; change no product code.',
  baseline: 'BASELINE step: record the numbers and build any tool the later steps depend on (e.g. an output snapshot).',
  structure: 'STRUCTURE step: move or split files exactly as design.md (target structure, old -> new map) says; update every import; OUTPUT-NEUTRAL — every suite and every output snapshot the change names unchanged; nothing else in the same commit.',
  model: 'MODEL step: follow its design.md section exactly (update design.md in the same commit if reality forces a different choice, and say why); the root causes it owns must turn from known divergences into passes.',
  conformance: 'CONFORMANCE step: go through the area RULE BY RULE (systematically, every rule, not by what comes to mind); every rule gets a fixture recorded from CODESYS; every disagreement is a root cause: pin it with its recorded fixture, fix it test-first, or mark it a known divergence with its reason if it cannot be fixed in this step.',
  fix: 'FIX step: each root cause, failing test first against its CODESYS-recorded fixtures, fixed at the root; remove the divergence mark it clears.',
  lean: 'LEAN step: same output, less code — prove every output snapshot the change names byte-identical before and after; the map\'s size/pedantic/lint totals move the way the step claims.',
  downstream: 'DOWNSTREAM step: re-run every consumer suite; each change is either a recording-decided improvement (note it) or a regression (fix it).',
}

const GATE = { type: 'object', properties: { committed: { type: 'boolean' }, hash: { type: 'string' },
  numbers: { type: 'string' }, blocker: { type: 'string' } }, required: ['committed'] }
let stopped = null
const done = []
for (const s of steps) {
  if (s.kind === 'close') break
  if (s.designFirst) {
    phase('Design')
    done.push(await agent(`${RULES}

DESIGN for step ${s.id} — ${s.title}. Write its section in ${CHANGE}/design.md (create it if missing). SHORT (owner 2026-10-03:
"the workflow is a bit too heavy"): at most ~40 lines — the target, the choice and why (name the rejected options in one line each,
measure only what decides between them), what stays refused by name, the migration. No essays, no full option write-ups. Commit design.md alone as "docs(openspec): ${args.change} design — <topic>". No code.
Return the choice in three lines.`, { label: `design:${s.id}`, phase: 'Design' }))
  }

  phase('Implement')
  const impl = await agent(`${RULES}

STEP ${s.id} — ${s.title} (tasks ${s.openTasks.join(', ')}). ${KIND[s.kind] ?? ''}${s.parts ? `
This agent handles ${s.parts.length} consecutive steps (${s.parts.map(p => p.id).join(', ')}) — read the context once, do them IN ORDER, and
keep each one separable: its own tests, and leave a note per step so the gate can commit them one by one.` : ''}
Test-first where there is logic. Do not start a later step. Do not commit (the gate commits). Return what changed, tests and fixtures
added, and the numbers the step's tasks ask for.`, { label: `impl:${s.id}`, phase: 'Implement' })

  phase('Review')
  const findings = (await agent(`${RULES}

REVIEW step ${s.id} (uncommitted in the working tree) with the DATA lens: can anything now give a different answer than CODESYS, or
(for structure/lean steps) than before, on any input? Was a test or a recording adapted to the code? Is anything silently dropped?
Is every rule of the area covered (conformance)? READ-ONLY; every finding needs a repro. Implementer's report:
${impl}`, { label: `review:${s.id}`, phase: 'Review', schema: FIND }))?.findings ?? []
  // Measured 2026-10-02 (frontend-conformance, 27.7 agent-h): implement 59%, fix 27%, gate 9%, review 5%. A separate fix
  // agent re-read the whole context and re-ran the tests the gate then ran again; the GATE now fixes ordinary findings itself.
  // Only a HIGH finding keeps the separate fix + second review (independent eyes on the risky change).
  let pending = findings
  if (!args.light && findings.some(f => f.severity === 'high')) {
    const fix = await agent(`${RULES}

FIX the confirmed findings for step ${s.id} (failing test first; skip a wrong one with the reason). Do not commit.
${JSON.stringify(findings, null, 1)}`, { label: `fix:${s.id}`, phase: 'Review' })
    pending = (await agent(`${RULES}

SECOND data-lens review of step ${s.id} after these fixes. READ-ONLY, a repro per finding.
${fix}`, { label: `review:${s.id}:r2`, phase: 'Review', schema: FIND }))?.findings ?? []
  }

  phase('Gate')
  let gate = await agent(`${RULES}

GATE step ${s.id}. ${pending.length ? `FIRST fix these review findings (failing test first; skip a wrong one with the reason, written under its task):
${JSON.stringify(pending, null, 1)}
Then: ` : ''}Typecheck; regenerate the fixture map if fixtures or the transpiler changed; the FULL suites the change names — green,
run with VOLT_REQUIRE_FULL=1 and VOLT_FIXTURES unset (a partial run skips the project-wide totals and still reads 0 fail; VOLT_REQUIRE_FULL=1 refuses it).
Write the step's numbers/delta under its tasks in tasks.md and tick what is done. ${s.parts ? 'This was a group: make ONE COMMIT PER STEP in the group, in order (only the paths of that step each), so bisect and revert stay per step. ' : ''}Commit exactly the step's paths as
"<type>(<scope>): ${args.change} ${s.id} — <what>". If it cannot get green, do NOT commit: restore the tree to the last commit and write
in the task what blocks it. Return: committed yes/no, hash, the numbers.`, { label: `gate:${s.id}`, phase: 'Gate', schema: GATE })
  if (!gate?.committed) {
    // A red gate gets ONE repair attempt on the same work; if it stays red the run STOPS — a later step must never be
    // built on a tree that lacks this one (2026-09-30: 2.2 started without 2.1's lexer and had to be parked).
    log(`gate ${s.id} not green — one repair attempt`)
    gate = await agent(`${RULES}

REPAIR step ${s.id}: its gate was not green. Gate report:
${JSON.stringify(gate)}
Bring back the step's work if the gate set it aside (git stash apply of ITS stash — never git stash -u, which would sweep other
sessions' untracked files), then fix the failures (every full suite run with VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset): decide on grounds independent of the code whether product or test is wrong;
baseline ceilings may only fall. When everything is green, tick and commit as the gate would have. Otherwise leave the tree clean
and say what blocks it.`, { label: `repair:${s.id}`, phase: 'Gate', schema: GATE })
  }
  done.push(gate)
  if (!gate?.committed) { log(`STOP: step ${s.id} could not be made green — ${gate?.blocker ?? 'see report'}`); stopped = s.id; break }
}

if (stopped) return { change: args.change, stoppedAt: stopped, blockedBy: [`${args.change} step ${stopped} is red`], done }
const closeOpen = (status?.steps ?? []).some(s => s.kind === 'close')
if (closeOpen && (!steps.length || steps[steps.length - 1]?.kind === 'close' || steps.every(s => s.kind === 'close'))) {
  phase('Close')
  done.push(await agent(`${RULES}

CLOSE ${args.change}. If every other step is ticked: run the FULL suite COLD once (VOLT_RUSTC_CACHE=0 VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset) — green; the docs the change names are updated; a final review with the SPEC and LAYERING
lenses over the whole change (fix what it finds, test-first); archive it (npx --yes openspec archive ${args.change} -y), delete the
recreated openspec/specs/, and commit. If tasks are still open: do them first when they are verification (live IDE checks via
ide.ps1 -Instance ${args.change}, e2e runs, full suites, numbers), writing results under each task; any other open task: name it and stop.`, { label: 'close', phase: 'Close' }))
}

return { change: args.change, steps: steps.map(s => `${s.id} [${s.kind}] ${s.title}`), done }
