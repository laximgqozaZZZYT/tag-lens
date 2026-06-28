// L2 — Settings-panel sub-tab descriptor list (extracted from view.ts
// renderSettingsBody). Locks the key order/labels so the rendered button strip
// and the persisted `settingsSubTab` field stay in lockstep.
import { ok } from "./assert";
import { settingsSubTabs, type SettingsSubTab } from "../src/panel/settings-tabs";

// Exactly three sub-tabs, in render order, with the expected keys + labels.
{
	const subs = settingsSubTabs();
	ok(subs.length === 3, `three sub-tabs (got ${subs.length})`);
	ok(subs.map((s) => s.key).join(",") === "view,display,encode", "key order View/Display/Encode");
	ok(subs.map((s) => s.label).join(",") === "View,Display,Encode", "labels match keys");
}

// Pure: a fresh array each call (no shared mutable singleton the view could clobber).
{
	const a = settingsSubTabs();
	const b = settingsSubTabs();
	ok(a !== b, "returns a fresh array each call");
}

// The key union is the single source of truth for the field type: every key is a
// valid SettingsSubTab (compile-time check, asserted structurally here too).
{
	const keys: SettingsSubTab[] = settingsSubTabs().map((s) => s.key);
	ok(keys.every((k) => k === "view" || k === "display" || k === "encode"), "keys are SettingsSubTab values");
}
