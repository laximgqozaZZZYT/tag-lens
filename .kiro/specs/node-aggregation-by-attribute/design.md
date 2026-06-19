# Design Document: Node Aggregation by Attribute

## Overview

The node aggregation feature adds visual grouping of nodes with identical attribute values, displayed as a distinctive jūnihitoe-style (stacked kimono hem) layered icon. This feature operates purely at the visual rendering layer—after layout, before drawing—ensuring it never modifies the data selection layer or changes which nodes are displayed.

Aggregation is configured per-set (single tags, ∪ unions, ∩ intersections) in the Encode tab, following the existing per-set override pattern used by `nodeDisplayOverrides`. When enabled for a set, nodes sharing identical attribute values are rendered as a single composite icon with offset layers indicating multiplicity.

**Key Design Principles:**
1. **Visual layer only**: Aggregation is a rendering-time transform that doesn't modify `LaidOut.nodes`
2. **Per-set configuration**: Each cluster/set has independent aggregation settings
3. **Attribute-driven**: Grouping is based on configurable attributes (starting with a single attribute, extensible to multiple)
4. **Separation of concerns**: Follows the existing nodeDisplayOverrides pattern for settings persistence and resolution

## Architecture

### Component Interaction Flow

```
┌──────────────────────────────────────────────────────────────┐
│ Settings Layer (MiniSettings)                                │
│ - aggregationSettings: Record<string, AggregationConfig>     │
│ - globalAggregationAttribute: string                         │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────┐
│ Encode Tab UI (panel/settings-tabs.ts)                       │
│ - renderAggregationToggle() per layer                        │
│ - renderGlobalAttributeSelector()                            │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────┐
│ Rebuild Pipeline (rebuild-pipeline.ts)                       │
│ Parser → Query → Layout → Encoding → [NEW] Aggregation      │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────┐
│ Aggregation Engine (aggregation/compute.ts)                  │
│ - computeAggregationGroups(nodes, settings)                  │
│ - Returns: Map<aggregationKey, AggregationGroup>             │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────┐
│ Draw Layer (draw-card.ts, draw-*.ts)                         │
│ - drawJunihitoeIcon() for aggregated nodes                   │
│ - Standard drawCard() for individual nodes                   │
└──────────────────────────────────────────────────────────────┘
```

### Module Responsibilities

**New Modules:**

- `src/aggregation/compute.ts`: Core aggregation logic (group computation)
- `src/aggregation/render.ts`: Jūnihitoe icon rendering
- `src/aggregation/types.ts`: TypeScript interfaces for aggregation structures
- `src/aggregation/interact.ts`: Hover and click handling for aggregated nodes

**Modified Modules:**

- `src/types.ts`: Add `aggregationSettings` and `globalAggregationAttribute` to `MiniSettings`
- `src/panel/settings-tabs.ts`: Add aggregation toggle UI to Encode tab layer controls
- `src/view.ts`: Wire aggregation computation and rendering into the draw pipeline
- `src/interaction/hit-test.ts`: Extend hit testing for aggregated node regions

## Components and Interfaces

### Data Structures

```typescript
// src/aggregation/types.ts

// Per-set aggregation configuration
export interface AggregationConfig {
  enabled: boolean;
  // Reserved for future multi-attribute support
  attributes?: string[];
}

// A group of nodes with identical attribute values
export interface AggregationGroup {
  // Unique key: "setKey:attributeValue" (e.g., "tag/project:status=active")
  key: string;
  // The set/cluster this group belongs to
  setKey: string;
  // Node IDs in this group
  nodeIds: string[];
  // The shared attribute value(s) that define this group
  attributeValue: string;
  // Display position (centroid of member positions)
  x: number;
  y: number;
  // Bounding box for the group (used for hit testing)
  width: number;
  height: number;
  // Representative node (used for encoding, visual properties)
  representativeNode: PositionedNode;
}

// Aggregation state maintained during rendering
export interface AggregationState {
  // Map from aggregation key to group
  groups: Map<string, AggregationGroup>;
  // Map from node ID to aggregation key (for lookup)
  nodeToGroup: Map<string, string>;
  // Set of node IDs that are aggregated (for filtering during draw)
  aggregatedNodeIds: Set<string>;
}
```

