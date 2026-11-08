import { expect, test } from "bun:test"
import { projectUtf8EncodingFrom } from "./project-settings.js"

// the Compile option "UTF-8 Encoding for STRING": CODESYS's descriptor writes it on or off; nothing stated is no setting
test("the project's \"UTF-8 encoding\" row is read, on or off; no row states nothing; any other value is refused", () => {
  expect(projectUtf8EncodingFrom("Unicode identifiers:   off\nUTF-8 encoding:        off")).toBe(false)
  expect(projectUtf8EncodingFrom("UTF-8 encoding:        on\r\n")).toBe(true)
  expect(projectUtf8EncodingFrom("Replace constants:     off")).toBeUndefined()
  expect(() => projectUtf8EncodingFrom("UTF-8 encoding:        yes")).toThrow("neither 'on' nor 'off'")
})
