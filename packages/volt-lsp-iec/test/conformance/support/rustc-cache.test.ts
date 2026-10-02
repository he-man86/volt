import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  buildKey,
  buildRust,
  environmentIdentity,
  KEYED_ENV,
  sampled,
  StaleCacheError,
  toolchainIdentity,
  uncacheable,
  type KeyInput,
  type Toolchain,
} from "./rustc-cache.js"
import { CLIPPY, RUSTC, skipRustSuite } from "./rustc.js"
import { buildArgv } from "./transpile-confidence.js"

const exeOf = (dir: string, name: string) => join(dir, `${name}${process.platform === "win32" ? ".exe" : ""}`)

const BASE: KeyInput = {
  source: "fn main() {}\n",
  argv: ["clippy-driver", "--edition", "2021", "-W", "warnings", "-o", "/s/a/x.exe", "/s/a/x.rs"],
  file: "/s/a/x.rs",
  exe: "/s/a/x.exe",
  compiler: "rustc 1.96.0 / sysroot / sha",
  environment: "[]",
}

const TOOLCHAIN: Toolchain = {
  versionVerbose: "rustc 1.96.0 (ac68faa20 2026-05-25)\ncommit-hash: ac68\nhost: x86_64-pc-windows-msvc\nLLVM version: 22.1.2\n",
  sysroot: "C:/rustup/toolchains/stable",
  binary: "aa".repeat(32),
  stdlib: ["libstd-1234.rlib:100", "libcore-5678.rlib:200"],
  linker: '["C:/VS/link.exe",1000,1]',
}

