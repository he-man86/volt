/**
 * THE `{IF}` CONDITION'S VALUE — a `Condition` (`condition-parse.ts`) evaluated against what a consumer MEASURED of the
 * world it is compiled in (`ConditionWorld`) and the body's own defines. A question about a part the world does not hold
 * is refused by name, never answered by a default. Split from `conditional.ts` (openspec lsp-same-standard design.md
 * §2.2), whose header states what was measured.
 */
import { TYPED_PREFIXES } from "../lex/prefixes.js"
import type { Dialect } from "../lex/vocabulary.js"
import { Refused, UNKNOWN_OPERATOR_ERRORS, VendorError, type Condition, type ConditionError } from "./condition-parse.js"

/** The project's and the unit's names, as the binder knows them. */
export interface ConditionNames {
  /** A variable named `name` is visible in the current scope. */
  variable(name: string): boolean
  type(name: string): boolean
  pou(name: string): boolean
  /** Does `name`'s declaration carry `{attribute '<attribute>'}` — undefined when `name` is not found. */
  hasAttribute(kind: "pou" | "variable", name: string, attribute: string): boolean | undefined
  /** The NAME of the type the variable `name` is declared with, upper-case and as written — an alias, a DUT or an FB by
   *  its own name — undefined when `name` is no variable declared with a plain type name. */
  typeOf(name: string): string | undefined
  /** The integer value of the constant `name` — undefined when it is no constant with a literal integer value. */
  constantValue(name: string): bigint | undefined
}

/** Facts of the device the code is compiled for. */
export interface DeviceFacts {
  littleEndian: boolean
  simulation: boolean
  fpu: boolean
  registerSize: number
  packMode: number
}

/**
 * THE COMPILATION TARGET — only what a TYPE fact depends on: the width of a pointer, which is the width the platform
 * integers (`__XINT`, `__UXINT`, `__XWORD`) take and the narrowest integer a pointer fits (`types/platform.ts`). A fact
 * of the DEVICE, never of the vendor: both recording projects are 64-bit (`plat_*`, `ty_xint_twincat_width`), and a
 * TwinCAT project once recorded on its ARM CE7 target measured the 32-bit half (frontend-conformance 4.1.1).
 */
export interface Target {
  pointerBits: 32 | 64
}

/** What the project's compile settings say, each part known or not: its compile defines (CODESYS's Application > Build >
 *  Compiler defines, the TwinCAT PLC project's "Compiler defines") and its task configuration. */
interface ProjectFacts {
  defines?: ReadonlySet<string>
  tasks?: ReadonlySet<string>
}

/** The environment a project is compiled in, as far as a consumer MEASURED it: the device and the project's compile
 *  settings. The LSP knows neither; the conformance harness states the recording projects' (`defined (VOLT_NEVER_DEFINED)`
 *  measures their defines), the transpiler the exec oracle's (`transpile/lower/conditions.ts`). */
export interface CompileEnvironment {
  device?: DeviceFacts
  project?: ProjectFacts
  /** The target's pointer width, where it was MEASURED (the recordings' `plat_*`) or read off a device whose width is
   *  measured (`workspace-refs` `targetOfDevices`). Absent, a platform integer has no width and resolves to nothing. */
  target?: Target
}

/**
 * What a condition may ask beyond the body's own defines. Every part is optional and a question about an absent part is
 * REFUSED by name, never answered by a default: the LSP holds no device, no project compile defines and no task
 * configuration, so `defined (IsSimulationMode)` there is unknown — not FALSE — and so is `defined (X)` of any name the
 * body does not define itself (a compile define of the application makes it TRUE).
 */
export interface ConditionWorld extends CompileEnvironment {
  /** The vendor, for the operators only CODESYS reads (`project_defined`, `hasconstanttype`). */
  dialect?: Dialect
  names?: ConditionNames
}

/** The device's defines, as measured on the exec device (frontend-conformance 2.7.1): its FLAGS asked by `defined`, its
 *  VALUES by `hasvalue`. The crossed shapes (`defined (RegisterSize)`, `hasvalue (IsSimulationMode, …)`) are measured
 *  nowhere and refused by name (0 occurrences in the corpora). */
const DEVICE_DEFINES: Record<string, keyof DeviceFacts> = { IsLittleEndian: "littleEndian", IsSimulationMode: "simulation", IsFPUSupported: "fpu" }
const DEVICE_VALUES: Record<string, keyof DeviceFacts> = { RegisterSize: "registerSize", PackMode: "packMode" }
type ConditionValue = boolean | { refused: string } | { errors: readonly ConditionError[] }

/**
 * `condition` under `world` and the body's own `defines` (name → value, case-sensitive). `uncertain` names the defines a
 * `{define}`/`{undefine}` may or may not have changed — one in a branch whose condition was refused — so a question
 * about one is refused too.
 */
export function evaluateCondition(
  condition: Condition,
  world: ConditionWorld,
  defines: ReadonlyMap<string, string | undefined>,
  uncertain: ReadonlySet<string> = new Set(),
): ConditionValue {
  try {
    return new ConditionEvaluator(world, defines, uncertain).ev(condition)
  } catch (e) {
    if (e instanceof VendorError) return { errors: e.errors }
    if (e instanceof Refused) return { refused: e.message }
    throw e
  }
}

/** One evaluation — throws `Refused` (a question the world cannot answer) or `VendorError` where it stops. */
class ConditionEvaluator {
  constructor(
    private readonly world: ConditionWorld,
    private readonly defines: ReadonlyMap<string, string | undefined>,
    private readonly uncertain: ReadonlySet<string>,
  ) {}

  private refuse(what: string): never {
    throw new Refused(what)
  }

