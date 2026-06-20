// Bases logic UI rework: the selected-base list is driven by two pure helpers
// (add / remove). These guard add-dedup, append order, immutability, and remove.
import { ok } from "./assert";
import {
	addBaseFileToSelected,
	removeBaseFileFromSelected,
} from "../src/bases/selection";

// add — appends to an empty list.
{
	const out = addBaseFileToSelected([], "A.base");
	ok(out.length === 1 && out[0] === "A.base", "add to empty list appends the path");
}

// add — preserves existing order and appends new at the end.
{
	const out = addBaseFileToSelected(["A.base"], "B.base");
	ok(
		out.length === 2 && out[0] === "A.base" && out[1] === "B.base",
		"add appends new path at the end, keeping order",
	);
}

// add — dedups (already-selected path is a no-op for membership).
{
	const out = addBaseFileToSelected(["A.base", "B.base"], "A.base");
	ok(
		out.length === 2 && out.filter((p) => p === "A.base").length === 1,
		"add of an existing path does not duplicate it",
	);
}

// add — returns a NEW array (never mutates the input).
{
	const input = ["A.base"];
	const out = addBaseFileToSelected(input, "B.base");
	ok(out !== input && input.length === 1, "add returns a new array, input untouched");
}

// remove — drops the matching path, keeps the rest in order.
{
	const out = removeBaseFileFromSelected(["A.base", "B.base", "C.base"], "B.base");
	ok(
		out.length === 2 && out[0] === "A.base" && out[1] === "C.base",
		"remove drops only the matching path, order preserved",
	);
}

// remove — a missing path is a no-op (still a new array, same members).
{
	const input = ["A.base"];
	const out = removeBaseFileFromSelected(input, "Z.base");
	ok(
		out !== input && out.length === 1 && out[0] === "A.base",
		"remove of a missing path returns an equal new array",
	);
}
