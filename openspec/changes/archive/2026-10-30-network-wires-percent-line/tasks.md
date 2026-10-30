> FOR REVIEW (simplification), written from Sim-Assist. Nothing is built until the owner answers.

## 1. Review

- [ ] 1.1 Owner: `%WIRES w1, w2` instead of `VAR_TEMP w1 : ANY; END_VAR` (proposal.md)

## 2. Build (after the answer)

- [ ] 2.1 `plain-st.ts` reads `%WIRES` as a network line; the old line reads with a hint naming the new one
- [ ] 2.2 The bridge's reader and writer use `%WIRES`; `network-text.html`'s "Wires" section shows it
