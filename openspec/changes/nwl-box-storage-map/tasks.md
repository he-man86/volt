## 1. Measure

- [x] 1.1 Read the vendor assemblies: the box members, both code generators, the editor's insert, its EN/ENO and main-output commands
- [x] 1.2 Drive the editor's own `InsertBox` for every kind, LD and FBD, to get the reference forms
- [x] 1.3 Measure output lists per kind at a root and consumed: build, run, compiler language model, editor layout, pull
- [x] 1.4 The stored form against its pulled text pushed back: unchanged, edited, in a new POU
- [x] 1.5 EN and ENO against their slots; box flags; CallType; Instance; ProvidesSTSnippet; InputFlags length; input names; extensible inputs; the Execute box
- [x] 1.6 What a push stores per kind against the editor's forms

## 2. Fix, test-first, one commit each

- [x] 2.1 A consumed FB or PROGRAM box holding no null is refused by name
- [x] 2.2 An operator box with an empty output slot is refused by name
- [x] 2.3 A PROGRAM box is pushed with the editor's output list, and read past its first output builds on CODESYS
- [x] 2.4 A box storing extensible inputs, an operator box showing ENO with an empty value slot, an operator box holding a second null, a resolved call's input past its names and a slot named ENO on a box showing none are each refused by name
- [x] 2.5 An Execute box runs after the one push that wrote it

## 3. Pin

- [x] 3.1 The recording, one row per stored state, and the list of lost pictures
- [x] 3.2 `CodesysBoxStatesTests` over every row
- [x] 3.3 The IDE-authored fixture and `scripts/author-box-states-fixture.py`
- [x] 3.4 `test/e2e/graphical/nwl-box-states.test.ts`

## 4. For the owner and Sim-Assist, not this change

- [ ] 4.1 The parked decision on a box's main output, from the design's last section
- [ ] 4.2 The gap list: what a picture needs, and each difference between a pushed box and the editor's