### Settings Schema

```typescript
// Addition to src/types.ts MiniSettings interface

export interface MiniSettings {
  // ... existing fields ...
  
  // Global attribute used for aggregation (e.g., "status", "maturity")
  // When unset or "", aggregation is globally disabled
  globalAggregationAttribute: string;
  
  // Per-set aggregation configuration
  // Key = cluster groupKey or synthetic layer key (UNION_LAYER_KEY, INTERSECTION_LAYER_KEY)
  aggregationSettings: Record<string, AggregationConfig>;
}

// Addition to DEFAULT_SETTINGS
export const DEFAULT_SETTINGS: MiniSettings = {
  // ... existing defaults ...
  globalAggregationAttribute: "",
  aggregationSettings: {},
};
```

## Data Models

### Aggregation Computation Algorithm

The aggregation engine operates on the fully laid-out node array, grouping nodes by set membership and attribute value:

```typescript
// Pseudocode for src/aggregation/compute.ts

function computeAggregationGroups(
  nodes: PositionedNode[],
  settings: MiniSettings,
  viewMode: ViewMode
): AggregationState {
  const groups = new Map<string, AggregationGroup>();
  const nodeToGroup = new Map<string, string>();
  const aggregatedNodeIds = new Set<string>();
  
  // Early exit if no global attribute configured
  if (!settings.globalAggregationAttribute) {
    return { groups, nodeToGroup, aggregatedNodeIds };
  }
  
  // Group nodes by (set, attributeValue)
  const groupMap = new Map<string, PositionedNode[]>();
  
  for (const node of nodes) {
    for (const membership of node.memberships) {
      const config = settings.aggregationSettings[membership];
      
      // Skip if aggregation disabled for this set
      if (!config?.enabled) continue;
      
      // Extract attribute value
      const attrValue = getAttributeValue(
        node,
        settings.globalAggregationAttribute
      );
      
      // Skip nodes with null/undefined attributes
      if (attrValue == null) continue;
      
      const groupKey = `${membership}:${attrValue}`;
      
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, []);
      }
      groupMap.get(groupKey).push(node);
      
      // Only process first membership (primary cluster)
      break;
    }
  }
  
  // Convert groups with 2+ nodes into AggregationGroup
  for (const [groupKey, nodeList] of groupMap) {
    if (nodeList.length < 2) continue;
    
    const [setKey, attrValue] = groupKey.split(":", 2);
    
    // Compute centroid position
    const cx = average(nodeList.map(n => n.x));
    const cy = average(nodeList.map(n => n.y));
    
    // Compute bounding box
    const bounds = computeBounds(nodeList);
    
    const group: AggregationGroup = {
      key: groupKey,
      setKey,
      nodeIds: nodeList.map(n => n.id),
      attributeValue: attrValue,
      x: cx,
      y: cy,
      width: bounds.width,
      height: bounds.height,
      representativeNode: nodeList[0], // First node as representative
    };
    
    groups.set(groupKey, group);
    
    for (const node of nodeList) {
      nodeToGroup.set(node.id, groupKey);
      aggregatedNodeIds.add(node.id);
    }
  }
  
  return { groups, nodeToGroup, aggregatedNodeIds };
}

function getAttributeValue(
  node: PositionedNode,
  attribute: string
): string | null {
  // Map attribute names to node fields
  switch (attribute) {
    case "status":
      return node.fmStatus ?? null;
    case "maturity":
      return node.fmMaturity ?? null;
    case "age":
      return node.ageDays != null ? 
        bucketAge(node.ageDays) : null;
    default:
      return null;
  }
}
```

### Jūnihitoe Icon Rendering

The layered icon effect is achieved by drawing multiple offset rectangles behind the top card:

