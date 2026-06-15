import { ok } from "./assert";
import { resolveStatusColor, autoAssignColors } from "../src/visual/status-overlay";

const customColors = {
	"to-read": "#ff0000",
	"done": "#00ff00",
};

// resolveStatusColor tests
ok(resolveStatusColor("to-read", customColors) === "#ff0000", "Exact match works");
ok(resolveStatusColor(" TO-READ ", customColors) === "#ff0000", "Trim and uppercase works");
ok(resolveStatusColor("done", customColors) === "#00ff00", "Second match works");
ok(resolveStatusColor("missing", customColors) === null, "Missing returns null");
ok(resolveStatusColor(undefined, customColors) === null, "Undefined returns null");
ok(resolveStatusColor(null, customColors) === null, "Null returns null");
ok(resolveStatusColor("   ", customColors) === null, "Whitespace returns null");

// autoAssignColors tests
const assigned = autoAssignColors(["to-read", "done", "Reading", " reading "]);

ok(typeof assigned["to-read"] === "string" && assigned["to-read"].startsWith("#"), "Generates hex color");
ok(assigned["reading"] === assigned["reading"], "Consistent key for reading");
ok(Object.keys(assigned).length === 3, "Only generates unique trimmed lowercase keys");

const assigned2 = autoAssignColors(["to-read"]);
ok(assigned["to-read"] === assigned2["to-read"], "Stable hashing across calls");
