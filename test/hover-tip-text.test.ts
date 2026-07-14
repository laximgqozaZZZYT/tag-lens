// Pure hover-tooltip text builders extracted from view.ts's showHover.
import { ok } from "./assert";
import {
	heatmapCellTipText,
	ghostEdgeTipText,
	clusterTipText,
	aggregationGroupTipText,
} from "../src/interaction/hover-tip-text";

// Heatmap diagonal → the tag's own size.
{
	const t = heatmapCellTipText({ label: "book", size: 12 }, { label: "book", size: 12 }, 12, true);
	ok(t.title === "book", "diagonal title is the tag label");
	ok(t.sub === "12 notes", "diagonal sub is the tag size");
}

// Heatmap off-diagonal → intersection count + Jaccard(|A|,|B|,∩).
{
	// |A|=10, |B|=6, ∩=4 → union = 10+6-4 = 12 → 4/12 = 0.33
	const t = heatmapCellTipText({ label: "a", size: 10 }, { label: "b", size: 6 }, 4, false);
	ok(t.title === "a * b", "off-diagonal title joins both labels");
	ok(t.sub === "4 notes (Jaccard 0.33)", "off-diagonal sub has count + Jaccard");
}

// Ghost edge → up to 3 shared tags, no overflow marker at exactly 3.
{
	const t = ghostEdgeTipText({ sharedTags: ["x", "y", "z"], jaccard: 0.5 });
	ok(t.title === "Suggested link", "ghost title is static");
	ok(t.sub === "shared tags: #x #y #z (Jaccard 0.50)", "three tags, no overflow");
}

// Ghost edge → overflow marker for the 4th+ tag.
{
	const t = ghostEdgeTipText({ sharedTags: ["x", "y", "z", "w", "v"], jaccard: 0.125 });
	ok(t.sub === "shared tags: #x #y #z (+2) (Jaccard 0.13)", "overflow shows (+N), Jaccard rounds");
}

// Cluster → label + member count.
{
	const t = clusterTipText("Novels", 7);
	ok(t.title === "Novels" && t.sub === "7 items", "cluster label + item count");
}

// Aggregation group → tail of prefix:value key + note count.
{
	const t = aggregationGroupTipText("folder:Inbox", 3);
	ok(t.title === "Inbox" && t.sub === "3 notes", "group tail label + note count");
}
