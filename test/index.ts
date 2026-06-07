// Import every *.test.ts here so one bundle runs the whole suite.
import { summary } from "./assert";

// (test files imported below as they are added)
import "./conformal.test";
import "./droste-layout.test";
import "./note-menu.test";
import "./hidden-nodes.test";
import "./theme.test";

summary();
