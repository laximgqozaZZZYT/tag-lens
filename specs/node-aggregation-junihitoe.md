# Node Aggregation by Attribute (Junihitoe) Specification

## Overview
- Purpose: Group nodes with the same attribute value within a set into a single "Junihitoe" layered stack to reduce visual clutter.
- Status: Draft
- Version: 0.1.0
- Last Updated: 2026-06-19
- Author: vow-spec-architect

## Requirements
### Functional Requirements
- [FR-001] Global attribute selection (status, maturity, age) in the Encode tab.
- [FR-002] Per-set enable/disable toggle for aggregation.
- [FR-003] Group nodes by attribute value when enabled.
- [FR-004] Compute centroid and bounding box for aggregated groups.
- [FR-005] Render aggregated groups as "Junihitoe" (layered) stacks.
- [FR-006] Support Union and Intersection synthetic layers for aggregation.

### Non-Functional Requirements
- [NFR-001] Performance: Aggregation should not significantly delay the rebuild pipeline.
- [NFR-002] Visual: The Junihitoe stack should be distinguishable from the standard 3-card stack.

## Technical Design
### Architecture
- **Aggregation Computation**: `src/aggregation/compute.ts` handles the grouping logic. It takes `PositionedNode[]` and returns `AggregationState`.
- **Pipeline Integration**: `src/view.ts` calls `computeAggregationGroups` after the layout phase but before final coordinate settling (snap).
- **Rendering**: `src/draw/draw-helpers.ts` provides `drawJunihitoeStack`.

### Interfaces
#### AggregationConfig (`src/aggregation/types.ts`)
```typescript
export interface AggregationConfig {
    enabled: boolean;
}
```

#### Junihitoe Rendering
- A stack of 5 rounded rectangles.
- Vertical offset: 4px per layer.
- Horizontal offset: 2px per layer.
- Colors: Deep red, orange, yellow, green, purple (standard Junihitoe palette or theme-derived).

### Dependencies
- Existing `PositionedNode` structure.
- `MiniSettings` (already has `globalAggregationAttribute` and `aggregationSettings`).

## Implementation Tasks
### Phase 1: Pipeline Integration
- [ ] Ensure `AggregationConfig` and `AggregationState` are exported correctly in `src/aggregation/types.ts`.
- [ ] In `src/view.ts`, add `aggregationState: AggregationState` property to `MiniGraphView`.
- [ ] In `src/view.ts#rebuild()`, call `computeAggregationGroups(this.laid.nodes, this.settings, this.settings.viewMode)` after `layout()` is called.
- [ ] Update `this.laid.nodes` or a derived list to exclude nodes in `aggregationState.aggregatedNodeIds`.

### Phase 2: Junihitoe Stack Implementation
- [ ] Implement `drawJunihitoeStack` in `src/draw/draw-helpers.ts`.
    - Parameters: `ctx`, `group` (AggregationGroup), `cardW`, `cardH`, `zoom`, `highlighted`, `minFontPx`.
    - Drawing logic: 5 layers with cascading offsets and Junihitoe-inspired border colors.
- [ ] Replace or augment `drawAggregateStack` usage in `src/view.ts#draw()` to handle `AggregationGroup`s from the state.

### Phase 3: UI Components
- [ ] Add `Aggregation Attribute` dropdown to `renderSettingsEncodeTab` in `src/panel/settings-tabs.ts`.
- [ ] Add `Enable attribute-aggregation` toggle to `renderLayerTab` and `renderSetLayerTab` in `src/panel/settings-tabs.ts`.
    - Backed by `settings.aggregationSettings[groupKey].enabled`.

## Acceptance Criteria
- [AC-001] Selecting an attribute (e.g., "status") and enabling it for a tag successfully replaces nodes with a stack icon.
- [AC-002] The stack icon displays the attribute value (e.g., "active") and the count (e.g., "5 nodes").
- [AC-003] Toggling aggregation off restores individual cards.
- [AC-004] `npm run verify` passes.

## Agent Coordination Notes
- `src/view.ts` is very large; be careful with and ensure new state properties are initialized correctly.
- `src/layout.ts` contains NUL bytes, use `grep -a`.
- The Junihitoe icon should use theme-aware colors where possible, but can use a fixed palette for the "layers" as long as it's readable in dark/light modes.
