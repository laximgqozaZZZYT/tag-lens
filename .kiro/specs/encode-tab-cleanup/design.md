# Design Document: Encode Tab Cleanup

## Overview

This design describes the approach for clearing the Encode tab UI content while preserving all underlying functionality. The cleanup removes visual controls (Color, Shape, Position X/Y bindings, legend toggles, stale days, maturity badge, and layers/overrides sections) but maintains the complete settings data structure, encoding engine, and rebuild pipeline.

The key principle is **UI simplification without functional regression**: all TypeScript interfaces, data structures, and pipeline logic remain unchanged and operational.

## Architecture

### Current Architecture (Preserved)

The Encode tab is part of the Tag Lens layered architecture:

```
[UI Panel] → settings-tabs.ts (Encode tab renders controls)
     ↓
[Settings] → MiniSettings interface (persisted data)
     ↓
[Encoding Engine] → encoding/* (evaluates bindings)
     ↓
[Rebuild Pipeline] → parser → query → layout → encoding → draw
     ↓
[Canvas] → draw-*.ts (renders with encoding applied)
```

**Critical invariant**: Visual Encoding is a separate layer from the SQL/DataviewJS filter layer. It never changes which notes are displayed (data-selection ⊥ visual layer).

### Change Scope

**Modified**: 
- `src/panel/settings-tabs.ts` - `renderSettingsEncodeTab()` function body only

**Unchanged**:
- `src/types.ts` - MiniSettings interface
- `src/encoding/types.ts` - EncodingBinding type
- `src/encoding/evaluate.ts` - Encoding evaluation logic
- `src/rebuild-pipeline.ts` - Pipeline orchestration
- All draw functions (`src/draw/*.ts`)
- All other settings tabs (View, Filter, Display, Insight)

## Components and Interfaces

### Function Signature (Preserved)

```typescript
export function renderSettingsEncodeTab(el: HTMLElement, deps: EncodeTabDeps): void
```

**EncodeTabDeps interface** (unchanged):
```typescript
interface EncodeTabDeps {
  settings: MiniSettings;
  save: () => void;
  rebuild: () => Promise<void>;
  refreshSettingsTab: () => void;
  requestDraw: () => void;
  laid: LaidOut;
  encLegends: BindingLegend[];
}
```

### Cleared UI Elements

The function will remove these sections:
1. **Visual Encoding section header** + Japanese description
2. **Color binding controls** (`renderBindingControls(section, "color", "Color（色）")`)
3. **Shape binding controls** (`renderBindingControls(section, "shape", "Shape（形）")`)
4. **Legend toggle** ("Show legend on canvas")
5. **Experimental section** (Position X/Y controls)
6. **Legacy section** (stale days input, maturity badge toggle)
7. **Layers & Overrides section** (`renderLayersSubSection`)

### Minimal Replacement

The function will render a minimal placeholder:

```typescript
export function renderSettingsEncodeTab(el: HTMLElement, deps: EncodeTabDeps): void {
  const section = el.createDiv({ cls: "gim-panel-section" });
  section.createEl("h4", { text: "Visual Encoding" });
  section.createEl("div", {
    text: "(Content cleared for cleanup)",
  }).setCssStyles({ 
    fontSize: "10px", 
    color: "var(--text-faint)", 
    marginTop: "8px" 
  });
}
```

## Data Models

### MiniSettings Fields (All Preserved)

These fields remain in the interface and continue to function:

```typescript
interface MiniSettings {
  // Encoding bindings (continues to be evaluated by encoding engine)
  encoding: EncodingBinding[];
  
  // Legend display (continues to control canvas legend rendering)
  showLegend: boolean;
  legendHiddenModes: Partial<Record<ViewMode, boolean>>;
  legendPos: Partial<Record<ViewMode, { x: number; y: number }>>;
  
  // Freshness/staleness (used by Opacity encoding and Insight alerts)
  staleDays: number;
  
  // Maturity badge (used by card rendering in draw-card.ts)
  showMaturity: boolean;
  
  // Layer management (used by node-display.ts and layout)
  nodeDisplayOverrides: Record<string, { nodeRows?: number; nodeCols?: number }>;
  inheritFrom: Record<string, string>;
  layerInheritFull: string[];
  aggregatedLayers: string[];
  hiddenNodes: string[];
  
  // ... all other fields unchanged
}
```

