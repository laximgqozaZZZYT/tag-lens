// Import every *.test.ts here so one bundle runs the whole suite.
import { summary } from "./assert";

// (test files imported below as they are added)
import "./conformal.test";
import "./droste-layout.test";
import "./note-menu.test";
import "./hidden-nodes.test";
import "./theme.test";
import "./query.test";
import "./image-export.test";
import "./tag-classification.test";
import "./lens-presets.test";
import "./freshness.test";
import "./gap-finder.test";
import "./bridge-finder.test";
import "./having-highlight.test";
import "./status-overlay.test";
import "./note-maturity.test";
import "./stream-layout.test";
import "./heatmap-layout.test";
import "./display-applicability.test";
import "./encoding-scales.test";
import "./encoding-evaluate.test";
import "./encoding-migrate.test";
import "./axis-layout.test";
import "./droste-axis.test";
import "./spreadsheet-pan.test";
import "./insight-alerts.test";
import "./tag-path.test";
import "./note-menu-geom.test";
import "./settings-parity.test";
import "./attribute-propagation.test";

summary();
