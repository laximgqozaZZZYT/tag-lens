// Obsidian-coupled image-export I/O (clipboard write / vault save). Kept apart
// from the pure ./image-export helpers (exportFileName/exportCanvasDims) so those
// stay unit-testable. Extracted from view.ts as free functions taking deps.
import { App, Notice } from "obsidian";
import { exportFileName, svgFileName } from "../visual/image-export";

export interface ExportIODeps {
	app: App;
	viewMode: string;
}

export async function saveBlobToVault(blob: Blob, deps: ExportIODeps): Promise<void> {
	const name = exportFileName(deps.viewMode, new Date());
	const fm = deps.app.fileManager as unknown as {
		getAvailablePathForAttachment?: (n: string, src?: string) => Promise<string> | string;
	};
	let path = name;
	try {
		if (typeof fm.getAvailablePathForAttachment === "function") {
			path = await fm.getAvailablePathForAttachment(name, "");
		}
		const buf = await blob.arrayBuffer();
		const file = await deps.app.vault.createBinary(path, buf);
		new Notice(`Tag Lens: image saved to ${file.path}`);
	} catch (e) {
		new Notice(
			`Tag Lens: failed to save image — ${e instanceof Error ? e.message : String(e)}`,
		);
		console.error("[tag-lens] save image failed:", e);
	}
}

// SVG is text, so it goes through vault.create (not createBinary).
export async function saveSvgToVault(svg: string, deps: ExportIODeps): Promise<void> {
	const name = svgFileName(deps.viewMode, new Date());
	const fm = deps.app.fileManager as unknown as {
		getAvailablePathForAttachment?: (n: string, src?: string) => Promise<string> | string;
	};
	let path = name;
	try {
		if (typeof fm.getAvailablePathForAttachment === "function") {
			path = await fm.getAvailablePathForAttachment(name, "");
		}
		const file = await deps.app.vault.create(path, svg);
		new Notice(`Tag Lens: SVG saved to ${file.path}`);
	} catch (e) {
		new Notice(`Tag Lens: failed to save SVG — ${e instanceof Error ? e.message : String(e)}`);
		console.error("[tag-lens] save SVG failed:", e);
	}
}

// Copy the SVG markup to the clipboard. Prefer a rich ClipboardItem carrying both
// image/svg+xml (for design tools) and text/plain (for editors); fall back to a
// plain-text write, then to a vault save — so the user never silently loses it.
export async function copySvgToClipboard(svg: string, deps: ExportIODeps): Promise<void> {
	const w = activeWindow as unknown as {
		Blob?: typeof Blob;
		ClipboardItem?: new (items: Record<string, Blob>) => unknown;
		navigator?: {
			clipboard?: {
				write?: (data: unknown[]) => Promise<void>;
				writeText?: (t: string) => Promise<void>;
			};
		};
	};
	const Ctor = w.ClipboardItem;
	const write = w.navigator?.clipboard?.write;
	const BlobCtor = w.Blob;
	if (Ctor && write && BlobCtor) {
		try {
			const item = new Ctor({
				"image/svg+xml": new BlobCtor([svg], { type: "image/svg+xml" }),
				"text/plain": new BlobCtor([svg], { type: "text/plain" }),
			});
			await write.call(w.navigator!.clipboard, [item]);
			new Notice("Tag Lens: SVG copied to clipboard.");
			return;
		} catch (e) {
			console.error("[tag-lens] SVG clipboard.write failed, trying writeText:", e);
		}
	}
	const writeText = w.navigator?.clipboard?.writeText;
	if (writeText) {
		try {
			await writeText.call(w.navigator!.clipboard, svg);
			new Notice("Tag Lens: SVG markup copied to clipboard (text).");
			return;
		} catch (e) {
			console.error("[tag-lens] SVG writeText failed:", e);
		}
	}
	new Notice("Tag Lens: clipboard unavailable — saving SVG to vault instead.");
	await saveSvgToVault(svg, deps);
}

export async function copyBlobToClipboard(blob: Blob, deps: ExportIODeps): Promise<void> {
	const w = activeWindow as unknown as {
		ClipboardItem?: new (items: Record<string, Blob>) => unknown;
		navigator?: { clipboard?: { write?: (data: unknown[]) => Promise<void> } };
	};
	const Ctor = w.ClipboardItem;
	const write = w.navigator?.clipboard?.write;
	if (!Ctor || !write) {
		new Notice("Tag Lens: clipboard image copy unavailable — saving to vault instead.");
		await saveBlobToVault(blob, deps);
		return;
	}
	try {
		await write.call(w.navigator!.clipboard, [new Ctor({ "image/png": blob })]);
		new Notice("Tag Lens: view copied to clipboard.");
	} catch (e) {
		new Notice("Tag Lens: clipboard copy failed — saving to vault instead.");
		console.error("[tag-lens] clipboard copy failed:", e);
		await saveBlobToVault(blob, deps);
	}
}
