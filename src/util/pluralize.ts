// English count-noun label: `"1 node"` / `"3 nodes"`. The trailing-`s` plural
// idiom (`${n} word${n === 1 ? "" : "s"}`) was repeated across the Data ▸ JSON
// tab labels (view.ts) and the mode-legend suffix (mode-legend-input.ts); this
// is the single pure source for it. Only the regular-`s` plural is handled —
// every current call site is a regular noun ("node", "preset", "bundled preset").
export function pluralize(count: number, singular: string): string {
	return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
