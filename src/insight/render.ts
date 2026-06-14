import { App, setIcon, Modal, Notice } from "obsidian";
import type { LaidOut } from "../layout";
import type { MiniSettings } from "../types";
import { staleClusters } from "../freshness";
import { streamGeom } from "../draw-stream";
import { computeCognitiveLoad, computeTagSuggestions, type ComputedCognitiveLoad } from "./compute";
import { applyGolderClassification, convertToNestedTag } from "./actions";

export interface InsightDeps {
	app: App;
	settings: MiniSettings;
	save: () => void;

	// Layout State
	laid: LaidOut;
	canvasWidth: number;
	canvasHeight: number;
	currentGaps: Array<{ a: string; b: string; expected: number; actual: number }>;
	currentBridges: Array<{ a: string; b: string; sharedTags: string[] }>;
	highlightedHavingClusters: Map<string, number>;

	// Local UI State
	insightK: number;
	setInsightK: (k: number) => void;
	insightSubTab: "overview" | "alerts" | "suggest";
	setInsightSubTab: (tab: "overview" | "alerts" | "suggest") => void;
}

export function renderInsightTab(host: HTMLElement, deps: InsightDeps): void {
	host.empty();
	const k = deps.insightK;
	let computed: ComputedCognitiveLoad;
	try {
		computed = computeCognitiveLoad(deps.app, k);
		(window as any).app.lastInsight = computed;
	} catch (e) {
		host.createDiv({ text: `Could not compute cognitive load: ${e instanceof Error ? e.message : String(e)}` })
			.setAttr("style", "font-size:11px;color:var(--color-red);padding:8px");
		return;
	}

	const subBar = host.createDiv();
	subBar.setCssStyles({ display: "flex", flexWrap: "wrap", gap: "1px", marginBottom: "6px", borderBottom: "1px solid var(--background-modifier-border)" });
	const content = host.createDiv({ cls: "gim-panel-content" });

	type SubKey = "overview" | "alerts" | "suggest";
	const SUBS: { key: SubKey; label: string }[] = [
		{ key: "overview", label: "Overview" },
		{ key: "alerts", label: "Alerts" },
		{ key: "suggest", label: "Suggest" },
	];
	const subBtns = new Map<string, HTMLElement>();
	const styleSubs = (): void => {
		for (const { key } of SUBS) {
			const b = subBtns.get(key);
			if (!b) continue;
			const on = deps.insightSubTab === key;
			b.setCssStyles({
				background: "transparent", border: "none",
				borderBottom: on ? "2px solid var(--interactive-accent)" : "2px solid transparent",
				borderRadius: "0", padding: "4px 8px", marginBottom: "-1px",
				color: on ? "var(--text-normal)" : "var(--text-muted)", fontWeight: on ? "600" : "400",
				cursor: "pointer", fontSize: "10.5px", lineHeight: "1.3",
			});
		}
	};
	const renderSub = (): void => {
		content.empty();
		switch (deps.insightSubTab) {
			case "overview": renderInsightOverview(content, deps, computed); break;
			case "alerts": renderInsightAlerts(content, deps, computed); break;
			case "suggest": renderInsightSuggest(content, deps); break;
		}
	};
	for (const { key, label } of SUBS) {
		const b = subBar.createEl("button", { text: label });
		subBtns.set(key, b);
		b.addEventListener("click", () => { 
			deps.insightSubTab = key;
			deps.setInsightSubTab(key); 
			styleSubs(); 
			renderSub(); 
		});
		b.addEventListener("mouseenter", () => { if (deps.insightSubTab !== key) { b.setCssStyles({ color: "var(--text-muted)" }); b.setCssStyles({ borderBottomColor: "var(--background-modifier-border)" }); } });
		b.addEventListener("mouseleave", () => styleSubs());
	}
	styleSubs();
	renderSub();
}

