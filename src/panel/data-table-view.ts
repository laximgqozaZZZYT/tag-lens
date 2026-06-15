// Data-table preview (Node Preview + Link Preview) rendered into the navigator's
// table tab. Extracted from view.ts as a free function (DI) per the view-split
// plan: the view side becomes a thin delegator. Behaviour-preserving.
import type { App } from "obsidian";
import { stripTabPrefix, type NoteRef } from "../note-menu";

// Only the edge fields the Link Preview needs (PositionedEdge is assignable).
export interface DataTableEdge {
	source: string;
	target: string;
}

export interface DataTableDeps {
	app: App;
	edges: ReadonlyArray<DataTableEdge>;
}

export function renderDataTableView(
	host: HTMLElement,
	nodes: ReadonlyArray<NoteRef>,
	deps: DataTableDeps,
): void {
	host.empty();

	const title = host.createEl("h4", { text: "Node Preview" });
	title.setCssStyles({ margin: "0 0 8px 0" });

	const tableContainer = host.createDiv();
	tableContainer.setCssStyles({ overflow: "auto", maxHeight: "250px", border: "1px solid var(--background-modifier-border)", borderRadius: "4px" });

	const table = tableContainer.createEl("table");
	table.setCssStyles({ width: "100%", borderCollapse: "collapse", fontSize: "11px", textAlign: "left" });

	const thead = table.createEl("thead");
	thead.setCssStyles({ position: "sticky", top: "0", background: "var(--background-secondary)", zIndex: "1" });

	const trHead = thead.createEl("tr");
	["Name", "Tags", "Status", "Path"].forEach(col => {
		const th = trHead.createEl("th", { text: col });
		th.setCssStyles({ padding: "6px", borderBottom: "1px solid var(--background-modifier-border)", color: "var(--text-muted)" });
	});

	const tbody = table.createEl("tbody");

	// Render up to 500 nodes to prevent massive UI freezing
	const limit = Math.min(nodes.length, 500);
	for (let i = 0; i < limit; i++) {
		const n = nodes[i];
		const tr = tbody.createEl("tr");
		tr.setCssStyles({ borderBottom: "1px solid var(--background-modifier-border-hover)" });

		// Name
		const tdName = tr.createEl("td");
		tdName.setCssStyles({ padding: "6px" });
		const a = tdName.createEl("a", { text: n.label });
		a.setCssStyles({ cursor: "pointer", color: "var(--text-accent)", textDecoration: "none" });
		a.addEventListener("click", () => {
			const dest = deps.app.metadataCache.getFirstLinkpathDest(n.id, "");
			if (dest) void deps.app.workspace.getLeaf(false).openFile(dest);
		});

		// Tags
		const tdTags = tr.createEl("td");
		tdTags.setCssStyles({ padding: "6px", color: "var(--text-muted)", maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
		const tags = n.tags ?? [];
		tdTags.title = tags.join(", ");
		tdTags.textContent = tags.join(", ");

		// Status
		const tdStatus = tr.createEl("td");
		tdStatus.setCssStyles({ padding: "6px" });

		let statusStr = "";
		if (n.frontmatter && n.frontmatter["status"]) {
			statusStr = n.frontmatter["status"].join(", ");
		}
		if (statusStr) {
			tdStatus.createSpan({ text: statusStr }).setCssStyles({
				background: "var(--background-modifier-border)",
				padding: "2px 4px",
				borderRadius: "3px",
				fontSize: "9px"
			});
		}

		// Path
		const tdPath = tr.createEl("td", { text: n.path || n.id });
		tdPath.setCssStyles({ padding: "6px", color: "var(--text-muted)", maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
	}

	if (nodes.length > limit) {
		const trTail = tbody.createEl("tr");
		const tdTail = trTail.createEl("td", { text: `... and ${nodes.length - limit} more nodes` });
		tdTail.setAttr("colspan", "4");
		tdTail.setCssStyles({ padding: "8px", textAlign: "center", color: "var(--text-faint)", fontStyle: "italic" });
	}

	// Link Preview
	const linkTitle = host.createEl("h4", { text: "Link Preview" });
	linkTitle.setCssStyles({ margin: "16px 0 8px 0" });

	const linkTableContainer = host.createDiv();
	linkTableContainer.setCssStyles({ overflow: "auto", maxHeight: "250px", border: "1px solid var(--background-modifier-border)", borderRadius: "4px" });

	const linkTable = linkTableContainer.createEl("table");
	linkTable.setCssStyles({ width: "100%", borderCollapse: "collapse", fontSize: "11px", textAlign: "left" });

	const linkThead = linkTable.createEl("thead");
	linkThead.setCssStyles({ position: "sticky", top: "0", background: "var(--background-secondary)", zIndex: "1" });

	const trLinkHead = linkThead.createEl("tr");
	["Source", "Target", "Description"].forEach(col => {
		const th = trLinkHead.createEl("th", { text: col });
		th.setCssStyles({ padding: "6px", borderBottom: "1px solid var(--background-modifier-border)", color: "var(--text-muted)" });
	});

	const linkTbody = linkTable.createEl("tbody");

	// Create a fast lookup map for node labels
	const nodeLabelMap = new Map<string, string>();
	for (const n of nodes) {
		nodeLabelMap.set(stripTabPrefix(n.id), n.label);
		nodeLabelMap.set(n.id, n.label);
	}

	// Use the currently laid out edges
	const edges = deps.edges || [];
	const edgeLimit = Math.min(edges.length, 500);

	if (edges.length === 0) {
		const tr = linkTbody.createEl("tr");
		const td = tr.createEl("td", { text: "No links to display." });
		td.setAttr("colspan", "3");
		td.setCssStyles({ padding: "12px", textAlign: "center", color: "var(--text-muted)", fontStyle: "italic" });
	} else {
		for (let i = 0; i < edgeLimit; i++) {
			const e = edges[i];
			const tr = linkTbody.createEl("tr");
			tr.setCssStyles({ borderBottom: "1px solid var(--background-modifier-border-hover)" });

			const srcLabel = nodeLabelMap.get(e.source) || e.source;
			const tgtLabel = nodeLabelMap.get(e.target) || e.target;

			const tdSrc = tr.createEl("td", { text: srcLabel });
			tdSrc.setCssStyles({ padding: "6px" });

			const tdTgt = tr.createEl("td", { text: tgtLabel });
			tdTgt.setCssStyles({ padding: "6px" });

			const tdDesc = tr.createEl("td", { text: "(none)" });
			tdDesc.setCssStyles({ padding: "6px", color: "var(--text-faint)", fontStyle: "italic" });
		}

		if (edges.length > edgeLimit) {
			const trTail = linkTbody.createEl("tr");
			const tdTail = trTail.createEl("td", { text: `... and ${edges.length - edgeLimit} more links` });
			tdTail.setAttr("colspan", "3");
			tdTail.setCssStyles({ padding: "8px", textAlign: "center", color: "var(--text-faint)", fontStyle: "italic" });
		}
	}
}
