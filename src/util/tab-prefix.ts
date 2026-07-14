// Euler / bubblesets modes duplicate a note per hosted tag by creating copies
// with id `${tag}\t${originalPath}`. All other modes use the plain file path
// with no tab. Stripping the prefix lets the folder tree, the leaf display
// label, the search deduplicator, and per-mode paint hidden-set lookups work on
// the real file path. Lives under the neutral `util/` so both `interaction/` and
// `draw/` can share it without a cross-layer import.
export function stripTabPrefix(id: string): string {
	const tab = id.indexOf("\t");
	return tab >= 0 ? id.slice(tab + 1) : id;
}
