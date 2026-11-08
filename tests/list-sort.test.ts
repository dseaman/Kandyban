import { describe, it, expect } from "vitest";
import {
	compareItems,
	sortedOptions,
	type SortState,
	type SortVocabulary,
} from "../src/views/list-sort";
import type { ParsedItem } from "../src/parser";

const vocab: SortVocabulary = {
	status: ["open", "in-progress", "done"],
	horizon: ["now", "next", "later"],
};

function item(overrides: {
	id: string;
	title?: string;
	status?: string;
	horizon?: string;
	milestone?: string;
	scope?: string;
}): ParsedItem {
	return {
		id: overrides.id,
		kind: overrides.id.startsWith("MS-") ? "milestone" : "backlog",
		title: overrides.title ?? overrides.id,
		raw: overrides.scope !== undefined ? { scope: overrides.scope } : {},
		enums: {
			status: overrides.status,
			horizon: overrides.horizon,
			milestone: overrides.milestone,
			dependsOn: [],
		},
	};
}

function sortedIds(items: ParsedItem[], sort: SortState): string[] {
	return [...items]
		.sort((a, b) => compareItems(a, b, sort, vocab))
		.map((x) => x.id);
}

describe("compareItems — id column", () => {
	it("orders BL-2 before BL-10 (natural sort)", () => {
		const items = [item({ id: "BL-10" }), item({ id: "BL-2" }), item({ id: "BL-100" })];
		expect(sortedIds(items, { column: "id", direction: "asc" })).toEqual([
			"BL-2",
			"BL-10",
			"BL-100",
		]);
	});

	it("orders BL prefix before MS prefix", () => {
		const items = [item({ id: "MS-1" }), item({ id: "BL-99" })];
		expect(sortedIds(items, { column: "id", direction: "asc" })).toEqual([
			"BL-99",
			"MS-1",
		]);
	});

	it("reverses for desc direction", () => {
		const items = [item({ id: "BL-1" }), item({ id: "BL-2" })];
		expect(sortedIds(items, { column: "id", direction: "desc" })).toEqual([
			"BL-2",
			"BL-1",
		]);
	});
});

describe("compareItems — title column", () => {
	it("is case-insensitive and numeric-aware", () => {
		const items = [
			item({ id: "A", title: "Step 10" }),
			item({ id: "B", title: "step 2" }),
			item({ id: "C", title: "Alpha" }),
		];
		expect(sortedIds(items, { column: "title", direction: "asc" })).toEqual([
			"C",
			"B",
			"A",
		]);
	});
});

describe("compareItems — status column", () => {
	it("sorts by vocabulary order, not alphabetical", () => {
		const items = [
			item({ id: "A", status: "done" }),
			item({ id: "B", status: "open" }),
			item({ id: "C", status: "in-progress" }),
		];
		expect(sortedIds(items, { column: "status", direction: "asc" })).toEqual([
			"B",
			"C",
			"A",
		]);
	});

	it("places out-of-vocab values after in-vocab, alphabetically", () => {
		const items = [
			item({ id: "A", status: "zeta" }),
			item({ id: "B", status: "done" }),
			item({ id: "C", status: "alpha" }),
			item({ id: "D", status: "open" }),
		];
		expect(sortedIds(items, { column: "status", direction: "asc" })).toEqual([
			"D",
			"B",
			"C",
			"A",
		]);
	});

	it("places undefined status at the end regardless of direction", () => {
		const items = [
			item({ id: "A" }),
			item({ id: "B", status: "open" }),
			item({ id: "C", status: "done" }),
		];
		expect(sortedIds(items, { column: "status", direction: "asc" })).toEqual([
			"B",
			"C",
			"A",
		]);
		expect(sortedIds(items, { column: "status", direction: "desc" })).toEqual([
			"C",
			"B",
			"A",
		]);
	});
});

describe("compareItems — horizon column", () => {
	it("sorts by horizon vocabulary order", () => {
		const items = [
			item({ id: "A", horizon: "later" }),
			item({ id: "B", horizon: "now" }),
			item({ id: "C", horizon: "next" }),
		];
		expect(sortedIds(items, { column: "horizon", direction: "asc" })).toEqual([
			"B",
			"C",
			"A",
		]);
	});
});

describe("compareItems — milestone column", () => {
	it("natural-sorts milestone ids and puts undefined last", () => {
		const items = [
			item({ id: "A", milestone: "MS-10" }),
			item({ id: "B" }),
			item({ id: "C", milestone: "MS-2" }),
		];
		expect(sortedIds(items, { column: "milestone", direction: "asc" })).toEqual([
			"C",
			"A",
			"B",
		]);
		expect(sortedIds(items, { column: "milestone", direction: "desc" })).toEqual([
			"A",
			"C",
			"B",
		]);
	});
});

describe("compareItems — scope column", () => {
	it("string-compares scope and puts undefined last", () => {
		const items = [
			item({ id: "A", scope: "frontend" }),
			item({ id: "B" }),
			item({ id: "C", scope: "backend" }),
		];
		expect(sortedIds(items, { column: "scope", direction: "asc" })).toEqual([
			"C",
			"A",
			"B",
		]);
	});
});

describe("sortedOptions", () => {
	it("orders horizons by the configured vocabulary, unknowns after", () => {
		expect(
			sortedOptions(["later", "now", "zebra", undefined, "next", "now", "", "alpha"], "horizon", vocab),
		).toEqual(["now", "next", "later", "alpha", "zebra"]);
	});

	it("orders statuses by the configured vocabulary", () => {
		expect(sortedOptions(["done", "open", "in-progress"], "status", vocab)).toEqual([
			"open",
			"in-progress",
			"done",
		]);
	});

	it("orders milestones naturally", () => {
		expect(sortedOptions(["MS-10", "MS-2", "MS-1"], "milestone", vocab)).toEqual([
			"MS-1",
			"MS-2",
			"MS-10",
		]);
	});
});
