# Requirements Document: Encode Tab Cleanup

## Introduction

The Encode tab in the Tag Lens settings panel currently displays content with Japanese text and multiple sections. This spec defines the requirements for clearing the tab content to make it minimal while preserving all underlying functionality, settings structure, and data flow integrity.

## Glossary

- **Encode_Tab**: The Visual Encoding settings tab in the Tag Lens control panel, implemented in `renderSettingsEncodeTab()` function
- **MiniSettings**: The TypeScript interface defining all persisted plugin settings
- **EncodingBinding**: Data structure storing attribute-to-visual-channel mappings (channelId, fieldId, scale, enabled)
- **Rebuild_Pipeline**: The orchestrated data flow from parser → query → layout → encoding → draw
- **Visual_Encoding_Engine**: The system that maps note attributes to visual channels (color, shape, position) without changing which notes are displayed

## Requirements

### Requirement 1: Clear Visual Content

**User Story:** As a developer, I want the Encode tab content cleared, so that the tab displays minimal UI elements.

#### Acceptance Criteria

1. THE Encode_Tab SHALL NOT display the Japanese description text ("タグ・年齢・フロントマターなどの属性を...")
2. THE Encode_Tab SHALL NOT display Color binding controls
3. THE Encode_Tab SHALL NOT display Shape binding controls  
4. THE Encode_Tab SHALL NOT display the "Show legend on canvas" toggle
5. THE Encode_Tab SHALL NOT display the Experimental section (Position X/Y controls)
6. THE Encode_Tab SHALL NOT display the Legacy bindings section (stale days, maturity badge)
7. THE Encode_Tab SHALL NOT display the Layers & Overrides section
8. THE Encode_Tab SHALL render an empty or minimal placeholder section

### Requirement 2: Preserve Settings Data Structure

**User Story:** As a developer, I want all settings storage preserved, so that no data is lost and functionality remains intact.

#### Acceptance Criteria

1. THE MiniSettings interface SHALL remain unchanged
2. THE EncodingBinding type definition SHALL remain unchanged
3. THE encoding field in MiniSettings SHALL continue storing EncodingBinding arrays
4. THE showLegend field in MiniSettings SHALL remain functional
5. THE staleDays field in MiniSettings SHALL remain functional
6. THE showMaturity field in MiniSettings SHALL remain functional
7. THE nodeDisplayOverrides field in MiniSettings SHALL remain functional
8. THE inheritFrom field in MiniSettings SHALL remain functional
9. THE layerInheritFull field in MiniSettings SHALL remain functional
10. THE aggregatedLayers field in MiniSettings SHALL remain functional

### Requirement 3: Preserve Encoding Engine Functionality

**User Story:** As a developer, I want the Visual Encoding Engine to remain fully operational, so that encoding logic continues to work correctly.

#### Acceptance Criteria

1. THE Visual_Encoding_Engine SHALL continue evaluating encoding bindings
2. WHEN encoding bindings exist in settings, THE system SHALL apply them during the rebuild pipeline
3. THE encoding evaluation SHALL continue mapping attributes to visual channels (color, shape, position)
4. THE encoding layer SHALL remain independent from the data-selection layer (query/filter)
5. THE encoding SHALL NOT change which notes are displayed (data-selection invariant)

### Requirement 4: Preserve Rebuild and Draw Pipeline

**User Story:** As a developer, I want the rebuild pipeline to remain intact, so that the plugin continues to render correctly.

#### Acceptance Criteria

1. THE Rebuild_Pipeline SHALL continue executing parser → query → layout → encoding → draw
2. WHEN settings change, THE system SHALL continue triggering rebuilds via `deps.rebuild()`
3. WHEN encoding changes, THE system SHALL continue calling `deps.requestDraw()`
4. THE draw functions SHALL continue accessing encoding results from `laid` data structure
5. THE canvas rendering SHALL continue applying visual encoding to displayed nodes

### Requirement 5: Maintain Type Safety

**User Story:** As a developer, I want type checking to pass, so that no type errors are introduced.

#### Acceptance Criteria

1. WHEN running `tsc --noEmit`, THE compilation SHALL succeed with zero errors
2. WHEN running `npm run verify`, THE verification SHALL pass (typecheck && test && build)
3. THE EncodeTabDeps type SHALL remain compatible with the function signature
4. THE function signature of `renderSettingsEncodeTab` SHALL remain unchanged

### Requirement 6: Preserve Tab Structure

**User Story:** As a developer, I want the tab infrastructure to remain intact, so that the Encode tab continues to appear in the settings panel.

#### Acceptance Criteria

1. THE Encode_Tab SHALL continue to be rendered when the Settings tab is active
2. THE Encode_Tab SHALL remain accessible via the settings panel navigation
3. THE function `renderSettingsEncodeTab` SHALL remain exported and callable
4. THE tab container element SHALL be created and appended to the parent element
