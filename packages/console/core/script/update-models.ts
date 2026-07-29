#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import os from "os"
import { ZenData } from "../src/model"

const root = path.resolve(process.cwd(), "..", "..", "..")
// VOLT: authoring stage is `marce`, not opencode's `frank` (both are a developer's personal stage). See infra/README.md.
const models = await $`bun sst secret list --stage marce`.cwd(root).text()
const PARTS = 30

// read the line starting with "ZEN_MODELS"
const lines = models.split("\n")
const oldValues = Array.from({ length: PARTS }, (_, i) => {
  const value = lines
    .find((line) => line.startsWith(`ZEN_MODELS${i + 1}=`))
    ?.split("=")
    .slice(1)
    .join("=")
  if (!value) throw new Error(`ZEN_MODELS${i + 1} not found`)
  return value
})

// store the prettified json to a temp file
const filename = `models-${Date.now()}.json`
const tempFile = Bun.file(path.join(os.tmpdir(), filename))
await tempFile.write(JSON.stringify(JSON.parse(oldValues.join("")), null, 2))
console.log("tempFile", tempFile.name)

// open temp file in vim and read the file on close
// VOLT: VS Code instead of vim. `--wait` is load-bearing — without it `code` returns immediately and the
// script would read back the UNEDITED file. Set $EDITOR to override (e.g. `vim`, `nano`, `notepad`).
const [editor, ...editorArgs] = (process.env.EDITOR ?? "code --wait").split(" ")
await $`${editor} ${editorArgs} ${tempFile.name}`
const newValue = JSON.stringify(JSON.parse(await tempFile.text()))
ZenData.validate(JSON.parse(newValue))

// update the secret
const chunk = Math.ceil(newValue.length / PARTS)
const newValues = Array.from({ length: PARTS }, (_, i) =>
  newValue.slice(chunk * i, i === PARTS - 1 ? undefined : chunk * (i + 1)),
)

const envFile = Bun.file(path.join(os.tmpdir(), `models-${Date.now()}.env`))
await envFile.write(newValues.map((v, i) => `ZEN_MODELS${i + 1}="${v.replace(/"/g, '\\"')}"`).join("\n"))
await $`bun sst secret load ${envFile.name} --stage marce`.cwd(root) // VOLT: was `frank`