  private names(what: string): ConditionNames {
    return this.world.names ?? this.refuse(`${what} asks the project's names, which this parse was not given`)
  }

  private device(what: string): DeviceFacts {
    return this.world.device ?? this.refuse(`${what} asks a fact of the device, which Volt does not know here`)
  }

  private projectDefines(what: string): ReadonlySet<string> {
    return this.world.project?.defines ?? this.refuse(`${what} asks the project's compile defines, which Volt does not know here`)
  }

  private tasks(what: string): ReadonlySet<string> {
    return this.world.project?.tasks ?? this.refuse(`${what} asks the project's task configuration, which Volt does not know here`)
  }

  private certain(name: string, what: string): void {
    if (this.uncertain.has(name)) this.refuse(`${what} asks a define made or removed in a branch Volt could not decide`)
  }

  /** `what` is an operator CODESYS alone reads: TwinCAT's answer is the unknown-operator pair. */
  private codesysOnly(what: string): void {
    if (this.world.dialect === "twincat") throw new VendorError(UNKNOWN_OPERATOR_ERRORS)
    if (this.world.dialect === undefined) this.refuse(`${what} is read by CODESYS alone, and this parse was not given its vendor`)
  }

  ev(c: Condition): boolean {
    switch (c.op) {
      case "not":
        return !this.ev(c.operand)
      case "and":
        return this.ev(c.left) && this.ev(c.right)
      case "or":
        return this.ev(c.left) || this.ev(c.right)
      case "defined":
        return this.defined(c.name)
      case "defined_in": {
        const what = `defined (${c.kind}: ${c.name})`
        if (c.kind === "resource") return false
        if (c.kind === "task") return this.tasks(what).has(c.name)
        return this.names(what)[c.kind](c.name)
      }
      case "hasvalue":
        return this.hasvalue(c.name, c.value)
      case "hasattribute": {
        const what = `hasattribute (${c.kind}: ${c.name}, '${c.attribute}')`
        return this.names(what).hasAttribute(c.kind, c.name, c.attribute) ?? this.refuse(`${what}: '${c.name}' is not found`)
      }
      case "hastype":
        return this.hastype(c.name, c.type)
      case "hasconstanttype":
        this.codesysOnly(`hasconstanttype (${c.name}, ${c.replaced ? "TRUE" : "FALSE"})`)
        return this.refuse(`hasconstanttype (${c.name}, ${c.replaced ? "TRUE" : "FALSE"}) asks the project's 'Replace constants' option, which Volt does not know here`)
      case "hasconstantvalue":
        return this.hasconstantvalue(c)
      case "project_defined":
        this.codesysOnly(`project_defined (${c.name})`)
        return this.projectDefines(`project_defined (${c.name})`).has(c.name)
    }
  }

  private defined(name: string): boolean {
    const what = `defined (${name})`
    this.certain(name, what)
    if (this.defines.has(name)) return true
    const fact = Object.hasOwn(DEVICE_DEFINES, name) ? DEVICE_DEFINES[name] : undefined
    // a device VALUE define asked by `defined` is no measured shape: refused, never the project defines' FALSE
    if (Object.hasOwn(DEVICE_VALUES, name)) this.refuse(`${what} asks whether the device's value define is defined, which no recording measured`)
    // a name the body does not define is the project's compile define, or a device's
    return fact === undefined ? this.projectDefines(what).has(name) : (this.device(what)[fact] as boolean)
  }

  private hasvalue(name: string, value: string): boolean {
    const what = `hasvalue (${name}, '${value}')`
    this.certain(name, what)
    if (this.defines.has(name)) return this.defines.get(name) === value
    const fact = Object.hasOwn(DEVICE_VALUES, name) ? DEVICE_VALUES[name] : undefined
    if (fact !== undefined) return String(this.device(what)[fact]) === value
    // a device FLAG define asked by `hasvalue` is no measured shape: refused, never the project defines' FALSE
    if (Object.hasOwn(DEVICE_DEFINES, name)) this.refuse(`${what} asks the value of the device's flag define, which no recording measured`)
    // a compile define of the project has a value Volt is not given: only its absence answers
    return this.projectDefines(what).has(name) ? this.refuse(`${what} asks the value of a project compile define, which Volt does not know here`) : false
  }

  /**
   * Measured for an elementary type spec against a variable of an elementary type (`prag_if_hastype`, INT and DINT):
   * a generic spec (ANY_INT, …, which CODESYS documents) and a variable of an alias, a DUT or an FB are not, and
   * are refused rather than compared by name.
   */
  private hastype(name: string, type: string): boolean {
    const what = `hastype (variable: ${name}, ${type})`
    if (!TYPED_PREFIXES.has(type.toUpperCase())) this.refuse(`${what}: the type spec '${type}' is not an elementary type Volt has measured hastype against`)
    const t = this.names(what).typeOf(name) ?? this.refuse(`${what}: '${name}' is no variable declared with a type name`)
    if (!TYPED_PREFIXES.has(t)) this.refuse(`${what}: '${name}' is declared with '${t}', which is not an elementary type Volt has measured hastype against`)
    return t === type.toUpperCase()
  }

  private hasconstantvalue(c: Extract<Condition, { op: "hasconstantvalue" }>): boolean {
    const what = `hasconstantvalue (${c.name}, ${c.value}, ${c.compare})`
    const v = this.names(what).constantValue(c.name) ?? this.refuse(`${what}: '${c.name}' is no constant with an integer value`)
    switch (c.compare) {
      case "<":
        return v < c.value
      case "<=":
        return v <= c.value
      case "=":
        return v === c.value
      case "<>":
        return v !== c.value
      case ">=":
        return v >= c.value
      case ">":
        return v > c.value
    }
    return false
  }
}
