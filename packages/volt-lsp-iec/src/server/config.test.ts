/**
 * The server's environment (`config.ts`): `NETWORK_TEXT_ENABLED` is `VOLT_GRAPHICAL=1`, read once. The suite runs with it
 * on (`bunfig.toml` preloads `test/network-text-on.ts`); "off" is proved in a child process started without it,
 * as an editor starts this server (`test/lsp/network-text-switch.test.ts`).
 */
import { expect, test } from "bun:test"
import { NETWORK_TEXT_ENABLED } from "./config.js"

test("the suite runs with the switch on", () => {
  expect(process.env.VOLT_GRAPHICAL).toBe("1")
  expect(NETWORK_TEXT_ENABLED).toBe(true)
})