describe("the key — every input a build reads changes it", () => {
  const key = buildKey(BASE)
  const changed: [string, Partial<KeyInput>][] = [
    ["one byte of source", { source: "fn main() { }\n" }],
    ["a trailing newline", { source: "fn main() {}\n\n" }],
    ["the compiler binary named in argv", { argv: ["rustc", ...BASE.argv.slice(1)] }],
    ["the edition", { argv: BASE.argv.map((a) => (a === "2021" ? "2018" : a)) }],
    ["a lint level", { argv: BASE.argv.map((a) => (a === "-W" ? "-D" : a)) }],
    ["an added flag", { argv: [...BASE.argv.slice(0, -1), "-F", "unsafe_code", BASE.file] }],
    ["an explicit --target", { argv: [...BASE.argv.slice(0, -1), "--target", "x86_64-unknown-linux-gnu", BASE.file] }],
    ["an --extern crate", { argv: [...BASE.argv.slice(0, -1), "--extern", "foo=/l/libfoo.rlib", BASE.file] }],
    ["a library search path", { argv: [...BASE.argv.slice(0, -1), "-L", "/l", BASE.file] }],
    ["the flag order", { argv: [BASE.argv[0]!, "-W", "warnings", "--edition", "2021", ...BASE.argv.slice(5)] }],
    ["metadata instead of an executable", { argv: [...BASE.argv.slice(0, 5), "--emit", "metadata", "-o", "/s/a/x.exe", BASE.file] }],
    ["the crate name (the file's basename)", { file: "/s/a/y.rs", argv: BASE.argv.map((a) => (a === BASE.file ? "/s/a/y.rs" : a)) }],
    ["the toolchain identity", { compiler: "rustc 1.97.0 / sysroot / sha" }],
    ["the environment identity", { environment: '[["RUSTUP_TOOLCHAIN","nightly"]]' }],
  ]
  for (const [what, delta] of changed)
    test(`${what} → a different key`, () => expect(buildKey({ ...BASE, ...delta })).not.toBe(key))

  test("the same build in another scratch directory → the same key (only the paths are abstracted)", () => {
    const moved = { file: "/t/b/x.rs", exe: "/t/b/x.exe" }
    expect(buildKey({ ...BASE, ...moved, argv: BASE.argv.map((a) => (a === BASE.file ? moved.file : a === BASE.exe ? moved.exe : a)) })).toBe(key)
  })

  const toolchain = toolchainIdentity(TOOLCHAIN)
  const parts: [string, Partial<Toolchain>][] = [
    ["the release (-vV)", { versionVerbose: TOOLCHAIN.versionVerbose.replace("1.96.0", "1.96.1") }],
    ["the commit hash (-vV)", { versionVerbose: TOOLCHAIN.versionVerbose.replace("ac68\n", "ac69\n") }],
    ["the host = target triple (-vV)", { versionVerbose: TOOLCHAIN.versionVerbose.replace("windows-msvc", "windows-gnu") }],
    ["the LLVM version (-vV)", { versionVerbose: TOOLCHAIN.versionVerbose.replace("22.1.2", "22.1.3") }],
    ["the sysroot / toolchain path", { sysroot: "C:/rustup/toolchains/nightly" }],
    ["the real compiler binary's hash", { binary: "ab".repeat(32) }],
    ["a std library file", { stdlib: ["libstd-9999.rlib:100", "libcore-5678.rlib:200"] }],
    ["a std library file's size", { stdlib: ["libstd-1234.rlib:101", "libcore-5678.rlib:200"] }],
    ["the linker", { linker: '["C:/VS2/link.exe",1000,1]' }],
  ]
  for (const [what, delta] of parts)
    test(`${what} → a different toolchain identity`, () => expect(toolchainIdentity({ ...TOOLCHAIN, ...delta })).not.toBe(toolchain))

  test("every keyed environment variable, and a clippy.toml, changes the environment identity", () => {
    const cwd = mkdtempSync(join(tmpdir(), "volt-rustc-cache-env-"))
    try {
      const base = environmentIdentity({}, cwd)
      for (const name of KEYED_ENV) expect([name, environmentIdentity({ [name]: "x" }, cwd)]).not.toEqual([name, base])
      for (const name of ["clippy.toml", ".clippy.toml"]) {
        writeFileSync(join(cwd, name), "too-many-arguments-threshold = 3\n")
        const configured = environmentIdentity({}, cwd)
        expect(configured).not.toBe(base)
        writeFileSync(join(cwd, name), "too-many-arguments-threshold = 4\n")
        expect(environmentIdentity({}, cwd)).not.toBe(configured)
        rmSync(join(cwd, name))
      }
      // CLIPPY_CONF_DIR moves where clippy looks: a config there is keyed
      const conf = join(cwd, "conf")
      mkdirSync(conf)
      writeFileSync(join(conf, "clippy.toml"), "x = 1\n")
      const a = environmentIdentity({ CLIPPY_CONF_DIR: conf }, cwd)
      writeFileSync(join(conf, "clippy.toml"), "x = 2\n")
      expect(environmentIdentity({ CLIPPY_CONF_DIR: conf }, cwd)).not.toBe(a)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test("a source that can read an input outside the key is not cacheable", () => {
    for (const s of [
      'include!("x.rs");',
      'const S: &str = include_str!("x.txt");',
      'const B: &[u8] = include_bytes!("x.bin");',
      'const V: &str = env!("X");',
      'const V: Option<&str> = option_env!("X");',
      "extern crate foo;",
      "mod helper;",
      '#[path = "x.rs"] mod h { }',
    ])
      expect([s, uncacheable(`fn main() {}\n${s}\n`)]).not.toEqual([s, undefined])
    expect(uncacheable("mod inner { pub fn f() {} }\nfn main() { let _ = std::env::args(); inner::f(); }\n")).toBeUndefined()
  })
})

describe("sampled verification — which hits are re-proved", () => {
  const keys = Array.from({ length: 20_000 }, (_, i) => buildKey({ ...BASE, source: `fn main() { let _ = ${i}; }` }))
  test("is a pure function of key and seed (reproducible)", () => {
    expect(keys.map((k) => sampled(k, "seed1", 0.02))).toEqual(keys.map((k) => sampled(k, "seed1", 0.02)))
  })
  test("another seed samples other hits", () => {
    expect(keys.map((k) => sampled(k, "seed1", 0.02))).not.toEqual(keys.map((k) => sampled(k, "seed2", 0.02)))
  })
  test("0 re-proves none, 1 re-proves every hit, 0.02 about 2%", () => {
    expect(keys.filter((k) => sampled(k, "s", 0)).length).toBe(0)
    expect(keys.filter((k) => sampled(k, "s", 1)).length).toBe(keys.length)
    const rate = keys.filter((k) => sampled(k, "s", 0.02)).length / keys.length
    expect(rate).toBeGreaterThan(0.015)
    expect(rate).toBeLessThan(0.025)
  })
})

describe.skipIf(skipRustSuite())("a build through the cache", () => {
  setDefaultTimeout(60_000) // each case is a few real compiles
  const scratch = mkdtempSync(join(tmpdir(), "volt-rustc-cache-"))
  const root = join(scratch, "cache")
  const compiler = CLIPPY ?? RUSTC!
  const program = (says: string) => `fn main() {\n    let unused = 1;\n    println!("${says}");\n}\n`
  let n = 0
  /** a build of `source` as `name`, in a fresh scratch directory each time (a hit must work from anywhere) */
  const build = async (name: string, source: string, at = root) => {
    const dir = join(scratch, `run${n++}`)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${name}.rs`)
    const exe = exeOf(dir, name)
    const keys = () => (existsSync(at) && !at.endsWith("not-a-dir") ? readdirSync(at) : [])
    const before = new Set(keys())
    const b = await buildRust(buildArgv(compiler, file, { exe }), file, exe, source, [[]], at)
    return { dir, file, exe, b, entry: keys().filter((k) => !before.has(k)).map((k) => join(at, k))[0] }
  }
  const saved = { cache: process.env.VOLT_RUSTC_CACHE, verify: process.env.VOLT_RUSTC_CACHE_VERIFY }
  const verify = (fraction: string) => (process.env.VOLT_RUSTC_CACHE_VERIFY = fraction)
  beforeAll(() => {
    process.env.VOLT_RUSTC_CACHE = "1" // CI runs the suite with the cache off; THIS test is of the cache
    verify("0")
  })
  afterAll(() => {
    for (const [k, v] of [["VOLT_RUSTC_CACHE", saved.cache], ["VOLT_RUSTC_CACHE_VERIFY", saved.verify]] as const)
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    rmSync(scratch, { recursive: true, force: true })
  })

  test("a miss compiles and stores; a hit in another directory reads exactly like a compile there", async () => {
    const first = await build("hello", program("hi"))
    expect([first.b.cached, first.b.exit]).toEqual([false, 0])
    expect(first.b.stderr).toContain("unused")
    const second = await build("hello", program("hi"))
    expect([second.b.cached, second.b.exit]).toEqual([true, 0])
    // the stored stderr was written in the FIRST directory; the hit names the second, in both spellings
    const swap = (t: string, from: string, to: string) =>
      t.split(JSON.stringify(from).slice(1, -1)).join(JSON.stringify(to).slice(1, -1)).split(from).join(to)
    expect(second.b.stderr).toBe(swap(first.b.stderr, first.dir, second.dir))
    expect(Bun.spawnSync([second.exe]).stdout.toString()).toBe("hi\n")
  })

  test("a refused build is cached as refused", async () => {
    const miss = await build("refused", "fn main() { let x: u8 = 1.5; }\n")
    const hit = await build("refused", "fn main() { let x: u8 = 1.5; }\n")
    expect([miss.b.cached, miss.b.exit, hit.b.cached, hit.b.exit]).toEqual([false, 1, true, 1])
    expect(hit.b.stderr).toBe(miss.b.stderr.split(miss.dir).join(hit.dir).split(JSON.stringify(miss.dir).slice(1, -1)).join(JSON.stringify(hit.dir).slice(1, -1)))
  })

  test("a verified hit that agrees hands back the real build", async () => {
    verify("1")
    try {
      const again = await build("hello", program("hi"))
      expect([again.b.cached, again.b.exit]).toEqual([false, 0])
      expect(Bun.spawnSync([again.exe]).stdout.toString()).toBe("hi\n")
      expect(readdirSync(again.dir).some((f) => f.includes(".cached"))).toBe(false)
    } finally {
      verify("0")
    }
  })

  test("a verified hit of a program that PANICS agrees — the panic's thread id is the run's, not the program's", async () => {
    // rustc ≥ 1.89 prints `thread 'main' (<os thread id>) panicked at …`: two runs of one executable differ there
    const panics = `fn main() {\n    panic!("guard");\n}\n`
    await build("panics", panics)
    verify("1")
    try {
      const again = await build("panics", panics)
      expect([again.b.cached, again.b.exit]).toEqual([false, 0])
    } finally {
      verify("0")
    }
  })

  test("a hit's executable IS the entry's file (a hard link, so the virus scanner's verdict holds) — and a verified hit compiling over that path leaves the entry intact", async () => {
    const first = await build("linked", program("linked"))
    const hit = await build("linked", program("linked"))
    expect(hit.b.cached).toBe(true)
    const stored = join(root, readdirSync(root).find((k) => existsSync(join(root, k, "entry.json")) && JSON.parse(readFileSync(join(root, k, "entry.json"), "utf8")).origin === first.dir)!, "out.bin")
    expect(statSync(hit.exe).nlink).toBeGreaterThanOrEqual(2)
    const before = readFileSync(stored)
    verify("1")
    try {
      const reproved = await build("linked", program("linked"))
      expect([reproved.b.cached, reproved.b.exit]).toEqual([false, 0])
    } finally {
      verify("0")
    }
    // the real compile wrote `exe`; had it written THROUGH the link, the stored executable would now be that build
    expect(readFileSync(stored).equals(before)).toBe(true)
    const after = await build("linked", program("linked"))
    expect(after.b.cached).toBe(true)
    expect(Bun.spawnSync([after.exe]).stdout.toString()).toBe("linked\n")
  })

  test("a STALE executable is caught by the run probe, fails loudly, and is evicted", async () => {
    const stale = (await build("stale", program("right"))).entry!
    const other = (await build("other", program("wrong"))).entry!
    // the entry for `stale` now holds `other`'s executable, with a matching hash — corruption no check but a re-proof finds
    writeFileSync(join(stale, "out.bin"), readFileSync(join(other, "out.bin")))
    const entry = JSON.parse(readFileSync(join(stale, "entry.json"), "utf8"))
    entry.exe = JSON.parse(readFileSync(join(other, "entry.json"), "utf8")).exe
    writeFileSync(join(stale, "entry.json"), JSON.stringify(entry))
    // unverified, the cache would hand it out — this is the hole sampled verification closes
    const trusted = await build("stale", program("right"))
    expect(trusted.b.cached).toBe(true)
    expect(Bun.spawnSync([trusted.exe]).stdout.toString()).toBe("wrong\n")
    verify("1")
    try {
      const error = await build("stale", program("right")).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(StaleCacheError)
      expect((error as Error).message).toMatch(/^rustc cache stale: stale, run \[\] differed/)
      expect(existsSync(stale)).toBe(false)
    } finally {
      verify("0")
    }
    const rebuilt = await build("stale", program("right"))
    expect(rebuilt.b.cached).toBe(false)
    expect(Bun.spawnSync([rebuilt.exe]).stdout.toString()).toBe("right\n")
  })

  test("STALE diagnostics are caught by the build comparison", async () => {
    const dir = (await build("lints", program("x"))).entry!
    const entry = JSON.parse(readFileSync(join(dir, "entry.json"), "utf8"))
    entry.stderr = entry.stderr.replace("unused", "unsed")
    writeFileSync(join(dir, "entry.json"), JSON.stringify(entry))
    verify("1")
    try {
      const error = await build("lints", program("x")).catch((e: unknown) => e)
      expect((error as Error).message).toMatch(/^rustc cache stale: lints, build stderr \(diagnostics\/lints\) differed/)
      expect(existsSync(dir)).toBe(false)
    } finally {
      verify("0")
    }
  })

  test("a corrupt or partial entry is a miss, not a wrong answer", async () => {
    const dir = (await build("corrupt", program("ok"))).entry!
    writeFileSync(join(dir, "out.bin"), "truncated")
    const again = await build("corrupt", program("ok"))
    expect([again.b.cached, again.b.exit]).toEqual([false, 0])
    expect(readFileSync(join(dir, "out.bin")).toString()).not.toBe("truncated") // evicted, then stored again
    expect(Bun.spawnSync([again.exe]).stdout.toString()).toBe("ok\n")
    // and an entry.json cut short
    writeFileSync(join(dir, "entry.json"), '{"format":2,"exit":0,"std')
    expect((await build("corrupt", program("ok"))).b.cached).toBe(false)
  })

  test("a cache that cannot be used is a real compile", async () => {
    const notADir = join(scratch, "not-a-dir")
    writeFileSync(notADir, "")
    const b = await build("io", program("io"), notADir)
    expect([b.b.cached, b.b.exit]).toEqual([false, 0])
    expect(Bun.spawnSync([b.exe]).stdout.toString()).toBe("io\n")
  })

  test("VOLT_RUSTC_CACHE=0 compiles every time", async () => {
    process.env.VOLT_RUSTC_CACHE = "0"
    try {
      expect((await build("hello", program("hi"))).b.cached).toBe(false)
    } finally {
      process.env.VOLT_RUSTC_CACHE = "1"
    }
  })
})
