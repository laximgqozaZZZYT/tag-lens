import type { EncodingBinding } from "./types";

/**
 * Whether the card fill is free to show a note's per-tag stripe colours.
 *
 * A multi-tag note is striped with its tag hues only when the colour channel
 * does NOT encode some other attribute: an enabled `color` binding to any field
 * other than `tag` claims the fill (striping it too would make the legend lie),
 * so the stripe stands down. No colour binding — or a `color`→`tag` binding —
 * leaves the fill tag-based, the natural striped case. A disabled colour
 * binding does not claim the fill (it is inert), so it stays tag-based.
 */
export function colorIsTagBased(bindings: readonly EncodingBinding[]): boolean {
	const colorBinding = bindings.find((b) => b.enabled && b.channelId === "color");
	return !colorBinding || colorBinding.fieldId === "tag";
}