export function renderInsightOverview(host: HTMLElement, deps: InsightDeps, computed: ComputedCognitiveLoad): void {
	const { score, globalStats } = computed;
	const band = score < 40 ? { c: "var(--color-green)", b: "var(--color-green)", t: "Low" }
		: score < 80 ? { c: "var(--color-yellow)", b: "var(--color-yellow)", t: "Moderate" }
			: { c: "var(--color-red)", b: "var(--color-red)", t: "High / Critical" };

	// ── Score gauge ──
	const gauge = host.createDiv();
	gauge.setCssStyles({ border: "1px solid var(--background-modifier-border)", borderRadius: "8px", background: "var(--background-secondary)", padding: "10px", marginBottom: "8px" });
	const gTop = gauge.createDiv();
	gTop.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "6px" });
	const gLeft = gTop.createDiv();
	gLeft.createDiv({ text: "Total Cognitive Load Score" }).setAttr("style", "font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-faint)");
	const sc = gLeft.createDiv({ text: `${score} ` });
	sc.setCssStyles({ fontSize: "22px", fontWeight: "700", color: band.c });
	sc.createSpan({ text: "/ 100" }).setAttr("style", "font-size:11px;font-weight:400;color:var(--text-faint)");
	gTop.createDiv({ text: band.t }).setAttr("style", `font-size:12px;font-weight:600;color:${band.c}`);
	const track = gauge.createDiv();
	track.setCssStyles({ height: "8px", width: "100%", borderRadius: "999px", background: "var(--background-modifier-border)", overflow: "hidden" });
	const fill = track.createDiv();
	fill.setCssStyles({ height: "100%", width: `${score}%`, background: band.b, borderRadius: "999px", transition: "width .15s" });
	gauge.createDiv({ text: `Vault: ${globalStats.totalNotes} notes · ${globalStats.totalFolders} folders · ${globalStats.totalLinks} links · ${globalStats.distinctTags} tags` })
		.setAttr("style", "font-size:9px;color:var(--text-faint);margin-top:6px;font-family:monospace");

	// ── K sensitivity slider + refresh ──
	const ctrl = host.createDiv();
	ctrl.setCssStyles({ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", fontSize: "11px", color: "var(--text-muted)" });
	ctrl.createSpan({ text: "Sensitivity (K)" });
	const kIn = ctrl.createEl("input", { attr: { type: "range", min: "1", max: "5", step: "0.1", value: String(deps.insightK) } });
	kIn.setCssStyles({ flex: "1 1 auto", accentColor: "var(--interactive-accent)", cursor: "pointer" });
	const kVal = ctrl.createSpan({ text: deps.insightK.toFixed(1) });
	kVal.setCssStyles({ fontFamily: "monospace", color: "var(--text-accent)", width: "26px", textAlign: "right" });
	// Update K + label live while dragging (cheap), but only RE-SCAN the vault
	// on release (`change`) so a large vault doesn't recompute per pixel.
	kIn.addEventListener("input", () => { deps.setInsightK(Number(kIn.value)); kVal.setText(deps.insightK.toFixed(1)); });
	kIn.addEventListener("change", () => { deps.save(); renderInsightTab(host.parentElement!, deps); });
	const refresh = ctrl.createEl("button", { text: "Refresh" });
	refresh.setCssStyles({ fontSize: "10px", padding: "2px 8px", background: "var(--background-secondary)", border: "1px solid var(--background-modifier-border)", borderRadius: "4px", color: "var(--text-muted)", cursor: "pointer" });
	refresh.addEventListener("click", () => { renderInsightTab(host.parentElement!, deps); });
}

export function renderInsightAlerts(host: HTMLElement, deps: InsightDeps, computed: ComputedCognitiveLoad): void {
	const { triggered } = computed;
	// ── Alerts (active only) ──
	if (triggered.length === 0) {
		const ok = host.createDiv();
		ok.setCssStyles({ display: "flex", gap: "8px", alignItems: "flex-start", border: "1px solid var(--color-green)", background: "rgba(16,185,129,0.12)", borderRadius: "6px", padding: "10px" });
		ok.createSpan().setAttr("style", "width:10px;height:10px;border-radius:2px;background:var(--color-green);flex:0 0 auto;margin-top:2px;display:inline-block");
		ok.createSpan({ text: "[OK] System status: Normal. Cognitive load is optimal." }).setAttr("style", "font-size:12px;line-height:1.5;color:var(--color-green)");
		return;
	}

	interface AlertItem { label: string; severity: "CRITICAL" | "WARNING" | "INFO"; summary: string; detail: string; advice: string; offender: string; }
	const allCards: AlertItem[] = [];
	for (const cond of triggered) {
		if (cond.offenders) {
			for (const o of cond.offenders) {
				allCards.push({ label: cond.label, severity: cond.severity, summary: cond.summary, detail: cond.detail, advice: cond.advice, offender: o });
			}
		}
	}

	// Under-covered clusters check
	if (deps.settings.havingMode === "highlight" && deps.highlightedHavingClusters.size > 0) {
		const arr = Array.from(deps.highlightedHavingClusters.entries());
		// Sort ascending by count (most under-covered first)
		arr.sort((a, b) => a[1] - b[1]);
		const details = arr.slice(0, 10).map(c => `${c[0]} — only ${c[1]} notes`).join("\n");
		const extra = arr.length > 10 ? `\n...and ${arr.length - 10} more.` : "";
		
		allCards.push({
			label: "Under-covered clusters",
			severity: "WARNING",
			summary: `Found ${arr.length} clusters failing HAVING conditions.`,
			detail: `These clusters do not meet the HAVING threshold but are kept visible via highlight mode.\n${details}${extra}`,
			advice: "Consider adding more notes to these clusters, or adjusting the HAVING thresholds.",
			offender: "Highlight Mode"
		});
	}

	// Freshness Overlay: Stalled Cluster check
	if (deps.settings.freshnessOverlay) {
		// Extract cluster timestamps from graph nodes
		const clusterMap = new Map<string, { newest: number; size: number }>();
		for (const node of deps.laid.nodes) {
			if (node.mtime == null) continue;
			for (const m of node.memberships) {
				if (m === "all") continue;
				const c = clusterMap.get(m);
				if (c) {
					c.newest = Math.max(c.newest, node.mtime);
					c.size++;
				} else {
					clusterMap.set(m, { newest: node.mtime, size: 1 });
				}
			}
		}
		const clusterStats = Array.from(clusterMap.entries()).map(([k, v]) => ({ key: k, newestMtime: v.newest, size: v.size }));
		const now = Date.now();
		const stalled = staleClusters(clusterStats, now, deps.settings.staleDays);
		for (const s of stalled) {
			allCards.push({
				label: "Stalled cluster",
				severity: "WARNING",
				summary: `No activity for ${s.daysStale} days.`,
				detail: `The cluster has not had any notes updated or created in ${s.daysStale} days, exceeding the configured threshold of ${deps.settings.staleDays} days.`,
				advice: "Consider reviewing these notes to see if they are still relevant, or if they need to be archived.",
				offender: s.key
			});
		}
	}

	// Note Maturity: Ripening Backlog
	if (deps.settings.showMaturity) {
		const ripening = deps.laid.nodes.filter(n => n.fmMaturity === "fleeting" && n.ageDays != null && n.ageDays > 30);
		if (ripening.length > 0) {
			ripening.sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0));
			const details = ripening.slice(0, 10).map(n => `${n.label} — ${Math.floor(n.ageDays || 0)} days old`).join("\n");
			const extra = ripening.length > 10 ? `\n...and ${ripening.length - 10} more.` : "";
			allCards.push({
				label: "Ripening backlog",
				severity: "WARNING",
				summary: `Found ${ripening.length} fleeting notes older than 30 days.`,
				detail: `These notes have remained 'fleeting' for over 30 days:\n${details}${extra}`,
				advice: "Consider reviewing these notes to synthesize them into 'permanent' notes or refactor them.",
				offender: "Note Maturity"
			});
		}
	}

	// Sequence Stream: Dropped threads
	if (deps.settings.viewMode === "stream" && deps.laid.stream) {
		const geom = streamGeom(deps.laid.stream, deps.canvasWidth, deps.canvasHeight);
		if (geom.droppedThreads.length > 0) {
			const details = geom.droppedThreads.slice(0, 10).map(t => `${t.tag} — last seen at '${deps.laid.stream!.cols[t.c]}', absent for ${t.ageBins} bins`).join("\n");
			const extra = geom.droppedThreads.length > 10 ? `\n...and ${geom.droppedThreads.length - 10} more.` : "";
			allCards.push({
				label: "Dropped threads",
				severity: "WARNING",
				summary: `Found ${geom.droppedThreads.length} tags that stopped appearing.`,
				detail: `These tags appear early in the sequence but have no occurrences in recent bins:\n${details}${extra}`,
				advice: "Review these to see if a thread was abandoned or a tag is no longer needed.",
				offender: "Sequence Stream"
			});
		}
	}

	if (deps.settings.gapFinder && deps.settings.viewMode === "heatmap" && deps.currentGaps.length > 0) {
		const top10 = deps.currentGaps.slice(0, 10);
		const details = top10.map(g => `#${g.a} × #${g.b} — expected ~${Math.round(g.expected)}, actual ${g.actual}`).join("\n");
		allCards.push({
			label: "Unexplored intersections",
			severity: "WARNING", // Using WARNING to ensure it stands out, but could be INFO
			summary: `Found ${deps.currentGaps.length} gaps in tag co-occurrences.`,
			detail: `These tags have high individual frequencies but rarely or never co-occur. Top gaps:\n${details}`,
			advice: "Consider creating notes that bridge these topics.",
			offender: "Heatmap Gaps"
		});
	}

	if (deps.settings.showGhostEdges && deps.currentBridges.length > 0) {
		const top10 = deps.currentBridges.slice(0, 10);
		const details = top10.map(b => `${b.a} ↔ ${b.b} (${b.sharedTags.length} shared tags)`).join("\n");
		allCards.push({
			label: "Link candidates",
			severity: "INFO",
			summary: `Found ${deps.currentBridges.length} ghost edges.`,
			detail: `These notes have strong tag overlap (Jaccard >= ${deps.settings.ghostEdgeMinJaccard}) but are not linked. Top candidates:\n${details}`,
			advice: "Consider explicitly linking these notes.",
			offender: "Ghost Edges"
		});
	}

	const listContainer = host.createDiv();
	// Render in batches to avoid locking the UI with thousands of offenders
	const BATCH_SIZE = 9999;
	let loadedCount = 0;

	const renderBatch = () => {
		const batch = allCards.slice(loadedCount, loadedCount + BATCH_SIZE);
		for (const item of batch) {
			const critical = item.severity === "CRITICAL";
			const card = listContainer.createDiv();
			card.setCssStyles({
				display: "flex", gap: "8px", alignItems: "flex-start", marginBottom: "8px", borderRadius: "6px", padding: "10px",
				border: `1px solid ${critical ? "var(--color-red)" : "var(--color-yellow)"}`, background: critical ? "rgba(239,68,68,0.10)" : "rgba(245,158,11,0.10)",
			});
			card.createSpan().setAttr("style", `width:10px;height:10px;border-radius:2px;flex:0 0 auto;margin-top:3px;display:inline-block;background:${critical ? "var(--color-red)" : "var(--color-yellow)"}`);
			const body = card.createDiv();
			body.setCssStyles({ flex: "1 1 auto" });

			const titleRow = body.createDiv();
			titleRow.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" });
			titleRow.createDiv({ text: item.label }).setAttr("style", `font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${critical ? "var(--color-red)" : "var(--color-yellow)"}`);
			const btnGroup = titleRow.createDiv();
			btnGroup.setCssStyles({ display: "flex", gap: "8px", alignItems: "center" });

			const dismissBtn = btnGroup.createEl("button", { cls: "clickable-icon", title: "Dismiss" });
			setIcon(dismissBtn, "x");
			dismissBtn.setCssStyles({ background: "none", border: "none", padding: "0", cursor: "pointer", color: critical ? "var(--color-red)" : "var(--color-yellow)", display: "flex", alignItems: "center" });

			dismissBtn.addEventListener("click", () => {
				card.remove();
			});

			const summaryDiv = body.createDiv({ text: item.summary });
			summaryDiv.setCssStyles({ 
				fontSize: "12px", 
				lineHeight: "1.5", 
				color: critical ? "var(--color-red)" : "var(--color-yellow)",
				cursor: "pointer",
				textDecoration: "underline dashed",
				textUnderlineOffset: "2px"
			});
			
			const offenderDiv = body.createDiv({ text: `• Target: ${item.offender}` });
			offenderDiv.setCssStyles({ marginTop: "5px", fontSize: "10px", color: "var(--text-muted)", fontFamily: "monospace", lineHeight: "1.5" });

			const detailsDiv = body.createDiv();
			detailsDiv.setCssStyles({ display: "none", marginTop: "8px", padding: "6px", background: "rgba(0,0,0,0.15)", borderRadius: "4px" });
			
			const detailText = detailsDiv.createDiv({ text: item.detail });
			detailText.setCssStyles({ fontSize: "11px", color: critical ? "var(--color-red)" : "var(--color-yellow)", marginBottom: "4px" });
			
			const adviceText = detailsDiv.createDiv();
			adviceText.setCssStyles({ fontSize: "11px", color: critical ? "var(--color-red)" : "var(--color-yellow)" });
			adviceText.createSpan({ text: "Recommendation: " }).setAttr("style", "font-weight:bold");
			adviceText.createSpan({ text: item.advice });

			summaryDiv.addEventListener("click", () => {
				detailsDiv.setCssStyles({ display: detailsDiv.style.display === "none" ? "block" : "none" });
			});
		}
		loadedCount += batch.length;
		if (loadedCount < allCards.length) {
			sentinel.style.display = "block";
			listContainer.appendChild(sentinel); // Move sentinel to the end
		} else {
			sentinel.style.display = "none";
		}
	};

	const sentinel = host.createDiv();
	sentinel.setCssStyles({ height: "20px", width: "100%" });

	const observer = new IntersectionObserver((entries) => {
		if (entries[0].isIntersecting && loadedCount < allCards.length) {
			renderBatch();
		}
	}, { root: host, rootMargin: "100px" });
	observer.observe(sentinel);

	// Initial render
	renderBatch();
}

