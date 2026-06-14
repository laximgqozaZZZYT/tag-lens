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
	await app.fileManager.processFrontMatter(file, (fm: any) => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		fm.golder_type = golderType;
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
	// eslint-disable-next-line no-useless-escape
	const searchRegex = new RegExp(`(^|\\s)#${tag.replace(/[-\\/\\^$*+?.()|[\]{}]/g, '\\$&')}(\\s|$)`, "gm");
	const replacement = `$1#${parentPath}/${tag}$2`;

	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		if (!cache) continue;
		
		const hasTag = cache.tags?.some(t => t.tag === `#${tag}`) || 
					   ((cache.frontmatter?.tags) && (
						   (Array.isArray(cache.frontmatter.tags) && cache.frontmatter.tags.includes(tag)) ||
						   cache.frontmatter.tags === tag
					   ));
		
		if (hasTag) {
			await app.vault.process(f, (content) => {
				return content.replace(searchRegex, replacement);
			});
			
			await app.fileManager.processFrontMatter(f, (fm: any) => {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				if (fm.tags) {
					// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
					if (Array.isArray(fm.tags)) {
						// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
						fm.tags = fm.tags.map((t: string) => t === tag ? `${parentPath}/${tag}` : t);
					// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
					} else if (fm.tags === tag) {
						// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
						fm.tags = `${parentPath}/${tag}`;
					}
				}
			});
			
			updatedCount++;
		}
	}
	new Notice(`Converted #${tag} to #${parentPath}/${tag} in ${updatedCount} files.`);
}
