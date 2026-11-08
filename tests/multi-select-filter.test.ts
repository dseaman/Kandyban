import { describe, it, expect } from "vitest";
import { filterButtonLabel, toggled } from "../src/views/multi-select-filter";

const options = ["open", "in-progress", "done"];

describe("toggled", () => {
	it("unchecking one value from 'all' selects everything else", () => {
		expect(toggled(null, options, "done")).toEqual(new Set(["open", "in-progress"]));
	});

	it("re-checking the last missing value collapses back to 'all'", () => {
		expect(toggled(new Set(["open", "in-progress"]), options, "done")).toBeNull();
	});

	it("toggles a value off and on without mutating the input", () => {
		const current = new Set(["open", "done"]);
		expect(toggled(current, options, "done")).toEqual(new Set(["open"]));
		expect(toggled(current, options, "in-progress")).toBeNull();
		expect(current).toEqual(new Set(["open", "done"]));
	});

	it("works with the board's empty-string 'no status' value", () => {
		expect(toggled(null, ["open", ""], "")).toEqual(new Set(["open"]));
	});
});

describe("filterButtonLabel", () => {
	it("describes all / none / partial selections", () => {
		expect(filterButtonLabel("status", options, null)).toBe("status: all (3)");
		expect(filterButtonLabel("status", options, new Set())).toBe("status: none");
		expect(filterButtonLabel("status", options, new Set(["open"]))).toBe("status: 1 of 3");
		expect(filterButtonLabel("status", [], null)).toBe("status: —");
	});
});
