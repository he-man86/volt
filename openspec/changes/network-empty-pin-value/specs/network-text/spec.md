## ADDED Requirements

### Requirement: an empty pin value is refused in a network
The network check SHALL refuse an empty value at a box pin or EN in a network body (`t1(IN := , PT := T#1S)`,
`MOVE(EN := , 1, OUT => n)`, `f(a, , b)`) by name, as the bridge reader refuses it, since an unconnected pin is left out
and the rail is `RAIL()`.

#### Scenario: the editor's old rail spelling
- **WHEN** a network body holds `t1(IN := , PT := T#1S);`
- **THEN** the LSP reports a network-plain-st error on the empty value naming the forms the text has
