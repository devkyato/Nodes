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
  function render() {
    const all = loadLibrary(); const query = refs.search.value.trim().toLowerCase();
    const projects = all.filter((item) => !query || String(item.title).toLowerCase().includes(query));
    refs.count.textContent = `${all.length} ${all.length === 1 ? "flowchart" : "flowcharts"}`; refs.grid.replaceChildren(); refs.empty.hidden = all.length !== 0 || Boolean(query);
    if (!projects.length && query) { const empty = document.createElement("p"); empty.className = "library-no-results"; empty.textContent = `No flowcharts match “${refs.search.value.trim()}”.`; refs.grid.append(empty); return; }
    projects.forEach((project, index) => {
      const card = document.createElement("article"); card.className = "project-card simple-project-card"; card.dataset.projectId = project.id;
      card.innerHTML = `<button type="button" class="project-open" data-open-project="${escapeHtml(project.id)}" aria-label="Open ${escapeHtml(project.title)}">
        <span class="project-preview premium-preview" aria-hidden="true"><span class="preview-node one"></span><span class="preview-node two"></span><span class="preview-node three"></span><i></i><b></b></span>
        <span class="project-card-copy"><strong>${escapeHtml(project.title || "Untitled Flowchart")}</strong><small>${relativeDate(project.updatedAt)} · ${Number(project.nodeCount) || 0} shapes</small></span></button>
        <div class="project-card-actions"><button type="button" data-duplicate-project="${escapeHtml(project.id)}">Duplicate</button><button type="button" class="project-delete" data-delete-project="${escapeHtml(project.id)}">Delete</button></div>`;
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
