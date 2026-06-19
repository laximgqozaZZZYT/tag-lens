# Implementation Plan: Node Aggregation by Attribute

## Overview

Implement visual node aggregation with jūnihitoe-style layered icons, configurable per-set in the Encode tab. The feature operates purely at the visual rendering layer without modifying the data selection or layout pipeline. Implementation follows the existing per-set override pattern (nodeDisplayOverrides) for settings management.

## Tasks

- [x] 1. Create aggregation types and settings structure
  - Create `src/aggregation/types.ts` with `AggregationConfig`, `AggregationGroup`, and `AggregationState` interfaces
  - Add `globalAggregationAttribute: string` to `MiniSettings` interface in `src/types.ts`
  - Add `aggregationSettings: Record<string, AggregationConfig>` to `MiniSettings` interface
  - Add corresponding fields to `DEFAULT_SETTINGS` in `src/types.ts`
  - _Requirements: 1.1, 3.4, 8.1, 8.2_

- [ ] 2. Implement aggregation computation engine
  - [x] 2.1 Create core grouping algorithm in `src/aggregation/compute.ts`
    - Implement `computeAggregationGroups(nodes, settings, viewMode)` function
    - Implement `getAttributeValue(node, attribute)` helper for attribute extraction
    - Implement `computeBounds(nodes)` helper for bounding box calculation
    - Group nodes by (setKey, attributeValue) pairs
    - Compute centroid positions for each group
    - Filter out single-node groups
    - _Requirements: 1.1, 1.2, 1.3, 5.5_
  
  - [x] 2.2 Write property test for attribute-based grouping
    - **Property 1: Attribute-based grouping consistency**
    - **Validates: Requirements 1.1, 1.2**
  
  - [ ] 2.3 Write property test for node data preservation
    - **Property 2: Node data preservation**
    - **Validates: Requirements 1.3, 6.2, 6.4**
  
  - [~] 2.4 Write unit tests for edge cases
    - Test empty node array
    - Test nodes with null/undefined attributes
    - Test single-node groups (should not aggregate)
    - _Requirements: 1.5_

- [ ] 3. Implement jūnihitoe icon rendering
  - [~] 3.1 Create rendering functions in `src/aggregation/render.ts`
    - Implement `drawJunihitoeIcon(ctx, opts)` with layered offset rendering
    - Implement `drawCountBadge(ctx, node, count, zoom)` for truncated groups
    - Calculate layer offsets scaled by zoom level
    - Apply alpha fading to background layers
    - Truncate to maximum visible layers (5-7)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  
  - [~] 3.2 Write property test for visual encoding preservation
    - **Property 4: Visual encoding preservation**
    - **Validates: Requirements 2.5**
  
  - [~] 3.3 Write property test for count display accuracy
    - **Property 5: Count display accuracy**
    - **Validates: Requirements 2.2**
  
  - [~] 3.4 Write property test for zoom-consistent offset scaling
    - **Property 6: Zoom-consistent offset scaling**
    - **Validates: Requirements 2.3**
  
  - [~] 3.5 Write unit tests for rendering edge cases
    - Test rendering with different layer counts (1, 3, 5, 10)
    - Test at different zoom levels (0.5, 1.0, 2.0)
    - Test count badge positioning
    - _Requirements: 2.4_

- [~] 4. Checkpoint - Ensure core aggregation logic tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Integrate aggregation into view pipeline
  - [~] 5.1 Wire aggregation computation into rebuild pipeline
    - Add `aggregationState: AggregationState` field to `MiniGraphView` class in `src/view.ts`
    - Call `computeAggregationGroups()` after encoding evaluation in `rebuild()`
    - Store result in `this.aggregationState`
    - _Requirements: 6.3_
  
  - [~] 5.2 Modify draw loop to render aggregated nodes
    - In `draw()` method, iterate over `aggregationState.groups` and call `drawJunihitoeIcon()`
    - Skip individual rendering for nodes in `aggregationState.aggregatedNodeIds`
    - Pass through encoding parameters from representative node
    - _Requirements: 2.5, 5.4_
  
  - [~] 5.3 Write property test for disabled aggregation bypass
    - **Property 19: Global disable bypass**
    - **Validates: Requirements 9.3**
  
  - [~] 5.4 Write property test for input array immutability
    - **Property 14: Input array immutability**
    - **Validates: Requirements 6.1, 6.2**
  
  - [~] 5.5 Write property test for aggregation trigger isolation
    - **Property 10: Aggregation trigger isolation**
    - **Validates: Requirements 4.3, 6.3**

- [ ] 6. Implement Encode tab UI controls
  - [~] 6.1 Add global attribute selector
    - In `src/panel/settings-tabs.ts`, create `renderGlobalAttributeSelector()` function
    - Add dropdown with options: None, Status, Maturity, Age
    - Update `renderSettingsEncodeTab()` to call selector render
    - Clear all aggregation settings when attribute set to None
    - _Requirements: 4.1, 4.5_
  
  - [~] 6.2 Add per-layer aggregation toggles
    - In `src/panel/settings-tabs.ts`, create `renderAggregationSection()` function
    - Add toggle to each layer tab (in `renderLayerTab()` and `renderSetLayerTab()`)
    - Disable toggles when no global attribute configured
    - Add tooltip explanations for disabled state
    - _Requirements: 3.1, 4.1, 4.2, 4.5_
  
  - [~] 6.3 Write property test for per-set configuration isolation
    - **Property 7: Per-set configuration isolation**
    - **Validates: Requirements 3.2**
  
  - [~] 6.4 Write property test for settings round-trip preservation
    - **Property 9: Settings round-trip preservation**
    - **Validates: Requirements 3.4, 3.5, 8.4**

