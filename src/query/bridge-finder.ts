import { jaccardWithShared } from "../util/jaccard";

export interface BridgeCandidate {
	a: string;
	b: string;
	jaccard: number;
	sharedTags: string[];
}

export function findBridges(
	nodes: { id: string; tags: string[] }[],
	linkedPairs: Set<string>,
	minJaccard: number,
	maxResults: number
): BridgeCandidate[] {
	// Reverse index: tag -> Set<nodeId>
	const tagToNodes = new Map<string, Set<string>>();
	
	for (const node of nodes) {
		for (const tag of node.tags) {
			let set = tagToNodes.get(tag);
			if (!set) {
				set = new Set();
				tagToNodes.set(tag, set);
			}
			set.add(node.id);
		}
	}

	// Exclude mega-tags that appear in more than 30% of all nodes.
	// Mega-tags cause a combinatorial explosion of pairs and are usually too broad
	// to indicate a meaningful missing connection.
	const totalNodes = nodes.length;
	const threshold = Math.max(10, totalNodes * 0.3);
	const validTags = new Set<string>();
	
	for (const [tag, set] of tagToNodes.entries()) {
		if (set.size <= threshold) {
			validTags.add(tag);
		}
	}

	const candidates: BridgeCandidate[] = [];
	const seenPairs = new Set<string>();
	
	// Fast tag lookup per node
	const nodeTagSets = new Map<string, Set<string>>();
	for (const node of nodes) {
		nodeTagSets.set(node.id, new Set(node.tags));
	}

	// Process nodes and find pairs sharing at least one valid tag
	for (let i = 0; i < nodes.length; i++) {
		const nodeA = nodes[i];
		const aTags = nodeA.tags.filter(t => validTags.has(t));
		
		if (aTags.length === 0) continue;
		
		const candidatesForA = new Set<string>();
		for (const tag of aTags) {
			const nodesWithTag = tagToNodes.get(tag);
			if (nodesWithTag) {
				for (const idB of nodesWithTag) {
					if (idB !== nodeA.id) {
						candidatesForA.add(idB);
					}
				}
			}
		}

		const setA = nodeTagSets.get(nodeA.id)!;
		
		for (const idB of candidatesForA) {
			// Normalize pair key (dictionary order)
			const pairKey = nodeA.id < idB ? `${nodeA.id}|${idB}` : `${idB}|${nodeA.id}`;
			
			// Skip if already processed or already linked
			if (seenPairs.has(pairKey) || linkedPairs.has(pairKey)) {
				continue;
			}
			seenPairs.add(pairKey);

			const setB = nodeTagSets.get(idB)!;

			// Empty union (both tag sets empty) → skip, as the old inline loop did.
			if (setA.size === 0 && setB.size === 0) continue;

			// Jaccard similarity + the concrete shared tags (in setA's order).
			const { jaccard, shared: sharedTags } = jaccardWithShared(setA, setB);

			if (jaccard >= minJaccard) {
				candidates.push({
					a: nodeA.id < idB ? nodeA.id : idB, // Ensure consistent order for output
					b: nodeA.id < idB ? idB : nodeA.id,
					jaccard,
					sharedTags
				});
			}
		}
	}

	// Sort descending by Jaccard score, then ascending by number of shared tags
	candidates.sort((x, y) => y.jaccard - x.jaccard || y.sharedTags.length - x.sharedTags.length);
	
	return candidates.slice(0, maxResults);
}
