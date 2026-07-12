import { expect, test } from "bun:test";
import { Emitter } from "./emitter.js";

test("fires every listener; a disposed subscription stops receiving", () => {
	const e = new Emitter<number>();
	let a = 0;
	let b = 0;
	const subA = e.event((v) => (a += v));
	e.event((v) => (b += v));
	e.fire(2);
	expect([a, b]).toEqual([2, 2]);
	subA.dispose();
	e.fire(3);
	expect([a, b]).toEqual([2, 5]); // a unsubscribed, b still live
});

test("a void emitter fires with no argument", () => {
	const e = new Emitter();
	let n = 0;
	e.event(() => n++);
	e.fire();
	e.fire();
	expect(n).toBe(2);
});

test("dispose() drops all listeners", () => {
	const e = new Emitter();
	let n = 0;
	e.event(() => n++);
	e.dispose();
	e.fire();
	expect(n).toBe(0);
});
