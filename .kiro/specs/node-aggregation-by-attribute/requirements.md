# Requirements Document: Node Aggregation by Attribute

## Introduction

This feature enables visual aggregation of nodes that share identical attributes within any VIEWMODE. When enabled, multiple nodes with the same attribute values are displayed as a single layered icon with a jūnihitoe-style appearance (resembling stacked kimono hems). Aggregation settings are configurable per-set in the Encode tab, allowing independent control for single sets, unions, intersections, and other set types. This feature operates purely at the visual layer and does not alter which nodes are displayed.

## Glossary

- **Node**: A visual element representing a note in the Tag Lens visualization
- **Attribute**: A data property of a node (e.g., status, maturity, tag membership, frontmatter values)
- **Aggregation**: The visual grouping of multiple nodes with identical attribute values into a single display element
- **Jūnihitoe_Icon**: A layered visual representation showing multiple nodes stacked with offset edges, resembling the hems of traditional twelve-layered kimono robes
- **VIEWMODE**: The current visualization mode (Icon Gallery, Intersection lattice, Heatmap, UpSet plot, Matrix, Tag graph, BubbleSets, Nested set, Stream, etc.)
- **Set**: A collection of nodes, including single-tag sets, unions (∪), intersections (∩), and other logical combinations
- **Encode_Tab**: The settings panel tab where visual encoding configurations are managed
- **Visual_Encoding**: The layer that maps node attributes to visual channels (color, position, size, etc.) without changing which nodes are displayed
- **Aggregation_Group**: A collection of nodes with identical attribute values that are candidates for visual aggregation
- **Layer_Control**: Per-set configuration UI in the Encode tab for managing visual encoding and display settings

## Requirements

### Requirement 1: Attribute-Based Node Aggregation

**User Story:** As a user, I want to aggregate nodes that share the same attributes, so that I can reduce visual clutter and identify patterns in attribute distributions across my vault.

#### Acceptance Criteria

1. WHEN aggregation is enabled for a set AND multiple nodes within that set share identical attribute values, THE System SHALL visually group those nodes into a single Jūnihitoe_Icon
2. WHEN determining identical attributes, THE System SHALL compare all configured aggregation attributes (initially supporting a predefined attribute like status or maturity)
3. WHEN an Aggregation_Group contains N nodes, THE System SHALL preserve all N nodes' data for interaction purposes (hover, click, navigation)
4. WHEN aggregation is disabled for a set, THE System SHALL display all nodes individually without grouping
5. WHEN no nodes in a set share identical attributes, THE System SHALL display all nodes individually even when aggregation is enabled

### Requirement 2: Jūnihitoe Visual Representation

**User Story:** As a user, I want aggregated nodes to have a distinctive layered appearance, so that I can immediately recognize them as representing multiple nodes.

#### Acceptance Criteria

1. WHEN rendering a Jūnihitoe_Icon, THE System SHALL display multiple offset layers resembling stacked kimono hems
2. WHEN an Aggregation_Group contains N nodes, THE Jūnihitoe_Icon SHALL display a visual indication of the count (e.g., layer depth, badge, or tooltip)
3. WHEN rendering layer offsets, THE System SHALL use a consistent offset pattern (e.g., 2-4 pixels per layer) that remains readable at different zoom levels
4. WHEN the aggregation count exceeds a display threshold (e.g., 5-7 layers), THE System SHALL use a simplified representation (e.g., truncated layers with a count badge)
5. THE Jūnihitoe_Icon SHALL preserve the base node's visual encoding (color, shape, size) from the Visual_Encoding layer

### Requirement 3: Per-Set Aggregation Configuration

**User Story:** As a user, I want to control aggregation independently for each set, so that I can enable aggregation for high-cardinality sets while keeping others ungrouped.

#### Acceptance Criteria

1. WHEN the Encode_Tab displays Layer_Control sections, THE System SHALL include an aggregation toggle for each set (single sets, ∪, ∩, etc.)
2. WHEN a user toggles aggregation for a specific set, THE System SHALL apply that setting only to nodes belonging to that set
3. WHEN a node belongs to multiple sets with different aggregation settings, THE System SHALL respect the aggregation setting of the node's primary set (main cluster membership)
4. THE System SHALL persist per-set aggregation settings in MiniSettings
5. THE System SHALL restore per-set aggregation settings when loading saved lenses or reopening the vault

### Requirement 4: Encode Tab Integration

**User Story:** As a developer, I want aggregation controls integrated into the existing Encode tab structure, so that all visual encoding settings remain centralized and consistent.

#### Acceptance Criteria

