import { App } from "obsidian";
import { effectiveClassification } from "../query/tag-classification";

export interface GlobalStats {
	totalNotes: number;
	totalFolders: number;
	totalLinks: number;
	distinctTags: number;
}

export interface TriggeredAlert {
	id: string;
	label: string;
	severity: "CRITICAL" | "WARNING" | "INFO";
	summary: string;
	detail: string;
	advice: string;
	offenders?: string[];
	offender?: string; // used by some alerts
}

export interface ComputedCognitiveLoad {
	score: number;
	globalStats: GlobalStats;
	triggered: TriggeredAlert[];
}

export function computeCognitiveLoad(app: App, k: number): ComputedCognitiveLoad {
	const files = app.vault.getMarkdownFiles();
	const totalNotes = files.length;
	// Folders that directly contain ≥1 markdown file → file count per folder.
	const folderCounts = new Map<string, number>();
	for (const f of files) {
		const dir = f.parent ? f.parent.path : "/";
		folderCounts.set(dir, (folderCounts.get(dir) ?? 0) + 1);
	}
	const totalFolders = Math.max(1, folderCounts.size);
	// Links: resolvedLinks = { src: { tgt: count } }. Total + per-note in/out.
	const resolved = app.metadataCache.resolvedLinks;
	let totalLinks = 0;
	const outCount = new Map<string, number>();
	const inCount = new Map<string, number>();
	for (const src of Object.keys(resolved)) {
		const targets = resolved[src];
		let o = 0;
		for (const tgt of Object.keys(targets)) {
			const c = targets[tgt];
			totalLinks += c;
			o += c;
			inCount.set(tgt, (inCount.get(tgt) ?? 0) + c);
		}
		outCount.set(src, o);
	}
	// Tags per note + per-tag note counts + distinct tags.
	const stripHash = (t: string): string => (t.startsWith("#") ? t.slice(1) : t);
	const tagNoteCount = new Map<string, number>();
	const noteTagCount = new Map<string, number>();
	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		const tags = new Set<string>();
		if (cache?.tags) for (const t of cache.tags) tags.add(stripHash(t.tag));
		const fmTags = (cache?.frontmatter as Record<string, unknown> | undefined)?.tags;
		if (Array.isArray(fmTags)) {
			for (const t of fmTags) {
				const tr = stripHash(String(t)).trim();
				if (tr) tags.add(tr);
			}
		} else if (typeof fmTags === "string") {
			for (const t of fmTags.split(",")) {
				const tr = stripHash(t).trim();
				if (tr) tags.add(tr);
			}
		}
		noteTagCount.set(f.path, tags.size);
		for (const t of tags) tagNoteCount.set(t, (tagNoteCount.get(t) ?? 0) + 1);
	}
	console.log("[E2E DEBUG] tagNoteCount timeline =", tagNoteCount.get("timeline"), "beat =", tagNoteCount.get("beat"));
	const distinctTags = Math.max(1, tagNoteCount.size);

	const triggered: TriggeredAlert[] = [];
	if (totalNotes === 0) return { score: 0, globalStats: { totalNotes, totalFolders, totalLinks, distinctTags }, triggered };
	const linkDensity = totalLinks / totalNotes;
	const basename = (p: string): string => { const s = p.split("/").pop() ?? p; return s.endsWith(".md") ? s.slice(0, -3) : s; };
	const topN = <T>(arr: T[], score: (x: T) => number, label: (x: T) => string): string[] => {
		return [...arr].sort((a, b) => score(b) - score(a)).map(label);
	};

	// [Architectural Imbalance] folder files > (notes/folders)*K
	{
		const thr = (totalNotes / totalFolders) * k;
		const hits = [...folderCounts.entries()].filter(([, c]) => c > thr);
		if (hits.length > 0) triggered.push({
			id: "architecturalImbalance", label: "Architectural Imbalance", severity: "CRITICAL",
			summary: "Overcrowded folder",
			detail: "This folder holds a disproportionate number of files compared to the vault average.",
			advice: "Refactor by creating logical sub-folders.",
			offenders: topN(hits, ([, c]) => c, ([p, c]) => `${p === "/" ? "(root)" : p} (${c} files)`),
		});
	}

	// [High Degree Node] link/backlink > max(50, linkDensity * 5 * K)
	{
		const thr = Math.max(50, linkDensity * 5 * k);
		const hits = files
			.map((f) => ({ f, lc: (outCount.get(f.path) ?? 0) + (inCount.get(f.path) ?? 0) }))
			.filter((x) => x.lc > thr);
		if (hits.length > 0) triggered.push({
			id: "highDegreeNode", label: "High Degree Node", severity: "CRITICAL",
			summary: "Excessive links",
			detail: "The degree (total links and backlinks) of this note vastly exceeds the vault average, indicating it is a massive hub.",
			advice: "Isolate this hub note or visualize it using a subset graph.",
			offenders: topN(hits, (x) => x.lc, (x) => `${basename(x.f.path)} (${x.lc} links)`),
		});
	}
	// [Monolith Note] size > 15*K AND link/backlink < (links/notes)/K
	{
		const hits = files
			.map((f) => ({ f, kb: f.stat.size / 1024, lc: (outCount.get(f.path) ?? 0) + (inCount.get(f.path) ?? 0) }))
			.filter((x) => x.kb > 15 * k && x.lc < linkDensity / k);
		if (hits.length > 0) triggered.push({
			id: "monolithNote", label: "Monolith Note", severity: "WARNING",
			summary: "Monolithic note",
			detail: "This note is very large but has very few links, making it hard to navigate.",
			advice: "Break it down into smaller, interlinked atomic notes.",
			offenders: topN(hits, (x) => x.kb, (x) => `${basename(x.f.path)} (${Math.round(x.kb)} KB)`),
		});
	}
	// [Tag Soup] note tags > 5*K
	{
		const thr = 5 * k;
		const hits = [...noteTagCount.entries()].filter(([, c]) => c > thr);
		if (hits.length > 0) triggered.push({
			id: "tagSoup", label: "Tag Soup", severity: "WARNING",
			summary: "Too many tags",
			detail: "This note has an excessive number of tags, diluting its categorical meaning.",
			advice: "Consolidate tags or use links instead of tags for relations.",
			offenders: topN(hits, ([, c]) => c, ([p, c]) => `${basename(p)} (${c} tags)`),
		});
	}

	// [Orphan Notes] notes with 0 tags AND 0 links
	{
		const orphans = files.filter(f => {
			const tags = noteTagCount.get(f.path) ?? 0;
			const links = (outCount.get(f.path) ?? 0) + (inCount.get(f.path) ?? 0);
			return tags === 0 && links === 0;
		});
		if (orphans.length > 0) triggered.push({
			id: "orphanNotes", label: "Orphan Notes", severity: "INFO",
			summary: `${orphans.length} note${orphans.length > 1 ? "s have" : " has"} no tags and no links`,
			detail: "These notes are completely disconnected — they have neither tags nor links/backlinks, making them invisible to any tag-based or graph-based navigation.",
			advice: "Add tags or links to integrate them into your knowledge graph, or delete them if they are no longer needed.",
			offenders: topN(orphans, (f) => f.stat.size, (f) => basename(f.path)),
		});
	}

	// [Redundant Tag Pair] Jaccard >= 0.9 between two tags' member sets
	{
		const tagMembers = new Map<string, Set<string>>();
		for (const f of files) {
			const cache = app.metadataCache.getFileCache(f);
			const tags = new Set<string>();
			if (cache?.tags) for (const t of cache.tags) tags.add(stripHash(t.tag));
			const fmTags = (cache?.frontmatter as Record<string, unknown> | undefined)?.tags;
			if (Array.isArray(fmTags)) for (const t of fmTags) tags.add(stripHash(String(t)));
			else if (typeof fmTags === "string") tags.add(stripHash(fmTags));
			for (const t of tags) {
				let s = tagMembers.get(t);
				if (!s) { s = new Set(); tagMembers.set(t, s); }
				s.add(f.path);
			}
		}
		const redundant = findRedundantTagPairs(tagMembers, 0.9, 10);
		if (redundant.length > 0) triggered.push({
			id: "redundantTagPair", label: "Redundant Tag Pair", severity: "INFO",
			summary: `${redundant.length} tag pair${redundant.length > 1 ? "s" : ""} with near-identical membership`,
			detail: "These tag pairs have a Jaccard similarity ≥ 0.9, meaning they are applied to almost exactly the same notes. They may be candidates for merging or aliasing.",
			advice: "Consider merging one tag into the other, or converting one into a nested sub-tag of the other.",
			offenders: redundant.map(r => `#${r.a} ↔ #${r.b} (Jaccard ${(r.jaccard * 100).toFixed(0)}%)`),
		});
	}

	// [Over-broad Tag] tag covers > 40% of all notes
	{
		const threshold = 0.4;
		const overbroad = findOverbroadTags(tagNoteCount, totalNotes, threshold);
		if (overbroad.length > 0) triggered.push({
			id: "overbroadTag", label: "Over-broad Tag", severity: "INFO",
			summary: `${overbroad.length} tag${overbroad.length > 1 ? "s cover" : " covers"} over 40% of all notes`,
			detail: "A tag that is applied to a very large proportion of the vault provides little discriminative value for navigation or filtering.",
			advice: "Consider splitting into more specific sub-tags, or removing the tag if it adds no value.",
			offenders: overbroad.map(o => `#${o.tag} (${o.count} notes, ${(o.ratio * 100).toFixed(0)}%)`),
		});
	}

	return { score: Math.min(100, triggered.length * 20), globalStats: { totalNotes, totalFolders, totalLinks, distinctTags }, triggered };
}

