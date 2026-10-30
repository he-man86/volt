> FOR REVIEW (simplification), written from Sim-Assist. Nothing is built until the owner answers.

## 1. Review

- [ ] 1.1 Push `x := auto AND BRANCH(a, b);` and `x := BRANCH(FEED := auto, a, b);` through the bridge (CODESYS and TwinCAT); record whether both make one model
- [ ] 1.2 Owner: drop `FEED` (proposal.md)

## 2. Build (after the answer)

- [ ] 2.1 `StNetworkWriter` writes `f AND (a OR b)` for contact branches and `f AND BRANCH(…)` where a branch holds a box
- [ ] 2.2 The reader reports `FEED :=` with a hint naming the new spelling; `network-text.html`'s "parallel" row shows the new form
