# Coordination: Node Aggregation (Junihitoe)

## Sprint Goals
- Complete the Node Aggregation by Attribute feature.
- Implement the "Junihitoe" stack rendering.
- Integrate UI controls in the Encode and Layer tabs.

## Task Assignments
| Task | Assignee | Status | Notes |
|---|---|---|---|
| Phase 1: Pipeline Integration | implementer | Pending | Modify `src/view.ts` and `src/aggregation/compute.ts` |
| Phase 2: Junihitoe Stack Rendering | implementer | Pending | Add `drawJunihitoeStack` to `src/draw/draw-helpers.ts` |
| Phase 3: UI Implementation | implementer | Pending | Update `settings-tabs.ts` and `settings-sections.ts` |
| Phase 4: Verification & Bugfixes | tester | Pending | `npm run verify` and manual check |

## Blocking Issues
- None

## Integration Points
- `src/view.ts`: The `rebuild()` pipeline is the main integration point.
- `src/draw/draw-helpers.ts`: Shared drawing utilities.
- `src/aggregation/types.ts`: Shared types.