// ── Pure detection helpers (exported for unit testing) ───────────────────────

export interface RedundantPair {
	a: string;
	b: string;
	jaccard: number;
}

/** Find tag pairs whose member sets have Jaccard similarity ≥ minJaccard. */
export function findRedundantTagPairs(
	tagMembers: Map<string, Set<string>>,
	minJaccard: number,
	maxResults: number
): RedundantPair[] {
	const tags = Array.from(tagMembers.entries());
	const results: RedundantPair[] = [];
	for (let i = 0; i < tags.length; i++) {
		const [aKey, aSet] = tags[i];
		if (aSet.size < 2) continue; // singletons can't be meaningfully redundant
		for (let j = i + 1; j < tags.length; j++) {
			const [bKey, bSet] = tags[j];
			if (bSet.size < 2) continue;
			let inter = 0;
			for (const id of aSet) { if (bSet.has(id)) inter++; }
			const union = aSet.size + bSet.size - inter;
			if (union === 0) continue;
			const jaccard = inter / union;
			if (jaccard >= minJaccard) {
				results.push({ a: aKey, b: bKey, jaccard });
			}
		}
	}
	results.sort((a, b) => b.jaccard - a.jaccard);
	return results.slice(0, maxResults);
}

export interface OverbroadTag {
	tag: string;
	count: number;
	ratio: number;
}