```typescript
// Pseudocode for src/aggregation/render.ts

interface JunihitoeRenderOptions {
  group: AggregationGroup;
  representativeNode: PositionedNode;
  zoom: number;
  // Inherited from representative node's draw options
  cardOpts: DrawCardOptions;
}

function drawJunihitoeIcon(
  ctx: CanvasRenderingContext2D,
  opts: JunihitoeRenderOptions
): void {
  const { group, representativeNode, zoom, cardOpts } = opts;
  const count = group.nodeIds.length;
  
  // Configuration
  const maxVisibleLayers = 5; // Truncate for readability
  const layerOffset = 3 / zoom; // Screen pixels per layer
  const layerAlpha = 0.8; // Fade factor per layer
  
  const visibleLayers = Math.min(count, maxVisibleLayers);
  const node = representativeNode;
  
  ctx.save();
  
  // Draw layers from back to front
  for (let i = visibleLayers - 1; i >= 0; i--) {
    const offsetX = i * layerOffset;
    const offsetY = i * layerOffset;
    
    // Create offset node for layer
    const layerNode: PositionedNode = {
      ...node,
      x: node.x + offsetX,
      y: node.y + offsetY,
    };
    
    // Apply fading to background layers
    const layerAlphaFactor = i === 0 ? 1.0 : 
      Math.pow(layerAlpha, visibleLayers - i);
    
    ctx.globalAlpha = layerAlphaFactor * (cardOpts.encOpacity ?? 1.0);
    
    // Draw the card (use standard drawCard function)
    drawCard(ctx, layerNode, {
      ...cardOpts,
      // Only show content on top layer
      showBody: i === 0 && cardOpts.showBody,
    });
  }
  
  // Draw count badge if truncated
  if (count > maxVisibleLayers) {
    drawCountBadge(ctx, node, count, zoom);
  }
  
  ctx.restore();
}

function drawCountBadge(
  ctx: CanvasRenderingContext2D,
  node: PositionedNode,
  count: number,
  zoom: number
): void {
  const badge = `×${count}`;
  const fontSize = 10 / zoom;
  const padding = 4 / zoom;
  const radius = 3 / zoom;
  
  // Position in bottom-right corner
  const x = node.x + node.width / 2 - padding;
  const y = node.y + node.height / 2 - padding;
  
  ctx.font = `${fontSize}px sans-serif`;
  const metrics = ctx.measureText(badge);
  const badgeW = metrics.width + padding * 2;
  const badgeH = fontSize + padding * 2;
  
  // Background
  ctx.fillStyle = theme().accent;
  ctx.beginPath();
  roundedRectPath(ctx, x - badgeW, y - badgeH, badgeW, badgeH, radius);
  ctx.fill();
  
  // Text
  ctx.fillStyle = theme().text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badge, x - badgeW / 2, y - badgeH / 2);
}
```

### Integration with Draw Pipeline

Aggregation is computed once per rebuild (after encoding evaluation) and stored in `view.ts` state. During rendering, the draw loop checks if a node is aggregated and delegates to the appropriate renderer:

```typescript
// Pseudocode modifications to src/view.ts

class MiniGraphView {
  // New state
  private aggregationState: AggregationState = {
    groups: new Map(),
    nodeToGroup: new Map(),
    aggregatedNodeIds: new Set(),
  };
  
  // In rebuild pipeline (after encoding evaluation)
  private async rebuild(): Promise<void> {
    // ... existing pipeline: parser → query → layout → encoding ...
    
    // Compute aggregation groups
    this.aggregationState = computeAggregationGroups(
      this.laid.nodes,
      this.settings,
      this.settings.viewMode
    );
    
    this.requestDraw();
  }
  
  // In draw loop (card-based modes)
  private draw(): void {
    // ... viewport setup, background ...
    
    // Draw aggregated groups first
    for (const group of this.aggregationState.groups.values()) {
      drawJunihitoeIcon(ctx, {
        group,
        representativeNode: group.representativeNode,
        zoom: this.zoom,
        cardOpts: this.resolveCardOptions(group.representativeNode),
      });
    }
    
    // Draw individual (non-aggregated) nodes
    for (const node of this.laid.nodes) {
      if (this.aggregationState.aggregatedNodeIds.has(node.id)) {
        continue; // Skip aggregated nodes
      }
      
      drawCard(ctx, node, this.resolveCardOptions(node));
    }
    
    // ... edges, enclosures, overlays ...
  }
}
```