- [ ] 7. Implement interaction handling
  - [~] 7.1 Create aggregation interaction utilities in `src/aggregation/interact.ts`
    - Implement `findAggregatedNodeAtPoint(x, y, aggregationState)` for hit testing
    - Implement `showAggregationTooltip(group, nodes)` for tooltip generation
    - Implement `showAggregationMenu(group, nodes, callback)` for click menu
    - _Requirements: 7.1, 7.2_
  
  - [~] 7.2 Extend hit testing in `src/interaction/hit-test.ts`
    - Check aggregated nodes before individual nodes in hit test priority
    - Return aggregation group when hit
    - Add new `HitResult` type for aggregated nodes
    - _Requirements: 7.2, 7.5_
  
  - [~] 7.3 Wire hover and click handlers in `src/view.ts`
    - Add hover handling to show aggregation tooltips
    - Add click handling to show aggregation selection menu
    - Update marquee selection to expand aggregated groups
    - _Requirements: 7.1, 7.2, 7.5_
  
  - [~] 7.4 Write property test for tooltip completeness
    - **Property 15: Tooltip completeness**
    - **Validates: Requirements 7.1**
  
  - [~] 7.5 Write property test for marquee selection expansion
    - **Property 17: Marquee selection expansion**
    - **Validates: Requirements 7.5**
  
  - [~] 7.6 Write unit tests for interaction scenarios
    - Test hover over aggregated vs individual nodes
    - Test click menu with different group sizes
    - Test marquee selection intersection detection
    - _Requirements: 7.1, 7.2, 7.5_

- [~] 8. Checkpoint - Ensure interaction and UI tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement viewmode support and state preservation
  - [~] 9.1 Add viewmode compatibility checks
    - In `src/aggregation/compute.ts`, add `isViewModeSupported(mode)` function
    - Document which modes support visual aggregation rendering
    - _Requirements: 5.1, 5.3_
  
  - [~] 9.2 Ensure aggregation recomputes on viewmode switch
    - Verify `rebuild()` is called on viewmode changes
    - Verify settings are preserved across viewmode switches
    - _Requirements: 5.2_
  
  - [~] 9.3 Write property test for viewmode state preservation
    - **Property 11: Viewmode state preservation**
    - **Validates: Requirements 5.1, 5.2**
  
  - [~] 9.4 Write property test for primary membership precedence
    - **Property 8: Primary membership precedence**
    - **Validates: Requirements 3.3**
  
  - [~] 9.5 Write property test for card boundary constraint
    - **Property 12: Card boundary constraint**
    - **Validates: Requirements 5.4**
  
  - [~] 9.6 Write property test for centroid position accuracy
    - **Property 13: Centroid position accuracy**
    - **Validates: Requirements 5.5**

- [ ] 10. Implement settings migration and validation
  - [~] 10.1 Add settings migration in `src/main.ts`
    - Check for missing `globalAggregationAttribute` and `aggregationSettings` fields
    - Initialize with empty/default values for existing vaults
    - _Requirements: 8.3_
  
  - [~] 10.2 Add settings validation
    - In `src/aggregation/compute.ts`, filter obsolete aggregation setting keys
    - Validate global attribute value is in allowed list
    - _Requirements: 8.5_
  
  - [~] 10.3 Write property test for obsolete key filtering
    - **Property 18: Obsolete key filtering**
    - **Validates: Requirements 8.5**
  
  - [~] 10.4 Write unit test for settings migration
    - Test upgrade from version without aggregation fields
    - Verify defaults are applied correctly
    - _Requirements: 8.3_

- [ ] 11. Add highlighting and visual state propagation
  - [~] 11.1 Implement highlight propagation
    - Check if any group member is highlighted
    - Pass highlight state to `drawJunihitoeIcon()`
    - Apply highlight style to all layers
    - _Requirements: 7.4_
  
  - [~] 11.2 Write property test for highlight propagation
    - **Property 16: Highlight propagation**
    - **Validates: Requirements 7.4**

- [ ] 12. Final integration and verification
  - [~] 12.1 Run full verification suite
    - Execute `npm run verify` (tsc + test + build)
    - Ensure all type checks pass
    - Ensure all unit and property tests pass
    - _Requirements: All_
  
  - [~] 12.2 Write end-to-end test for aggregation workflow
    - Use separate Obsidian profile and CDP port
    - Enable aggregation in Encode tab via CDP
    - Verify jūnihitoe icons appear on canvas (pixel sampling)
    - Verify hover and click interactions work
    - Verify settings persist after vault reload
    - **MUST use separate profile + port + cleanup**
    - _Requirements: 3.1, 4.2, 7.1, 7.2, 3.5_
  
  - [~] 12.3 Update documentation
    - Add aggregation feature to README or user guide
    - Document aggregation attribute options
    - Document per-set toggle behavior
    - _Requirements: N/A_

- [~] 13. Final checkpoint - All tests pass
  - Ensure all tests pass, verify with `npm run verify`, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Property tests validate universal correctness properties with 100+ iterations
- Unit tests validate specific examples and edge cases
- Aggregation operates purely at the visual layer, never modifying data selection or layout
- Follow AGENTS.md guidelines: use `grep -a` for layout.ts, run `tsc --noEmit` for type checking
- Visual encoding separation is maintained throughout - aggregation never changes which nodes are displayed