export function renderInsightSuggest(host: HTMLElement, deps: InsightDeps): void {
	host.empty();
	
	const suggestions = computeTagSuggestions(deps.app);
	
	const container = host.createDiv();
	container.setCssStyles({ display: "flex", flexDirection: "column", gap: "10px" });

	const titleRow = container.createDiv();
	titleRow.setCssStyles({ display: "flex", justifyContent: "space-between", alignItems: "center" });
	titleRow.createEl("h4", { text: "Tag Classification Suggestions" }).setCssStyles({ margin: "0" });

	// Since there can be many tags, let's make it scrollable
	const tableContainer = container.createDiv();
	tableContainer.setCssStyles({ overflowY: "auto", maxHeight: "400px", border: "1px solid var(--background-modifier-border)", borderRadius: "4px" });

	const table = tableContainer.createEl("table");
	table.setCssStyles({ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" });
	
	const thead = table.createEl("thead");
	thead.setCssStyles({ position: "sticky", top: "0", background: "var(--background-secondary)", zIndex: "1" });
	const headerRow = thead.createEl("tr");
	const TYPE_LABELS: Record<string, string> = {
		"what_it_is": "What it is (Objective Topic)",
		"what_it_contains": "What it contains (Content Elements)",
		"who_owns_it": "Who owns it (Owner/Creator)",
		"refined_category": "Refining categories (Category Refiner)",
		"qualities": "Qualities (Subjective Traits)",
		"task_org": "Task organization (Status/Process)",
		"self_ref": "Self reference (Personal/Contextual)"
	};

	const TYPE_DESCRIPTIONS: Record<string, string> = {
		"what_it_is": "Describes the objective topic or subject matter of the note.",
		"what_it_contains": "Describes specific content elements (e.g., code, images, formulas).",
		"who_owns_it": "Identifies the owner, creator, brand, or vendor related to the note.",
		"refined_category": "A sub-category that refines a broader topic, typically used in a nested hierarchy.",
		"qualities": "Describes subjective traits, opinions, or characteristics of the note.",
		"task_org": "Used for organizing workflow, statuses, or processes (e.g., #todo, #wip).",
		"self_ref": "Highly localized, personal, or temporary contextual tags."
	};

	["Tag", "Stats", "Suggested Classification", "Actions"].forEach(text => {
		const th = headerRow.createEl("th");
		th.setCssStyles({ padding: "6px", borderBottom: "1px solid var(--background-modifier-border)", color: "var(--text-muted)" });
		
		const wrapper = th.createDiv();
		wrapper.setCssStyles({ display: "flex", alignItems: "center", gap: "4px" });
		wrapper.createSpan({ text });
		
		if (text === "Suggested Classification") {
			const infoIcon = wrapper.createSpan();
			infoIcon.setCssStyles({ cursor: "pointer", color: "var(--text-muted)", display: "inline-flex" });
			setIcon(infoIcon, "info");
			infoIcon.addEventListener("click", () => {
				new ClassificationInfoModal(deps.app, TYPE_LABELS, TYPE_DESCRIPTIONS).open();
			});
		}
	});

	const tbody = table.createEl("tbody");


	for (const s of suggestions) {
		const tr = tbody.createEl("tr");
		tr.setCssStyles({ borderBottom: "1px solid var(--background-modifier-border-hover)" });

		// Tag
		const tdTag = tr.createEl("td");
		tdTag.setCssStyles({ padding: "8px 6px" });
		const tagLink = tdTag.createEl("a", { text: `#${s.tag}` });
		tagLink.setCssStyles({ color: "var(--text-accent)", cursor: "pointer", textDecoration: "none" });
		tagLink.addEventListener("click", () => {
			const dest = deps.app.metadataCache.getFirstLinkpathDest(s.tag, "");
			if (dest) {
				void deps.app.workspace.getLeaf(false).openFile(dest);
			} else {
				new Notice(`Tag page for #${s.tag} does not exist yet.`);
			}
		});

		// Stats
		const tdStats = tr.createEl("td", { text: `${s.count} notes (${(s.ratio * 100).toFixed(1)}%)` });
		tdStats.setCssStyles({ padding: "8px 6px", color: "var(--text-muted)", whiteSpace: "nowrap" });

		// Suggested Classification Dropdown
		const tdClass = tr.createEl("td");
		tdClass.setCssStyles({ padding: "8px 6px" });
		
		const selectEl = tdClass.createEl("select");
		selectEl.setCssStyles({ width: "100%", maxWidth: "180px", padding: "2px", fontSize: "12px", background: "var(--background-modifier-form-field)" });
		for (const [key, label] of Object.entries(TYPE_LABELS)) {
			const option = selectEl.createEl("option", { text: label, value: key });
			if (key === s.golderType) option.selected = true;
		}

		// Actions
		const tdActions = tr.createEl("td");
		tdActions.setCssStyles({ padding: "8px 6px", minWidth: "150px" });
		const actionsDiv = tdActions.createDiv();
		actionsDiv.setCssStyles({ display: "flex", gap: "6px", flexWrap: "wrap" });

		const btnApply = actionsDiv.createEl("button", { text: "Apply Classification" });
		btnApply.setCssStyles({ fontSize: "10px", padding: "2px 6px", cursor: "pointer" });
		btnApply.addEventListener("click", () => {
			const selectedType = selectEl.value;
			applyGolderClassification(deps.app, s.tag, selectedType)
				.then(() => renderInsightSuggest(host, deps))
				.catch((e: Error) => new Notice(`Error: ${e.message}`));
		});

		const btnConvert = actionsDiv.createEl("button", { text: "Convert to Nested Tag" });
		btnConvert.setCssStyles({ fontSize: "10px", padding: "2px 6px", cursor: "pointer" });
		btnConvert.addEventListener("click", () => {
			new PromptModal(deps.app, `Convert #${s.tag} to a nested tag. Enter parent path (e.g. "Programming"):`, (parent) => {
				if (parent && parent.trim()) {
					convertToNestedTag(deps.app, s.tag, parent.trim())
						.then(() => renderInsightSuggest(host, deps))
						.catch((e: Error) => new Notice(`Error: ${e.message}`));
				}
			}).open();
		});
	}
}

class PromptModal extends Modal {
	private submitted = false;
	constructor(app: App, private message: string, private onSubmit: (val: string | null) => void) {
		super(app);
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h4", { text: this.message });
		const input = contentEl.createEl("input", { type: "text" });
		input.setCssStyles({ width: "100%" });
		const submitBtn = contentEl.createEl("button", { text: "Submit" });
		submitBtn.setCssStyles({ marginTop: "10px" });
		const finish = (val: string | null) => {
			if (!this.submitted) {
				this.submitted = true;
				this.onSubmit(val);
				this.close();
			}
		};
		submitBtn.addEventListener("click", () => finish(input.value));
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") finish(input.value);
			if (e.key === "Escape") finish(null);
		});
		input.focus();
	}
	onClose() {
		if (!this.submitted) this.onSubmit(null);
		this.contentEl.empty();
	}
}

class ClassificationInfoModal extends Modal {
	labels: Record<string, string>;
	descriptions: Record<string, string>;

	constructor(app: App, labels: Record<string, string>, descriptions: Record<string, string>) {
		super(app);
		this.labels = labels;
		this.descriptions = descriptions;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Tag Classifications" });
		
		const table = contentEl.createEl("table");
		table.setCssStyles({ width: "100%", borderCollapse: "collapse", fontSize: "14px", marginTop: "10px" });

		for (const [key, label] of Object.entries(this.labels)) {
			const tr = table.createEl("tr");
			tr.setCssStyles({ borderBottom: "1px solid var(--background-modifier-border-hover)" });
			
			const tdLabel = tr.createEl("td");
			tdLabel.setCssStyles({ padding: "10px 8px", fontWeight: "600", whiteSpace: "nowrap", verticalAlign: "top" });
			tdLabel.createSpan({ text: label });

			const tdDesc = tr.createEl("td");
			tdDesc.setCssStyles({ padding: "10px 8px", color: "var(--text-muted)", verticalAlign: "top" });
			tdDesc.createSpan({ text: this.descriptions[key] || "" });
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
