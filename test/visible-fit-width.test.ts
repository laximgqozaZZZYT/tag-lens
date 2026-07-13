// visibleFitWidth(clientWidth, panelWidth) — the fit-area width = canvas client
// width minus the docked note-menu panel, floored at 1. Behaviour lock for the
// seam deduped from the two `fitToView` mode branches (lattice + default card).
import { visibleFitWidth } from "../src/layout/visible-fit-width";
import { ok } from "./assert";

// The docked panel is subtracted from the client width.
ok(visibleFitWidth(1000, 300) === 700, "subtracts the docked panel width");

// Floating / hidden panel (0) → full client width passes through.
ok(visibleFitWidth(800, 0) === 800, "panel 0 → full width passthrough");

// Panel exactly covering the canvas → floored at 1, never 0.
ok(visibleFitWidth(300, 300) === 1, "panel == width → floored to 1");

// Panel wider than the canvas (over-persisted width) → still floored at 1.
ok(visibleFitWidth(300, 400) === 1, "panel > width → floored to 1");