### Encode Tab UI Integration

Aggregation controls are added to each layer's configuration section in the Encode tab:

```typescript
// Pseudocode additions to src/panel/settings-tabs.ts

function renderLayerTab(
  el: HTMLElement,
  groupKey: string,
  deps: EncodeTabDeps
): void {
  // ... existing layer controls ...
  
  // Add aggregation section
  renderAggregationSection(el, groupKey, deps);
}

function renderAggregationSection(
  el: HTMLElement,
  groupKey: string,
  deps: EncodeTabDeps
): void {
  const section = el.createDiv({ cls: "gim-panel-section" });
  section.createEl("h5", { text: "Node Aggregation" });
  
  // Show global attribute selector only in first layer
  if (isFirstLayer(groupKey, deps)) {
    renderGlobalAttributeSelector(section, deps);
  }
  
  // Per-layer toggle
  const config = deps.settings.aggregationSettings[groupKey] ?? {
    enabled: false,
  };
  
  const toggleRow = section.createEl("label", { cls: "gim-toggle-row" });
  const checkbox = toggleRow.createEl("input", { type: "checkbox" });
  checkbox.checked = config.enabled;
  
  // Disable if no global attribute configured
  if (!deps.settings.globalAggregationAttribute) {
    checkbox.disabled = true;
    toggleRow.setAttribute("title", 
      "Select a global aggregation attribute first");
  }
  
  checkbox.addEventListener("change", () => {
    if (!deps.settings.aggregationSettings[groupKey]) {
      deps.settings.aggregationSettings[groupKey] = { enabled: false };
    }
    deps.settings.aggregationSettings[groupKey].enabled = checkbox.checked;
    deps.save();
    deps.rebuild();
  });
  
  toggleRow.createSpan({ text: "Aggregate nodes by attribute" });
}

function renderGlobalAttributeSelector(
  el: HTMLElement,
  deps: EncodeTabDeps
): void {
  const row = el.createDiv({ cls: "gim-setting-row" });
  row.createEl("label", { text: "Aggregation attribute:" });
  
  const select = row.createEl("select");
  
  // Options
  const options = [
    { value: "", label: "None (disabled)" },
    { value: "status", label: "Status" },
    { value: "maturity", label: "Maturity" },
    { value: "age", label: "Age (bucketed)" },
  ];
  
  for (const opt of options) {
    const option = select.createEl("option", { 
      value: opt.value,
      text: opt.label,
    });
    if (opt.value === deps.settings.globalAggregationAttribute) {
      option.selected = true;
    }
  }
  
  select.addEventListener("change", () => {
    deps.settings.globalAggregationAttribute = select.value;
    
    // Clear all aggregation settings if disabled
    if (!select.value) {
      deps.settings.aggregationSettings = {};
    }
    
    deps.save();
    deps.rebuild();
    deps.refreshSettingsTab(); // Refresh to update disabled state
  });
}
```

### Interaction Handling

Hover and click interactions for aggregated nodes:

```typescript
// Pseudocode for src/aggregation/interact.ts

export function findAggregatedNodeAtPoint(
  x: number,
  y: number,
  aggregationState: AggregationState
): AggregationGroup | null {
  for (const group of aggregationState.groups.values()) {
    // Check if point is within group bounding box
    const halfW = group.width / 2;
    const halfH = group.height / 2;
    
    if (
      x >= group.x - halfW &&
      x <= group.x + halfW &&
      y >= group.y - halfH &&
      y <= group.y + halfH
    ) {
      return group;
    }
  }
  
  return null;
}

export function showAggregationTooltip(
  group: AggregationGroup,
  nodes: Map<string, GraphNode>
): string {
  const labels = group.nodeIds
    .map(id => nodes.get(id)?.label ?? id)
    .slice(0, 10); // Limit to 10 for readability
  
  const more = group.nodeIds.length > 10 ? 
    `\n... and ${group.nodeIds.length - 10} more` : "";
  
  return `Aggregated nodes (${group.nodeIds.length}):\n` +
    labels.join("\n") +
    more;
}

export function showAggregationMenu(
  group: AggregationGroup,
  nodes: Map<string, GraphNode>,
  callback: (nodeId: string) => void
): void {
  // Create a menu with all aggregated node labels
  const menu = new Menu();
  
  for (const nodeId of group.nodeIds) {
    const node = nodes.get(nodeId);
    if (!node) continue;
    
    menu.addItem(item => {
      item.setTitle(node.label);
      item.setIcon("file");
      item.onClick(() => callback(nodeId));
    });
  }
  
  menu.showAtMouseEvent(event);
}
```