/** Find tags that cover more than `threshold` fraction of all notes. */
export function findOverbroadTags(
	tagNoteCount: Map<string, number>,
	totalNotes: number,
	threshold: number
): OverbroadTag[] {
	if (totalNotes === 0) return [];
	const results: OverbroadTag[] = [];
	for (const [tag, count] of tagNoteCount) {
		const ratio = count / totalNotes;
		if (ratio > threshold) {
			results.push({ tag, count, ratio });
		}
	}
	results.sort((a, b) => b.ratio - a.ratio);
	return results;
}

export interface TagSuggestion {
	tag: string;
	count: number;
	ratio: number;
	golderType: string;
	coOccurrence: Map<string, number>;
}

export function computeTagSuggestions(app: App): TagSuggestion[] {
	const files = app.vault.getMarkdownFiles();
	const totalNotes = Math.max(1, files.length);

	interface TagStat {
		tag: string;
		count: number;
		coOccurrence: Map<string, number>;
	}

	const stats = new Map<string, TagStat>();
	const stripHash = (t: string): string => (t.startsWith("#") ? t.slice(1) : t);

	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		const tags = new Set<string>();
		if (cache?.tags) for (const t of cache.tags) tags.add(stripHash(t.tag));
		const fmTags = (cache?.frontmatter as Record<string, unknown> | undefined)?.tags;
		if (Array.isArray(fmTags)) {
			for (const t of fmTags) if (t) tags.add(stripHash(String(t)));
		} else if (typeof fmTags === "string") {
			if (fmTags) {
				fmTags.split(",").forEach(t => {
					const trimmed = t.trim();
					if (trimmed) tags.add(stripHash(trimmed));
				});
			}
		}

		const tagArray = Array.from(tags);
		for (const t of tagArray) {
			let stat = stats.get(t);
			if (!stat) {
				stat = { tag: t, count: 0, coOccurrence: new Map() };
				stats.set(t, stat);
			}
			stat.count++;
			for (const co of tagArray) {
				if (co !== t) {
					stat.coOccurrence.set(co, (stat.coOccurrence.get(co) ?? 0) + 1);
				}
			}
		}
	}

	// Calculate percentiles across all tags
	const allCounts = Array.from(stats.values()).map(s => s.count).sort((a, b) => a - b);
	const totalTagsCount = allCounts.length;
	const medianCount = totalTagsCount > 0 ? allCounts[Math.floor(totalTagsCount * 0.5)] : 0;
	const p90Count = totalTagsCount > 0 ? allCounts[Math.floor(totalTagsCount * 0.9)] : 0;
	const p25Count = totalTagsCount > 0 ? allCounts[Math.floor(totalTagsCount * 0.25)] : 0;

	const getGolderSuggestion = (stat: TagStat): string => {
		// 1. Task Organization (Top 10% frequency, at least 5 notes)
		if (stat.count >= p90Count && stat.count >= 5) return "task_org";
		
		// 6. Who owns it (Vendors, must be below median frequency)
		const vendorPattern = /(^|\/)(amazon|aws|google|microsoft|apple|meta|github|vercel|linux|ubuntu|debian|ansible|terraform)$/i;
		if (stat.count <= medianCount && vendorPattern.test(stat.tag)) return "who_owns_it";
		
		// 2. Refining Categories (Explicit hierarchy)
		if (stat.tag.includes('/')) return "refined_category";
		
		// Prevent extreme low frequency tags from being automatically classified as refined categories.
		// Also ensure the co-occurring tag is more frequent (acts as a parent topic).
		if (stat.count >= 3) {
			for (const [coTag, coCount] of stat.coOccurrence) {
				const parentStat = stats.get(coTag);
				if (parentStat && parentStat.count > stat.count && (coCount / stat.count) >= 0.9) {
					return "refined_category";
				}
			}
		}
		
		// 3. Qualities vs 4. What it is
		// Medium to high frequency (between 25th and 90th percentile)
		if (stat.count > p25Count && stat.count < p90Count) {
			// Use entropy (diversity of co-occurrence) instead of absolute size
			const entropy = stat.coOccurrence.size / stat.count;
			return entropy >= 0.5 ? "qualities" : "what_it_is";
		}
		
		// 5. What it contains (Bottom 25% frequency)
		if (stat.count <= p25Count && stat.count >= 2) return "what_it_contains";
		
		return "self_ref";
	};

	const results = [];
	for (const stat of stats.values()) {
		// A user's applied classification (tag-page frontmatter `golder_type`,
		// written by applyGolderClassification) is the source of truth for the
		// dropdown's initial value; the heuristic only fills in when nothing
		// has been applied yet. Read the SAME file the writer targets so the
		// applied choice round-trips instead of reverting to the suggestion.
		const tagPage = app.metadataCache.getFirstLinkpathDest(stat.tag, "");
		const persisted = tagPage
			? (app.metadataCache.getFileCache(tagPage)?.frontmatter as Record<string, unknown> | undefined)?.golder_type
			: undefined;
		results.push({
			tag: stat.tag,
			count: stat.count,
			ratio: stat.count / totalNotes,
			golderType: effectiveClassification(persisted, getGolderSuggestion(stat)),
			coOccurrence: stat.coOccurrence
		});
	}

	return results.sort((a, b) => b.count - a.count);
}
