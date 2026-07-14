Evidence-based model comparison for the PLC agent. Off-the-shelf tooling, hand-written tasks, no harness.
Not started. Independent of the deploy — informs the model/pricing choice in `commercial-cloud-backend`.

## Setup (no build)
- [ ] Install **Promptfoo** (`npx promptfoo@latest init` in an `eval/` dir). No code — a `promptfooconfig.yaml`.
- [ ] Add providers: `anthropic:claude-…` and the DeepSeek endpoint (`openai`-compatible, `deepseek-chat`/
      `deepseek-reasoner`). Keys via env (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`).

## The tasks (~10 representative IEC 61131-3 asks)
- [ ] Write them as prompt files — the kind of thing a Volt user asks the agent. Cover: **generate** (a POU:
      debounce, engineering-unit scaling, a small SFC/state machine), **fix** (a bug in given ST or a ladder rung),
      **refactor** (extract an FB, tidy a CASE), **explain** (what a fault/POU does). Keep inputs realistic ST/FBD.
- [ ] Pull a few real snippets from the LSP corpus/fixtures so the code looks like actual projects.

## Grade (cheapest first)
- [ ] **LLM-as-judge** (Promptfoo built-in) with a rubric: correctness, IEC-idiomatic, compiles-plausibly, safety.
- [ ] Spot-check by hand (~10 tasks is eyeball-able) to sanity-check the judge.
- [ ] (Optional, later — Volt's unfair advantage) wire a grader that **compiles the generated ST via the bridge/LSP**
      and scores on clean build. Highest-signal, but this is the one part that's custom — do it only if the
      LLM-judge result is ambiguous.

## Decide + hand back
- [ ] Record per-task DeepSeek-vs-Claude quality + cost. Conclusion: is DeepSeek good enough to be the **default**,
      or must Claude be? Does the pricing gate models or just usage?
- [ ] Feed the decision into `commercial-cloud-backend` Stage 4b (model catalog) + the pricing model.
