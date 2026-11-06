/**
 * WHAT EACH NETWORK WORD RUNS AS, one line each — the hover text of the network words (`network-words.ts`). The ONE
 * place these texts live: the generated "What it runs as" table of `network-text.html` (openspec
 * network-rail-and-pin-negation task 2.3) replaces this table when it exists. Each line says what the lowering
 * (`transpile/lower/network/network.ts`) makes of the word.
 */

/** The meaning of a word that stands for itself, keyed by its form. */
export const NETWORK_MEANINGS = {
  LANGUAGE: "the body's language: LD or FBD, written as network text",
  LD: "Ladder Diagram, written as network text",
  FBD: "Function Block Diagram, written as network text",
  NETWORK: "a network starts here; its title is optional",
  DISABLED: "the network is not compiled: it runs as nothing",
  UNSUPPORTED: "a network the text cannot spell: kept as the IDE holds it",
  RAIL: "the left rail: TRUE",
  BRANCH: "a parallel branch: FEED AND (one branch OR the next); every branch runs",
  BRANCH_SHORTCIRCUIT: "a short-circuit parallel branch: a branch holding a box runs unless FEED and a box-free branch are TRUE",
  EXECUTE: "an Execute box: IF EN THEN its ST END_IF; its ENO is its EN",
  OPERAND: "an operand written as ST text: the expression its string holds",
  COMMENT: "an operand comment: the operand it wraps, the comment the engineer typed beside it",
  RISING: "a rising edge of its value: an R_TRIG called with it, read by its Q",
  FALLING: "a falling edge of its value: an F_TRIG called with it, read by its Q",
  INVERT: "a negation of its value: NOT of it (bitwise on an integer)",
  ASSIGN: "coils, jumps and returns on one value: every target receives it, in order, each its own mark; it hands the value on",
  Q: "a coil: the target receives the value",
  Q_SET: "a set coil: the target is set TRUE while the value is TRUE",
  Q_RESET: "a reset coil: the target is reset FALSE while the value is TRUE",
  Q_INVERTED: "a negated coil: the target receives NOT the value",
  JMP: "a jump as a target: IF its value THEN JMP to the label END_IF",
  RETURN: "the return as a target: IF its value THEN RETURN END_IF",
} as const satisfies Record<string, string>

export type NetworkForm = keyof typeof NETWORK_MEANINGS

/** A label: the network's own (`l:`) or the one a jump names (`JMP.l`). */
export const labelMeaning = (name: string, jump: boolean): string =>
  jump ? `the label ${name}: where the jump goes` : `the network's label ${name}: a jump's destination`