### EncodingBinding Structure (Preserved)

```typescript
interface EncodingBinding {
  channelId: string;      // "color" | "shape" | "axisX" | "axisY" | ...
  fieldId: string;        // "status" | "ageDays" | "frontmatter:key" | ...
  scale?: ScaleConfig;    // Scale configuration (linear/log/categorical/...)
  enabled: boolean;       // Whether binding is active
}
```

This structure continues to be:
- Stored in `settings.encoding` array
- Evaluated by `encoding/evaluate.ts`
- Applied during rebuild pipeline
- Rendered via draw functions

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Acceptance Criteria Testing Prework

#### 1.1 THE Encode_Tab SHALL NOT display the Japanese description text
**Thoughts**: This is testing that a specific UI element is not present. We can verify by inspecting the rendered DOM and ensuring no element contains the Japanese text string.
**Testable**: yes - example

#### 1.2-1.7 THE Encode_Tab SHALL NOT display [various UI sections]
**Thoughts**: These are all checking that specific UI controls are not rendered. These are example-based tests that verify specific DOM structure.
**Testable**: yes - example

#### 1.8 THE Encode_Tab SHALL render an empty or minimal placeholder section
**Thoughts**: This is checking that the tab renders something (not completely broken), even if minimal.
**Testable**: yes - example

#### 2.1-2.10 Settings data structure fields SHALL remain unchanged/functional
**Thoughts**: These are testing that the TypeScript interface structure is preserved. This is verified by `tsc --noEmit` (type checking). Not property-testable at runtime since TypeScript types are erased.
**Testable**: no (type-level verification)

#### 3.1-3.5 Visual_Encoding_Engine SHALL continue functioning
**Thoughts**: These test that the encoding evaluation pipeline continues to work. We can test this by creating encoding bindings programmatically and verifying they are evaluated during rebuild.
**Testable**: yes - property

#### 4.1-4.5 Rebuild_Pipeline SHALL remain intact
**Thoughts**: These test that the pipeline execution continues. We can verify by triggering rebuilds and checking that each stage executes and produces output.
**Testable**: yes - property

#### 5.1-5.4 Type safety SHALL be maintained
**Thoughts**: This is verified by running `tsc --noEmit`. Not runtime-testable.
**Testable**: no (compile-time verification)

#### 6.1-6.4 Tab structure SHALL remain intact
**Thoughts**: These test that the tab infrastructure continues to work - the function is callable, it creates DOM elements, etc.
**Testable**: yes - example

### Property Reflection

After reviewing the prework:
- Properties 3.1-3.5 (encoding engine) can be combined into one comprehensive property about encoding evaluation continuing to work
- Properties 4.1-4.5 (rebuild pipeline) can be combined into one property about pipeline execution
- Type-level properties (2.x, 5.x) are verified by `tsc --noEmit`, not property tests
- UI structure tests (1.x, 6.x) are example-based, not property-based

### Properties

**Property 1: Tab renders without crashing**
*For any* valid EncodeTabDeps object, calling `renderSettingsEncodeTab(el, deps)` should complete without throwing exceptions and should create at least one child element in the container
**Validates: Requirements 1.8, 6.1, 6.3**

**Property 2: Encoding evaluation continues**
*For any* valid encoding binding in `settings.encoding`, the encoding engine should evaluate it during rebuild and produce NodeDrawParams for affected nodes
**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

**Property 3: Rebuild pipeline executes**
*For any* settings change that triggers rebuild, the complete pipeline (parser → query → layout → encoding → draw) should execute and produce a valid LaidOut structure
**Validates: Requirements 4.1, 4.2, 4.3, 4.4**

## Error Handling

### Compile-Time Safety

