(() => {
  "use strict";

  const LIBRARY_KEY = "nodes-project-library-v1";
  const PROJECT_PREFIX = "nodes-project-v1:";
  const CHECKPOINT_PREFIX = "nodes-checkpoint-v1:";
  const refs = {
    grid: document.querySelector("#project-grid"), empty: document.querySelector("#library-empty"),
    count: document.querySelector("#project-count"), search: document.querySelector("#project-search"),
    file: document.querySelector("#library-file-input"), toasts: document.querySelector("#toast-region")
  };
  const makeId = () => crypto.randomUUID?.() || `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const projectKey = (id) => `${PROJECT_PREFIX}${id}`;
  const checkpointKey = (id) => `${CHECKPOINT_PREFIX}${id}`;
  const safeParse = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

  function loadLibrary() {
    const items = safeParse(localStorage.getItem(LIBRARY_KEY) || "[]", []);
    return Array.isArray(items) ? items.filter((item) => item?.id).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) : [];
  }
  function saveLibrary(items) { localStorage.setItem(LIBRARY_KEY, JSON.stringify(items)); }
  function openProject(id) { location.href = `editor.html?project=${encodeURIComponent(id)}`; }
  function relativeDate(value) {
    const date = new Date(value); const delta = Math.max(0, Date.now() - date.getTime());
    if (delta < 60_000) return "Just now";
    if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} min ago`;
    if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} hr ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  }
  function showToast(message, tone = "neutral") {
    const toast = document.createElement("div"); toast.className = `toast-message alert ${tone === "error" ? "alert-error" : "alert-success"}`;
    toast.innerHTML = `<span class="toast-dot" aria-hidden="true"></span><span>${escapeHtml(message)}</span>`; refs.toasts.append(toast);
    requestAnimationFrame(() => toast.classList.add("visible")); setTimeout(() => { toast.classList.remove("visible"); setTimeout(() => toast.remove(), 180); }, 2200);
  }
  function createProject(data = null) {
    const id = makeId(); const now = new Date().toISOString(); const title = data?.documentTitle || "Untitled Flowchart";
    const project = data || { version: 1, documentTitle: title, nodes: [], edges: [], zoom: 1, pan: { x: 0, y: 0 }, snap: true, showGrid: true };
    saveLibrary([{ id, title, createdAt: now, updatedAt: now, nodeCount: project.nodes.length }, ...loadLibrary()]);
    localStorage.setItem(projectKey(id), JSON.stringify({ ...project, documentTitle: title }));
    openProject(id);
  }
  function duplicateProject(id) {
    const source = loadLibrary().find((item) => item.id === id); if (!source) return;
    const newId = makeId(); const now = new Date().toISOString(); const title = `${source.title || "Untitled Flowchart"} copy`;
    saveLibrary([{ ...source, id: newId, title, createdAt: now, updatedAt: now }, ...loadLibrary()]);
    const data = safeParse(localStorage.getItem(projectKey(id)), null);
    if (data) localStorage.setItem(projectKey(newId), JSON.stringify({ ...data, documentTitle: title }));
    const checkpoint = localStorage.getItem(checkpointKey(id)); if (checkpoint) localStorage.setItem(checkpointKey(newId), checkpoint);
    render(); showToast("Flowchart duplicated");
  }
  function deleteProject(id) {
    const item = loadLibrary().find((project) => project.id === id);
    if (!item || !confirm(`Delete “${item.title}” from this device?`)) return;
    saveLibrary(loadLibrary().filter((project) => project.id !== id)); localStorage.removeItem(projectKey(id)); localStorage.removeItem(checkpointKey(id));
    render(); showToast("Flowchart deleted");
  }

  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const pointForPort = (node, port) => {
    const x = number(node.x); const y = number(node.y); const width = number(node.width, 160); const height = number(node.height, 76);
    if (port === "top") return [x + width / 2, y];
    if (port === "right") return [x + width, y + height / 2];
    if (port === "bottom") return [x + width / 2, y + height];
    return [x, y + height / 2];
  };
  const connectorPath = (edge, nodesById) => {
    const from = nodesById.get(edge.fromNodeId); const to = nodesById.get(edge.toNodeId);
    if (!from || !to) return "";
    const [ax, ay] = pointForPort(from, edge.fromPort); const [bx, by] = pointForPort(to, edge.toPort);
    if (edge.type === "curved") {
      const vectors = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
      const [avx, avy] = vectors[edge.fromPort] || [0, 0]; const [bvx, bvy] = vectors[edge.toPort] || [0, 0];
      const distance = Math.max(50, Math.min(180, Math.hypot(bx - ax, by - ay) * .45));
      return `M${ax} ${ay} C${ax + avx * distance} ${ay + avy * distance},${bx + bvx * distance} ${by + bvy * distance},${bx} ${by}`;
    }
    if (edge.type === "elbow") {
      if (edge.fromPort === "left" || edge.fromPort === "right") { const mid = (ax + bx) / 2; return `M${ax} ${ay} H${mid} V${by} H${bx}`; }
      const mid = (ay + by) / 2; return `M${ax} ${ay} V${mid} H${bx} V${by}`;
    }
    return `M${ax} ${ay} L${bx} ${by}`;
  };
  const shapeMarkup = (node) => {
    const width = number(node.width, 160); const height = number(node.height, 76); const style = node.style || {};
    const fill = escapeHtml(style.fill || "#ffffff"); const stroke = escapeHtml(style.stroke || "#475569");
    const strokeWidth = Math.max(.5, number(style.strokeWidth, 1.5)); const opacity = Math.max(0, Math.min(1, number(style.opacity, 1)));
    const dash = style.strokeStyle === "dashed" ? ' stroke-dasharray="7 5"' : style.strokeStyle === "dotted" ? ' stroke-dasharray="2 4"' : "";
    const common = `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" stroke-linejoin="round"${dash}`;
    if (node.type === "text") return "";
    if (node.type === "terminator") return `<rect width="${width}" height="${height}" rx="${height / 2}" ${common}/>`;
    if (node.type === "input") return `<polygon points="${width * .13},0 ${width},0 ${width * .87},${height} 0,${height}" ${common}/>`;
    if (node.type === "decision") return `<polygon points="${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}" ${common}/>`;
    if (node.type === "document") return `<path d="M0 0H${width}V${height * .78} C${width * .76} ${height * .58},${width * .58} ${height},${width * .34} ${height * .82} C${width * .2} ${height * .72},${width * .1} ${height * .78},0 ${height * .9}Z" ${common}/>`;
    if (node.type === "database") return `<path d="M0 ${height * .14} C0 ${-height * .02},${width} ${-height * .02},${width} ${height * .14} V${height * .86} C${width} ${height * 1.02},0 ${height * 1.02},0 ${height * .86}Z" ${common}/><ellipse cx="${width / 2}" cy="${height * .14}" rx="${width / 2}" ry="${height * .14}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    if (node.type === "manual") return `<polygon points="${width * .16},0 ${width},0 ${width * .86},${height} 0,${height}" ${common}/>`;
    if (node.type === "preparation") return `<polygon points="${width * .15},0 ${width * .85},0 ${width},${height / 2} ${width * .85},${height} ${width * .15},${height} 0,${height / 2}" ${common}/>`;
    if (node.type === "onpage") return `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" ${common}/>`;
    if (node.type === "offpage") return `<polygon points="0,0 ${width},0 ${width},${height * .66} ${width / 2},${height} 0,${height * .66}" ${common}/>`;
    if (node.type === "delay") return `<path d="M0 0H${width * .52} C${width * 1.12} 0,${width * 1.12} ${height},${width * .52} ${height}H0Z" ${common}/>`;
    const radius = Math.max(0, number(style.cornerRadius));
    const inset = node.type === "predefined" ? `<path d="M${width * .12} 0V${height} M${width * .88} 0V${height}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>` : "";
    return `<rect width="${width}" height="${height}" rx="${radius}" ${common}/>${inset}`;
  };
  function previewMarkup(projectId) {
    const data = safeParse(localStorage.getItem(projectKey(projectId)), null); const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
    if (!nodes.length) return '<span class="blank-preview">Blank canvas</span>';
    const edges = Array.isArray(data.edges) ? data.edges : []; const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const minX = Math.min(...nodes.map((node) => number(node.x))); const minY = Math.min(...nodes.map((node) => number(node.y)));
    const maxX = Math.max(...nodes.map((node) => number(node.x) + number(node.width, 160))); const maxY = Math.max(...nodes.map((node) => number(node.y) + number(node.height, 76)));
    const padding = Math.max(28, Math.min(90, Math.max(maxX - minX, maxY - minY) * .06));
    const viewBox = `${minX - padding} ${minY - padding} ${Math.max(1, maxX - minX + padding * 2)} ${Math.max(1, maxY - minY + padding * 2)}`;
    const edgeMarkup = edges.map((edge) => {
      const path = connectorPath(edge, nodesById); if (!path) return ""; const style = edge.style || {};
      const dash = style.strokeStyle === "dashed" ? ' stroke-dasharray="7 5"' : style.strokeStyle === "dotted" ? ' stroke-dasharray="2 4"' : "";
      return `<path d="${path}" fill="none" stroke="${escapeHtml(style.stroke || "#475569")}" stroke-width="${Math.max(.5, number(style.strokeWidth, 1.5))}"${dash} marker-end="url(#preview-arrow)"/>`;
    }).join("");
    const nodeMarkup = [...nodes].sort((a, b) => number(a.zIndex) - number(b.zIndex)).map((node) => {
      const width = number(node.width, 160); const height = number(node.height, 76); const style = node.style || {}; const fontSize = Math.max(8, number(style.fontSize, 14));
      const transform = `translate(${number(node.x)} ${number(node.y)}) rotate(${number(node.rotation)} ${width / 2} ${height / 2})`;
      const label = String(node.text || "").replace(/\s+/g, " ").trim();
      const text = label ? `<text x="${width / 2}" y="${height / 2 + fontSize * .34}" text-anchor="middle" fill="${escapeHtml(style.textColor || "#1f2937")}" font-size="${fontSize}" font-family="Inter,system-ui,sans-serif">${escapeHtml(label.length > 42 ? `${label.slice(0, 41)}…` : label)}</text>` : "";
      return `<g data-preview-node="${escapeHtml(node.id || "")}" transform="${transform}">${shapeMarkup(node)}${text}</g>`;
    }).join("");
    return `<svg class="project-preview-graphic" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Flowchart preview"><defs><marker id="preview-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="context-stroke"/></marker></defs><g>${edgeMarkup}${nodeMarkup}</g></svg>`;
  }
  function render() {
    const all = loadLibrary(); const query = refs.search.value.trim().toLowerCase();
    const projects = all.filter((item) => !query || String(item.title).toLowerCase().includes(query));
    refs.count.textContent = `${all.length} ${all.length === 1 ? "flowchart" : "flowcharts"}`; refs.grid.replaceChildren(); refs.empty.hidden = all.length !== 0 || Boolean(query);
    if (!projects.length && query) { const empty = document.createElement("p"); empty.className = "library-no-results"; empty.textContent = `No flowcharts match “${refs.search.value.trim()}”.`; refs.grid.append(empty); return; }
    projects.forEach((project, index) => {
      const card = document.createElement("article"); card.className = "project-card simple-project-card"; card.dataset.projectId = project.id;
      card.innerHTML = `<button type="button" class="project-open" data-open-project="${escapeHtml(project.id)}" aria-label="Open ${escapeHtml(project.title)}">
        <span class="project-preview premium-preview">${previewMarkup(project.id)}</span>
        <span class="project-card-copy"><strong>${escapeHtml(project.title || "Untitled Flowchart")}</strong><small>${relativeDate(project.updatedAt)} · ${Number(project.nodeCount) || 0} shapes</small></span></button>
        <details class="project-options">
          <summary aria-label="Options for ${escapeHtml(project.title || "Untitled Flowchart")}" title="Project options">•••</summary>
          <div class="project-options-menu"><button type="button" data-duplicate-project="${escapeHtml(project.id)}">Duplicate</button><button type="button" class="project-delete" data-delete-project="${escapeHtml(project.id)}">Delete</button></div>
        </details>`;
      card.style.setProperty("--card-index", index); refs.grid.append(card);
    });
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-new-project]")) return createProject();
    if (event.target.closest("[data-import-project]")) return refs.file.click();
    if (event.target.closest("[data-home-theme]")) {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next; document.documentElement.dataset.themePreference = next; localStorage.setItem("flowchart-creator-theme", next); return;
    }
    const open = event.target.closest("[data-open-project]"); const duplicate = event.target.closest("[data-duplicate-project]"); const remove = event.target.closest("[data-delete-project]");
    if (open) openProject(open.dataset.openProject); else if (duplicate) duplicateProject(duplicate.dataset.duplicateProject); else if (remove) deleteProject(remove.dataset.deleteProject);
  });
  refs.search.addEventListener("input", render);
  refs.file.addEventListener("change", async () => {
    const file = refs.file.files[0]; refs.file.value = ""; if (!file) return;
    try { const data = JSON.parse(await file.text()); if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error(); createProject(data); }
    catch { showToast("Choose a valid Nodes JSON project", "error"); }
  });
  window.addEventListener("storage", render); render();
})();
