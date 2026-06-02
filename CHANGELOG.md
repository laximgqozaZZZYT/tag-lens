# Changelog

All notable changes to Tag Lens are documented here.

## 0.3.1

### Added — Note navigator (mini-menu)

A floating mini-menu, available in **every** view mode, that lists all notes
(after WHERE / GROUP_BY / HAVING / LIMIT) and lets you:

- Browse notes as a **Folder** tree or a **Tag** tree — the tag tree groups by
  `#tag` and adds multi-tag **combination sub-groups** (e.g. `#a · #b`) so notes
  belonging to several tags are easy to find.
- **Search** by plain text, `#tag` (hierarchical) or frontmatter `key:value`,
  with live suggestions.
- **Show / hide** notes on the graph with a checkbox on each row; folder
  checkboxes cascade to their notes (tri-state), plus **Select all / Deselect
  all** to toggle everything at once.
- Click a note to focus / locate / open it.

The panel is **movable, resizable and minimisable** (drag the header to move, the
bottom-right corner to resize, double-click the header to minimise), its content
is identical in every view mode, and it can be shown or hidden from the settings
panel.
