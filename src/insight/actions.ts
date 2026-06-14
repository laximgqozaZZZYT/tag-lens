import { App, Notice } from "obsidian";

export async function applyGolderClassification(
	app: App,
	tag: string,
	golderType: string
): Promise<void> {
	const tagPage = app.metadataCache.getFirstLinkpathDest(tag, "");
	if (!tagPage) {
		new Notice(`Tag page for #${tag} does not exist yet.`);
		return;
	}
	const file = tagPage;
	await app.fileManager.processFrontMatter(file, (fm: unknown) => {
		if (typeof fm === "object" && fm !== null) {
			(fm as Record<string, unknown>).golder_type = golderType;
		}
	});
	new Notice(`Applied classification '${golderType}' to #${tag}`);
}

export async function convertToNestedTag(
	app: App,
	tag: string,
	parentPath: string
): Promise<void> {
	const files = app.vault.getMarkdownFiles();
	let updatedCount = 0;
	// Handle both #tag and tags in frontmatter. For body replacement, ensure word boundaries
	const searchRegex = new RegExp(`(^|\\s)#${tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(\\s|$)`, "gm");
	const replacement = `$1#${parentPath}/${tag}$2`;

	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		if (!cache) continue;
		
		const fmTags: unknown = cache.frontmatter?.tags;
		const hasTag = cache.tags?.some(t => t.tag === `#${tag}`) || 
					   (fmTags && (
						   (Array.isArray(fmTags) && fmTags.some(t => typeof t === "string" && t === tag)) ||
						   (typeof fmTags === "string" && fmTags === tag)
					   ));
		
		if (hasTag) {
			await app.vault.process(f, (content) => {
				return content.replace(searchRegex, replacement);
			});
			
			await app.fileManager.processFrontMatter(f, (fm: unknown) => {
				if (typeof fm === "object" && fm !== null) {
					const rfm = fm as Record<string, unknown>;
					if (rfm.tags) {
						if (Array.isArray(rfm.tags)) {
							rfm.tags = rfm.tags.map((t: unknown) => t === tag ? `${parentPath}/${tag}` : t);
						} else if (rfm.tags === tag) {
							rfm.tags = `${parentPath}/${tag}`;
						}
					}
				}
			});
			
			updatedCount++;
		}
	}
	new Notice(`Converted #${tag} to #${parentPath}/${tag} in ${updatedCount} files.`);
}
