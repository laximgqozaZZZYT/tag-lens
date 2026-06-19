# Implementation Plan: Encode Tab Cleanup

## Overview

This plan clears the Encode tab UI content by replacing the `renderSettingsEncodeTab` function body with a minimal implementation. The approach is surgical: modify only the function body in `src/panel/settings-tabs.ts`, leaving all type definitions, data structures, and pipeline logic unchanged.

## Tasks

- [x] 1. Replace renderSettingsEncodeTab function body with minimal implementation
  - Replace the entire function body (currently ~200+ lines) with a minimal placeholder
  - Keep function signature unchanged: `export function renderSettingsEncodeTab(el: HTMLElement, deps: EncodeTabDeps): void`
  - Create single section with header "Visual Encoding" and placeholder text
  - Remove all binding controls (Color, Shape, Position X/Y)
  - Remove legend toggle, stale days input, maturity badge toggle
  - Remove Layers & Overrides section call
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 6.1, 6.3, 6.4_

- [x] 2. Run type checking verification
  - Execute `npm run typecheck` (or `tsc --noEmit`)
  - Verify zero TypeScript errors
  - Confirm MiniSettings interface unchanged
  - Confirm EncodingBinding type unchanged
  - Confirm EncodeTabDeps interface compatible
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 2.1, 2.2_

- [x] 3. Run full verification suite
  - Execute `npm run verify` (tsc && test && build)
  - Confirm all three stages pass (typecheck, test, build)
  - Fix any test failures if they occur
  - _Requirements: 5.2_

- [x] 4. Checkpoint - Manual UI verification
  - Deploy to dev vault: `npm run deploy`
  - Open Obsidian and reload plugin
  - Navigate to Tag Lens → Settings → Encode tab
  - Verify tab renders minimal content without errors
  - Verify other settings tabs still function
  - Verify canvas rendering unchanged
  - Check browser console for errors
  - _Requirements: 6.1, 6.2_

- [ ] 5. Write unit test for minimal tab rendering
  - Create test file or add to existing settings tests
  - Mock HTMLElement and EncodeTabDeps
  - Call renderSettingsEncodeTab(el, deps)
  - Assert: el has child elements
  - Assert: el contains "Visual Encoding" text
  - Assert: el does NOT contain Japanese description
  - Assert: el does NOT contain binding controls
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [ ] 6. Verify encoding engine property tests still pass
  - Identify existing encoding evaluation tests
  - Run tests and confirm they pass
  - If no existing tests, create test that:
    - Generates random EncodingBinding objects
    - Adds to settings.encoding array
    - Triggers rebuild (if possible in test harness)
    - Verifies encoding produces NodeDrawParams
  - Run minimum 100 iterations if creating new property test
  - **Tag: Feature: encode-tab-cleanup, Property 2: Encoding evaluation continues**
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 7. Verify rebuild pipeline property tests still pass
  - Identify existing rebuild pipeline tests
  - Run tests and confirm they pass
  - If no existing tests, create test that:
    - Generates random settings changes
    - Triggers rebuild
    - Verifies pipeline produces valid LaidOut structure
  - Run minimum 100 iterations if creating new property test
  - **Tag: Feature: encode-tab-cleanup, Property 3: Rebuild pipeline executes**
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 8. Final checkpoint - Ensure all tests pass
  - Run `npm run verify` one final time
  - Confirm no regressions in any tests
  - Confirm no type errors
  - Confirm build succeeds
  - Ask user if any questions arise

## Notes

- The core change is task 1 (function body replacement)
- Verification gate (task 2-3) is mandatory per AGENTS.md
- Manual UI check (task 4) is critical since this affects user-visible UI
- All tasks are required for comprehensive validation
- Property tests (tasks 6-7) validate that encoding engine and pipeline remain functional despite UI changes
- All existing functionality must remain intact - only the UI rendering is simplified
