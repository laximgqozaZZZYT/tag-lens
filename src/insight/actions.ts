import { type App, Notice } from "obsidian";
import { isValidTagName } from "./tag-path";

export async function applyGolderClassification(
	app: App,
	tag: string,
	golderType: string
): Promise<void> {
	// Guard against path-injection: reject any tag name that cannot be safely
	// used as a vault-relative file path component.
	if (!isValidTagName(tag)) {
		new Notice(`Invalid tag name: ${tag}`);
		return;
	}

	let tagPage = app.metadataCache.getFirstLinkpathDest(tag, "");
	if (!tagPage) {
		try {
			tagPage = await app.vault.create(`${tag}.md`, "");
			new Notice(`Created new tag page: ${tag}.md`);
		} catch (e) {
			new Notice(`Failed to create tag page ${tag}.md: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
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
	// Handle both #tag and its subtags (#tag/...), allowing punctuation after the tag.
	const searchRegex = new RegExp(`(^|\\s)#(${tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?:/[^\\s.,;:?!\\]]*)?)(?=[\\s.,;:?!\\]]|$)`, "gm");
	const replacement = `$1#${parentPath}/$2`;

	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		if (!cache) continue;
		
		const fmTags: unknown = cache.frontmatter?.tags;
		const hasTag = cache.tags?.some(t => t.tag === `#${tag}` || t.tag.startsWith(`#${tag}/`)) || 
					   (fmTags && (
						   (Array.isArray(fmTags) && fmTags.some(t => typeof t === "string" && (t === tag || t.startsWith(`${tag}/`)))) ||
						   (typeof fmTags === "string" && (fmTags === tag || fmTags.startsWith(`${tag}/`)))
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
							rfm.tags = rfm.tags.map((t: unknown) => {
								if (typeof t !== "string") return t;
								if (t === tag || t.startsWith(`${tag}/`)) return `${parentPath}/${t}`;
								return t;
							});
						} else if (typeof rfm.tags === "string" && (rfm.tags === tag || rfm.tags.startsWith(`${tag}/`))) {
							rfm.tags = `${parentPath}/${rfm.tags}`;
						}
					}
				}
			});
			
			updatedCount++;
		}
	}
	new Notice(`Converted #${tag} to #${parentPath}/${tag} in ${updatedCount} files.`);
}