### Modifications to Hit Testing

```typescript
// Pseudocode modifications to src/interaction/hit-test.ts

export function hitTest(
  x: number,
  y: number,
  laid: LaidOut,
  aggregationState: AggregationState
): HitResult {
  // Check aggregated nodes first (they have priority)
  const aggGroup = findAggregatedNodeAtPoint(x, y, aggregationState);
  if (aggGroup) {
    return {
      type: "aggregated-node",
      group: aggGroup,
    };
  }
  
  // Check individual nodes (excluding aggregated)
  for (const node of laid.nodes) {
    if (aggregationState.aggregatedNodeIds.has(node.id)) {
      continue; // Skip aggregated nodes
    }
    
    if (pointInNode(x, y, node)) {
      return {
        type: "node",
        node,
      };
    }
  }
  
  // ... existing hit test logic for edges, clusters, etc. ...
}
```

## Error Handling

### Validation and Edge Cases

1. **No Global Attribute Set**:
   - All per-layer toggles are disabled with tooltip explanation
   - `computeAggregationGroups` returns empty state immediately

2. **Attribute Value Null/Undefined**:
   - Nodes with missing attribute values are excluded from aggregation
   - They render individually as normal

3. **Single-Node Groups**:
   - Groups with only 1 node are not created
   - The node renders individually (no jūnihitoe effect)

4. **Invalid Aggregation Settings**:
   - On load, validate `aggregationSettings` keys against available clusters
   - Ignore orphaned entries from deleted clusters
   - Missing `enabled` field defaults to `false`

5. **Viewmode Compatibility**:
   - Aggregation applies to all card-based modes (euler, bipartite, bubblesets, upset)
   - For non-card modes (matrix, heatmap, lattice, stream), aggregation is computed but not rendered
   - Switching modes preserves aggregation settings

6. **Performance Degradation**:
   - If aggregation computation exceeds 100ms, log warning
   - Consider disabling aggregation auto for large vaults (>5000 nodes)

### Error Messages

```typescript
// User-facing error messages

const ERRORS = {
  NO_ATTRIBUTE: "Select an aggregation attribute in the Encode tab to enable this feature",
  COMPUTATION_TIMEOUT: "Aggregation took too long to compute. Consider filtering your vault or disabling aggregation for some sets.",
  INVALID_ATTRIBUTE: "The selected aggregation attribute is not available for this node type",
};
```

## Testing Strategy

### Unit Tests

Testing approach balances property-based and example-based tests:

**Unit Tests** (specific examples and edge cases):
- Aggregation computation with known node sets
- Jūnihitoe rendering at different zoom levels
- Settings persistence and migration
- Hit testing for aggregated nodes
- Tooltip and menu generation

**Property Tests** (covered in Correctness Properties section):
- Universal properties that should hold for all inputs
- Randomized testing for robustness

### Testing Configuration

All property-based tests should:
- Run minimum 100 iterations (due to randomization)
- Reference their design document property via comment tags
- Tag format: `// Feature: node-aggregation-by-attribute, Property N: <property text>`

### Test Organization

```
test/
  aggregation-compute.test.ts       # Unit: group computation
  aggregation-render.test.ts        # Unit: jūnihitoe rendering
  aggregation-settings.test.ts      # Unit: settings persistence
  aggregation-properties.test.ts    # Property: universal correctness
```

### End-to-End Testing

E2E tests using the CDP harness:
- Enable aggregation for a set in Encode tab
- Verify jūnihitoe icons appear on canvas
- Verify hover shows tooltip with multiple node labels
- Verify click shows selection menu
- Verify switching viewmodes preserves aggregation
- Verify PNG export includes aggregated nodes correctly