1. THE Aggregation_Toggle SHALL be positioned within each Layer_Control section in the Encode_Tab
2. WHEN rendering the Encode_Tab, THE System SHALL display aggregation controls for all sets (including synthetic ∪/∩ layers)
3. WHEN aggregation settings change, THE System SHALL trigger a redraw without rebuilding the layout or changing the node set
4. THE Aggregation_Toggle UI SHALL follow the existing toggle pattern (label + checkbox) used in other Encode_Tab sections
5. WHEN no aggregation attribute is configured globally, THE Aggregation_Toggle SHALL be disabled with an explanatory tooltip

### Requirement 5: VIEWMODE Compatibility

**User Story:** As a user, I want aggregation to work across all VIEWMODEs, so that I have a consistent experience regardless of which visualization I'm using.

#### Acceptance Criteria

1. THE Aggregation_Feature SHALL support all current VIEWMODEs (Icon Gallery, Intersection lattice, Heatmap, UpSet plot, Matrix, Tag graph, BubbleSets, Nested set, Stream)
2. WHEN switching between VIEWMODEs, THE System SHALL preserve aggregation settings and reapply them to the new view
3. WHEN a VIEWMODE does not support visual aggregation (e.g., Matrix mode where nodes are dots in a grid), THE System SHALL disable aggregation controls with an explanatory message
4. WHEN aggregation is active in a card-based VIEWMODE (euler, bipartite, bubblesets, upset), THE Jūnihitoe_Icon SHALL render correctly within card boundaries
5. WHEN aggregation is active in spatial VIEWMODEs (Icon Gallery with Cartesian axes), THE System SHALL position the Jūnihitoe_Icon at the computed layout position

### Requirement 6: Visual Encoding Layer Separation

**User Story:** As a system architect, I want aggregation to operate purely at the visual layer, so that it never changes which nodes are displayed and maintains separation of concerns.

#### Acceptance Criteria

1. THE Aggregation_Feature SHALL NOT modify the data selection layer (query results, filtered node set)
2. WHEN aggregation is applied, THE System SHALL maintain the same node count in the underlying LaidOut.nodes array
3. THE Aggregation_Feature SHALL operate after layout and before rendering (in the Visual_Encoding evaluation phase or as a rendering-time transform)
4. WHEN displaying node counts in the UI (e.g., "showing N notes"), THE System SHALL report the unaggregated count (total individual nodes, not aggregated groups)
5. WHEN exporting visualizations to PNG, THE System SHALL render Jūnihitoe_Icons consistently with the canvas display

### Requirement 7: Interaction and Hover Behavior

**User Story:** As a user, I want to interact with aggregated nodes to see which individual notes they represent, so that I can navigate to specific notes or understand the composition of the group.

#### Acceptance Criteria

1. WHEN a user hovers over a Jūnihitoe_Icon, THE System SHALL display a tooltip showing all aggregated node labels
2. WHEN a user clicks a Jūnihitoe_Icon containing multiple nodes, THE System SHALL provide a selection UI (e.g., menu, list) to choose which note to navigate to
3. WHEN aggregation changes due to filtering or setting changes, THE System SHALL update hover and click behaviors accordingly
4. WHEN a Jūnihitoe_Icon is highlighted (via search or selection), THE System SHALL apply the highlight to the aggregated visual representation
5. WHEN using marquee selection, THE System SHALL select all individual nodes within any intersected Jūnihitoe_Icon

### Requirement 8: Settings Persistence and Migration

**User Story:** As a developer, I want aggregation settings properly persisted and migrated, so that users' configurations are preserved across plugin updates.

#### Acceptance Criteria

1. THE System SHALL add per-set aggregation settings to the MiniSettings interface
2. THE System SHALL add per-set aggregation settings to DEFAULT_SETTINGS
3. WHEN a user upgrades from a version without aggregation settings, THE System SHALL initialize all per-set aggregation toggles to disabled (false)
4. THE System SHALL persist aggregation settings in the same format as other per-set display overrides (e.g., nodeDisplayOverrides structure)
5. WHEN loading settings, THE System SHALL validate that aggregation configuration keys match available sets and ignore obsolete entries

### Requirement 9: Performance and Scalability

**User Story:** As a user with large vaults, I want aggregation to perform efficiently, so that enabling it doesn't cause noticeable lag or frame rate drops.

#### Acceptance Criteria

1. WHEN computing Aggregation_Groups, THE System SHALL use an efficient grouping algorithm (e.g., hash-based grouping by attribute values)
2. WHEN rendering Jūnihitoe_Icons, THE System SHALL cache layer geometry to avoid redundant calculations per frame
3. WHEN aggregation is disabled for all sets, THE System SHALL skip aggregation computation entirely
4. WHEN the node count exceeds 1000 nodes, aggregation processing time SHALL NOT exceed 100ms
5. WHEN rendering a VIEWMODE with aggregation enabled, the frame rate SHALL remain above 30 FPS during pan and zoom operations
