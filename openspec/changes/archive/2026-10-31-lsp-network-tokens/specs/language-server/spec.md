## ADDED Requirements

### Requirement: The language server classifies, completes and explains the network words
The language server SHALL treat the words a plain-ST network body holds beyond ST as language: the words of its `%`
lines and every receiver mark are keywords; `RAIL`, `BRANCH`, `BRANCH_SHORTCIRCUIT`, `EXECUTE`, `OPERAND` and a
value's `RISING(`/`FALLING(` are functions; `JMP` and a target `RETURN` are keywords; a jump's label and a network's
`l:` are labels. Completion SHALL offer the mark words before a receiver, the body's labels after `JMP.`, and `RAIL()`
with the network's boxes where a value or a call stands, and none of them in a plain ST body. Hover SHALL answer each
network word with one line saying what it runs as, from one table. `networkTokens(text)` SHALL return the same
classification as `[{start, length, kind}]`.

#### Scenario: a pin's mark
- **WHEN** a network body holds `t1(RISING IN := a);`
- **THEN** `RISING` is a keyword token and hovering it answers "a rising-edge mark on the IN pin"

#### Scenario: the rail
- **WHEN** a network body holds `x := RAIL();`
- **THEN** `RAIL` is a function token and hovering it answers "the left rail: TRUE"

#### Scenario: a jump's label
- **WHEN** the cursor stands after `JMP.` in a network body declaring the labels `l:` and `m:`
- **THEN** completion offers exactly `l` and `m`, and in `JMP.l := a;` the `l` is a label token

#### Scenario: an ST body
- **WHEN** a plain ST body declares and reads a variable `rail`
- **THEN** `rail` is a variable token and completion offers no network word