**E2E Test Pattern** (following AGENTS.md guidelines):

```typescript
// E2E test MUST use separate profile + port
const CDP_PORT = 9223; // Different from main (9222)
const PROFILE_DIR = `/tmp/obs-agg-test-${Date.now()}`;
// MUST kill only this process + cleanup PROFILE_DIR on exit
```

## Correctness Properties

**What are Correctness Properties?**

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees. Each property is written as a universal statement ("for all" or "for any") that can be validated through property-based testing with randomized inputs.

### Properties

**Property 1: Attribute-based grouping consistency**

*For any* set of nodes with aggregation enabled and any attribute configuration, nodes with identical attribute values should be grouped together, and nodes with different attribute values should remain in separate groups (or ungrouped if singleton).

**Validates: Requirements 1.1, 1.2**

---

**Property 2: Node data preservation**

*For any* aggregation computation, the total count of unique node IDs across all aggregation groups plus ungrouped nodes should equal the input node count, and all node data (label, memberships, attributes) should be retrievable from the aggregation state.

**Validates: Requirements 1.3, 6.2, 6.4**

---

**Property 3: Disabled aggregation has no effect**

*For any* set with aggregation disabled, all nodes belonging to that set should not appear in any aggregation group, regardless of whether they share attribute values with other nodes.

**Validates: Requirements 1.4**

---

**Property 4: Visual encoding preservation**

*For any* aggregated node group, the representative node's visual encoding parameters (color, shape, size, opacity) should be identical to what the first node in the group would have if rendered individually.

**Validates: Requirements 2.5**

---

**Property 5: Count display accuracy**

*For any* aggregation group containing N nodes where N exceeds the display threshold, the rendered output should include a count indicator that accurately reports N.

**Validates: Requirements 2.2**

---

**Property 6: Zoom-consistent offset scaling**

*For any* aggregation group rendered at zoom level Z, the pixel offset between layers should be inversely proportional to Z (offset_pixels = base_offset / Z), ensuring consistent screen-space layering.

**Validates: Requirements 2.3**

---

**Property 7: Per-set configuration isolation**

*For any* two distinct sets A and B, changing the aggregation setting for set A should not affect which nodes from set B are aggregated or how they are grouped.

**Validates: Requirements 3.2**

---

**Property 8: Primary membership precedence**

*For any* node with multiple set memberships, the node should only appear in at most one aggregation group, determined by the aggregation setting of its first (primary) membership.

**Validates: Requirements 3.3**

---

**Property 9: Settings round-trip preservation**

*For any* valid aggregation configuration, serializing the settings to JSON and deserializing should produce an equivalent configuration with all per-set toggles and the global attribute preserved.

**Validates: Requirements 3.4, 3.5, 8.4**

---

**Property 10: Aggregation trigger isolation**

*For any* change to aggregation settings (enable/disable a set, change global attribute), the system should recompute aggregation and trigger a redraw without invoking the layout pipeline or modifying the LaidOut.nodes array.

**Validates: Requirements 4.3, 6.3**

---

**Property 11: Viewmode state preservation**

*For any* pair of viewmodes (M1, M2) and any aggregation configuration, switching from M1 to M2 and back to M1 should preserve all aggregation settings and recompute groups correctly based on the same settings.

**Validates: Requirements 5.1, 5.2**

---

**Property 12: Card boundary constraint**

*For any* aggregation group rendered in a card-based viewmode, the bounding box of all rendered layers (including offsets) should not exceed 1.5× the representative node's card dimensions.

**Validates: Requirements 5.4**

---

**Property 13: Centroid position accuracy**

*For any* aggregation group, the displayed position (x, y) should equal the arithmetic mean of the x-coordinates and y-coordinates of all member nodes' positions.

**Validates: Requirements 5.5**

---

**Property 14: Input array immutability**

*For any* aggregation computation given input array N, the array N should remain unmodified (same length, same node IDs, same node positions) after aggregation completes.

**Validates: Requirements 6.1, 6.2**

---

**Property 15: Tooltip completeness**