- **Type checking**: All changes must pass `tsc --noEmit` (the only type gate)
- **Interface preservation**: MiniSettings and EncodingBinding types remain unchanged
- **Function signature**: `renderSettingsEncodeTab` signature unchanged

### Runtime Safety

- **Minimal DOM operations**: The simplified function only creates basic HTML elements, reducing surface area for runtime errors
- **No binding evaluation in UI**: The tab no longer reads/writes encoding bindings directly, eliminating validation errors
- **Deps usage**: The function accepts deps but doesn't call save/rebuild/requestDraw, eliminating potential async issues

### Fallback Behavior

- If `el` parameter is invalid, standard DOM errors will occur (same as current behavior)
- If `deps` parameter is invalid, no errors occur since we don't access it (improvement over current)

## Testing Strategy

### Unit Tests

**Example-based tests** for UI structure:

1. **Test: Encode tab renders minimal content**
   - Create mock deps object
   - Call `renderSettingsEncodeTab(el, deps)`
   - Assert: el has at least one child element
   - Assert: el contains "Visual Encoding" text
   - Assert: el does NOT contain Japanese description text
   - Assert: el does NOT contain "Color" binding controls
   - Assert: el does NOT contain "Show legend on canvas" toggle

2. **Test: Function signature unchanged**
   - Import function
   - Verify it accepts (HTMLElement, EncodeTabDeps)
   - Verify it returns void

### Property-Based Tests

**Property tests** for system integrity (run as part of broader test suite, not specific to this change):

1. **Property: Encoding evaluation (existing test, verify still passes)**
   - Generate random encoding bindings
   - Add to settings.encoding
   - Trigger rebuild
   - Verify: encoding evaluation produces NodeDrawParams
   - **Minimum 100 iterations**
   - **Tag: Feature: encode-tab-cleanup, Property 2: Encoding evaluation continues**

2. **Property: Rebuild pipeline (existing test, verify still passes)**
   - Generate random settings changes
   - Trigger rebuild
   - Verify: pipeline produces valid LaidOut structure
   - **Minimum 100 iterations**
   - **Tag: Feature: encode-tab-cleanup, Property 3: Rebuild pipeline executes**

### Integration Tests

1. **Manual verification** (since this affects UI):
   - Deploy plugin: `npm run deploy`
   - Open Obsidian dev vault
   - Open Tag Lens view
   - Open Settings panel → Encode tab
   - Verify: Tab shows minimal content
   - Verify: No errors in console
   - Verify: Other tabs still work
   - Verify: Canvas still renders correctly

### Verification Gate

**Critical**: After implementation, run:
```bash
npm run verify  # = tsc --noEmit && npm test && npm run build
```

All three stages must pass:
- `tsc --noEmit` - Type checking (the only type gate)
- `npm test` - Unit tests
- `npm run build` - esbuild compilation

## Implementation Notes

### Code Location

- **File**: `src/panel/settings-tabs.ts`
- **Function**: `renderSettingsEncodeTab` (starts around line 339)
- **Approach**: Replace entire function body with minimal implementation

### Dependencies Preserved

The function will continue to:
- Accept HTMLElement container
- Accept EncodeTabDeps dependencies
- Create DOM elements using Obsidian API (createDiv, createEl)
- Return void

### Dependencies Removed

The function will no longer:
- Call `renderBindingControls` helper
- Call `renderLayersSubSection` helper
- Access `deps.settings` encoding fields
- Call `deps.save()` or `deps.rebuild()`
- Access `deps.laid.clusters`
- Access `deps.encLegends`

### Verification Checklist

- [ ] `tsc --noEmit` passes (no type errors)
- [ ] `npm test` passes (no test failures)
- [ ] `npm run build` succeeds (esbuild compiles)
- [ ] Manual UI check: Encode tab renders minimal content
- [ ] Manual UI check: No console errors
- [ ] Manual UI check: Other tabs still function
- [ ] Manual UI check: Canvas rendering unchanged
- [ ] No regression in encoding evaluation
- [ ] No regression in rebuild pipeline
