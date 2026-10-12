/**
 * the fixtures of `cross-object-four.ts` — part A: an FB_init argument chain three objects deep; a METHOD's VAR_INST and VAR_STAT, two instances in two objects; a GVL of an ARRAY of structs, written from two objects; an ARRAY of STRINGs in a struct, indexed across objects; a member chain four deep across three objects; a CASE whose selector is a PROPERTY read from another object; an early RETURN in each kind of routine; two interfaces on one FB, told apart by __QUERYINTERFACE.
 *
 * One slice of `cross-object-four.ts`, which assembles the parts in order (openspec lsp-same-standard 4.4: a fixture file is
 * held to 400 lines; the map is keyed by fixture name, so a split is map-neutral, and the walk order is kept).
 */
import type { LanguageTest } from "../../types.js"
import { doc, fb } from "./cross-object-four-shared.js"

export const CROSS_OBJECT_FOUR_TESTS_A: readonly LanguageTest[] = [
// ─── an FB_init argument chain three objects deep ───────────────────────────
  fb("xo4_fb_init_chain", "FB_X4_top", "FB_init arguments down a chain of three objects, an inner instance taking the outer's declared value",
    `FUNCTION_BLOCK FB_X4_leaf
VAR
	seed : INT;
	initRuns : INT;
END_VAR
END_FUNCTION_BLOCK

METHOD FB_init : BOOL
VAR_INPUT
	bInitRetains : BOOL;
	bInCopyCode : BOOL;
	start : INT;
END_VAR
seed := start;
initRuns := initRuns + 1;
END_METHOD

FUNCTION_BLOCK FB_X4_branch
VAR
	twig : FB_X4_leaf(start := 7);
	mine : INT;
END_VAR
mine := twig.seed * 2;
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_X4_top
VAR
	limb : FB_X4_branch;
	direct : FB_X4_leaf(start := 3);
	total : INT;
END_VAR
limb();
total := limb.mine + direct.seed;
END_FUNCTION_BLOCK
`,
    "inst : FB_X4_top;", "inst();", 2),
  // ─── a METHOD's VAR_INST and VAR_STAT, two instances in two objects ────────
  fb("xo4_method_inst_and_stat", "FB_X4_holderOne", "a METHOD's VAR_INST kept per instance and its VAR_STAT shared by all, across two holders in different objects",
    `FUNCTION_BLOCK FB_X4_counter
END_FUNCTION_BLOCK

METHOD Tick : INT
VAR_INST
	perInstance : INT;
END_VAR
VAR_STAT
	everyInstance : INT;
END_VAR
VAR
	perCall : INT;
END_VAR
perInstance := perInstance + 1;
everyInstance := everyInstance + 1;
perCall := perCall + 1;
Tick := perInstance * 100 + everyInstance * 10 + perCall;
END_METHOD

FUNCTION_BLOCK FB_X4_holderOne
VAR
	own : FB_X4_counter;
	seen : INT;
END_VAR
seen := own.Tick();
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_X4_holderTwo
VAR
	own : FB_X4_counter;
	seen : INT;
END_VAR
seen := own.Tick();
seen := own.Tick();
END_FUNCTION_BLOCK
`,
    "one : FB_X4_holderOne; two : FB_X4_holderTwo;", "one();\ntwo();", 2),
  // ─── a GVL of an ARRAY of structs, written from two objects ────────────────
  {
    name: "xo4_slot_struct",
    plcPrgVar: "x4Slot : DUT_X4_slot;",
    pouName: "DUT_X4_slot",
    kind: "dut",
    feature: "the struct the shared array holds",
    fromDoc: doc,
    source: `TYPE DUT_X4_slot :
STRUCT
	owner : INT;
	label : STRING(6);
END_STRUCT
END_TYPE
`,
  },
  {
    name: "xo4_gvl_array",
    pouName: "GVL_X4_slots",
    kind: "gvl",
    feature: "a GVL holding an ARRAY of a struct from another object",
    fromDoc: doc,
    source: `VAR_GLOBAL
	gSlots : ARRAY[1..3] OF DUT_X4_slot;
	gNext : INT := 1;
END_VAR
`,
    plcPrgVar: "seen : INT;",
    plcPrgBody: "seen := GVL_X4_slots.gNext;",
  },
  fb("xo4_two_writers_one_array", "FB_X4_claimer", "two FBs claiming slots from one GVL array through VAR_EXTERNAL, each advancing the shared cursor",
    `FUNCTION_BLOCK FB_X4_claimer
VAR_EXTERNAL
	gSlots : ARRAY[1..3] OF DUT_X4_slot;
	gNext : INT;
END_VAR
VAR_INPUT
	who : INT;
END_VAR
VAR_OUTPUT
	took : INT;
END_VAR
IF gNext <= 3 THEN
	gSlots[gNext].owner := who;
	gSlots[gNext].label := 'taken';
	took := gNext;
	gNext := gNext + 1;
ELSE
	took := 0;
END_IF
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_X4_pair
VAR
	first : FB_X4_claimer;
	second : FB_X4_claimer;
	tookFirst : INT;
	tookSecond : INT;
END_VAR
first(who := 11, took => tookFirst);
second(who := 22, took => tookSecond);
END_FUNCTION_BLOCK
`,
    "inst : FB_X4_pair;", "inst();", 2),
  // ─── an ARRAY of STRINGs in a struct, indexed across objects ───────────────
  fb("xo4_array_of_strings", "FB_X4_namer", "an ARRAY of STRING held in a STRUCT from another object, written by index and measured",
    `TYPE DUT_X4_names :
STRUCT
	entries : ARRAY[0..2] OF STRING(8);
	used : INT;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_X4_namer
VAR
	book : DUT_X4_names;
	k : INT;
	widest : INT;
	joined : STRING(30);
END_VAR
book.entries[0] := 'one';
book.entries[1] := 'three';
book.entries[2] := 'seventeen';
book.used := 3;
joined := '';
FOR k := 0 TO 2 DO
	IF LEN(book.entries[k]) > widest THEN
		widest := LEN(book.entries[k]);
	END_IF
	joined := CONCAT(joined, book.entries[k]);
END_FOR
END_FUNCTION_BLOCK
`,
    "inst : FB_X4_namer;", "inst();"),
  // The warning `xo4_array_of_strings` turned up and the LSP did not have: a string CONSTANT longer than where it is
  // stored. Recorded at several lengths, and in a WSTRING, to pin how the message quotes the literal — and that one
  // which FITS says nothing.
  fb("xo4_string_constant_too_long", "FB_X4_overlong", "a STRING and a WSTRING constant longer than the destination, at ten capacities, beside ones that fit",
    `FUNCTION_BLOCK FB_X4_overlong
VAR
	eight : STRING(8);
	one : STRING(1);
	fits : STRING(4);
	wide : WSTRING(2);
	exact : STRING(3);
	six : STRING(6);
	nine : STRING(9);
	two : STRING(2);
	five : STRING(5);
	w4 : WSTRING(4);
	w6 : WSTRING(6);
	w9 : WSTRING(9);
END_VAR
eight := 'seventeen';
one := 'ab';
fits := 'abcd';
wide := "abcde";
exact := 'abc';
six := 'abcdefgh';
nine := 'abcdefghijk';
two := 'abcdefgh';
five := 'abcdefgh';
w4 := "abcdefgh";
w6 := "abcdefgh";
w9 := "abcdefghijk";
END_FUNCTION_BLOCK
`,
    "inst : FB_X4_overlong;", "inst();"),
  // ─── a member chain four deep across three objects ─────────────────────────
  fb("xo4_member_chain_four_deep", "FB_X4_deep", "a struct of a struct of a struct, each in its own object, written and read four names deep",
    `TYPE DUT_X4_inner :
STRUCT
	value : INT;
	flag : BOOL;
END_STRUCT
END_TYPE

TYPE DUT_X4_middle :
STRUCT
	core : DUT_X4_inner;
	tag : INT;
END_STRUCT
END_TYPE

TYPE DUT_X4_outer :
STRUCT
	parts : ARRAY[1..2] OF DUT_X4_middle;
	count : INT;
END_STRUCT
END_TYPE

FUNCTION_BLOCK FB_X4_deep
VAR
	tree : DUT_X4_outer;
	read : INT;
	flagged : BOOL;
END_VAR
tree.parts[1].core.value := 5;
tree.parts[2].core.value := tree.parts[1].core.value * 3;
tree.parts[2].core.flag := TRUE;
tree.count := tree.parts[1].core.value + tree.parts[2].core.value;
read := tree.parts[2].core.value;
flagged := tree.parts[2].core.flag;
END_FUNCTION_BLOCK
`,
    "inst : FB_X4_deep;", "inst();"),
  // ─── a CASE whose selector is a PROPERTY read from another object ──────────
  fb("xo4_case_over_property", "FB_X4_switcher", "a CASE selector that is a PROPERTY read on an instance of another object, its getter running once",
    `FUNCTION_BLOCK FB_X4_dial
VAR
	setting : INT := 2;
	getRuns : INT;
END_VAR
END_FUNCTION_BLOCK

PROPERTY Position : INT
GET
getRuns := getRuns + 1;
Position := setting;
END_GET
END_PROPERTY

FUNCTION_BLOCK FB_X4_switcher
VAR
	dial : FB_X4_dial;
	branch : INT;
END_VAR
CASE dial.Position OF
	1:
		branch := 10;
	2:
		branch := 20;
	3:
		branch := 30;
ELSE
	branch := 99;
END_CASE
END_FUNCTION_BLOCK
`,
    "inst : FB_X4_switcher;", "inst();", 2),
  // ─── an early RETURN in each kind of routine ───────────────────────────────
  fb("xo4_return_in_every_routine", "FB_X4_early", "RETURN taken early in a FUNCTION, a METHOD, an ACTION and an FB body, each in its own object",
    `FUNCTION F_X4_guard : INT
VAR_INPUT
	value : INT;
END_VAR
F_X4_guard := 1;
IF value < 0 THEN
	RETURN;
END_IF
F_X4_guard := 2;
END_FUNCTION

FUNCTION_BLOCK FB_X4_early
VAR
	fromFunction : INT;
	fromMethod : INT;
	fromAction : INT;
	past : INT;
	stop : BOOL := TRUE;
END_VAR
fromFunction := F_X4_guard(value := -1);
fromMethod := Half(value := 9);
Trip();
IF stop THEN
	RETURN;
END_IF
past := 1;
END_FUNCTION_BLOCK

METHOD Half : INT
VAR_INPUT
	value : INT;
END_VAR
Half := value;
IF value > 5 THEN
	RETURN;
END_IF
Half := value * 100;
END_METHOD

ACTION Trip
fromAction := 1;
RETURN;
fromAction := 2;
END_ACTION
`,
    "inst : FB_X4_early;", "inst();"),
  // ─── two interfaces on one FB, told apart by __QUERYINTERFACE ──────────────
  fb("xo4_query_between_interfaces", "FB_X4_both", "one FB implementing two interfaces from their own objects, a variable of one queried for the other",
    `INTERFACE ITF_X4_readable EXTENDS __SYSTEM.IQueryInterface
METHOD Read : INT
END_METHOD
END_INTERFACE

INTERFACE ITF_X4_writable
METHOD Write : INT
VAR_INPUT
	value : INT;
END_VAR
END_METHOD
END_INTERFACE

FUNCTION_BLOCK FB_X4_both IMPLEMENTS ITF_X4_readable, ITF_X4_writable
VAR
	held : INT := 4;
END_VAR
END_FUNCTION_BLOCK

METHOD Read : INT
Read := held;
END_METHOD

METHOD Write : INT
VAR_INPUT
	value : INT;
END_VAR
held := value;
Write := held;
END_METHOD

FUNCTION_BLOCK FB_X4_readOnly IMPLEMENTS ITF_X4_readable
VAR
	fixed : INT := 9;
END_VAR
END_FUNCTION_BLOCK

METHOD Read : INT
Read := fixed;
END_METHOD
`,
    "both : FB_X4_both; only : FB_X4_readOnly; source : ITF_X4_readable; sink : ITF_X4_writable; foundBoth : BOOL; foundOnly : BOOL; wrote : INT; readBack : INT;",
    "source := both;\nfoundBoth := __QUERYINTERFACE(source, sink);\nIF foundBoth THEN\n\twrote := sink.Write(value := 12);\nEND_IF\nreadBack := source.Read();\nsource := only;\nfoundOnly := __QUERYINTERFACE(source, sink);",
    2),
]
