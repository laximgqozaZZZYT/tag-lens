// Obsidian-coupled image-export I/O (clipboard write / vault save). Kept apart
// from the pure ./image-export helpers (exportFileName/exportCanvasDims) so those
// stay unit-testable. Extracted from view.ts as free functions taking deps.
import { App, Notice } from "obsidian";
import { exportFileName } from "../visual/image-export";

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