*For any* aggregation group containing node IDs [id1, id2, ..., idN], the generated tooltip text should contain the labels of all nodes (up to a display limit), and the count should equal N.

**Validates: Requirements 7.1**

---

**Property 16: Highlight propagation**

*For any* aggregation group where at least one member node is highlighted, the rendered jūnihitoe icon should use the highlight visual style (highlighted fill and stroke).

**Validates: Requirements 7.4**

---

**Property 17: Marquee selection expansion**

*For any* aggregation group whose bounding box intersects a marquee selection rectangle, all member node IDs from that group should be included in the selection result set.

**Validates: Requirements 7.5**

---

**Property 18: Obsolete key filtering**

*For any* loaded settings containing aggregation configuration keys that don't match current cluster groupKeys or synthetic layer keys, those obsolete entries should be silently ignored and not affect aggregation computation.

**Validates: Requirements 8.5**

---

**Property 19: Global disable bypass**

*For any* aggregation state, if the global aggregation attribute is empty or unset, the aggregation computation should return empty groups regardless of per-set toggle states.

**Validates: Requirements 9.3**

### Testing Strategy

This feature uses a dual testing approach combining unit tests and property-based tests:

**Unit Tests** focus on:
- Specific examples of aggregation computation with known input sets
- Edge cases: empty node arrays, single-node groups, missing attributes
- UI rendering: specific layer counts, specific zoom levels, specific attribute values
- Settings migration from versions without aggregation fields
- Hit testing for specific aggregated node positions
- Error handling: invalid attributes, disabled state interactions

**Property Tests** focus on:
- Universal properties that must hold for all inputs (see Properties 1-19 above)
- Randomized node sets, attributes, settings configurations
- Comprehensive coverage through 100+ iterations per property
- Invariants that should never be violated regardless of inputs

**Property Test Configuration:**
- All property tests run minimum 100 iterations
- Each test references its design property via comment tag:
  ```typescript
  // Feature: node-aggregation-by-attribute, Property 1: Attribute-based grouping consistency
  ```
- Use fast-check (TypeScript) or QuickCheck-equivalent for property testing
- Generate random PositionedNode arrays with varied attributes
- Generate random MiniSettings with varied aggregation configurations
- Test invariants across all viewmode combinations

**Example Property Test Structure:**
```typescript
// Feature: node-aggregation-by-attribute, Property 2: Node data preservation
fc.assert(
  fc.property(
    fc.array(arbitraryPositionedNode()),
    fc.record({ globalAggregationAttribute: fc.string(), aggregationSettings: fc.dictionary(...) }),
    (nodes, settings) => {
      const aggState = computeAggregationGroups(nodes, settings, "euler");
      
      const allGroupNodeIds = new Set(
        Array.from(aggState.groups.values()).flatMap(g => g.nodeIds)
      );
      const ungroupedNodeIds = nodes
        .filter(n => !aggState.aggregatedNodeIds.has(n.id))
        .map(n => n.id);
      
      const totalCount = allGroupNodeIds.size + ungroupedNodeIds.length;
      return totalCount === nodes.length;
    }
  ),
  { numRuns: 100 }
);
```

**Integration Tests:**
- Full rebuild pipeline with aggregation enabled/disabled
- Viewmode switching with aggregation state preservation
- Encoding channel interactions with aggregated nodes
- Export functionality with aggregated icons

**End-to-End Tests** (CDP-based, following AGENTS.md requirements):
- Navigate to Encode tab, enable aggregation for a cluster
- Verify jūnihitoe icons appear on canvas using pixel sampling
- Verify tooltip shows multiple node labels on hover
- Verify click menu shows all aggregated nodes
- Verify settings persist after vault reload
- **MUST use separate Obsidian profile + dedicated port**
- **MUST verify actual canvas reflection, not just "no exception"**
- **MUST cleanup processes and temp directories on exit**

### Performance Expectations

While performance requirements are not tested as correctness properties, the implementation should meet these targets:

- Aggregation computation: O(n) where n = node count
- Group lookup during rendering: O(1) hash map access
- Rendering overhead: <10% increase compared to non-aggregated rendering
- Memory overhead: O(g) where g = number of aggregation groups (typically g << n)

