(() => {
  "use strict";

  const LIBRARY_KEY = "nodes-project-library-v1";
  const PROJECT_PREFIX = "nodes-project-v1:";
  const CHECKPOINT_PREFIX = "nodes-checkpoint-v1:";
  const refs = {
    grid: document.querySelector("#project-grid"),
    empty: document.querySelector("#library-empty"),
    count: document.querySelector("#project-count"),
    search: document.querySelector("#project-search"),
    modal: document.querySelector("#new-project-modal"),
    form: document.querySelector("#new-project-form"),
    name: document.querySelector("#new-project-name"),
    file: document.querySelector("#library-file-input"),
    toasts: document.querySelector("#toast-region")
  };

  const makeId = () => globalThis.crypto?.randomUUID?.() || `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const projectKey = (id) => `${PROJECT_PREFIX}${id}`;
  const checkpointKey = (id) => `${CHECKPOINT_PREFIX}${id}`;
  const safeParse = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

  function loadLibrary() {
    const items = safeParse(localStorage.getItem(LIBRARY_KEY) || "[]", []);
    return Array.isArray(items) ? items.filter((item) => item?.id).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) : [];
  }

  function saveLibrary(items) {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(items));
  }

  function relativeDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Recently edited";
    const delta = Math.max(0, Date.now() - date.getTime());
    if (delta < 60_000) return "Edited just now";
    if (delta < 3_600_000) return `Edited ${Math.floor(delta / 60_000)}m ago`;
    if (delta < 86_400_000) return `Edited ${Math.floor(delta / 3_600_000)}h ago`;
    return `Edited ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" })}`;
  }

  function openProject(id) {
    location.href = `editor.html?project=${encodeURIComponent(id)}`;
  }

  function showToast(message, tone = "neutral") {
    const toast = document.createElement("div");
    toast.className = `toast-message alert ${tone === "error" ? "alert-error" : "alert-success"}`;
    toast.innerHTML = `<span class="toast-dot" aria-hidden="true"></span><span>${escapeHtml(message)}</span>`;
    refs.toasts.append(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));
    setTimeout(() => { toast.classList.remove("visible"); setTimeout(() => toast.remove(), 180); }, 2600);
  }

  function render() {
    const all = loadLibrary();
    const query = refs.search.value.trim().toLowerCase();
    const projects = all.filter((item) => !query || String(item.title).toLowerCase().includes(query));
    refs.count.textContent = `${all.length} ${all.length === 1 ? "project" : "projects"} on this device`;
    refs.grid.replaceChildren();
    refs.empty.hidden = all.length !== 0 || Boolean(query);

    if (!projects.length && query) {
      const noResults = document.createElement("div");
      noResults.className = "library-no-results";
      noResults.textContent = `No flowcharts match “${refs.search.value.trim()}”.`;
      refs.grid.append(noResults);
      return;
    }

    projects.forEach((project) => {
      const card = document.createElement("article");
      card.className = "project-card";
      card.dataset.projectId = project.id;
      card.innerHTML = `
        <button type="button" class="project-open" data-open-project="${escapeHtml(project.id)}" aria-label="Open ${escapeHtml(project.title)}">
          <span class="project-preview" aria-hidden="true"><i></i><i></i><i></i><b></b><b></b></span>
          <span class="project-card-copy"><strong>${escapeHtml(project.title || "Untitled Flowchart")}</strong><small>${relativeDate(project.updatedAt)}</small></span>
        </button>
        <div class="project-card-footer">
          <span>${Number(project.nodeCount) || 0} shapes</span>
          <div class="project-card-actions">
            <button type="button" class="btn btn-sm btn-text" data-duplicate-project="${escapeHtml(project.id)}" title="Duplicate flowchart">Duplicate</button>
            <button type="button" class="btn btn-sm btn-text project-delete" data-delete-project="${escapeHtml(project.id)}" title="Delete local flowchart">Delete</button>
          </div>
        </div>`;
      refs.grid.append(card);
    });
  }

  function setModal(open) {
    refs.modal.classList.toggle("hidden", !open);
    refs.modal.classList.toggle("overlay-open", open);
    if (open) {
      refs.name.value = "Untitled Flowchart";
      requestAnimationFrame(() => { refs.name.focus(); refs.name.select(); });
    }
  }

  function createProject(title, data = null) {
    const id = makeId();
    const now = new Date().toISOString();
    const cleanTitle = String(title || "Untitled Flowchart").trim() || "Untitled Flowchart";
    const library = loadLibrary();
    library.unshift({ id, title: cleanTitle, createdAt: now, updatedAt: now, nodeCount: Array.isArray(data?.nodes) ? data.nodes.length : 8 });
    saveLibrary(library);
    if (data) {
      data.documentTitle = cleanTitle;
      localStorage.setItem(projectKey(id), JSON.stringify(data));
    }
    openProject(id);
  }

  function duplicateProject(id) {
    const source = loadLibrary().find((item) => item.id === id);
    if (!source) return;
    const data = safeParse(localStorage.getItem(projectKey(id)), null);
    const newId = makeId();
    const now = new Date().toISOString();
    const title = `${source.title || "Untitled Flowchart"} copy`;
    const library = loadLibrary();
    library.unshift({ ...source, id: newId, title, createdAt: now, updatedAt: now });
    saveLibrary(library);
    if (data) { data.documentTitle = title; localStorage.setItem(projectKey(newId), JSON.stringify(data)); }
    const checkpoint = localStorage.getItem(checkpointKey(id));
    if (checkpoint) localStorage.setItem(checkpointKey(newId), checkpoint);
    render();
    showToast("Flowchart duplicated");
  }

  function deleteProject(id) {
    const project = loadLibrary().find((item) => item.id === id);
    if (!project || !confirm(`Delete “${project.title}” from this browser? This cannot be undone.`)) return;
    saveLibrary(loadLibrary().filter((item) => item.id !== id));
    localStorage.removeItem(projectKey(id));
    localStorage.removeItem(checkpointKey(id));
    render();
    showToast("Local flowchart deleted");
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-new-project]")) setModal(true);
    if (event.target.closest("[data-close-new-project]")) setModal(false);
    const open = event.target.closest("[data-open-project]");
    const duplicate = event.target.closest("[data-duplicate-project]");
    const remove = event.target.closest("[data-delete-project]");
    if (open) openProject(open.dataset.openProject);
    if (duplicate) duplicateProject(duplicate.dataset.duplicateProject);
    if (remove) deleteProject(remove.dataset.deleteProject);
    if (event.target.closest("[data-import-project]")) refs.file.click();
    if (event.target === refs.modal) setModal(false);
  });
  refs.form.addEventListener("submit", (event) => { event.preventDefault(); createProject(refs.name.value); });
  refs.search.addEventListener("input", render);
  refs.file.addEventListener("change", async () => {
    const file = refs.file.files[0]; refs.file.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error("Invalid project");
      createProject(data.documentTitle || file.name.replace(/\.json$/i, ""), data);
    } catch { showToast("That file is not a valid Nodes JSON project", "error"); }
  });
  window.addEventListener("storage", render);
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") setModal(false); });
  render();
})();
