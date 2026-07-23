import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const browserCandidates = process.platform === "win32"
  ? [
      process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
      process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Microsoft/Edge/Application/msedge.exe")
    ]
  : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const browserPath = browserCandidates.find((candidate) => candidate && existsSync(candidate));

if (!browserPath) {
  console.error("Browser smoke test requires Chrome, Edge, or Chromium.");
  process.exit(1);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForJson(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class DevToolsClient {
  constructor(url) {
    this.url = url;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.errors = [];
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", ({ data }) => this.onMessage(JSON.parse(data)));
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  onMessage(message) {
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") this.errors.push(message.params.exceptionDetails.text);
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") this.errors.push(message.params.entry.text);
    const listeners = this.listeners.get(message.method) || [];
    listeners.splice(0).forEach((resolve) => resolve(message.params));
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  wait(method, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout);
      const listeners = this.listeners.get(method) || [];
      listeners.push((params) => { clearTimeout(timer); resolve(params); });
      this.listeners.set(method, listeners);
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }

  close() { this.socket.close(); }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const serverPort = await freePort();
const debugPort = await freePort();
const profile = mkdtempSync(join(tmpdir(), "flowchart-browser-"));
const server = spawn(process.execPath, [join(root, "scripts/serve.mjs")], { cwd: root, env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore" });
const browser = spawn(browserPath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--no-sandbox",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"
], { stdio: "ignore" });

let client;
try {
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
  const page = targets.find((target) => target.type === "page");
  assert(page?.webSocketDebuggerUrl, "Browser page target was not available");
  client = new DevToolsClient(page.webSocketDebuggerUrl);
  await client.connect();
  await Promise.all([client.send("Page.enable"), client.send("Runtime.enable"), client.send("Log.enable")]);
  const loaded = client.wait("Page.loadEventFired");
  await client.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/editor.html?project=browser-smoke` });
  await loaded;

  const initial = await client.evaluate(`({
    title: document.title,
    textLength: document.body.innerText.trim().length,
    shapes: document.querySelectorAll('.shape-item').length,
    nodes: document.querySelectorAll('#node-layer .node').length,
    edges: document.querySelectorAll('#edge-layer .edge').length,
    canvasWidth: document.querySelector('.workspace-bg').getAttribute('width'),
    canvasHeight: document.querySelector('.workspace-bg').getAttribute('height'),
    canvasStatus: document.querySelector('#canvas-size-status').textContent,
    overlay: Boolean(document.querySelector('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay'))
  })`);
  assert(initial.title === "Editor · Nodes", "Document title is incorrect");
  assert(initial.textLength > 50, "Page content is unexpectedly blank");
  assert(initial.shapes === 12, "Shape palette did not render all symbols");
  assert(initial.nodes === 8 && initial.edges === 7, "Starter diagram did not render correctly");
  assert(initial.canvasWidth === "794" && initial.canvasHeight === "1123" && initial.canvasStatus === "1 A4 page", `Initial A4 canvas is incorrect: ${JSON.stringify(initial)}`);
  assert(!initial.overlay, "An error overlay is visible");

  const navigation = await client.evaluate(`(() => {
    const canvas = document.querySelector('#canvas');
    const viewport = document.querySelector('#viewport');
    const before = viewport.getAttribute('transform');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    const panMode = document.querySelector('#canvas-shell').dataset.mode;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    const afterKeys = viewport.getAttribute('transform');
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true }));
    const afterWheel = viewport.getAttribute('transform');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    const gridHidden = document.querySelector('.grid').hasAttribute('hidden');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    return { before, panMode, afterKeys, afterWheel, gridHidden, gridVisibleAgain: !document.querySelector('.grid').hasAttribute('hidden') };
  })()`);
  assert(navigation.panMode === "pan", "H did not activate the pan tool");
  assert(navigation.before !== navigation.afterKeys && navigation.afterKeys !== navigation.afterWheel, "Keyboard and wheel panning did not update the viewport");
  assert(navigation.gridHidden && navigation.gridVisibleAgain, "G did not toggle the grid");
  await client.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }))`);

  const codeStudio = await client.evaluate(`(() => {
    document.querySelector(".code-studio-action").click();
    const sidebar = document.querySelector("#code-sidebar");
    const visible = !sidebar.classList.contains("hidden");
    const pseudo = document.querySelector("#code-output").textContent;
    const issues = document.querySelector("#code-issues").textContent;
    document.querySelector('[data-code-language="python"]').click();
    const python = document.querySelector("#code-output").textContent;
    document.querySelector('[data-code-language="cpp"]').click();
    const cpp = document.querySelector("#code-output").textContent;
    document.querySelector("#flow-text-input").value = "start\\nask Your name?\\ninput name\\nprocess Greet name\\ndisplay name\\nend";
    document.querySelector("#flow-text-input").dispatchEvent(new Event("input", { bubbles: true }));
    const recognizedSteps = document.querySelectorAll(".recognized-step").length;
    const liveCode = document.querySelector("#code-output").textContent;
    document.querySelector('[data-code-language="python"]').click();
    const livePython = document.querySelector("#code-output").textContent;
    document.querySelector('[data-code-language="cpp"]').click();
    const liveCpp = document.querySelector("#code-output").textContent;
    document.querySelector('[data-code-action="apply-text"]').click();
    const textNodes = document.querySelectorAll("#node-layer .node").length;
    const textEdges = document.querySelectorAll("#edge-layer .edge").length;
    const textApplied = document.querySelector("#node-layer").textContent;
    document.querySelector('[data-action="undo"]').click();
    document.querySelector('[data-inspector-tab="design"]').click();
    const singlePage = document.querySelector("#canvas-size-status").textContent;
    return { visible, pseudo, python, cpp, issues, textNodes, textEdges, textApplied, recognizedSteps, liveCode, livePython, liveCpp, singlePage, modalRemoved: !document.querySelector("#code-modal") };
  })()`);
  assert(codeStudio.visible, "Code Studio did not open");
  assert(/ready to generate/i.test(codeStudio.issues), "Flow validation did not report a healthy graph");
  assert(/PROGRAM untitled_flowchart/.test(codeStudio.pseudo), "Pseudocode was not generated");
  assert(/gross_pay/i.test(codeStudio.pseudo), "Pseudocode omitted the calculated value");
  assert(/def run_flowchart\(\):/.test(codeStudio.python), "Python was not generated");
  assert(/gross_pay = hours \* pay_rate/.test(codeStudio.python), "Python omitted the calculation");
  assert(/int main\(\)/.test(codeStudio.cpp), "C++ was not generated");
  assert(/gross_pay = hours \* pay_rate;/.test(codeStudio.cpp), "C++ omitted the calculation");
  assert(codeStudio.textNodes === 6 && codeStudio.textEdges === 5, "Text flow did not rebuild the diagram");
  assert(/Your name/.test(codeStudio.textApplied), "Text flow content was not rendered");
  assert(codeStudio.recognizedSteps === 6 && /Your name/.test(codeStudio.liveCode), "Live text recognition did not update the preview and code");
  assert(/def run_flowchart/.test(codeStudio.livePython) && /int main/.test(codeStudio.liveCpp), "Live Python and C++ previews did not update");
  assert(codeStudio.singlePage === "1 A4 page", `Text flow did not scale to one A4 page: ${codeStudio.singlePage}`);
  assert(codeStudio.modalRemoved, "Legacy Code Studio modal is still mounted");

  const theme = await client.evaluate(`(() => {
    const before = document.documentElement.dataset.theme;
    const choice = before === 'dark' ? 'light' : 'dark';
    document.querySelector('[data-theme-value="' + choice + '"]').click();
    const after = document.documentElement.dataset.theme;
    const saved = localStorage.getItem('flowchart-creator-theme');
    const label = document.querySelector('#theme-toggle').getAttribute('aria-label');
    document.querySelector('[data-theme-value="system"]').click();
    return { before, after, saved, label, choice };
  })()`);
  assert(theme.before !== theme.after && theme.saved === theme.choice, "Theme switching did not persist");
  assert(theme.label.toLowerCase().includes(theme.choice), "Theme menu label did not update");

  const uiSystem = await client.evaluate(`(() => {
    document.querySelector('button[title="Settings"]').click();
    const settingsVisible = !document.querySelector('#settings-modal').classList.contains('hidden');
    document.querySelector('[data-settings-tab="canvas"]').click();
    const grid = document.querySelector('#settings-grid-toggle');
    grid.checked = false; grid.dispatchEvent(new Event('change', { bubbles: true }));
    const gridHidden = document.querySelector('.grid').hasAttribute('hidden');
    grid.checked = true; grid.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-settings-tab="behavior"]').click();
    const connector = document.querySelector('#default-connector');
    connector.value = 'curved'; connector.dispatchEvent(new Event('change', { bubbles: true }));
    const arrow = document.querySelector('#default-arrow');
    arrow.value = 'diamond'; arrow.dispatchEvent(new Event('change', { bubbles: true }));
    const motion = document.querySelector('#reduced-motion-toggle');
    motion.checked = true; motion.dispatchEvent(new Event('change', { bubbles: true }));
    const reduced = document.documentElement.dataset.reduceMotion === 'true';
    motion.checked = false; motion.dispatchEvent(new Event('change', { bubbles: true }));
    const stored = JSON.parse(localStorage.getItem('flowchart-creator-settings-v1'));
    connector.value = 'straight'; connector.dispatchEvent(new Event('change', { bubbles: true }));
    arrow.value = 'arrow'; arrow.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-overlay="#settings-modal"].btn-primary').click();
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'k' }));
    const commandVisible = !document.querySelector('#command-modal').classList.contains('hidden');
    const search = document.querySelector('#command-search');
    search.value = 'settings'; search.dispatchEvent(new Event('input', { bubbles: true }));
    const visibleCommands = [...document.querySelectorAll('#command-list button')].filter((button) => !button.hidden).length;
    document.querySelector('[data-command-settings]').click();
    const routedToSettings = !document.querySelector('#settings-modal').classList.contains('hidden') && document.querySelector('#command-modal').classList.contains('hidden');
    document.querySelector('[aria-label="Close settings"]').click();
    return { settingsVisible, gridHidden, reduced, stored, commandVisible, visibleCommands, routedToSettings };
  })()`);
  assert(uiSystem.settingsVisible && uiSystem.gridHidden && uiSystem.reduced, `Settings modal did not control the workspace: ${JSON.stringify(uiSystem)}`);
  assert(uiSystem.stored.defaultConnector === "curved" && uiSystem.stored.defaultArrow === "diamond", "Editor preferences did not persist");
  assert(uiSystem.commandVisible && uiSystem.visibleCommands === 1 && uiSystem.routedToSettings, "Command menu search or routing failed");

  const nativeMenus = await client.evaluate(`(() => {
    const view = document.querySelector('#view-native').closest('details');
    document.querySelector('#view-native').click();
    const opened = view.open;
    view.querySelector('[data-view-action="grid"]').click();
    const closedAfterAction = !view.open;
    const gridHidden = document.querySelector('.grid').hasAttribute('hidden');
    document.querySelector('#view-native').click();
    view.querySelector('[data-view-action="grid"]').click();
    const exportMenu = document.querySelector('#export-native').closest('details');
    document.querySelector('#export-native').click();
    const exportOpened = exportMenu.open;
    document.body.click();
    return { opened, closedAfterAction, gridHidden, exportOpened, closedOutside: !exportMenu.open };
  })()`);
  assert(nativeMenus.opened && nativeMenus.closedAfterAction && nativeMenus.gridHidden && nativeMenus.exportOpened && nativeMenus.closedOutside, `Native editor menus failed: ${JSON.stringify(nativeMenus)}`);

  const connectionResult = await client.evaluate(`(() => {
    document.querySelector('[data-mode="connect"]').click();
    const svg = document.querySelector('#canvas');
    svg.setPointerCapture = () => {};
    const nodes = [...document.querySelectorAll('#node-layer .node')];
    const center = (element) => { const box = element.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
    const fromElement = document.querySelector('[data-port-node="' + nodes[0].dataset.nodeId + '"][data-port="bottom"]');
    const toElement = document.querySelector('[data-port-node="' + nodes[1].dataset.nodeId + '"][data-port="top"]');
    const from = center(fromElement);
    const to = center(toElement);
    fromElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: from.x, clientY: from.y, button: 0, pointerId: 1 }));
    svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: to.x, clientY: to.y, button: 0, pointerId: 1 }));
    svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: to.x, clientY: to.y, button: 0, pointerId: 1 }));
    return { edges: document.querySelectorAll('#edge-layer .edge').length, status: document.querySelector('#status-text').textContent };
  })()`);
  assert(connectionResult.edges === 8, `Connector creation failed: ${JSON.stringify(connectionResult)} ${client.errors.join("; ")}`);
  await client.evaluate("document.querySelector('[data-action=\"undo\"]').click()");
  assert(await client.evaluate("document.querySelectorAll('#edge-layer .edge').length") === 7, "Connector undo failed");

  const afterAdd = await client.evaluate(`(() => {
    document.querySelector('[data-shape="decision"]').click();
    return {
      nodes: document.querySelectorAll('#node-layer .node').length,
      panel: !document.querySelector('#properties-panel').hidden,
      draft: Boolean(localStorage.getItem('nodes-project-v1:browser-smoke'))
    };
  })()`);
  assert(afterAdd.nodes === 9 && afterAdd.panel && afterAdd.draft, "Adding a shape did not update or autosave the editor");

  const edited = await client.evaluate(`(() => {
    document.querySelector('#node-layer .node:last-child').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const editor = document.querySelector('#inline-editor');
    const opened = getComputedStyle(editor).display !== 'none';
    editor.value = 'Approved?';
    editor.dispatchEvent(new FocusEvent('blur'));
    return { opened, text: document.querySelector('#node-layer .node:last-child text').textContent };
  })()`);
  assert(edited.opened && edited.text.includes("Approved?"), `Inline text editing failed: ${JSON.stringify(edited)}`);

  const customization = await client.evaluate(`(() => {
    document.querySelector('[data-style-preset="ocean"]').click();
    const font = document.querySelector('[data-prop="fontFamily"]');
    font.value = 'mono'; font.dispatchEvent(new Event('change', { bubbles: true }));
    const shadow = document.querySelector('[data-prop="shadow"]');
    shadow.value = 'strong'; shadow.dispatchEvent(new Event('change', { bubbles: true }));
    const rotation = document.querySelector('[data-node-prop="rotation"]');
    rotation.value = '12'; rotation.dispatchEvent(new Event('change', { bubbles: true }));
    const node = document.querySelector('#node-layer .node:last-child');
    return { fill: node.querySelector('.node-shape')?.getAttribute('fill'), transform: node.getAttribute('transform'), style: node.getAttribute('style'), font: node.querySelector('text')?.getAttribute('font-family') };
  })()`);
  assert(customization.fill === "#dff4ff" && customization.transform.includes("rotate(12") && customization.style.includes("drop-shadow") && customization.font.includes("ui-monospace"), `Premium customization controls failed: ${JSON.stringify(customization)}`);

  const expandedCanvas = await client.evaluate(`(() => {
    const y = document.querySelector('[data-node-prop="y"]');
    y.value = '1180'; y.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      height: document.querySelector('.workspace-bg').getAttribute('height'),
      pages: document.querySelector('#canvas-size-status').textContent
    };
  })()`);
  assert(expandedCanvas.height === "2246" && expandedCanvas.pages === "2 A4 pages", `Canvas did not expand by an A4 page: ${JSON.stringify(expandedCanvas)}`);
  await client.evaluate("document.querySelector('[data-action=\"undo\"]').click()");

  const geometryBefore = await client.evaluate(`(() => {
    const node = document.querySelector('#node-layer .node:last-child').getBoundingClientRect();
    const zoom = document.querySelector('#zoom-display').textContent;
    return { x: node.x, y: node.y, width: node.width, height: node.height, zoom };
  })()`);
  await client.evaluate(`(() => {
    const svg = document.querySelector('#canvas');
    const box = document.querySelector('#node-layer .node:last-child').getBoundingClientRect();
    svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -120, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
    const movedBox = document.querySelector('#node-layer .node:last-child').getBoundingClientRect();
    const start = { x: movedBox.x + movedBox.width / 2, y: movedBox.y + movedBox.height / 2 };
    const node = document.querySelector('#node-layer .node:last-child');
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: start.x, clientY: start.y, button: 0, pointerId: 2 }));
    svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: start.x + 35, clientY: start.y + 25, button: 0, pointerId: 2 }));
    svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: start.x + 35, clientY: start.y + 25, button: 0, pointerId: 2 }));
  })()`);
  const geometryMoved = await client.evaluate(`(() => {
    const node = document.querySelector('#node-layer .node:last-child').getBoundingClientRect();
    return { x: node.x, y: node.y, zoom: document.querySelector('#zoom-display').textContent };
  })()`);
  assert(geometryMoved.zoom !== geometryBefore.zoom, "Ctrl+wheel zoom failed");
  assert(geometryMoved.x > geometryBefore.x + 15 && geometryMoved.y > geometryBefore.y + 10, "Dragging after zoom failed");

  const resizeStart = await client.evaluate(`(() => {
    const svg = document.querySelector('#canvas');
    const handle = document.querySelector('[data-handle="se"]');
    const box = handle.getBoundingClientRect();
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const width = document.querySelector('#node-layer .node:last-child').getBoundingClientRect().width;
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: start.x, clientY: start.y, button: 0, pointerId: 3 }));
    svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: start.x + 40, clientY: start.y + 30, button: 0, pointerId: 3 }));
    svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: start.x + 40, clientY: start.y + 30, button: 0, pointerId: 3 }));
    return { ...start, width };
  })()`);
  const resizedWidth = await client.evaluate("document.querySelector('#node-layer .node:last-child').getBoundingClientRect().width");
  assert(resizedWidth > resizeStart.width + 15, "Resize handles failed after zoom");

  const clarityControls = await client.evaluate(`(() => {
    const toolbar = document.querySelector('#context-toolbar');
    const initiallyVisible = !toolbar.hidden;
    toolbar.querySelector('[data-context-action="lock"]').click();
    const locked = document.querySelector('#node-layer .node:last-child').dataset.locked === 'true';
    const handlesWhileLocked = document.querySelectorAll('[data-resize-id]').length;
    toolbar.querySelector('[data-context-action="lock"]').click();
    document.querySelector('[data-view-action="grid"]').click();
    const gridHidden = document.querySelector('.grid').hasAttribute('hidden');
    document.querySelector('[data-view-action="grid"]').click();
    document.querySelector('#project-menu').click();
    document.querySelector('#theme-toggle').click();
    const openMenus = [...document.querySelectorAll('.toolbar .dropdown-menu')].filter((menu) => !menu.classList.contains('hidden')).length;
    document.querySelector('#shape-search').value = 'decision';
    document.querySelector('#shape-search').dispatchEvent(new Event('input', { bubbles: true }));
    const visibleShapes = [...document.querySelectorAll('.shape-item')].filter((item) => !item.hidden).length;
    return { initiallyVisible, locked, handlesWhileLocked, gridHidden, openMenus, visibleShapes };
  })()`);
  assert(clarityControls.initiallyVisible && clarityControls.locked && clarityControls.handlesWhileLocked === 0, "Selection quick actions or shape locking failed");
  assert(clarityControls.gridHidden && clarityControls.openMenus === 1 && clarityControls.visibleShapes === 1, "View controls, menu clarity, or shape search failed");
  await client.evaluate(`(() => { const search = document.querySelector('#shape-search'); search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); })()`);

  const history = await client.evaluate(`(() => {
    document.querySelector('[data-context-action="duplicate"]').click();
    const duplicated = document.querySelectorAll('#node-layer .node').length;
    document.querySelector('[data-action="undo"]').click();
    const undone = document.querySelectorAll('#node-layer .node').length;
    document.querySelector('[data-action="redo"]').click();
    const redone = document.querySelectorAll('#node-layer .node').length;
    document.querySelector('button[title="Clear canvas"]').click();
    const modalVisible = !document.querySelector('#clear-canvas-modal').classList.contains('hidden');
    document.querySelector('[data-confirm-clear]').click();
    const cleared = document.querySelectorAll('#node-layer .node').length;
    const hint = document.querySelector('.empty-hint')?.textContent;
    document.querySelector('[data-action="undo"]').click();
    return { duplicated, undone, redone, modalVisible, cleared, restored: document.querySelectorAll('#node-layer .node').length, hint };
  })()`);
  assert(history.duplicated === 10 && history.undone === 9 && history.redone === 10, "Duplicate or history controls failed");
  assert(history.modalVisible && history.cleared === 0 && history.restored === 10 && history.hint?.includes("Add a shape"), "Clear confirmation or restore behavior failed");

  const persistence = await client.evaluate(`(() => {
    document.querySelector('[data-action="save"]').click();
    document.querySelector('button[title="Clear canvas"]').click();
    document.querySelector('[data-confirm-clear]').click();
    const cleared = document.querySelectorAll('#node-layer .node').length;
    document.querySelector('[data-action="load"]').click();
    return { cleared, loaded: document.querySelectorAll('#node-layer .node').length };
  })()`);
  assert(persistence.cleared === 0 && persistence.loaded === 10, "Local save and load failed");

  const edgeLabel = await client.evaluate(`(() => {
    const edge = document.querySelector('#edge-layer .edge');
    edge.querySelector('.edge-hit').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 4 }));
    const input = document.querySelector('[data-edge-prop="label"]');
    input.value = 'Approved path';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return document.querySelector('#edge-layer .edge .edge-label')?.textContent;
  })()`);
  assert(edgeLabel === "Approved path", "Connector label editing failed");

  await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: profile });
  await client.evaluate(`(() => {
    document.querySelector('[data-action="download-xml"]').click();
    document.querySelector('[data-action="export-svg"]').click();
    document.querySelector('[data-action="export-png"]').click();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const downloads = readdirSync(profile);
  const svgDownload = downloads.find((name) => name.endsWith(".svg"));
  const xmlDownload = downloads.find((name) => name.endsWith(".xml"));
  assert(svgDownload, "SVG export did not download");
  assert(xmlDownload, "XML project export did not download");
  assert(downloads.some((name) => name.endsWith(".png")), "PNG export did not download");
  const exportedSvg = readFileSync(join(profile, svgDownload), "utf8");
  const exportedXml = readFileSync(join(profile, xmlDownload), "utf8");
  assert(exportedSvg.includes("Approved path") && exportedSvg.includes('fill="#ffffff"'), "SVG export did not preserve connector label styling");
  assert(!exportedSvg.includes("edge-hit"), "SVG export included editor-only hit targets");
  assert(exportedXml.includes("<flowchart-project") && exportedXml.includes("Approved path"), "XML project export is incomplete");

  const xmlImport = await client.evaluate(`(() => new Promise((resolve) => {
    document.querySelector('button[title="Clear canvas"]').click();
    document.querySelector('[data-confirm-clear]').click();
    const input = document.querySelector('#file-input');
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(exportedXml)}], 'roundtrip.xml', { type: 'application/xml' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const started = Date.now();
    const check = () => {
      const status = document.querySelector('#status-text').textContent;
      if (status.includes('Imported XML') || Date.now() - started > 3000) {
        resolve({ status, nodes: document.querySelectorAll('#node-layer .node').length, edges: document.querySelectorAll('#edge-layer .edge').length });
      } else setTimeout(check, 25);
    };
    check();
  }))()`);
  assert(xmlImport.status.includes("Imported XML") && xmlImport.nodes === 10 && xmlImport.edges === 7, `XML round-trip failed: ${JSON.stringify(xmlImport)}`);

  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobileToolbar = await client.evaluate(`new Promise((resolve) => requestAnimationFrame(() => {
    const controls = [...document.querySelectorAll('.toolbar [data-mode], .premium-toolbar-actions summary')].filter((control) => control.getBoundingClientRect().width > 0);
    resolve(controls.map((control) => {
      const rect = control.getBoundingClientRect();
      return { label: control.getAttribute('aria-label') || control.textContent.trim(), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, visible: getComputedStyle(control).display !== 'none' };
    }));
  }))`);
  assert(mobileToolbar.length >= 4 && mobileToolbar.every((control) => control.visible && control.width >= 20 && control.height >= 20 && control.left >= 0 && control.right <= 390 && control.top >= 0 && control.bottom <= 104), `Mobile toolbar controls are clipped: ${JSON.stringify(mobileToolbar)}`);

  await client.send("Emulation.clearDeviceMetricsOverride");
  const homeLoaded = client.wait("Page.loadEventFired");
  await client.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/` });
  await homeLoaded;
  const library = await client.evaluate(`(() => {
    const card = document.querySelector('[data-project-id="browser-smoke"]');
    const originalCount = document.querySelectorAll('.project-card').length;
    card.querySelector('[data-duplicate-project]').click();
    const duplicatedCount = document.querySelectorAll('.project-card').length;
    const search = document.querySelector('#project-search');
    search.value = 'no such flowchart';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const noResults = Boolean(document.querySelector('.library-no-results'));
    const preview = card.querySelector('.project-preview-graphic');
    const previewRect = preview?.getBoundingClientRect(); const frameRect = preview?.parentElement.getBoundingClientRect();
    return { title: document.title, card: Boolean(card), originalCount, duplicatedCount, noResults, noModal: !document.querySelector('#new-project-modal'), addButton: Boolean(document.querySelector('[data-new-project]')), preview: Boolean(preview), previewNodes: preview?.querySelectorAll('[data-preview-node]').length || 0, previewContained: Boolean(previewRect && frameRect && previewRect.height <= frameRect.height && previewRect.width <= frameRect.width), projectOptions: Boolean(card.querySelector('.project-options')), textOnlyBrand: document.querySelector('.library-brand')?.textContent.trim() === 'nodes_' && !document.querySelector('.library-brand .brand-icon'), localSaveCopy: document.body.innerText.includes('Saved on this device') };
  })()`);
  assert(library.title === "Nodes · Your flowcharts" && library.card, `Project library did not render: ${JSON.stringify(library)}`);
  assert(library.duplicatedCount === library.originalCount + 1 && library.noModal && library.addButton && library.noResults, "Project library controls failed");
  assert(library.preview && library.previewNodes === 10 && library.previewContained && library.projectOptions && library.textOnlyBrand && !library.localSaveCopy, `Project previews or simplified header failed: ${JSON.stringify(library)}`);
  const instantProjectLoaded = client.wait("Page.loadEventFired");
  await client.evaluate(`(() => { const search = document.querySelector('#project-search'); search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-new-project]').click(); })()`);
  await instantProjectLoaded;
  const instantProject = await client.evaluate(`({ title: document.title, projectUrl: location.search.includes('project='), nodes: document.querySelectorAll('#node-layer .node').length })`);
  assert(instantProject.title === "Editor · Nodes" && instantProject.projectUrl && instantProject.nodes === 0, `Add flowchart was not immediate and blank: ${JSON.stringify(instantProject)}`);
  assert(client.errors.length === 0, `Browser errors: ${client.errors.join("; ")}`);

  console.log("Browser smoke test passed: local project library, settings, commands, themes, locking, menus, modals, rendering, connectors, persistence, XML/JSON projects, and SVG/PNG export.");
} finally {
  client?.close();
  browser.kill();
  server.kill();
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 250).unref();
}
