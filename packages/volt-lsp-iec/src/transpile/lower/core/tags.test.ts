/**
 * The one tag encoding (task 1.7.19): 0 is none, the k-th recorded is k + 1, and back.
 */
import { expect, test } from "bun:test"
import { indexOfTag, NO_TAG, tagOfIndex } from "./tags.js"

test("0 names nothing; the k-th thing recorded is k + 1, and its tag names it again", () => {
  expect(NO_TAG).toBe(0)
  expect([0, 1, 41].map(tagOfIndex)).toEqual([1, 2, 42])
  for (const k of [0, 1, 41]) expect(indexOfTag(tagOfIndex(k))).toBe(k)
  expect(tagOfIndex(0)).not.toBe(NO_TAG)
})
