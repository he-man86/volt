# Tasks: transpile-refusal-classification

Paths are relative to `packages/volt-lsp-iec/`. Filed by `transpile-restructure` (its tasks.md 8.3, review R2).

## 1. Measure

- [x] 1.1 For each of the 83 `unclassified` codes in `src/transpile/lower/diagnostics/codes.ts`: its `bail` call sites, the
  fixtures that hit it (`map.generated.ts` rows, their recordings) and its corpus count (`scripts/probe-lowering-refusals.ts`).
  - Accept: one table in this file, one row per code, with the kind each piece of evidence points at, or "undecided".
  - Done 2026-10-11 by `scripts/probe-refusal-evidence.ts` (`bun scripts/probe-refusal-evidence.ts`, ~30 s; its pointer
    logic in `probe-refusal-evidence.test.ts`). 83 codes `unclassified`, as the ratchet says. Evidence is taken **per call
    site**, because one code's sites can refuse different things. Columns: **sites**: every `"code"` literal under
    `src/transpile/` (registry and tests excluded) that is a refusal (a bail argument, a `{ code, message }` refusal, a
    code chosen into a variable; not a member of a union type or a parameter's default), by file. **message says**: a kind
    only where a site's message literal (the argument after the code, never the next line's code; a template is read whole,
    templates nested in its `${...}` included) states one (`not measured`/`unmeasured`/`unrecorded`/`not recorded`,
    `not modelled`/`unmodelled`/`does not model`/`unsupported`, `CODESYS refuses`/`does not compile`/`vendor refuses`).
    `two-cases` means the message's `, or` alternatives state different kinds. **vendor ran** / **vendor refused**:
    conformance fixtures, lowered as `test/conformance/support/evidence.ts` lowers them, whose lowering reports the code,
    split by what the recording says the vendor did (ran: values or a run fault; refused: a compile error, a failed build,
    or a `refused` marker; unaskable and unasked fixtures skipped). **corpus POUs**: POUs of the six corpora that report it
    (`probe-lowering-refusals.ts`'s walk; every corpus project builds clean, measured 2026-09-24, so a hit is valid ST).
    **per site**: each diagnostic is attributed to the site whose literal produces its message (the most specific match).
    A message no literal produces (the message or the code held in a variable) is counted `(unattributed)`; one that two or
    more sites produce equally (the same fixed text) is counted `(one of a, b)`. Neither is guessed onto a site: they are
    pseudo-entries, listed after `‖`, counted in no site denominator and never one side of a split; a code with any of
    them reads `+ hits on no single site (read by hand)`. The column gives each site's pointer and its ran/refused/corpus
    hits. Lowerings that threw: 0. They would be named on stderr and counted in the header, never dropped silently.
    **Points at**, per site: valid ST (a vendor run or a corpus hit) rules out `invalid` only, so the site reads `valid`. A site
    reached only by vendor-refused fixtures reads `invalid?` (the refusal may be an unrelated gap the fixture also hits). A
    message alone is tentative (`?`). **Per code**: decided only when EVERY site points at the same kind. A site that says
    nothing does not agree with one that does (`partly decided`). Invalid ST at one site and valid ST at another, two stated
    kinds, or a `two-cases` message make a split candidate.
  - Gate 1 (2026-10-11): five review findings on the probe fixed, each test-first in `probe-refusal-evidence.test.ts` (18
    tests, was 14): (1) a template literal ended at its first inner backtick, so `no-unit`'s `lower-source.ts:87` and
    `pointer-targets`' `address.ts:266` matched nothing; the literal is now scanned as code. (2) a tie on fixed text went to
    whichever site the file walk reached first; it is now `(one of a, b)`. (3) `unmodelled` and `does not model` were not
    read as not-modelled. (4) `(unattributed)` counted as a site. (5) a union-type member (`routines.ts:190`) and a
    parameter default (`places.ts:23`) counted as sites. Moves: `no-unit` partly decided → `invalid?`; `call-output-type`
    partly decided → hits only on `(one of outputs.ts:33, outputs.ts:78)`; `call-method` and `type-unknown` split → their
    valid-ST hit is a tie (`call-method` undecided valid ST, `type-unknown` partly decided); `parse` and `stmt-call_stmt`
    split → partly decided (their valid ST is unattributed only); `pointer-value` undecided → partly decided (not-modelled
    at 3 of 10 sites); `place-not-local`'s `globals.ts:78` now says not-modelled (still a split); `call-base`, `call-body`,
    `graphical-body` and `property-store` lose their only attributed site (ties or unattributed). Gate: typecheck clean;
    full suite `VOLT_REQUIRE_FULL=1 bun test` 9448 pass, 35 skip, 389 todo, 0 fail (9872 tests, 326 files, 706 s); no
    fixture or transpiler change, so no `rate:fixtures`.
  - Tally (2 + 2 + 10 + 12 + 8 + 24 + 25 = 83):
    - **2 decided by evidence**, both not-measured: `for-bound-call`, `sizeof-unmeasured`.
    - **2 tentative `not-measured?`**: `fb-init-program`, `partial-access`. Their message is the only evidence.
    - **10 `invalid?`**, every site reached only by vendor-refused fixtures: `attr-init-unreached`, `call-inout-derived`,
      `call-param`, `call-super`, `case-label`, `enum-value`, `inout-constant-write`, `no-unit`, `string-op`,
      `this-in-program`.
    - **12 partly decided**, one kind at some sites and silence at the rest, each to be read per site: `adr-offset` and
      `any-input` (not-measured at 1 of 2 and 3 of 8 sites); `pointer-value` (not-modelled at 3 of 10, by message only:
      every hit at those three identical literals is a tie); and `assign-op`, `call-output`, `call-positional`, `parse`,
      `pointer-index`, `property-accessor`, `stmt-call_stmt`, `type-unknown`, `unary-op` (invalid at some sites).
    - **8 split candidates**:
      - 6 with invalid ST at one site and valid ST at another: `fb-init-argument`, `interface-query`, `place-not-local`
        (`globals.ts:78` says not-modelled, `globals.ts:82` invalid?), `place-shape`, `pointer-targets`, `var-at`.
      - `fb-init-order`: its sites say not-measured and not-modelled.
      - `layout-union`: one message joins "overlaid bytes are not measured" with "an initial value".
    - **24 valid ST, not-modelled vs not-measured undecided** (7 of them with hits on no single site besides).
    - **25 with no site evidence**: 20 with none at all (no fixture, no corpus hit, a silent message; this includes
      `call-target`, whose earlier "not-measured?" came from reading the next source line, `const unmeasured = ...`, as
      its message), and 5 whose hits all sit on pseudo-entries: `call-base`, `call-body`, `property-store` (valid ST on a
      tie of two sites), `call-output-type` (vendor-refused only, a tie of `outputs.ts:33`/`:78`), `graphical-body`
      (unattributed, `bodyOf`).
  - Findings for 2.x:
    - (a) Several codes are not about the user's ST at all: `no-scope`, `no-unit`, `unit-kind`, `root-inout` and
      `var-at-instances` (harness/entry), and `init-dropped` (a lowering-bug backstop, by its own comment). The three kinds may
      not fit them, just as `fb-init-root` and `pointer-root-input` were filed `not-measured` for a harness limit. `parse` is
      two things:
      - 797 vendor-refused fixtures.
      - 2 vendor-run fixtures, which are not alike:
        - `expr_pool_qualified_fb_type` ("Type definition expected instead of '__POOL'") is a real LSP parse gap.
        - `prag_if_hasconstanttype` is a deliberate refusal. "hasconstanttype (c, TRUE) asks the project's 'Replace
          constants' option, which Volt does not know here" is a project-setting fact Volt lacks, which is closer to
          not-measured. The vendor ran it: c=INT#5, out=INT#1.
      So `parse` needs a split, not only a parser fix.
    - (b) Codes hit both ways are now read per site. A site that only vendor-refused fixtures reach points at invalid for that
      site. For example, `var-at`'s `addresses.ts:69` ("incomplete, or of a shape not modelled") is reached by 12
      vendor-refused fixtures only, each refused for exactly that reason ("Direct address '%MX3' malformed", "'%I?0.0'
      malformed", "Unknown type: '%M?0.1'"). Its overlap sites `:112`/`:130` are reached by 8 vendor-run fixtures. The code
      is invalid at one site and not-modelled or not-measured at the others. Refused hits at a site that valid ST also
      reaches are evidence of nothing for that site, because lowering refuses before reaching the vendor's reason.
    - (c) `property-store`'s "does not compile" is a comment below the call, not its message. The probe reads no comment line.
    - (d) `(unattributed)` hits come from sites whose message is not a literal next to the code: `bodyOf`'s `{ code, message }`
      (`graphical-body`, `parse`), a code held in a variable (`stmt-call_stmt`, `fb-init-argument`, and `place-shape`'s
      `lw.bail(notAMember, ...)` at `places.ts:44`), a message held in a variable (`union-write`'s
      `lw.bail("union-write", what, span)` at `unions.ts:53`, 0 hits today), and the `pointers/state.ts` re-refusal. 2.x
      reads those sites by hand before classifying.
    - (e) `(one of a, b)` hits come from sites with the same fixed text (`call-method` `invoke.ts:159`/`names.ts:67`,
      `type-unknown` `expressions.ts:93`/`:106`, `call-base`, `call-body`, `call-output-type`, `call-global-instance`,
      `call-nested`, `property-store`, `any-input`'s `address.ts:85`/`:169`, `pointer-value`'s `address.ts:92`/`:186`/`:191`
      and `:99`/`:190`). Which site a hit came from needs the diagnostic's span or the code path, read by hand in 2.x; the
      message cannot say.

| code | sites | message says | vendor ran | vendor refused | corpus POUs | per site: pointer ran/refused/corpus | points at |
| `adr-offset` | 2: lower/builtins/sizeof.ts | not-measured | 2 (refuse_adr_difference, adr_difference_two_arrays) | 0 | 0 | sizeof.ts:60 none 0/0/0; sizeof.ts:70 not-measured 2/0/0 | partly decided (not-measured at 1 of 2 sites) |
| `any-input` | 8: lower/places/names.ts, lower/pointers/address.ts, lower/pointers/any.ts | not-measured | 0 | 0 | 8 (pro2193 8) | names.ts:23 none 0/0/0; address.ts:85 none 0/0/0; address.ts:169 none 0/0/0; address.ts:176 none 0/0/0; any.ts:30 not-measured 0/0/4; any.ts:147 not-measured? 0/0/0; any.ts:164 not-measured? 0/0/0; any.ts:179 none 0/0/0 ‖ (one of address.ts:85, address.ts:169) valid 0/0/4; (unattributed) valid 0/0/2 | partly decided (not-measured at 3 of 8 sites) + hits on no single site (read by hand) |
| `assign-op` | 2: lower/pointers/store.ts, lower/statements/assign.ts | — | 0 | 3 (cc3_reference_assign, decl_ref_init_on_value, …) | 0 | store.ts:92 invalid? 0/3/0; assign.ts:46 none 0/0/0 | partly decided (invalid at 1 of 2 sites) |
| `attr-init-inputs` | 1: lower/init/attributes.ts | — | 0 | 0 | 0 | attributes.ts:67 none 0/0/0 | undecided (no evidence) |
| `attr-init-unreached` | 1: lower/init/fb-init.ts | — | 0 | 1 (oopa_fb_init_array_left_out) | 0 | fb-init.ts:107 invalid? 0/1/0 | invalid? |
| `attr-instance-path` | 3: lower/init/attributes.ts | — | 3 (cc4_attribute_value_string, instance_path_with_reflection, …) | 0 | 0 | attributes.ts:44 valid 3/0/0; attributes.ts:45 none 0/0/0; attributes.ts:53 none 0/0/0 | undecided (valid ST: not-modelled or not-measured) |
| `call-base` | 2: lower/calls/routines.ts | — | 1 (unit_fb_extends_qualified) | 10 (cc2_base_and_interface_not_found, cc2_circular_inheritance, …) | 0 | routines.ts:291 none 0/0/0; routines.ts:336 none 0/0/0 ‖ (one of routines.ts:291, routines.ts:336) valid 1/10/0 | undecided (no evidence) + hits on no single site (read by hand) |
| `call-body` | 2: lower/calls/routines.ts | — | 0 | 0 | 175 (awa-palletizer 7, bakon-nano 17, lenze-mid 5, pro2193 146) | routines.ts:56 none 0/0/0; routines.ts:332 none 0/0/0 ‖ (one of routines.ts:56, routines.ts:332) valid 0/0/175 | undecided (no evidence) + hits on no single site (read by hand) |
| `call-fb-inout` | 1: lower/calls/last-binding.ts | — | 1 (tr_16_fb_copy_across_frame_instances) | 0 | 2 (pro2193 2) | last-binding.ts:81 valid 1/0/2 | undecided (valid ST: not-modelled or not-measured) |
| `call-global-instance` | 4: lower/calls/fb-call.ts, lower/calls/invoke.ts, lower/calls/property.ts, lower/interfaces/dispatch.ts | — | 1 (interface_holds_gvl_instance) | 1 (ambg_fb_instance_call) | 2 (bakon-nano 2) | fb-call.ts:119 none 0/0/0; invoke.ts:153 none 0/0/0; property.ts:91 none 0/0/0; dispatch.ts:40 valid 1/0/0 ‖ (one of fb-call.ts:119, invoke.ts:153) valid 0/1/2 | undecided (valid ST: not-modelled or not-measured) + hits on no single site (read by hand) |
| `call-inout-alias` | 6: lower/calls/binding.ts, lower/calls/invoke.ts, lower/calls/super.ts, lower/pointers/any.ts, lower/pointers/image-rewrite.ts | — | 1 (refuse_inout_aliases_receiver) | 0 | 0 | binding.ts:79 none 0/0/0; binding.ts:102 valid 1/0/0; invoke.ts:310 none 0/0/0; super.ts:94 none 0/0/0; any.ts:180 none 0/0/0; image-rewrite.ts:137 none 0/0/0 | undecided (valid ST: not-modelled or not-measured) |
| `call-inout-derived` | 1: lower/calls/binding.ts | — | 0 | 1 (oopb_abstract_assign_inout) | 0 | binding.ts:107 invalid? 0/1/0 | invalid? |
| `call-inout-order` | 2: lower/calls/binding.ts, lower/calls/fb-call.ts | — | 0 | 0 | 0 | binding.ts:187 none 0/0/0; fb-call.ts:179 none 0/0/0 | undecided (no evidence) |
| `call-inout-shadowed` | 2: lower/calls/invoke.ts, lower/calls/super.ts | — | 0 | 0 | 0 | invoke.ts:303 none 0/0/0; super.ts:89 none 0/0/0 | undecided (no evidence) |
| `call-method` | 3: lower/calls/invoke.ts, lower/interfaces/dispatch.ts, lower/places/names.ts | — | 0 | 2 (mem_unknown_method_of_fb_instance, mem_unknown_method_of_interface) | 30 (awa-palletizer 1, pro2193 29) | invoke.ts:159 none 0/0/0; dispatch.ts:52 valid 0/1/30; names.ts:67 none 0/0/0 ‖ (one of invoke.ts:159, names.ts:67) invalid? 0/1/0 | undecided (valid ST: not-modelled or not-measured) + hits on no single site (read by hand) |
| `call-named-args` | 1: lower/builtins/builtins.ts | — | 0 | 0 | 0 | builtins.ts:56 none 0/0/0 | undecided (no evidence) |
| `call-nested` | 3: lower/calls/invoke.ts, lower/calls/property.ts, lower/interfaces/dispatch.ts | — | 0 | 0 | 15 (pro2193 15) | invoke.ts:63 valid 0/0/7; property.ts:102 none 0/0/0; dispatch.ts:117 none 0/0/0 ‖ (one of property.ts:102, dispatch.ts:117) valid 0/0/12 | undecided (valid ST: not-modelled or not-measured) + hits on no single site (read by hand) |
| `call-open-array` | 3: lower/calls/fb-call.ts, lower/calls/invoke.ts, lower/calls/super.ts | — | 0 | 0 | 0 | fb-call.ts:216 none 0/0/0; invoke.ts:266 none 0/0/0; super.ts:107 none 0/0/0 | undecided (no evidence) |
| `call-output` | 3: lower/calls/invoke.ts, lower/calls/outputs.ts | — | 0 | 2 (calls_unknown_output_function, calls_unknown_output_method) | 0 | invoke.ts:200 none 0/0/0; invoke.ts:201 none 0/0/0; outputs.ts:22 invalid? 0/2/0 | partly decided (invalid at 1 of 3 sites) |
| `call-output-type` | 2: lower/calls/outputs.ts | — | 0 | 3 (accepts_output_into_other_type, tr_43_output_dint_to_int, …) | 0 | outputs.ts:33 none 0/0/0; outputs.ts:78 none 0/0/0 ‖ (one of outputs.ts:33, outputs.ts:78) invalid? 0/3/0 | undecided (no evidence) + hits on no single site (read by hand) |
| `call-param` | 4: lower/calls/fb-call.ts, lower/calls/invoke.ts, lower/calls/super.ts, lower/interfaces/dispatch.ts | — | 0 | 14 (calls_unknown_output_fb, calls_inout_unbound_unknown_named, …) | 0 | fb-call.ts:169 invalid? 0/3/0; invoke.ts:214 invalid? 0/9/0; super.ts:74 invalid? 0/1/0; dispatch.ts:58 invalid? 0/1/0 | invalid? |
| `call-positional` | 3: lower/calls/fb-call.ts, lower/calls/invoke.ts, lower/calls/super.ts | — | 0 | 5 (refuse_fb_called_positionally, tr_b4_positional_into_output, …) | 0 | fb-call.ts:156 invalid? 0/4/0; invoke.ts:185 invalid? 0/1/0; super.ts:61 none 0/0/0 | partly decided (invalid at 2 of 3 sites) |
| `call-program-member` | 1: lower/calls/fb-call.ts | — | 0 | 0 | 0 | fb-call.ts:124 none 0/0/0 | undecided (no evidence) |
| `call-program-method` | 1: lower/calls/invoke.ts | — | 0 | 0 | 4 (pro2193 4) | invoke.ts:158 valid 0/0/4 | undecided (valid ST: not-modelled or not-measured) |
| `call-program-property` | 2: lower/calls/property.ts | — | 0 | 0 | 0 | property.ts:109 none 0/0/0; property.ts:129 none 0/0/0 | undecided (no evidence) |
| `call-program-reentrant` | 8: lower/calls/fb-call.ts, lower/calls/invoke.ts, lower/calls/property.ts, lower/calls/routines.ts, lower/init/attributes.ts, lower/init/fb-init.ts | — | 0 | 0 | 0 | fb-call.ts:130 none 0/0/0; fb-call.ts:132 none 0/0/0; invoke.ts:163 none 0/0/0; invoke.ts:165 none 0/0/0; property.ts:111 none 0/0/0; routines.ts:351 none 0/0/0; attributes.ts:69 none 0/0/0; fb-init.ts:171 none 0/0/0 | undecided (no evidence) |
| `call-super` | 2: lower/calls/invoke.ts, lower/calls/super.ts | — | 0 | 5 (refuse_super_without_base, flw_super_in_program, …) | 0 | invoke.ts:97 invalid? 0/2/0; super.ts:32 invalid? 0/3/0 | invalid? |
| `call-target` | 4: lower/calls/property.ts, lower/calls/routines.ts | — | 0 | 0 | 0 | property.ts:38 none 0/0/0; routines.ts:243 none 0/0/0; routines.ts:246 none 0/0/0; routines.ts:326 none 0/0/0 | undecided (no evidence) |
| `case-label` | 1: lower/statements/case.ts | — | 0 | 4 (flw_case_variable_range_bound, lit_enum_typed_case_label, …) | 0 | case.ts:41 invalid? 0/4/0 | invalid? |
| `enum-value` | 1: lower/values/enums.ts | — | 0 | 12 (cc5_enum_init_not_convertible, enumdup_after_refused_implicit, …) | 0 | enums.ts:75 invalid? 0/12/0 | invalid? |
| `expr-call` | 4: lower/builtins/system.ts, lower/calls/invoke.ts | — | 7 (operand_ini_deprecated, sysop_position_value, …) | 47 (cs_anynum_to_conversions, operand_indexof, …) | 41 (awa-palletizer 1, pro2193 40) | system.ts:34 none 0/0/0; invoke.ts:102 none 0/0/0; invoke.ts:112 valid 6/46/34; invoke.ts:116 valid 1/1/9 | undecided (valid ST: not-modelled or not-measured) |
| `fb-init-argument` | 8: lower/init/fb-init-args.ts, lower/init/fb-init.ts, lower/init/step.ts | invalid/not-measured | 1 (init_this_in_initializer_argument) | 5 (fb_init_argument_left_out, init_struct_field_fb_init_scope_local, …) | 0 | fb-init-args.ts:60 none 0/0/0; fb-init-args.ts:64 invalid? 0/1/0; fb-init-args.ts:140 valid 1/0/0; fb-init-args.ts:167 none 0/0/0; fb-init-args.ts:172 invalid? 0/1/0; fb-init.ts:157 invalid? 0/1/0; fb-init.ts:163 none 0/0/0; step.ts:73 not-measured? 0/0/0 ‖ (unattributed) invalid? 0/2/0 | undecided (split? invalid ST at one site, valid ST at another) + hits on no single site (read by hand) |
| `fb-init-order` | 4: lower/init/fb-init-args.ts, lower/init/fb-init.ts, lower/init/position.ts | not-measured/not-modelled | 0 | 0 | 0 | fb-init-args.ts:194 not-measured? 0/0/0; fb-init.ts:179 not-modelled? 0/0/0; fb-init.ts:222 none 0/0/0; position.ts:96 not-measured? 0/0/0 | undecided (split? sites say not-measured + not-modelled) |
| `fb-init-program` | 1: lower/init/fb-init.ts | not-measured | 0 | 0 | 0 | fb-init.ts:145 not-measured? 0/0/0 | not-measured? |
| `for-bound-call` | 1: lower/statements/loops.ts | not-measured | 1 (refuse_for_step_calls) | 0 | 0 | loops.ts:96 not-measured 1/0/0 | not-measured |
| `graphical-body` | 1: lower/calls/routines.ts | — | 49 (sfc_step_flag_in_action, sfc_step_internal_in_action, …) | 47 (network_unnamed_instance, network_unnamed_assignment_target, …) | 129 (lenze-mid 5, pro2193 124) | routines.ts:210 none 0/0/0 ‖ (unattributed) valid 49/47/129 | undecided (no evidence) + hits on no single site (read by hand) |
| `init-dropped` | 1: lower/storage/declare.ts | — | 0 | 0 | 0 | declare.ts:104 none 0/0/0 | undecided (no evidence) |
| `init-not-constant` | 1: lower/init/initial-values.ts | — | 9 (init_struct_field_fb_init_scope, init_struct_field_fb_init_scope_dynamic, …) | 5 (tr_a20_real_mod_in_initializer, callarg_no_argument_variable_default, …) | 177 (awa-palletizer 7, bakon-nano 11, lenze-mid 7, pro2193 152) | initial-values.ts:60 valid 9/5/177 | undecided (valid ST: not-modelled or not-measured) |
| `inout-constant-write` | 1: lower/places/access-guards.ts | — | 0 | 1 (inout_const_write_5) | 0 | access-guards.ts:90 invalid? 0/1/0 | invalid? |
| `interface-call-shape` | 2: lower/interfaces/dispatch.ts | — | 1 (inh_interface_method_output_param) | 1 (calls_inout_unbound_interface_method) | 14 (pro2193 14) | dispatch.ts:54 valid 1/1/14; dispatch.ts:90 none 0/0/0 | undecided (valid ST: not-modelled or not-measured) |
| `interface-context` | 1: lower/interfaces/lend.ts | — | 0 | 0 | 0 | lend.ts:41 none 0/0/0 | undecided (no evidence) |
| `interface-input` | 1: lower/interfaces/dispatch.ts | — | 0 | 0 | 35 (pro2193 35) | dispatch.ts:60 valid 0/0/35 | undecided (valid ST: not-modelled or not-measured) |
| `interface-instance` | 1: lower/interfaces/tags.ts | — | 0 | 0 | 13 (pro2193 13) | tags.ts:62 valid 0/0/13 | undecided (valid ST: not-modelled or not-measured) |
| `interface-instance-relative` | 2: lower/interfaces/dispatch.ts, lower/interfaces/lend.ts | — | 1 (tr_18_queryinterface_into_global) | 0 | 0 | dispatch.ts:33 valid 1/0/0; lend.ts:63 none 0/0/0 | undecided (valid ST: not-modelled or not-measured) |
| `interface-lend-alias` | 1: lower/interfaces/lend.ts | — | 0 | 0 | 0 | lend.ts:70 none 0/0/0 | undecided (no evidence) |
| `interface-place` | 2: lower/interfaces/lend.ts, lower/interfaces/tags.ts | — | 0 | 0 | 21 (pro2193 21) | lend.ts:23 valid 0/0/21; tags.ts:129 none 0/0/0 | undecided (valid ST: not-modelled or not-measured) |
| `interface-query` | 4: lower/builtins/system.ts, lower/interfaces/query.ts | — | 0 | 2 (calls_queryinterface_int_first, calls_queryinterface_int_second) | 80 (pro2193 80) | system.ts:41 valid 0/0/80; query.ts:30 none 0/0/0; query.ts:40 none 0/0/0; query.ts:43 invalid? 0/2/0 | undecided (split? invalid ST at one site, valid ST at another) |
| `interface-store` | 1: lower/places/access-guards.ts | — | 0 | 0 | 0 | access-guards.ts:46 none 0/0/0 | undecided (no evidence) |
| `interface-type` | 1: lower/interfaces/tags.ts | — | 0 | 0 | 170 (awa-palletizer 7, bakon-nano 11, lenze-mid 6, pro2193 146) | tags.ts:146 valid 0/0/170 | undecided (valid ST: not-modelled or not-measured) |
| `interface-value` | 2: lower/interfaces/tags.ts, lower/places/access-guards.ts | — | 0 | 2 (dt_interface_variable_type_name, dt_interface_into_integers) | 80 (pro2193 80) | tags.ts:158 none 0/0/0; access-guards.ts:126 valid 0/2/80 | undecided (valid ST: not-modelled or not-measured) |
| `layout-base` | 1: lower/storage/layout.ts | — | 1 (unit_fb_extends_qualified) | 10 (cc2_base_and_interface_not_found, cc2_circular_inheritance, …) | 0 | layout.ts:89 valid 1/10/0 | undecided (valid ST: not-modelled or not-measured) |
| `layout-union` | 1: lower/storage/layout.ts | two-cases | 0 | 1 (dt_union_wstring_sizeof_bound) | 19 (lenze-mid 4, pro2193 15) | layout.ts:108 valid 0/1/19 ‖ (unattributed) valid 0/0/4 | undecided (split? a site's message joins two refusals) + hits on no single site (read by hand) |
| `no-scope` | 1: lower/entry/lower-source.ts | — | 0 | 0 | 0 | lower-source.ts:93 none 0/0/0 | undecided (no evidence) |
| `no-unit` | 1: lower/entry/lower-source.ts | — | 0 | 3 (pwh_unclosed_comment_struct, pwh_unclosed_comment_enum, …) | 0 | lower-source.ts:87 invalid? 0/3/0 | invalid? |
| `open-array-value` | 1: lower/places/bounds.ts | — | 0 | 0 | 0 | bounds.ts:49 none 0/0/0 | undecided (no evidence) |
| `parse` | 3: lower/calls/routines.ts, lower/entry/lower-source.ts | — | 2 (expr_pool_qualified_fb_type, prag_if_hasconstanttype) | 797 (cc4_type_name_bit_as_variable, cc4_type_name_byte_as_variable, …) | 0 | routines.ts:212 none 0/0/0; lower-source.ts:30 none 0/0/0; lower-source.ts:35 invalid? 0/5/0 ‖ (unattributed) valid 2/792/0 | partly decided (invalid at 1 of 3 sites) + hits on no single site (read by hand) |
| `partial-access` | 1: lower/expressions/partial-access.ts | not-measured | 0 | 0 | 0 | partial-access.ts:29 not-measured? 0/0/0 | not-measured? |
| `place-not-local` | 3: lower/places/globals.ts, lower/places/names.ts | not-modelled | 24 (oopa_inout_in_property, decl_var_generic, …) | 104 (cc2_constant_and_external, cc2_type_name_and_method_without_parens, …) | 154 (awa-palletizer 4, bakon-nano 16, lenze-mid 8, pro2193 126) | globals.ts:78 not-modelled 1/1/4; globals.ts:82 invalid? 0/1/0; names.ts:50 valid 23/102/154 | undecided (split? invalid ST at one site, valid ST at another) |
| `place-shape` | 6: lower/places/places.ts | — | 9 (decl_array_star_in_function_input, decl_array_star_in_method_input, …) | 41 (cc2_indexing_and_arity, cc2_in_out_not_assigned, …) | 122 (awa-palletizer 2, lenze-mid 8, pro2193 112) | places.ts:44 none 0/0/0; places.ts:58 valid 3/28/37; places.ts:80 invalid? 0/2/0; places.ts:92 none 0/0/0; places.ts:98 none 0/0/0; places.ts:122 valid 2/7/36 ‖ (unattributed) valid 4/4/116 | undecided (split? invalid ST at one site, valid ST at another) + hits on no single site (read by hand) |
| `pointer-foreign` | 1: lower/pointers/deref.ts | — | 0 | 0 | 6 (pro2193 6) | deref.ts:202 valid 0/0/6 ‖ (unattributed) valid 0/0/6 | undecided (valid ST: not-modelled or not-measured) + hits on no single site (read by hand) |
| `pointer-index` | 3: lower/places/places.ts, lower/pointers/deref.ts | — | 0 | 1 (cc3_pointer_conversions) | 0 | places.ts:105 invalid? 0/1/0; deref.ts:43 none 0/0/0; deref.ts:69 none 0/0/0 | partly decided (invalid at 1 of 3 sites) |
| `pointer-order` | 4: lower/pointers/address.ts, lower/pointers/borrowed.ts, lower/pointers/cursor.ts, lower/pointers/deref.ts | — | 2 (ptrparam_passed_on, decl_pointer_to_pointer_deref_typed) | 4 (decl_pointer_to_pointer_deref_once_into_int, decl_pointer_to_pointer_deref_thrice, …) | 48 (awa-palletizer 1, bakon-nano 3, pro2193 44) | address.ts:111 valid 0/0/8; borrowed.ts:66 valid 1/0/0; cursor.ts:233 none 0/0/0; deref.ts:64 valid 1/4/48 | undecided (valid ST: not-modelled or not-measured) |
| `pointer-outlives` | 2: lower/pointers/deref.ts, lower/pointers/state.ts | — | 0 | 0 | 42 (pro2193 42) | deref.ts:67 none 0/0/0; state.ts:212 valid 0/0/42 ‖ (unattributed) valid 0/0/42 | undecided (valid ST: not-modelled or not-measured) + hits on no single site (read by hand) |
| `pointer-place` | 1: lower/pointers/store.ts | — | 0 | 0 | 9 (pro2193 9) | store.ts:47 valid 0/0/9 | undecided (valid ST: not-modelled or not-measured) |
| `pointer-runtime-index` | 1: lower/pointers/address.ts | — | 0 | 0 | 6 (pro2193 6) | address.ts:47 valid 0/0/6 ‖ (unattributed) valid 0/0/5 | undecided (valid ST: not-modelled or not-measured) + hits on no single site (read by hand) |
| `pointer-shape` | 6: lower/pointers/address.ts | — | 1 (calls_adr_on_bit_access) | 0 | 1 (pro2193 1) | address.ts:31 none 0/0/0; address.ts:40 none 0/0/0; address.ts:60 valid 0/0/1; address.ts:66 none 0/0/0; address.ts:257 valid 1/0/0; address.ts:261 none 0/0/0 | undecided (valid ST: not-modelled or not-measured) |
| `pointer-step` | 3: lower/pointers/address.ts | — | 0 | 0 | 0 | address.ts:125 none 0/0/0; address.ts:135 none 0/0/0; address.ts:142 none 0/0/0 | undecided (no evidence) |
| `pointer-targets` | 9: lower/entry/lower-unit.ts, lower/pointers/address.ts, lower/pointers/deref.ts, lower/pointers/image-rewrite.ts, lower/pointers/store.ts | — | 1 (pointer_target_set_grows_copied) | 1 (cc6_reference_assign_constant) | 16 (pro2193 16) | lower-unit.ts:82 none 0/0/0; address.ts:105 valid 1/0/0; address.ts:195 valid 0/0/13; address.ts:266 valid 0/0/3; deref.ts:56 none 0/0/0; deref.ts:123 none 0/0/0; image-rewrite.ts:55 invalid? 0/1/0; store.ts:62 none 0/0/0; store.ts:104 none 0/0/0 ‖ (unattributed) valid 1/0/0 | undecided (split? invalid ST at one site, valid ST at another) + hits on no single site (read by hand) |
| `pointer-type` | 4: lower/pointers/address.ts, lower/pointers/borrowed.ts, lower/pointers/deref.ts | — | 5 (cursor_whole_store_capacity, oopb_abstract_ref_rebind, …) | 6 (refdecl_target_wrong_type, ptrsc_reference_initializer, …) | 40 (awa-palletizer 1, bakon-nano 1, lenze-mid 5, pro2193 33) | address.ts:57 valid 5/6/40; address.ts:67 none 0/0/0; borrowed.ts:75 valid 0/0/1; deref.ts:76 none 0/0/0 ‖ (unattributed) valid 1/2/3 | undecided (valid ST: not-modelled or not-measured) + hits on no single site (read by hand) |
| `pointer-value` | 10: lower/places/access-guards.ts, lower/pointers/address.ts, lower/pointers/cursor.ts, lower/pointers/store.ts | not-modelled | 17 (cmpop_pointer_vs_lint, cmpop_pointer_vs_sint, …) | 24 (cc3_pointer_conversions, cc5_pointer_not_convertible, …) | 99 (pro2193 99) | access-guards.ts:124 valid 14/22/4; address.ts:92 not-modelled? 0/0/0; address.ts:99 none 0/0/0; address.ts:183 none 0/0/0; address.ts:186 not-modelled? 0/0/0; address.ts:190 none 0/0/0; address.ts:191 not-modelled? 0/0/0; cursor.ts:96 none 0/0/0; store.ts:25 none 0/0/0; store.ts:28 none 0/0/0 ‖ (one of address.ts:99, address.ts:190) valid 3/4/0; (one of address.ts:92, address.ts:186, address.ts:191) valid 2/1/99; (unattributed) valid 0/0/4 | partly decided (not-modelled at 3 of 10 sites) + hits on no single site (read by hand) |
| `property-accessor` | 2: lower/calls/property.ts, lower/interfaces/dispatch.ts | — | 0 | 5 (cc2_property_lacks_getter, cc6_property_lacks_getter, …) | 0 | property.ts:36 invalid? 0/5/0; dispatch.ts:108 none 0/0/0 | partly decided (invalid at 1 of 2 sites) |
| `property-store` | 2: lower/calls/property.ts, lower/interfaces/dispatch.ts | — | 0 | 0 | 3 (pro2193 3) | property.ts:125 none 0/0/0; dispatch.ts:126 none 0/0/0 ‖ (one of property.ts:125, dispatch.ts:126) valid 0/0/3 | undecided (no evidence) + hits on no single site (read by hand) |
| `root-inout` | 2: lower/entry/lower-unit.ts | — | 0 | 0 | 0 | lower-unit.ts:185 none 0/0/0; lower-unit.ts:258 none 0/0/0 | undecided (no evidence) |
| `sizeof-unmeasured` | 1: lower/builtins/sizeof.ts | not-measured | 1 (refuse_sizeof_interface) | 0 | 168 (awa-palletizer 7, bakon-nano 9, lenze-mid 6, pro2193 146) | sizeof.ts:41 not-measured 1/0/168 | not-measured |
| `stmt-call_stmt` | 2: lower/calls/fb-call.ts | — | 0 | 10 (cc5_type_invoked_directly, cc5_invalid_call_target, …) | 2 (bakon-nano 2) | fb-call.ts:77 none 0/0/0; fb-call.ts:117 invalid? 0/3/0 ‖ (unattributed) valid 0/7/2 | partly decided (invalid at 1 of 2 sites) + hits on no single site (read by hand) |
| `string-op` | 2: lower/expressions/operators.ts | — | 0 | 10 (cmpop_string_vs_wstring, cmpop_real_vs_string, …) | 0 | operators.ts:210 invalid? 0/8/0; operators.ts:214 invalid? 0/2/0 | invalid? |
| `this-in-program` | 1: lower/places/places.ts | invalid | 0 | 1 (fbcall_this_in_program) | 0 | places.ts:51 invalid? 0/1/0 | invalid? |
| `type-unknown` | 5: lower/expressions/expressions.ts, lower/values/promote.ts | — | 1 (op_sys_type_class_bare) | 29 (op_arithmetic_bool_plus_int, cmpop_array_same_type, …) | 0 | expressions.ts:93 none 0/0/0; expressions.ts:106 none 0/0/0; expressions.ts:150 none 0/0/0; promote.ts:74 invalid? 0/29/0; promote.ts:93 none 0/0/0 ‖ (one of expressions.ts:93, expressions.ts:106) valid 1/0/0 | partly decided (invalid at 1 of 5 sites) + hits on no single site (read by hand) |
| `unary-op` | 3: lower/expressions/operators.ts | — | 0 | 19 (unary_minus_on_string, unary_not_on_string, …) | 0 | operators.ts:78 none 0/0/0; operators.ts:110 invalid? 0/11/0; operators.ts:112 invalid? 0/8/0 | partly decided (invalid at 2 of 3 sites) |
| `union-write` | 2: lower/storage/unions.ts | — | 0 | 0 | 0 | unions.ts:53 none 0/0/0; unions.ts:65 none 0/0/0 | undecided (no evidence) |
| `unit-kind` | 1: lower/entry/lower-unit.ts | — | 0 | 0 | 0 | lower-unit.ts:58 none 0/0/0 | undecided (no evidence) |
| `var-at` | 3: lower/storage/addresses.ts | two-cases | 8 (addr_same_word_twice, addr_byte_inside_word_low, …) | 12 (lit_address_unsized, lit_address_unsized_marker, …) | 0 | addresses.ts:69 invalid? 0/12/0; addresses.ts:112 valid 7/0/0; addresses.ts:130 valid 1/0/0 | undecided (split? invalid ST at one site, valid ST at another) |
| `var-at-instances` | 1: lower/entry/lower-unit.ts | — | 0 | 0 | 0 | lower-unit.ts:209 none 0/0/0 | undecided (no evidence) |

## 2. Classify

- [x] 2.1 Every code the evidence decides gets its kind; a code whose sites refuse two kinds is split, one code per kind.
  - Accept: `codes.test.ts`'s ratchet lowered to the new count; S `ir,rust` identical (no refusal moves).
- [x] 2.2 Every undecided code is asked first (fixtures written, then one `record:language` / `record:exec` batch per vendor),
  then classified.
  - Accept: the ratchet at 0 — the `unclassified` kind removed from `LowerCodeKind`; `docs/architecture.md`'s refused lists
    name each code's kind.
  - Done 2026-10-11 (2.1 and 2.2 in one step: 1.1's evidence decided few codes alone, so the asks and the splits went
    together). **The ratchet is gone: 0 `unclassified`, and the kind is removed from `LowerCodeKind`**; `codes.test.ts`'s
    ratchet is now "every code has one of the three kinds". The registry holds 163 codes (140 + 24 new − `call-base`): 60
    invalid, 73 not-modelled, 30 not-measured. Of the 83: 21 invalid, 52 not-modelled, 9 not-measured, `call-base` removed.
  - **The rules, per call site** (written into `codes.ts`'s header): a site only vendor-refused ST reaches, refused there for
    the site's own reason (each fixture's recorded error read against the site), is `invalid`. A site valid ST reaches (a
    vendor-run fixture, a corpus POU) is NEVER `invalid` — a wrong `invalid` sends a user to fix correct ST, while invalid ST
    that reaches a not-invalid site is reported by the front-end with CODESYS's own error beside it. Valid ST whose behaviour
    a recording states is `not-modelled`; valid ST whose behaviour no recording settles (a layout or address fact, an order,
    a project or device fact Volt is not given, a harness limit — precedent `fb-init-root`, `pointer-root-input`) is
    `not-measured`. A code whose sites refuse two of these is split (`lower/diagnostics/classification.test.ts`,
    test-first, 69 tests).
  - **Asked first**: 49 fixtures `rk_*` (`test/conformance/fixtures/{calls,memory,oop,operators}/refusal-kinds.ts`), each
    lowered first to prove it reaches the site it asks (its `feature` names the site); one `record:language` batch per
    vendor (CODESYS 48, then 3 again — `rk_interface_from_runtime_indexed_element` wrote a VAR from outside and
    `rk_queryinterface_from_instance` lacked `EXTENDS __SYSTEM.IQueryInterface`, fixture faults the first answer named,
    and the added `rk_init_slot_method_binitretains`; TwinCAT 50, Project13), one `record:exec` (31 cases, 0 failed), and
    one follow-up on all three for `rk_program_calls_itself` (the gap below). CODESYS refused 18 and built 31; TwinCAT
    differs on 3 (`rk_function_empty_argument`, `rk_fb_init_with_inout`, `rk_super_base_library` — its library is
    `Tc2_Standard`); the kind is CODESYS's, the transpiler's target. 8 probes were dropped before recording, lowering
    already passing them or another site coming first (an open array passed on, a struct output, REF= into a struct field,
    borrowed and scalar image pointers, an interface output, a FOR bound moved by a later METHOD).
  - **Splits, one code per kind**, each half with its recording: `call-base` → `base-unresolved` [invalid] (no FB
    declaration, a cycle, an interface or STRUCT base) + `call-library` [not-modelled] (a library base the binder linked);
    `layout-base` [not-modelled] + `base-unresolved`; `call-method` and `interface-type` [invalid, the project's] +
    `library-declaration` [not-modelled] (a library interface's METHODs after END_INTERFACE, a library FB with no
    IMPLEMENTS — all 115 and 175 corpus hits); `call-output` [invalid] + `call-empty-argument` [not-modelled]
    (`rk_function_empty_argument`: 6); `call-positional` [invalid] + `call-super-output` [not-modelled];
    `call-program-property` [not-modelled] + `program-property-written` [invalid]; `expr-call` and `stmt-call_stmt`
    [not-modelled, their families'; both FAMILY_EXCEPTIONS removed] + `call-not-callable` [invalid] (a name resolving to a
    variable, constant, type, GVL); `fb-init-argument` [invalid] + `fb-init-argument-shape` [not-modelled] (positional: 5;
    an FB_Init VAR_IN_OUT; THIS), and `step.ts`'s global read while FB_Init writes globals → `fb-init-order`
    [not-measured]; `interface-call-shape` [not-modelled] + `interface-impl-signature` [invalid]; `interface-query`
    [not-modelled] (an FB instance first operand: found TRUE, 4) + `interface-query-operand` [invalid]; `interface-value`
    [not-modelled] + `interface-given-value` [invalid]; `layout-union` [not-modelled] (an initial value builds) +
    `union-overlay` [not-measured]; `parse` [invalid] + `pragma-undecided` [not-measured] (`prag_if_hasconstanttype`);
    `place-not-local` [not-modelled] + `gvl-member-unknown` [invalid]; `place-shape` [not-modelled] + `deref-not-pointer`
    and `index-dims` [invalid] (`pointer-index`'s two-index site too); `pointer-type` [not-modelled] + `reference-type`
    [invalid]; `pointer-value` [not-modelled] + `integer-into-pointer` (the assignment table's CV6) and `pointer-operand`
    [invalid]; `type-unknown` [not-modelled] + `operand-types` [invalid]; `var-at` [not-modelled] (`%I*`) +
    `var-at-address` [invalid]; `call-inout-derived` [not-modelled] (a derived FB: `rk_inout_derived_fb` builds) + the
    existing `call-inout-type` [invalid] (`rk_inout_other_struct`); `call-super` [invalid] + `call-library` (`SUPER^()` over
    a library base); `attr-init-inputs` [not-modelled] (one `bInitRetains`) + `attr-init-signature` [invalid].
  - **Kinds, unsplit**, and what each rests on beyond 1.1's table. invalid: `assign-op` (`rk_ref_assign_in_chain`,
    `rk_interface_set_by_ref`), `call-named-args` (`rk_builtin_named_args`), `call-output-type`, `call-param`, `case-label`,
    `enum-value`, `inout-constant-write`, `no-unit`, `open-array-value` (`rk_open_array_assigned_whole`), `partial-access`
    (`rk_partial_access_signed`, `_out_of_range`; its message said "not measured", now that CODESYS refuses it),
    `property-accessor` (`rk_interface_property_not_implemented`), `string-op`, `this-in-program`, `unary-op`.
    not-modelled: `attr-init-unreached` (`rk_fb_init_array_elements`: 7, 7), `call-body`, `call-fb-inout`,
    `call-global-instance`, `call-inout-alias`, `call-inout-shadowed` (35), `call-nested` (`rk_nested_method_in_argument`:
    111 — the arguments in order, measured), `call-program-member`, `-method`, `-reentrant` (1, 1, 9), `graphical-body`,
    `init-not-constant`, `interface-input` (32), `interface-instance` (8), `interface-instance-relative`, `interface-place`
    (13), `interface-store` (`rk_interface_bound_to_inout` builds), `pointer-foreign`, `pointer-index` (33), `pointer-order`,
    `pointer-outlives` (42), `pointer-place`, `pointer-runtime-index` (23), `pointer-shape`, `pointer-step` (4660, 22),
    `pointer-targets`, `property-store` (sets 1), `union-write` (11, 10), `var-at-instances` (55, 55); and, reached by no
    fixture, no corpus POU and no ST found to reach them, Volt's own gaps — a defect if seen, so "wait or ask":
    `call-open-array`, `call-target`, `init-dropped`, `interface-context`, `interface-lend-alias`, `no-scope`, `unit-kind`,
    `call-this` (niche: accepted loss (0 occurrences in the corpora) for asking further). not-measured: `adr-offset` (an
    address gap is the compiler's allocation), `any-input` (TypeClass, the pValue of an unnamed argument),
    `attr-instance-path` (the project tree and the root are harness facts; `rk_instance_path_not_string` builds),
    `call-inout-order`, `fb-init-order`, `fb-init-program`, `for-bound-call`, `root-inout` (a harness limit, as
    `pointer-root-input`), `sizeof-unmeasured`.
  - **Found along the way, fixed test-first:**
    - `call-program` and `call-this` were emitted UNREGISTERED: `codes.test.ts`'s scan read a code argument only to its first
      comma, so a code chosen by a call (`bail(f(a, b) ? "x" : "y", …)`) or held in a variable was invisible to it — and a
      PROGRAM lowered as the root calling itself THREW LoweringBug instead of refusing. The scan reads the argument whole
      now (`codeArguments`, tested), the choice sits in the bail argument, and both are registered: `call-program`
      [not-modelled] (`rk_program_calls_itself`: CODESYS warns "Call recursion" and runs it, 3; TwinCAT builds),
      `call-this` [not-modelled] (no input reaches it).
    - `call-recursive` was `invalid` for every recursion, but recursion through ANOTHER routine runs
      (`calls_functions_mutually_recursive`) and so does a PROGRAM's (`rk_program_calls_itself`). Split: `call-recursive`
      [invalid] stays a FUNCTION or METHOD naming itself in its own body, where its name is its result
      (`cc2_call_recursion`, `calls_method_recursive`); `call-recursion` [not-modelled] is the rest.
    - The LSP's two false positives on the new fixtures: a missing interface PROPERTY is named by its accessor method,
      "There is no implementation for method '__GETLEVEL' …" (both vendors; it said "property 'LEVEL'"), and a struct field
      called is named as written, 'rec.M' (as every recorded member call is; it said 'M').
    - The asks' invalid ST found 14 front-end gaps (CODESYS refuses, the LSP says nothing: rated `lsp-gap`, the ceiling
      74 → 88 FOR MEASUREMENT in `map.test.ts`) — each niche: accepted loss (0 occurrences in the corpora, every corpus
      project builds), 12 by their fixtures' `deferred.lsp`, the two partial accesses `MEASURED_SILENT` (TwinCAT has no
      `.%` access and the LSP agrees with it); the front-end baselines name them as ceiling exceptions
      (`test/frontend/baseline.ts`, the fold dump's finding form now recognised there).
  - **S `ir,rust`** (baseline written from HEAD's `src/` with this step's fixtures, then checked): Rust identical for all
    3480; IR identical for 4218 fixtures, 1346 differ in `kind` only, 93 in `kind` and a split code's slug, 2 in the
    message (`partial-access`, reworded to its recorded kind) — no refusal moved: the same fixtures refused at the same
    spans.
  - Tests: `lower/diagnostics` 69 (all new or rewritten), `src/transpile/lower` + `src/analysis/checks` 1181 pass, `scripts`
    38, `test/frontend` 45 (baselines rewritten for the new fixtures), `test/conformance` 6736 with `rate:fixtures` rerun —
    one test, `call-parameters.test.ts`'s positional binding, runs at its 5 s timeout at HEAD as here (4.9–5.4 s at HEAD,
    5.1–5.7 s now, timed alone) and fails under load; flagged, not raised. Typecheck clean.
  - The probe `scripts/probe-refusal-evidence.ts` and its test are deleted: single-use, its table above is the record
    (`git show f5a189cb83:packages/volt-lsp-iec/scripts/probe-refusal-evidence.ts`).
  - `docs/architecture.md`: each registry code its refused lists name carries its kind in brackets (51 mentions), the split
    codes are in the lists, and a paragraph states the three kinds and how they were decided.
  - Gate 2 (2026-10-11): six review findings, five fixed test-first (`classification.test.ts` 66 tests, `routines.test.ts`),
    one scoped. A scan of every corpus POU's diagnostics with their kinds (one-off, not kept) moved 49 `reference-type` →
    `pointer-type` and 1 `call-not-callable` → `expr-call`, and nothing else; `rate:fixtures` leaves the map unchanged.
    - (1) `reference-type` took any REFERENCE of other STORAGE than its target, including a REFERENCE given to `REF=`: pro2193
      `MapperBase.SetSliceRef`'s `THIS^.sliceInfo REF= sliceInfo` (both `REFERENCE TO Slice_Type`), 49 corpus diagnostics.
      A REFERENCE given is now read as what it refers to: the same type → `pointer-type` [not-modelled]; another type stays
      `reference-type` (`cv_reference_to_other_reference`'s `ri REF= rr`, refused).
    - (2) `call-not-callable` took a name that resolves to a LIBRARY's declaration: awa-palletizer `DELETE(STR := …)`
      resolved to CAA File's FB `DELETE` before Standard's FUNCTION. Now invalid only for a project declaration
      (`invoke.ts` `notCallable`, used by the statement call in `fb-call.ts` too); a library one stays `expr-call` /
      `stmt-call_stmt`.
    - (3) `call-recursive` was decided by the call path, so `THIS^.M()` inside METHOD M was refused as invalid like the bare
      `M()`. `once` now takes `bare` (the call named the routine by its bare name, `calledRoutine`): only a bare self-name in
      the routine's own lowering is `call-recursive`; `THIS^.M()` is `call-recursion` [not-modelled] (no recording refuses
      it). `totality.test.ts`'s THIS^ case and `routines.test.ts`'s `once` case read `call-recursion` on that ground —
      no recording refuses a re-entry not made by the bare name — and a new `once` test holds the bare case.
    - (4) `parse` → not-modelled: the LSP's parser refuses ST CODESYS builds (`expr_pool_qualified_fb_type`, and five more
      vendor-built fixtures), and a refusal cannot tell that from a syntax error; invalid ST reaching it is reported by the
      front-end with CODESYS's own error beside it.
    - (5) `interface-given-value` took a REFERENCE TO an FB that implements the interface. Now invalid only for an
      elementary value (`rk_interface_given_integer`); anything else stays `interface-value` [not-modelled].
    - (6) the "a site valid ST reaches is never invalid" rule is stated for the codes this change classified; `codes.ts`'s
      header and `docs/architecture.md` name the seven older `invalid` codes valid ST still reaches (`var-duplicate` 189,
      `layout-recursive` 168, `call-arity` 66, `call-input-missing` 16, `bad-literal` 2 in the corpora; `constant-overflow`,
      `case-label-type` in vendor-built fixtures) until a change re-reads them — out of this change's 83.
  - Gate 2, second review (2026-10-11): four findings, two fixed test-first (`classification.test.ts` 68 tests), two
    scoped in `codes.ts`'s header with their reason.
    - (1) `call-recursive` [invalid] took any bare self-call, so an ACTION calling itself (`Act();` in ACTION Act) or a
      METHOD with no result type (`M();`) was refused as invalid, though neither has a name-as-result. `bare` is now set only
      for a routine with a result (`hasResult` in `routines.ts`: not an ACTION, a declared return type); the rest is
      `call-recursion` [not-modelled] (0 in the corpora).
    - (2) `pointer-value` at `loadValue` ("a pointer's value used as a number") is a mixed site: of the fixtures lowering to
      it, CODESYS refuses 22 (`ptrsc_into_*`, `cmpop_pointer_vs_dint`, `cc5_pointer_not_convertible`) and builds 14
      (`cmpop_pointer_vs_lint`, …), by the DESTINATION type; `loadValue` is not given that type. Not cheap: left
      `not-modelled` (4 corpus diagnostics, valid ST) and named in `codes.ts`'s header and `docs/architecture.md`.
    - (3) skipped: `reference-type` is not reached by an image-pointer REFERENCE (`bindReference` → `imageAddressOf` compares
      no types), so `rx REF= y` (REAL into REFERENCE TO INT, `refdecl_target_wrong_type`) lowers silently. A missing
      refusal older than this step; this change adds no refusal (proposal non-goals). Named in `codes.ts`'s header.
    - (4) an interface given a REFERENCE TO a project FB that does NOT implement it is now `interface-type` [invalid], read
      through the reference as the FB instance itself is (`tags.ts` `interfaceArgument`); one that implements it stays
      `interface-value` [not-modelled] (0 in the corpora).
    - Found by the gate's full run: the diagnostic census (`test/analysis/diagnostic-census.test.ts`) had not been
      re-measured for the 49 `rk_*` asks — it failed with 25 new CODESYS GAPs and 27 TwinCAT (the same front-end gaps 2.2
      lists, plus TwinCAT-only refusals of `rk_function_empty_argument`, `rk_fb_init_with_inout`, `rk_super_base_library`
      and CODESYS's "Call recursion" warning on `rk_program_calls_itself`). Each is a named ceiling exception per fixture and
      measure in `test/frontend/baseline.ts` (niche: accepted loss, 0 occurrences in the corpora), and the two fixture
      baselines rewritten (`VOLT_WRITE_BASELINE=1`: only `rk_*` rows and counts change; no ceiling rises).
    - Gate 2 numbers (2026-10-11): typecheck clean; `rate:fixtures` rerun after the fixes, the map unchanged by them; the full
      LSP suite with `VOLT_REQUIRE_FULL=1`: 9516 pass, 0 fail, 35 skip, 421 todo, 9972 tests in 326 files (808 s).

## Close-out (2026-10-11)

- Full LSP suite COLD (`VOLT_RUSTC_CACHE=0 VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset): 9516 pass, 0 fail, 35 skip,
  421 todo, 9972 tests in 326 files (1060 s). Typecheck clean.
- Docs: `docs/architecture.md`'s refused lists carry each code's kind (step 2); `docs/data-model.md`'s `LowerDiagnostic`
  names `LowerCodeKind` without the removed kind; no doc mentions `unclassified` or `call-base`.
- Final review, SPEC lens: the spec delta said each kind was decided by call sites and recordings alone, with no word on
  what was built beyond that — the per-site rules, the splits, the codes no input reaches (Volt's own gaps, `not-modelled`),
  the older `invalid` codes not re-read and `pointer-value`'s mixed site. Rewritten to state what was built before archiving.
  LAYERING lens: `scripts/check-layering.ts` clean (imports down only; the change's new imports reach `frontend/*` through
  their indexes); nothing to fix.
