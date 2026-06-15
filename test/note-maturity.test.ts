import { ok } from "./assert";
import { suggestMaturity, effectiveMaturity } from "../src/query/tag-classification";

// note maturity - heuristics
// A fleeting note
	ok(
		suggestMaturity({ wordCount: 40, linkCount: 1, backlinkCount: 0, ageDays: 1, hasSourceTag: false }) === "fleeting",
		"Small note with few links is fleeting"
	);

	// A permanent note
	ok(
		suggestMaturity({ wordCount: 100, linkCount: 2, backlinkCount: 2, ageDays: 5, hasSourceTag: false }) === "permanent",
		"Substantial note with >= 3 connections is permanent"
	);

	ok(
		suggestMaturity({ wordCount: 200, linkCount: 3, backlinkCount: 0, ageDays: 5, hasSourceTag: false }) === "permanent",
		"Substantial note with 3 links and 0 backlinks is permanent"
	);

	// A literature note
	ok(
		suggestMaturity({ wordCount: 300, linkCount: 1, backlinkCount: 1, ageDays: 10, hasSourceTag: true }) === "literature",
		"Note with source tag is literature, even if wordCount is high"
	);

	// Fallback/boundary cases
	ok(
		suggestMaturity({ wordCount: 49, linkCount: 5, backlinkCount: 5, ageDays: 10, hasSourceTag: false }) === "fleeting",
		"High connection but word count < 50 is fleeting"
);

// note maturity - effective classification
ok(effectiveMaturity("permanent", "fleeting") === "permanent", "Valid frontmatter wins");
ok(effectiveMaturity("literature", "permanent") === "literature", "Valid frontmatter wins");
ok(effectiveMaturity("unknown_value", "fleeting") === "fleeting", "Invalid frontmatter falls back to suggestion");
ok(effectiveMaturity(undefined, "literature") === "literature", "Undefined frontmatter falls back to suggestion");
