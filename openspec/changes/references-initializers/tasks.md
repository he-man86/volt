> DRAFT, written from Sim-Assist. Measured on dev `03609354f4`; nothing built.

## 1. References

- [ ] 1.1 `findReferences` walks every declaration's initial value (POU var sections, GVLs, DUT fields) in its declaration's scope
- [ ] 1.2 Test: references of a global and of an FB output include `a : INT := g;` and `b : TIME := t.ET;`

## 2. Resolve at an initial value

- [ ] 2.1 `resolveAt` resolves an identifier and a member chain inside an initial value
- [ ] 2.2 Test: definition, references and rename at `g` and at `ET` in an initial value

## 3. Consumers

- [ ] 3.1 Sim-Assist regenerates its bundle; its refactoring then renames initial values (its task, not Volt's)
