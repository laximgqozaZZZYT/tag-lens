export class App {}
export class TFile {}
// Minimal stub so modules importing AbstractInputSuggest can be loaded under
// test. The pure suggestion logic (extractEditingToken / computeSuggestions) is
// tested directly; the DOM-bound subclass methods are never invoked here.
export class AbstractInputSuggest {
	constructor(_app: unknown, _inputEl: unknown) {}
	open(): void {}
	close(): void {}
}
export class Notice {}
export class Modal {}
export class ItemView {}
export class WorkspaceLeaf {}
export function setIcon() {}
export function debounce() {}
// Stub: the Bases tests exercise the pure parser (parseBaseStructure /
// parseBaseFilter), not parseBaseFile, so this is never called under test.
export function parseYaml(): unknown {
	return null;
}
