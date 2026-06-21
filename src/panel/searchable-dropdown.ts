// Bases-style searchable dropdown. A trigger button that opens a floating panel
// with a search input and a list of selectable items. Each item can display an
// optional icon (left), a label (centre), an optional hint in muted text
// (right), and a checkmark for the currently selected item. Pure DOM — no
// framework, no Obsidian API dependency beyond `setIcon` for the icon column.
//
// Usage:
//   const dd = createSearchableDropdown(parentEl, { items, selected, onSelect, ... });
//   // later: dd.destroy();  // removes all listeners + DOM

import { setIcon } from "obsidian";

// ── Public types ────────────────────────────────────────────────────────────

export interface DropdownItem {
	id: string;
	label: string;
	/** Muted text shown to the right of the label (e.g. internal field name). */
	hint?: string;
	/** Obsidian icon id shown to the left of the label (e.g. "tag", "file-text"). */
	icon?: string;
}

export interface SearchableDropdownConfig {
	items: DropdownItem[];
	/** Currently selected item id (shown with a checkmark). */
	selected: string;
	/** Placeholder text for the search input. */
	placeholder?: string;
	/** Called when an item is picked. */
	onSelect: (id: string) => void;
	/** Optional label shown on the trigger button when nothing is selected. */
	emptyLabel?: string;
}

export interface SearchableDropdownHandle {
	/** Remove the dropdown panel and all global listeners. */
	destroy: () => void;
	/** Programmatically close the panel (if open). */
	close: () => void;
}

// ── Implementation ──────────────────────────────────────────────────────────

export function createSearchableDropdown(
	parent: HTMLElement,
	config: SearchableDropdownConfig,
): SearchableDropdownHandle {
	// ── Trigger button ──────────────────────────────────────────────────────
	const trigger = parent.createEl("button", { cls: "gim-vb-dropdown-trigger" });
	const selectedItem = config.items.find((i) => i.id === config.selected);
	trigger.setText(selectedItem?.label ?? config.emptyLabel ?? "Select…");

	let panel: HTMLElement | null = null;
	let cleanup: (() => void) | null = null;

	const close = (): void => {
		if (panel) {
			panel.remove();
			panel = null;
		}
		if (cleanup) {
			cleanup();
			cleanup = null;
		}
	};

	const open = (): void => {
		if (panel) {
			close();
			return;
		}

		panel = document.body.createEl("div", { cls: "gim-vb-dropdown-panel" });
		positionPanel(trigger, panel);

		// Search input
		const search = panel.createEl("input", {
			type: "text",
			cls: "gim-vb-dropdown-search",
			placeholder: config.placeholder ?? "入力して検索を開始...",
		});

		// Item list container
		const list = panel.createEl("div", { cls: "gim-vb-dropdown-list" });

		const renderItems = (query: string): void => {
			list.empty();
			const q = query.trim().toLowerCase();
			const filtered =
				q === ""
					? config.items
					: config.items.filter(
							(i) =>
								i.label.toLowerCase().includes(q) ||
								(i.hint?.toLowerCase().includes(q) ?? false),
						);

			if (filtered.length === 0) {
				const empty = list.createEl("div", {
					cls: "gim-vb-dropdown-empty",
					text: "一致する項目がありません",
				});
				empty.setCssStyles({
					padding: "8px 12px",
					color: "var(--text-muted)",
					fontSize: "12px",
				});
				return;
			}

			for (const item of filtered) {
				const row = list.createEl("div", { cls: "gim-vb-dropdown-item" });
				if (item.id === config.selected) row.addClass("is-selected");

				// Icon column
				if (item.icon) {
					const iconEl = row.createEl("span", {
						cls: "gim-vb-dropdown-item-icon",
					});
					setIcon(iconEl, item.icon);
				}

				// Label column
				row.createEl("span", {
					cls: "gim-vb-dropdown-item-label",
					text: item.label,
				});

				// Hint column (muted, right-aligned)
				if (item.hint) {
					row.createEl("span", {
						cls: "gim-vb-dropdown-item-hint",
						text: item.hint,
					});
				}

				// Checkmark for selected
				if (item.id === config.selected) {
					const check = row.createEl("span", {
						cls: "gim-vb-dropdown-item-check",
					});
					setIcon(check, "check");
				}

				row.addEventListener("click", (e) => {
					e.stopPropagation();
					config.onSelect(item.id);
					close();
				});
			}
		};

		renderItems("");

		search.addEventListener("input", () => {
			renderItems(search.value);
		});

		// Keyboard navigation
		search.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				close();
				trigger.focus();
			}
		});

		// Close on click outside
		const onDocClick = (e: MouseEvent): void => {
			if (
				panel &&
				!panel.contains(e.target as Node) &&
				!trigger.contains(e.target as Node)
			) {
				close();
			}
		};
		// Use setTimeout so the opening click doesn't immediately close
		const timerId = window.setTimeout(() => {
			document.addEventListener("click", onDocClick, true);
		}, 0);

		cleanup = () => {
			window.clearTimeout(timerId);
			document.removeEventListener("click", onDocClick, true);
		};

		// Focus search on open
		search.focus();
	};

	trigger.addEventListener("click", (e) => {
		e.stopPropagation();
		open();
	});

	return {
		destroy: () => {
			close();
			trigger.remove();
		},
		close,
	};
}

// Position the floating panel below the trigger (or above if not enough space).
function positionPanel(trigger: HTMLElement, panel: HTMLElement): void {
	const rect = trigger.getBoundingClientRect();
	const spaceBelow = window.innerHeight - rect.bottom;
	const panelHeight = 280; // max-height set in CSS

	if (spaceBelow >= panelHeight || spaceBelow >= rect.top) {
		// Below
		panel.setCssStyles({
			top: `${rect.bottom + 2}px`,
			left: `${rect.left}px`,
			minWidth: `${Math.max(rect.width, 220)}px`,
		});
	} else {
		// Above
		panel.setCssStyles({
			bottom: `${window.innerHeight - rect.top + 2}px`,
			left: `${rect.left}px`,
			minWidth: `${Math.max(rect.width, 220)}px`,
		});
	}
}
