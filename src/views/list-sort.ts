import type { ParsedItem } from "../parser";

export type SortColumn = "id" | "title" | "status" | "horizon" | "milestone" | "scope";
export type SortDirection = "asc" | "desc";

export interface SortState {
	column: SortColumn;
	direction: SortDirection;
}

export interface SortVocabulary {
	status: string[];
	horizon: string[];
}

// Missing values always sort to the end (direction-independent); the rest of
// the result inverts on `desc`.
export function compareItems(
	a: ParsedItem,
	b: ParsedItem,
	sort: SortState,
	vocab: SortVocabulary,
): number {
	const valA = pluck(a, sort.column);
	const valB = pluck(b, sort.column);

	if (valA === undefined && valB === undefined) return 0;
	if (valA === undefined) return 1;
	if (valB === undefined) return -1;

	const result = compareValues(valA, valB, sort.column, vocab);
	return sort.direction === "desc" ? -result : result;
}

function pluck(item: ParsedItem, column: SortColumn): string | undefined {
	switch (column) {
		case "id":
			return item.id;
		case "title":
			return item.title;
		case "status":
			return item.enums.status;
		case "horizon":
			return item.enums.horizon;
		case "milestone":
			return item.enums.milestone;
		case "scope":
			return item.raw["scope"];
	}
}

function compareValues(
	a: string,
	b: string,
	column: SortColumn,
	vocab: SortVocabulary,
): number {
	switch (column) {
		case "id":
		case "milestone":
			return naturalCompare(a, b);
		case "title":
		case "scope":
			return localeCompare(a, b);
		case "status":
			return vocabCompare(a, b, vocab.status);
		case "horizon":
			return vocabCompare(a, b, vocab.horizon);
	}
}

function localeCompare(a: string, b: string): number {
	return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

// Splits "PREFIX-DIGITS" so BL-2 sorts before BL-10. Falls back to locale
// compare when either string doesn't match the pattern.
function naturalCompare(a: string, b: string): number {
	const ma = a.match(/^([A-Za-z]+)-?(\d+)/);
	const mb = b.match(/^([A-Za-z]+)-?(\d+)/);
	if (ma && mb) {
		const px = ma[1]!.localeCompare(mb[1]!);
		if (px !== 0) return px;
		return Number(ma[2]) - Number(mb[2]);
	}
	return localeCompare(a, b);
}

// In-vocab values come first in configured order; out-of-vocab values come
// after, in locale order. On `desc` the caller inverts the whole result.
function vocabCompare(a: string, b: string, vocab: string[]): number {
	const ai = vocab.indexOf(a);
	const bi = vocab.indexOf(b);
	if (ai !== -1 && bi !== -1) return ai - bi;
	if (ai !== -1) return -1;
	if (bi !== -1) return 1;
	return localeCompare(a, b);
}

// Distinct, non-empty values for a filter menu, ordered the same way the
// column sorts: status/horizon in configured-vocabulary order (unknown values
// after, alphabetically), ids/milestones naturally (MS-2 before MS-10).
export function sortedOptions(
	values: Array<string | undefined>,
	column: SortColumn,
	vocab: SortVocabulary,
): string[] {
	const set = new Set<string>();
	for (const v of values) {
		if (typeof v === "string" && v.length > 0) set.add(v);
	}
	return Array.from(set).sort((a, b) => compareValues(a, b, column, vocab));
}
