import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
  await client.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}` });
  await loaded;

  const initial = await client.evaluate(`({
    title: document.title,
    textLength: document.body.innerText.trim().length,
    shapes: document.querySelectorAll('.shape-item').length,
    nodes: document.querySelectorAll('#node-layer .node').length,
    edges: document.querySelectorAll('#edge-layer .edge').length,
    overlay: Boolean(document.querySelector('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay'))
  })`);
  assert(initial.title === "Flowchart Creator", "Document title is incorrect");
  assert(initial.textLength > 50, "Page content is unexpectedly blank");
  assert(initial.shapes === 12, "Shape palette did not render all symbols");
  assert(initial.nodes === 8 && initial.edges === 7, "Starter diagram did not render correctly");
  assert(!initial.overlay, "An error overlay is visible");

  const afterAdd = await client.evaluate(`(() => {
    document.querySelector('[data-shape="decision"]').click();
    return { nodes: document.querySelectorAll('#node-layer .node').length, panel: !document.querySelector('#properties-panel').hidden };
  })()`);
  assert(afterAdd.nodes === 9 && afterAdd.panel, "Adding a shape did not update the editor");

  const edited = await client.evaluate(`(() => {
    document.querySelector('#node-layer .node:last-child').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const editor = document.querySelector('#inline-editor');
    const opened = getComputedStyle(editor).display !== 'none';
    editor.value = 'Approved?';
    editor.dispatchEvent(new FocusEvent('blur'));
    return { opened, text: document.querySelector('#node-layer .node:last-child text').textContent };
  })()`);
  assert(edited.opened && edited.text.includes("Approved?"), `Inline text editing failed: ${JSON.stringify(edited)}`);

  const history = await client.evaluate(`(() => {
    document.querySelector('[data-action="duplicate"]').click();
    const duplicated = document.querySelectorAll('#node-layer .node').length;
    document.querySelector('[data-action="undo"]').click();
    const undone = document.querySelectorAll('#node-layer .node').length;
    document.querySelector('[data-action="redo"]').click();
    const redone = document.querySelectorAll('#node-layer .node').length;
    document.querySelector('[data-action="clear"]').click();
    const cleared = document.querySelectorAll('#node-layer .node').length;
    const hint = document.querySelector('.empty-hint')?.textContent;
    document.querySelector('[data-action="undo"]').click();
    return { duplicated, undone, redone, cleared, restored: document.querySelectorAll('#node-layer .node').length, hint };
  })()`);
  assert(history.duplicated === 10 && history.undone === 9 && history.redone === 10, "Duplicate or history controls failed");
  assert(history.cleared === 0 && history.restored === 10 && history.hint?.includes("Add a shape"), "Clear or restore behavior failed");
  assert(client.errors.length === 0, `Browser errors: ${client.errors.join("; ")}`);

  console.log("Browser smoke test passed: rendering, add, edit, duplicate, history, clear, and restore.");
} finally {
  client?.close();
  browser.kill();
  server.kill();
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 250).unref();
}
