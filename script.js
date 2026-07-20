(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const CANVAS = { width: 2400, height: 1600, padding: 16 };
  const GRID_SIZE = 20;
  const STORAGE_KEY = "flowchart-creator-project-v1";
  const DEFAULT_NODE_STYLE = Object.freeze({
    fill: "#ffffff",
    stroke: "#475569",
    strokeWidth: 1.5,
    strokeStyle: "solid",
    opacity: 1,
    fontSize: 14,
    fontWeight: "400",
    italic: false,
    textAlign: "center",
    textColor: "#1f2937",
    cornerRadius: 6
  });
  const DEFAULT_EDGE_STYLE = Object.freeze({
    stroke: "#475569",
    strokeWidth: 1.5,
    strokeStyle: "solid",
    startArrow: "none",
    endArrow: "arrow"
  });
  const SHAPES = [
    ["terminator", "Start / End"],
    ["process", "Process"],
    ["input", "Input / Output"],
    ["decision", "Decision"],
    ["document", "Document"],
    ["predefined", "Predefined"],
    ["database", "Database"],
    ["manual", "Manual Input"],
    ["preparation", "Preparation"],
    ["onpage", "On-page"],
    ["offpage", "Off-page"],
    ["delay", "Delay"]
  ];
  const DEFAULT_SIZES = {
    terminator: [150, 62], process: [160, 76], input: [170, 76], decision: [145, 100],
    document: [170, 88], predefined: [170, 76], database: [160, 92], manual: [170, 76],
    preparation: [170, 76], onpage: [72, 72], offpage: [110, 92], delay: [150, 76], text: [180, 48]
  };

  const refs = {
    shell: document.querySelector("#canvas-shell"),
    svg: document.querySelector("#canvas"),
    viewport: document.querySelector("#viewport"),
    edgeLayer: document.querySelector("#edge-layer"),
    nodeLayer: document.querySelector("#node-layer"),
    overlayLayer: document.querySelector("#overlay-layer"),
    shapeList: document.querySelector("#shape-list"),
    properties: document.querySelector("#properties-panel"),
    propertiesTitle: document.querySelector("#properties-title"),
    propertiesContent: document.querySelector("#properties-content"),
    title: document.querySelector("#document-title"),
    zoom: document.querySelector("#zoom-display"),
    status: document.querySelector("#status-text"),
    selectionStatus: document.querySelector("#selection-status"),
    snap: document.querySelector("#snap-toggle"),
    editor: document.querySelector("#inline-editor"),
    fileInput: document.querySelector("#file-input")
  };

  let state = createInitialState();
  let interaction = null;
  let spacePressed = false;
  let clipboard = null;
  let editing = null;
  let nudgePending = false;

  function uid(prefix = "item") {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createNode(type, x, y, text = SHAPES.find(([key]) => key === type)?.[1] || "Text") {
    const [width, height] = DEFAULT_SIZES[type] || DEFAULT_SIZES.process;
    return {
      id: uid("node"), type, x, y, width, height, rotation: 0, text,
      style: clone(DEFAULT_NODE_STYLE), zIndex: state?.nodes?.length || 0, groupId: null
    };
  }

  function createInitialState() {
    const next = {
      documentTitle: "Untitled Flowchart",
      nodes: [], edges: [], selectedIds: [], zoom: 0.82, pan: { x: 160, y: 38 },
      mode: "select", snap: true, history: [], historyIndex: -1
    };
    state = next;
    const labels = [
      ["terminator", "START"],
      ["input", "Display message:\n“How many hours did you work?”"],
      ["input", "Read Hours"],
      ["input", "Display message:\n“How much do you get paid per hour?”"],
      ["input", "Read Pay Rate"],
      ["process", "Multiply Hours by Pay Rate\nStore result in Gross Pay"],
      ["input", "Display Gross Pay"],
      ["terminator", "END"]
    ];
    labels.forEach(([type, text], index) => {
      const node = createNode(type, 1120, 55 + index * 185, text);
      if (type === "input") node.width = index === 1 || index === 3 ? 320 : 190;
      if (type === "process") node.width = 300;
      next.nodes.push(node);
      if (index) {
        next.edges.push({
          id: uid("edge"), fromNodeId: next.nodes[index - 1].id, fromPort: "bottom",
          toNodeId: node.id, toPort: "top", type: "straight", label: "", style: clone(DEFAULT_EDGE_STYLE)
        });
      }
    });
    next.history = [snapshot(next)];
    next.historyIndex = 0;
    return next;
  }

  function snapshot(source = state) {
    return JSON.stringify({
      documentTitle: source.documentTitle,
      nodes: source.nodes,
      edges: source.edges,
      zoom: source.zoom,
      pan: source.pan,
      snap: source.snap
    });
  }

  function commit(message = "Updated") {
    const current = snapshot();
    if (state.history[state.historyIndex] === current) return;
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(current);
    if (state.history.length > 100) state.history.shift();
    state.historyIndex = state.history.length - 1;
    setStatus(message);
    updateToolbar();
  }

  function restoreHistory(index) {
    if (index < 0 || index >= state.history.length) return;
    const history = state.history;
    const restored = JSON.parse(history[index]);
    state = { ...state, ...restored, selectedIds: [], history, historyIndex: index, mode: "select" };
    refs.title.value = state.documentTitle;
    refs.snap.checked = state.snap;
    finishTextEditing(false);
    render();
  }

  function undo() { restoreHistory(state.historyIndex - 1); setStatus("Undo"); }
  function redo() { restoreHistory(state.historyIndex + 1); setStatus("Redo"); }

  function svgEl(tag, attributes = {}, text = "") {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([name, value]) => {
      if (value !== null && value !== undefined && value !== "") element.setAttribute(name, String(value));
    });
    if (text) element.textContent = text;
    return element;
  }

  function dashArray(style) {
    if (style === "dashed") return "7 5";
    if (style === "dotted") return "2 4";
    return null;
  }

  function geometryElements(node, preview = false) {
    const { width: w, height: h, type } = node;
    const style = node.style || DEFAULT_NODE_STYLE;
    const common = {
      class: preview ? "" : "node-shape",
      fill: style.fill,
      stroke: style.stroke,
      "stroke-width": style.strokeWidth,
      "stroke-dasharray": dashArray(style.strokeStyle),
      opacity: style.opacity,
      "stroke-linejoin": "round"
    };
    const items = [];
    if (type === "terminator") items.push(svgEl("rect", { ...common, width: w, height: h, rx: h / 2 }));
    else if (type === "process") items.push(svgEl("rect", { ...common, width: w, height: h, rx: style.cornerRadius || 0 }));
    else if (type === "input") items.push(svgEl("polygon", { ...common, points: `${w * .13},0 ${w},0 ${w * .87},${h} 0,${h}` }));
    else if (type === "decision") items.push(svgEl("polygon", { ...common, points: `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}` }));
    else if (type === "document") items.push(svgEl("path", { ...common, d: `M0 0H${w}V${h * .78} C${w * .76} ${h * .58},${w * .58} ${h},${w * .34} ${h * .82} C${w * .2} ${h * .72},${w * .1} ${h * .78},0 ${h * .9}Z` }));
    else if (type === "predefined") {
      items.push(svgEl("rect", { ...common, width: w, height: h, rx: style.cornerRadius || 0 }));
      items.push(svgEl("path", { d: `M${w * .12} 0V${h} M${w * .88} 0V${h}`, fill: "none", stroke: style.stroke, "stroke-width": style.strokeWidth, "stroke-dasharray": dashArray(style.strokeStyle), opacity: style.opacity, class: preview ? "" : "node-shape" }));
    } else if (type === "database") {
      items.push(svgEl("path", { ...common, d: `M0 ${h * .14} C0 ${-h * .02},${w} ${-h * .02},${w} ${h * .14} V${h * .86} C${w} ${h * 1.02},0 ${h * 1.02},0 ${h * .86}Z` }));
      items.push(svgEl("ellipse", { cx: w / 2, cy: h * .14, rx: w / 2, ry: h * .14, fill: "none", stroke: style.stroke, "stroke-width": style.strokeWidth, opacity: style.opacity, class: preview ? "" : "node-shape" }));
    } else if (type === "manual") items.push(svgEl("polygon", { ...common, points: `${w * .16},0 ${w},0 ${w * .86},${h} 0,${h}` }));
    else if (type === "preparation") items.push(svgEl("polygon", { ...common, points: `${w * .15},0 ${w * .85},0 ${w},${h / 2} ${w * .85},${h} ${w * .15},${h} 0,${h / 2}` }));
    else if (type === "onpage") items.push(svgEl("ellipse", { ...common, cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2 }));
    else if (type === "offpage") items.push(svgEl("polygon", { ...common, points: `0,0 ${w},0 ${w},${h * .66} ${w / 2},${h} 0,${h * .66}` }));
    else if (type === "delay") items.push(svgEl("path", { ...common, d: `M0 0H${w * .52} C${w * 1.12} 0,${w * 1.12} ${h},${w * .52} ${h}H0Z` }));
    return items;
  }

  function wrappedLines(text, width, height, fontSize) {
    const maxChars = Math.max(4, Math.floor((width - 24) / (fontSize * .56)));
    const sourceLines = String(text || "").split("\n");
    const result = [];
    sourceLines.forEach((source) => {
      if (!source) { result.push(""); return; }
      const words = source.split(/\s+/);
      let line = "";
      words.forEach((word) => {
        if (word.length > maxChars && !line) {
          for (let index = 0; index < word.length; index += maxChars) result.push(word.slice(index, index + maxChars));
        } else if (!line || `${line} ${word}`.length <= maxChars) line = line ? `${line} ${word}` : word;
        else { result.push(line); line = word; }
      });
      if (line) result.push(line);
    });
    const lineHeight = fontSize * 1.25;
    const maxLines = Math.max(1, Math.floor((height - 12) / lineHeight));
    if (result.length > maxLines) {
      result.length = maxLines;
      const last = result[maxLines - 1];
      result[maxLines - 1] = `${last.slice(0, Math.max(1, maxChars - 1))}…`;
    }
    return result;
  }

  function appendNodeText(group, node) {
    const style = node.style || DEFAULT_NODE_STYLE;
    const fontSize = Math.max(8, Number(style.fontSize) || 14);
    const lines = wrappedLines(node.text, node.width, node.height, fontSize);
    const lineHeight = fontSize * 1.25;
    const anchor = style.textAlign === "left" ? "start" : style.textAlign === "right" ? "end" : "middle";
    const x = style.textAlign === "left" ? 12 : style.textAlign === "right" ? node.width - 12 : node.width / 2;
    const startY = node.height / 2 - ((lines.length - 1) * lineHeight) / 2 + fontSize * .34;
    const text = svgEl("text", {
      x, y: startY, fill: style.textColor || "#1f2937", "font-size": fontSize,
      "font-family": "Inter, ui-sans-serif, system-ui, sans-serif", "font-weight": style.fontWeight,
      "font-style": style.italic ? "italic" : "normal", "text-anchor": anchor,
      "data-text-node": node.id, "pointer-events": "auto"
    });
    lines.forEach((line, index) => text.append(svgEl("tspan", { x, dy: index ? lineHeight : 0 }, line)));
    group.append(text);
  }

  function renderNodeInto(node, parent) {
    const group = svgEl("g", {
      class: "node", "data-node-id": node.id,
      transform: `translate(${node.x} ${node.y}) rotate(${node.rotation || 0} ${node.width / 2} ${node.height / 2})`
    });
    if (node.type !== "text") geometryElements(node).forEach((element) => group.append(element));
    appendNodeText(group, node);
    parent.append(group);
  }

  function portPoint(node, port) {
    if (!node) return { x: 0, y: 0 };
    if (port === "top") return { x: node.x + node.width / 2, y: node.y };
    if (port === "right") return { x: node.x + node.width, y: node.y + node.height / 2 };
    if (port === "bottom") return { x: node.x + node.width / 2, y: node.y + node.height };
    return { x: node.x, y: node.y + node.height / 2 };
  }

  function portVector(port) {
    return { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[port] || [0, 0];
  }

  function connectorPath(edge, overrideEnd = null) {
    const from = state.nodes.find((node) => node.id === edge.fromNodeId);
    const to = state.nodes.find((node) => node.id === edge.toNodeId);
    const a = portPoint(from, edge.fromPort);
    const b = overrideEnd || portPoint(to, edge.toPort);
    if (edge.type === "curved") {
      const [avx, avy] = portVector(edge.fromPort);
      const [bvx, bvy] = portVector(edge.toPort);
      const distance = Math.max(50, Math.min(180, Math.hypot(b.x - a.x, b.y - a.y) * .45));
      return `M${a.x} ${a.y} C${a.x + avx * distance} ${a.y + avy * distance},${b.x + bvx * distance} ${b.y + bvy * distance},${b.x} ${b.y}`;
    }
    if (edge.type === "elbow") {
      const horizontalStart = edge.fromPort === "left" || edge.fromPort === "right";
      if (horizontalStart) {
        const midX = (a.x + b.x) / 2;
        return `M${a.x} ${a.y} H${midX} V${b.y} H${b.x}`;
      }
      const midY = (a.y + b.y) / 2;
      return `M${a.x} ${a.y} V${midY} H${b.x} V${b.y}`;
    }
    return `M${a.x} ${a.y} L${b.x} ${b.y}`;
  }

  function markerValue(kind, end) {
    if (!kind || kind === "none") return null;
    if (kind === "arrow") return `url(#arrow-${end})`;
    if (kind === "circle") return "url(#circle-end)";
    if (kind === "diamond") return "url(#diamond-end)";
    return null;
  }

  function edgeLabelPoint(edge) {
    const from = state.nodes.find((node) => node.id === edge.fromNodeId);
    const to = state.nodes.find((node) => node.id === edge.toNodeId);
    const a = portPoint(from, edge.fromPort);
    const b = portPoint(to, edge.toPort);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function renderEdgeInto(edge, parent) {
    if (!state.nodes.some((node) => node.id === edge.fromNodeId) || !state.nodes.some((node) => node.id === edge.toNodeId)) return;
    const group = svgEl("g", { class: "edge", "data-edge-id": edge.id });
    const style = edge.style || DEFAULT_EDGE_STYLE;
    const d = connectorPath(edge);
    group.append(svgEl("path", { class: "edge-hit", d }));
    group.append(svgEl("path", {
      class: "edge-path", d, stroke: style.stroke, "stroke-width": style.strokeWidth,
      "stroke-dasharray": dashArray(style.strokeStyle), "marker-start": markerValue(style.startArrow, "start"),
      "marker-end": markerValue(style.endArrow, "end")
    }));
    if (edge.label) {
      const point = edgeLabelPoint(edge);
      const width = Math.max(34, edge.label.length * 7 + 10);
      group.append(svgEl("rect", { class: "edge-label-bg", x: point.x - width / 2, y: point.y - 12, width, height: 22, rx: 3 }));
      group.append(svgEl("text", { class: "edge-label", x: point.x, y: point.y + 4, "text-anchor": "middle", "font-size": 12, fill: "#334155", "data-text-edge": edge.id }, edge.label));
    }
    parent.append(group);
  }

  function render() {
    refs.viewport.setAttribute("transform", `translate(${state.pan.x} ${state.pan.y}) scale(${state.zoom})`);
    refs.edgeLayer.replaceChildren();
    refs.nodeLayer.replaceChildren();
    refs.overlayLayer.replaceChildren();
    state.edges.forEach((edge) => renderEdgeInto(edge, refs.edgeLayer));
    [...state.nodes].sort((a, b) => a.zIndex - b.zIndex).forEach((node) => renderNodeInto(node, refs.nodeLayer));
    renderOverlays();
    refs.zoom.textContent = `${Math.round(state.zoom * 100)}%`;
    refs.selectionStatus.textContent = `${state.selectedIds.length} selected`;
    refs.shell.dataset.mode = state.mode;
    renderProperties();
    updateToolbar();
  }

  function renderOverlays() {
    if (!state.nodes.length && !state.edges.length) {
      refs.overlayLayer.append(svgEl("text", { class: "empty-hint", x: CANVAS.width / 2, y: CANVAS.height / 2, "text-anchor": "middle" }, "Add a shape or double-click to add text"));
    }
    const selectedNodes = state.nodes.filter((node) => state.selectedIds.includes(node.id));
    selectedNodes.forEach((node) => renderNodeOverlay(node));
    if (state.mode === "connect") {
      state.nodes.filter((node) => !state.selectedIds.includes(node.id)).forEach((node) => renderPorts(node));
    }
    const selectedEdge = state.edges.find((edge) => state.selectedIds.includes(edge.id));
    if (selectedEdge && state.selectedIds.length === 1) renderEdgeOverlay(selectedEdge);
    if (interaction?.type === "marquee") {
      const box = normalizedRect(interaction.startWorld, interaction.currentWorld);
      refs.overlayLayer.append(svgEl("rect", { class: "marquee", ...box }));
    }
    if (interaction?.type === "connect") {
      const edge = { fromNodeId: interaction.nodeId, fromPort: interaction.port, toNodeId: interaction.nodeId, toPort: interaction.port, type: "straight" };
      refs.overlayLayer.append(svgEl("path", { d: connectorPath(edge, interaction.currentWorld), fill: "none", stroke: "#2563eb", "stroke-width": 1.5, "stroke-dasharray": "5 4", "marker-end": "url(#arrow-end)", "vector-effect": "non-scaling-stroke" }));
    }
    if (interaction?.type === "reconnect") {
      const edge = state.edges.find((item) => item.id === interaction.edgeId);
      if (edge) {
        const fixedNode = state.nodes.find((node) => node.id === (interaction.end === "from" ? edge.toNodeId : edge.fromNodeId));
        const fixedPort = interaction.end === "from" ? edge.toPort : edge.fromPort;
        const fixed = portPoint(fixedNode, fixedPort);
        const a = interaction.end === "from" ? interaction.currentWorld : fixed;
        const b = interaction.end === "from" ? fixed : interaction.currentWorld;
        refs.overlayLayer.append(svgEl("path", { d: `M${a.x} ${a.y} L${b.x} ${b.y}`, fill: "none", stroke: "#2563eb", "stroke-width": 1.5, "stroke-dasharray": "5 4", "vector-effect": "non-scaling-stroke" }));
      }
    }
  }

  function renderNodeOverlay(node) {
    refs.overlayLayer.append(svgEl("rect", {
      class: "selection-outline", x: node.x - 3, y: node.y - 3, width: node.width + 6, height: node.height + 6, rx: 2
    }));
    if (state.selectedIds.length === 1) {
      const handles = {
        nw: [node.x, node.y], n: [node.x + node.width / 2, node.y], ne: [node.x + node.width, node.y],
        e: [node.x + node.width, node.y + node.height / 2], se: [node.x + node.width, node.y + node.height],
        s: [node.x + node.width / 2, node.y + node.height], sw: [node.x, node.y + node.height], w: [node.x, node.y + node.height / 2]
      };
      Object.entries(handles).forEach(([handle, [cx, cy]]) => refs.overlayLayer.append(svgEl("rect", {
        class: "resize-handle", "data-resize-id": node.id, "data-handle": handle, x: cx - 4, y: cy - 4, width: 8, height: 8
      })));
    }
    renderPorts(node);
  }

  function renderPorts(node) {
    ["top", "right", "bottom", "left"].forEach((port) => {
      const point = portPoint(node, port);
      refs.overlayLayer.append(svgEl("circle", { class: "port", "data-port-node": node.id, "data-port": port, cx: point.x, cy: point.y, r: 5 }));
    });
  }

  function renderEdgeOverlay(edge) {
    const from = portPoint(state.nodes.find((node) => node.id === edge.fromNodeId), edge.fromPort);
    const to = portPoint(state.nodes.find((node) => node.id === edge.toNodeId), edge.toPort);
    refs.overlayLayer.append(svgEl("circle", { class: "endpoint-handle", "data-edge-end": "from", "data-edge-id": edge.id, cx: from.x, cy: from.y, r: 5 }));
    refs.overlayLayer.append(svgEl("circle", { class: "endpoint-handle", "data-edge-end": "to", "data-edge-id": edge.id, cx: to.x, cy: to.y, r: 5 }));
  }

  function createShapePalette() {
    SHAPES.forEach(([type, label]) => {
      const item = document.createElement("div");
      item.className = "shape-item";
      item.tabIndex = 0;
      item.draggable = true;
      item.dataset.shape = type;
      item.title = `Add ${label}`;
      item.setAttribute("role", "button");
      const preview = svgEl("svg", { viewBox: "0 0 70 46", "aria-hidden": "true" });
      const node = { type, width: 64, height: 40, style: { ...DEFAULT_NODE_STYLE, strokeWidth: 1.2 } };
      const group = svgEl("g", { transform: "translate(3 3)" });
      geometryElements(node, true).forEach((element) => group.append(element));
      preview.append(group);
      const text = document.createElement("span");
      text.textContent = label;
      item.append(preview, text);
      refs.shapeList.append(item);
    });
  }

  function addNode(type, point) {
    const [width, height] = DEFAULT_SIZES[type] || DEFAULT_SIZES.process;
    const node = createNode(type, clamp(point.x - width / 2, CANVAS.padding, CANVAS.width - width - CANVAS.padding), clamp(point.y - height / 2, CANVAS.padding, CANVAS.height - height - CANVAS.padding));
    if (state.snap) { node.x = snap(node.x); node.y = snap(node.y); }
    state.nodes.push(node);
    state.selectedIds = [node.id];
    commit(`Added ${SHAPES.find(([key]) => key === type)?.[1] || "shape"}`);
    render();
    return node;
  }

  function visibleCenter() {
    const rect = refs.svg.getBoundingClientRect();
    return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function screenToWorld(clientX, clientY) {
    const rect = refs.svg.getBoundingClientRect();
    return { x: (clientX - rect.left - state.pan.x) / state.zoom, y: (clientY - rect.top - state.pan.y) / state.zoom };
  }

  function worldToScreen(x, y) {
    const rect = refs.svg.getBoundingClientRect();
    return { x: rect.left + state.pan.x + x * state.zoom, y: rect.top + state.pan.y + y * state.zoom };
  }

  function normalizedRect(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  }

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function snap(value) { return Math.round(value / GRID_SIZE) * GRID_SIZE; }

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
    refs.shell.dataset.mode = mode;
    setStatus(mode === "connect" ? "Drag between connection points" : mode === "text" ? "Click to add text" : "Select tool");
    render();
  }

  function selectNode(nodeId, additive = false) {
    const node = state.nodes.find((item) => item.id === nodeId);
    let ids = [nodeId];
    if (node?.groupId && !additive) ids = state.nodes.filter((item) => item.groupId === node.groupId).map((item) => item.id);
    if (additive) {
      state.selectedIds = state.selectedIds.includes(nodeId) ? state.selectedIds.filter((id) => id !== nodeId) : [...state.selectedIds, ...ids.filter((id) => !state.selectedIds.includes(id))];
    } else if (!state.selectedIds.includes(nodeId)) state.selectedIds = ids;
  }

  function onPointerDown(event) {
    if (event.button !== 0 && event.button !== 1) return;
    refs.shell.focus({ preventScroll: true });
    const world = screenToWorld(event.clientX, event.clientY);
    const resize = event.target.closest?.("[data-resize-id]");
    const port = event.target.closest?.("[data-port-node]");
    const endpoint = event.target.closest?.("[data-edge-end]");
    const nodeElement = event.target.closest?.("[data-node-id]");
    const edgeElement = event.target.closest?.("[data-edge-id]");

    if (spacePressed || event.button === 1) {
      interaction = { type: "pan", startClient: { x: event.clientX, y: event.clientY }, initialPan: { ...state.pan } };
      refs.shell.classList.add("panning");
    } else if (resize) {
      const node = state.nodes.find((item) => item.id === resize.dataset.resizeId);
      interaction = { type: "resize", nodeId: node.id, handle: resize.dataset.handle, startWorld: world, initial: clone(node) };
    } else if (endpoint) {
      interaction = { type: "reconnect", edgeId: endpoint.dataset.edgeId, end: endpoint.dataset.edgeEnd, currentWorld: world };
    } else if (port && (state.mode === "connect" || state.selectedIds.includes(port.dataset.portNode))) {
      interaction = { type: "connect", nodeId: port.dataset.portNode, port: port.dataset.port, startWorld: world, currentWorld: world };
    } else if (nodeElement) {
      const nodeId = nodeElement.dataset.nodeId;
      selectNode(nodeId, event.shiftKey);
      const initial = new Map(state.nodes.filter((node) => state.selectedIds.includes(node.id)).map((node) => [node.id, { x: node.x, y: node.y }]));
      interaction = { type: "move", startWorld: world, initial, changed: false };
      render();
    } else if (edgeElement) {
      const edgeId = edgeElement.dataset.edgeId;
      state.selectedIds = event.shiftKey ? [...new Set([...state.selectedIds, edgeId])] : [edgeId];
      render();
    } else if (state.mode === "text") {
      const node = addNode("text", world);
      beginTextEditing("node", node.id);
    } else {
      if (!event.shiftKey) state.selectedIds = [];
      interaction = { type: "marquee", startWorld: world, currentWorld: world, additive: event.shiftKey };
      render();
    }
    if (interaction) refs.svg.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!interaction) return;
    const world = screenToWorld(event.clientX, event.clientY);
    if (interaction.type === "pan") {
      state.pan.x = interaction.initialPan.x + event.clientX - interaction.startClient.x;
      state.pan.y = interaction.initialPan.y + event.clientY - interaction.startClient.y;
      applyViewport();
      return;
    }
    if (interaction.type === "move") {
      let dx = world.x - interaction.startWorld.x;
      let dy = world.y - interaction.startWorld.y;
      interaction.initial.forEach((position, id) => {
        const node = state.nodes.find((item) => item.id === id);
        if (!node) return;
        let x = position.x + dx;
        let y = position.y + dy;
        if (state.snap) { x = snap(x); y = snap(y); }
        node.x = clamp(x, CANVAS.padding, CANVAS.width - node.width - CANVAS.padding);
        node.y = clamp(y, CANVAS.padding, CANVAS.height - node.height - CANVAS.padding);
      });
      interaction.changed = Math.abs(dx) > .5 || Math.abs(dy) > .5;
      render();
      return;
    }
    if (interaction.type === "resize") {
      resizeNode(interaction, world);
      render();
      return;
    }
    interaction.currentWorld = world;
    renderOverlaysOnly();
  }

  function resizeNode(active, world) {
    const node = state.nodes.find((item) => item.id === active.nodeId);
    if (!node) return;
    const minWidth = node.type === "text" ? 60 : 48;
    const minHeight = node.type === "text" ? 28 : 36;
    const dx = world.x - active.startWorld.x;
    const dy = world.y - active.startWorld.y;
    let { x, y, width, height } = active.initial;
    if (active.handle.includes("e")) width = Math.max(minWidth, active.initial.width + dx);
    if (active.handle.includes("s")) height = Math.max(minHeight, active.initial.height + dy);
    if (active.handle.includes("w")) { width = Math.max(minWidth, active.initial.width - dx); x = active.initial.x + active.initial.width - width; }
    if (active.handle.includes("n")) { height = Math.max(minHeight, active.initial.height - dy); y = active.initial.y + active.initial.height - height; }
    if (state.snap) { x = snap(x); y = snap(y); width = Math.max(minWidth, snap(width)); height = Math.max(minHeight, snap(height)); }
    node.x = clamp(x, CANVAS.padding, CANVAS.width - minWidth - CANVAS.padding);
    node.y = clamp(y, CANVAS.padding, CANVAS.height - minHeight - CANVAS.padding);
    node.width = Math.min(width, CANVAS.width - node.x - CANVAS.padding);
    node.height = Math.min(height, CANVAS.height - node.y - CANVAS.padding);
  }

  function onPointerUp(event) {
    if (!interaction) return;
    const active = interaction;
    const world = screenToWorld(event.clientX, event.clientY);
    interaction = null;
    refs.shell.classList.remove("panning");
    if (active.type === "move" && active.changed) commit("Moved selection");
    else if (active.type === "resize") commit("Resized shape");
    else if (active.type === "marquee") completeMarquee(active, world);
    else if (active.type === "connect") completeConnection(active, world);
    else if (active.type === "reconnect") completeReconnect(active, world);
    render();
  }

  function completeMarquee(active, world) {
    const box = normalizedRect(active.startWorld, world);
    const hits = state.nodes.filter((node) => node.x >= box.x && node.y >= box.y && node.x + node.width <= box.x + box.width && node.y + node.height <= box.y + box.height).map((node) => node.id);
    state.selectedIds = active.additive ? [...new Set([...state.selectedIds, ...hits])] : hits;
  }

  function nearestPort(world, excludeNodeId = null) {
    let best = null;
    state.nodes.forEach((node) => {
      if (node.id === excludeNodeId) return;
      ["top", "right", "bottom", "left"].forEach((port) => {
        const point = portPoint(node, port);
        const distance = Math.hypot(point.x - world.x, point.y - world.y);
        if (distance <= 34 / state.zoom && (!best || distance < best.distance)) best = { nodeId: node.id, port, distance };
      });
    });
    return best;
  }

  function completeConnection(active, world) {
    const target = nearestPort(world, active.nodeId);
    if (!target) { setStatus("Connector cancelled"); return; }
    const edge = {
      id: uid("edge"), fromNodeId: active.nodeId, fromPort: active.port,
      toNodeId: target.nodeId, toPort: target.port, type: "straight", label: "", style: clone(DEFAULT_EDGE_STYLE)
    };
    state.edges.push(edge);
    state.selectedIds = [edge.id];
    commit("Created connector");
  }

  function completeReconnect(active, world) {
    const edge = state.edges.find((item) => item.id === active.edgeId);
    if (!edge) return;
    const exclude = active.end === "from" ? edge.toNodeId : edge.fromNodeId;
    const target = nearestPort(world, exclude);
    if (!target) { setStatus("Endpoint unchanged"); return; }
    if (active.end === "from") { edge.fromNodeId = target.nodeId; edge.fromPort = target.port; }
    else { edge.toNodeId = target.nodeId; edge.toPort = target.port; }
    commit("Reconnected endpoint");
  }

  function renderOverlaysOnly() {
    refs.overlayLayer.replaceChildren();
    renderOverlays();
  }

  function applyViewport() {
    refs.viewport.setAttribute("transform", `translate(${state.pan.x} ${state.pan.y}) scale(${state.zoom})`);
    refs.zoom.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function zoomAt(factor, clientX, clientY) {
    const rect = refs.svg.getBoundingClientRect();
    const cx = clientX ?? rect.left + rect.width / 2;
    const cy = clientY ?? rect.top + rect.height / 2;
    const world = screenToWorld(cx, cy);
    const next = clamp(state.zoom * factor, .2, 3);
    state.zoom = Math.round(next * 100) / 100;
    state.pan.x = cx - rect.left - world.x * state.zoom;
    state.pan.y = cy - rect.top - world.y * state.zoom;
    render();
  }

  function fitToScreen() {
    const rect = refs.svg.getBoundingClientRect();
    const bounds = diagramBounds();
    const pad = 70;
    state.zoom = clamp(Math.min((rect.width - pad * 2) / bounds.width, (rect.height - pad * 2) / bounds.height), .2, 1.5);
    state.pan.x = (rect.width - bounds.width * state.zoom) / 2 - bounds.x * state.zoom;
    state.pan.y = (rect.height - bounds.height * state.zoom) / 2 - bounds.y * state.zoom;
    render();
    setStatus("Fit diagram to screen");
  }

  function diagramBounds() {
    if (!state.nodes.length) return { x: 0, y: 0, width: CANVAS.width, height: CANVAS.height };
    const minX = Math.min(...state.nodes.map((node) => node.x));
    const minY = Math.min(...state.nodes.map((node) => node.y));
    const maxX = Math.max(...state.nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...state.nodes.map((node) => node.y + node.height));
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  function beginTextEditing(kind, id) {
    finishTextEditing(true);
    const item = kind === "node" ? state.nodes.find((node) => node.id === id) : state.edges.find((edge) => edge.id === id);
    if (!item) return;
    editing = { kind, id, original: item.text ?? item.label ?? "", cancelled: false };
    let box;
    let style = DEFAULT_NODE_STYLE;
    if (kind === "node") {
      const topLeft = worldToScreen(item.x, item.y);
      box = { left: topLeft.x, top: topLeft.y, width: item.width * state.zoom, height: item.height * state.zoom };
      style = item.style || style;
    } else {
      const point = edgeLabelPoint(item);
      const screen = worldToScreen(point.x, point.y);
      box = { left: screen.x - 90, top: screen.y - 22, width: 180, height: 44 };
    }
    Object.assign(refs.editor.style, {
      display: "block", left: `${box.left}px`, top: `${box.top}px`, width: `${Math.max(70, box.width)}px`,
      height: `${Math.max(34, box.height)}px`, fontSize: `${Math.max(11, (style.fontSize || 14) * state.zoom)}px`,
      fontWeight: style.fontWeight, fontStyle: style.italic ? "italic" : "normal", textAlign: style.textAlign || "center"
    });
    refs.editor.value = kind === "node" ? item.text : item.label;
    refs.editor.focus();
    refs.editor.select();
  }

  function finishTextEditing(save = true) {
    if (!editing) return;
    const active = editing;
    editing = null;
    refs.editor.style.display = "none";
    const item = active.kind === "node" ? state.nodes.find((node) => node.id === active.id) : state.edges.find((edge) => edge.id === active.id);
    if (!item) return;
    const value = active.cancelled || !save ? active.original : refs.editor.value;
    if (active.kind === "node") item.text = value;
    else item.label = value;
    if (save && !active.cancelled && value !== active.original) commit("Edited text");
    render();
  }

  function selectedNodes() { return state.nodes.filter((node) => state.selectedIds.includes(node.id)); }
  function selectedEdges() { return state.edges.filter((edge) => state.selectedIds.includes(edge.id)); }

  function deleteSelection() {
    if (!state.selectedIds.length) return;
    const nodeIds = new Set(selectedNodes().map((node) => node.id));
    state.nodes = state.nodes.filter((node) => !nodeIds.has(node.id));
    state.edges = state.edges.filter((edge) => !state.selectedIds.includes(edge.id) && !nodeIds.has(edge.fromNodeId) && !nodeIds.has(edge.toNodeId));
    state.selectedIds = [];
    commit("Deleted selection");
    render();
  }

  function copySelection() {
    const nodes = selectedNodes();
    if (!nodes.length) return;
    const ids = new Set(nodes.map((node) => node.id));
    clipboard = { nodes: clone(nodes), edges: clone(state.edges.filter((edge) => ids.has(edge.fromNodeId) && ids.has(edge.toNodeId))) };
    setStatus(`Copied ${nodes.length} object${nodes.length === 1 ? "" : "s"}`);
  }

  function pasteSelection() {
    if (!clipboard?.nodes?.length) return;
    const idMap = new Map();
    const groupMap = new Map();
    const nodes = clipboard.nodes.map((source) => {
      const node = clone(source);
      idMap.set(node.id, uid("node"));
      node.id = idMap.get(node.id);
      node.x = clamp(node.x + 30, CANVAS.padding, CANVAS.width - node.width - CANVAS.padding);
      node.y = clamp(node.y + 30, CANVAS.padding, CANVAS.height - node.height - CANVAS.padding);
      if (node.groupId) {
        if (!groupMap.has(node.groupId)) groupMap.set(node.groupId, uid("group"));
        node.groupId = groupMap.get(node.groupId);
      }
      node.zIndex = state.nodes.length + 1;
      return node;
    });
    const edges = clipboard.edges.map((source) => ({ ...clone(source), id: uid("edge"), fromNodeId: idMap.get(source.fromNodeId), toNodeId: idMap.get(source.toNodeId) }));
    state.nodes.push(...nodes);
    state.edges.push(...edges);
    state.selectedIds = nodes.map((node) => node.id);
    clipboard = { nodes: clone(nodes), edges: clone(edges) };
    commit("Pasted selection");
    render();
  }

  function duplicateSelection() { copySelection(); pasteSelection(); }

  function moveSelection(dx, dy) {
    const nodes = selectedNodes();
    if (!nodes.length) return;
    nodes.forEach((node) => {
      node.x = clamp(node.x + dx, CANVAS.padding, CANVAS.width - node.width - CANVAS.padding);
      node.y = clamp(node.y + dy, CANVAS.padding, CANVAS.height - node.height - CANVAS.padding);
    });
    nudgePending = true;
    render();
  }

  function clearCanvas() {
    if (!state.nodes.length && !state.edges.length) return;
    state.nodes = [];
    state.edges = [];
    state.selectedIds = [];
    commit("Cleared canvas — undo is available");
    render();
  }

  function renderProperties() {
    const nodes = selectedNodes();
    const edges = selectedEdges();
    refs.properties.hidden = !state.selectedIds.length;
    if (!state.selectedIds.length) return;
    if (nodes.length > 1 && !edges.length) return renderMultiProperties(nodes);
    if (nodes.length === 1 && !edges.length) return renderNodeProperties(nodes[0]);
    if (edges.length === 1 && !nodes.length) return renderEdgeProperties(edges[0]);
    refs.propertiesTitle.textContent = "Selection";
    refs.propertiesContent.innerHTML = `<div class="property-section">Mixed objects selected</div><div class="property-actions"><button data-panel-action="delete">Delete</button></div>`;
  }

  function option(value, label, current) { return `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`; }

  function renderNodeProperties(node) {
    const style = node.style;
    refs.propertiesTitle.textContent = node.type === "text" ? "Text" : "Shape";
    refs.propertiesContent.innerHTML = `
      ${node.type === "text" ? "" : `<section class="property-section"><div class="property-section-title">Appearance</div>
        <div class="property-row"><label>Fill</label><input type="color" data-prop="fill" value="${style.fill}"></div>
        <div class="property-row"><label>Border</label><input type="color" data-prop="stroke" value="${style.stroke}"></div>
        <div class="property-row"><label>Width</label><input type="number" data-prop="strokeWidth" value="${style.strokeWidth}" min="0" max="12" step="0.5"></div>
        <div class="property-row"><label>Style</label><select data-prop="strokeStyle">${option("solid", "Solid", style.strokeStyle)}${option("dashed", "Dashed", style.strokeStyle)}${option("dotted", "Dotted", style.strokeStyle)}</select></div>
        <div class="property-row"><label>Opacity</label><input type="number" data-prop="opacity" value="${style.opacity}" min="0.1" max="1" step="0.1"></div>
        ${["process", "terminator"].includes(node.type) ? `<div class="property-row"><label>Radius</label><input type="number" data-prop="cornerRadius" value="${style.cornerRadius}" min="0" max="40"></div>` : ""}
      </section>`}
      <section class="property-section"><div class="property-section-title">Text</div>
        <div class="property-row"><label>Size</label><input type="number" data-prop="fontSize" value="${style.fontSize}" min="8" max="72"></div>
        <div class="property-row"><label>Color</label><input type="color" data-prop="textColor" value="${style.textColor}"></div>
        <div class="property-row"><label>Style</label><div class="segment"><button data-prop-button="fontWeight" data-value="${style.fontWeight === "700" ? "400" : "700"}" class="${style.fontWeight === "700" ? "active" : ""}"><b>B</b></button><button data-prop-button="italic" data-value="${!style.italic}" class="${style.italic ? "active" : ""}"><i>I</i></button></div></div>
        <div class="property-row"><label>Align</label><div class="segment"><button data-prop-button="textAlign" data-value="left" class="${style.textAlign === "left" ? "active" : ""}">L</button><button data-prop-button="textAlign" data-value="center" class="${style.textAlign === "center" ? "active" : ""}">C</button><button data-prop-button="textAlign" data-value="right" class="${style.textAlign === "right" ? "active" : ""}">R</button></div></div>
      </section>
      <section class="property-section"><div class="property-section-title">Position & size</div>
        <div class="two-col"><div class="mini-field"><label>X</label><input type="number" data-node-prop="x" value="${Math.round(node.x)}"></div><div class="mini-field"><label>Y</label><input type="number" data-node-prop="y" value="${Math.round(node.y)}"></div><div class="mini-field"><label>Width</label><input type="number" data-node-prop="width" value="${Math.round(node.width)}" min="40"></div><div class="mini-field"><label>Height</label><input type="number" data-node-prop="height" value="${Math.round(node.height)}" min="28"></div></div>
      </section>
      <section class="property-section"><div class="property-section-title">Layer</div><div class="property-actions"><button data-panel-action="front">Front</button><button data-panel-action="forward">Forward</button><button data-panel-action="backward">Backward</button><button data-panel-action="back">Back</button></div></section>
      <div class="property-actions"><button data-panel-action="duplicate">Duplicate</button><button data-panel-action="delete">Delete</button></div>`;
  }

  function renderEdgeProperties(edge) {
    const style = edge.style;
    refs.propertiesTitle.textContent = "Connector";
    refs.propertiesContent.innerHTML = `
      <section class="property-section"><div class="property-section-title">Line</div>
        <div class="property-row"><label>Type</label><select data-edge-prop="type">${option("straight", "Straight", edge.type)}${option("elbow", "Elbow", edge.type)}${option("curved", "Curved", edge.type)}</select></div>
        <div class="property-row"><label>Color</label><input type="color" data-edge-style="stroke" value="${style.stroke}"></div>
        <div class="property-row"><label>Width</label><input type="number" data-edge-style="strokeWidth" value="${style.strokeWidth}" min="0.5" max="12" step="0.5"></div>
        <div class="property-row"><label>Style</label><select data-edge-style="strokeStyle">${option("solid", "Solid", style.strokeStyle)}${option("dashed", "Dashed", style.strokeStyle)}${option("dotted", "Dotted", style.strokeStyle)}</select></div>
        <div class="property-row"><label>Start</label><select data-edge-style="startArrow">${arrowOptions(style.startArrow)}</select></div>
        <div class="property-row"><label>End</label><select data-edge-style="endArrow">${arrowOptions(style.endArrow)}</select></div>
      </section>
      <section class="property-section"><div class="property-section-title">Label</div><div class="property-row"><label>Text</label><input type="text" data-edge-prop="label" value="${escapeHtml(edge.label)}"></div></section>
      <div class="property-actions"><button data-panel-action="delete">Delete</button></div>`;
  }

  function arrowOptions(current) {
    return [["none", "None"], ["arrow", "Arrow"], ["circle", "Circle"], ["diamond", "Diamond"]].map(([value, label]) => option(value, label, current)).join("");
  }

  function renderMultiProperties(nodes) {
    refs.propertiesTitle.textContent = `${nodes.length} Shapes`;
    refs.propertiesContent.innerHTML = `
      <section class="property-section"><div class="property-section-title">Align</div><div class="property-actions"><button data-arrange="left">Left</button><button data-arrange="center">Center</button><button data-arrange="right">Right</button><button data-arrange="top">Top</button><button data-arrange="middle">Middle</button><button data-arrange="bottom">Bottom</button></div></section>
      <section class="property-section"><div class="property-section-title">Distribute</div><div class="property-actions"><button data-arrange="horizontal">Horizontal</button><button data-arrange="vertical">Vertical</button></div></section>
      <section class="property-section"><div class="property-section-title">Group</div><div class="property-actions"><button data-panel-action="group">Group</button><button data-panel-action="ungroup">Ungroup</button></div></section>
      <div class="property-actions"><button data-panel-action="duplicate">Duplicate</button><button data-panel-action="delete">Delete</button></div>`;
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
  }

  function handlePropertyChange(event) {
    const node = selectedNodes()[0];
    const edge = selectedEdges()[0];
    if (event.target.dataset.prop && node) {
      const key = event.target.dataset.prop;
      node.style[key] = event.target.type === "number" ? Number(event.target.value) : event.target.value;
    } else if (event.target.dataset.nodeProp && node) {
      const key = event.target.dataset.nodeProp;
      let value = Number(event.target.value);
      if (["width", "height"].includes(key)) value = Math.max(key === "width" ? 40 : 28, value);
      node[key] = value;
      node.x = clamp(node.x, CANVAS.padding, CANVAS.width - node.width - CANVAS.padding);
      node.y = clamp(node.y, CANVAS.padding, CANVAS.height - node.height - CANVAS.padding);
    } else if (event.target.dataset.edgeProp && edge) {
      edge[event.target.dataset.edgeProp] = event.target.value;
    } else if (event.target.dataset.edgeStyle && edge) {
      const key = event.target.dataset.edgeStyle;
      edge.style[key] = event.target.type === "number" ? Number(event.target.value) : event.target.value;
    } else return;
    commit("Changed properties");
    render();
  }

  function handlePropertiesClick(event) {
    const propButton = event.target.closest("[data-prop-button]");
    const arrange = event.target.closest("[data-arrange]");
    const action = event.target.closest("[data-panel-action]");
    if (propButton) {
      const node = selectedNodes()[0];
      if (!node) return;
      const key = propButton.dataset.propButton;
      node.style[key] = propButton.dataset.value === "true" ? true : propButton.dataset.value === "false" ? false : propButton.dataset.value;
      commit("Changed text style"); render();
    } else if (arrange) arrangeSelection(arrange.dataset.arrange);
    else if (action) handlePanelAction(action.dataset.panelAction);
  }

  function arrangeSelection(kind) {
    const nodes = selectedNodes();
    if (nodes.length < 2) return;
    const minX = Math.min(...nodes.map((node) => node.x));
    const maxX = Math.max(...nodes.map((node) => node.x + node.width));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxY = Math.max(...nodes.map((node) => node.y + node.height));
    if (kind === "left") nodes.forEach((node) => { node.x = minX; });
    if (kind === "center") nodes.forEach((node) => { node.x = (minX + maxX - node.width) / 2; });
    if (kind === "right") nodes.forEach((node) => { node.x = maxX - node.width; });
    if (kind === "top") nodes.forEach((node) => { node.y = minY; });
    if (kind === "middle") nodes.forEach((node) => { node.y = (minY + maxY - node.height) / 2; });
    if (kind === "bottom") nodes.forEach((node) => { node.y = maxY - node.height; });
    if (kind === "horizontal") distribute(nodes, "x", "width");
    if (kind === "vertical") distribute(nodes, "y", "height");
    commit(`${kind[0].toUpperCase()}${kind.slice(1)} arrangement`);
    render();
  }

  function distribute(nodes, axis, sizeKey) {
    if (nodes.length < 3) return;
    const sorted = [...nodes].sort((a, b) => a[axis] - b[axis]);
    const first = sorted[0][axis];
    const lastEnd = sorted.at(-1)[axis] + sorted.at(-1)[sizeKey];
    const totalSize = sorted.reduce((sum, node) => sum + node[sizeKey], 0);
    const gap = (lastEnd - first - totalSize) / (sorted.length - 1);
    let cursor = first;
    sorted.forEach((node) => { node[axis] = cursor; cursor += node[sizeKey] + gap; });
  }

  function handlePanelAction(action) {
    if (action === "delete") return deleteSelection();
    if (action === "duplicate") return duplicateSelection();
    if (action === "group") {
      const groupId = uid("group"); selectedNodes().forEach((node) => { node.groupId = groupId; }); commit("Grouped selection"); render(); return;
    }
    if (action === "ungroup") { selectedNodes().forEach((node) => { node.groupId = null; }); commit("Ungrouped selection"); render(); return; }
    changeLayer(action);
  }

  function changeLayer(action) {
    const node = selectedNodes()[0];
    if (!node) return;
    const sorted = [...state.nodes].sort((a, b) => a.zIndex - b.zIndex);
    const index = sorted.findIndex((item) => item.id === node.id);
    if (action === "front") sorted.splice(index, 1), sorted.push(node);
    if (action === "back") sorted.splice(index, 1), sorted.unshift(node);
    if (action === "forward" && index < sorted.length - 1) [sorted[index], sorted[index + 1]] = [sorted[index + 1], sorted[index]];
    if (action === "backward" && index > 0) [sorted[index], sorted[index - 1]] = [sorted[index - 1], sorted[index]];
    sorted.forEach((item, position) => { item.zIndex = position; });
    commit("Changed layer order"); render();
  }

  function projectData() {
    return {
      version: 1, documentTitle: state.documentTitle, canvas: clone(CANVAS), nodes: clone(state.nodes),
      edges: clone(state.edges), zoom: state.zoom, pan: clone(state.pan), snap: state.snap
    };
  }

  function normalizeProject(data) {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error("Invalid project file");
    return {
      documentTitle: String(data.documentTitle || "Untitled Flowchart"),
      nodes: data.nodes.map((node, index) => ({ ...createNode(node.type || "process", 0, 0, ""), ...node, style: { ...DEFAULT_NODE_STYLE, ...(node.style || {}) }, zIndex: Number(node.zIndex ?? index) })),
      edges: data.edges.map((edge) => ({ ...edge, id: edge.id || uid("edge"), type: edge.type || "straight", label: edge.label || "", style: { ...DEFAULT_EDGE_STYLE, ...(edge.style || {}) } })),
      zoom: clamp(Number(data.zoom) || 1, .2, 3), pan: { x: Number(data.pan?.x) || 0, y: Number(data.pan?.y) || 0 }, snap: data.snap !== false
    };
  }

  function loadProject(data, message = "Loaded project") {
    const normalized = normalizeProject(data);
    state = { ...state, ...normalized, selectedIds: [], history: [], historyIndex: -1, mode: "select" };
    state.history = [snapshot()]; state.historyIndex = 0;
    refs.title.value = state.documentTitle; refs.snap.checked = state.snap;
    render(); setStatus(message);
  }

  function saveLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projectData()));
    setStatus("Saved in this browser");
  }

  function loadLocal() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { setStatus("No saved project in this browser"); return; }
    try { loadProject(JSON.parse(raw), "Loaded saved project"); } catch { setStatus("The saved project could not be loaded"); }
  }

  function safeFileName(extension) {
    const name = state.documentTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "flowchart";
    return `${name}.${extension}`;
  }

  function downloadBlob(blob, fileName) {
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url; link.download = fileName; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadJson() {
    downloadBlob(new Blob([JSON.stringify(projectData(), null, 2)], { type: "application/json" }), safeFileName("json"));
    setStatus("Downloaded project JSON");
  }

  function exportSvgString() {
    const bounds = diagramBounds();
    const padding = 32;
    const root = svgEl("svg", {
      xmlns: SVG_NS, viewBox: `${bounds.x - padding} ${bounds.y - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`,
      width: Math.ceil(bounds.width + padding * 2), height: Math.ceil(bounds.height + padding * 2)
    });
    const defs = svgEl("defs");
    defs.innerHTML = `<marker id="arrow-end" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke"/></marker><marker id="arrow-start" markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M9,0 L9,6 L0,3 z" fill="context-stroke"/></marker><marker id="circle-end" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto" markerUnits="strokeWidth"><circle cx="4" cy="4" r="2.5" fill="context-stroke"/></marker><marker id="diamond-end" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,4 L4,0 L8,4 L4,8 z" fill="context-stroke"/></marker>`;
    root.append(defs);
    const edgeGroup = svgEl("g");
    state.edges.forEach((edge) => renderEdgeInto(edge, edgeGroup));
    edgeGroup.querySelectorAll(".edge-hit").forEach((hit) => hit.remove());
    root.append(edgeGroup);
    const nodeGroup = svgEl("g");
    [...state.nodes].sort((a, b) => a.zIndex - b.zIndex).forEach((node) => renderNodeInto(node, nodeGroup));
    root.append(nodeGroup);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(root)}`;
  }

  function exportSvg() {
    if (!state.nodes.length) { setStatus("Add an object before exporting"); return; }
    downloadBlob(new Blob([exportSvgString()], { type: "image/svg+xml;charset=utf-8" }), safeFileName("svg"));
    setStatus("Exported SVG");
  }

  function exportPng() {
    if (!state.nodes.length) { setStatus("Add an object before exporting"); return; }
    const svg = exportSvgString();
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    image.onload = () => {
      const scale = Math.min(3, 2400 / Math.max(image.width, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(image.width * scale); canvas.height = Math.ceil(image.height * scale);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => { if (blob) downloadBlob(blob, safeFileName("png")); }, "image/png");
      URL.revokeObjectURL(url); setStatus("Exported PNG");
    };
    image.onerror = () => { URL.revokeObjectURL(url); setStatus("PNG export failed"); };
    image.src = url;
  }

  function handleToolbar(action) {
    const actions = {
      undo, redo, delete: deleteSelection, duplicate: duplicateSelection, clear: clearCanvas,
      "zoom-out": () => zoomAt(1 / 1.15), "zoom-in": () => zoomAt(1.15), "zoom-reset": () => { state.zoom = 1; render(); },
      fit: fitToScreen, save: saveLocal, load: loadLocal, "download-json": downloadJson,
      "import-json": () => refs.fileInput.click(), "export-svg": exportSvg, "export-png": exportPng
    };
    actions[action]?.();
  }

  function updateToolbar() {
    const disabled = {
      undo: state.historyIndex <= 0, redo: state.historyIndex >= state.history.length - 1,
      delete: !state.selectedIds.length, duplicate: !selectedNodes().length
    };
    Object.entries(disabled).forEach(([action, value]) => {
      const button = document.querySelector(`[data-action="${action}"]`);
      if (button) button.disabled = value;
    });
  }

  function setStatus(message) { refs.status.textContent = message; }

  function onKeyDown(event) {
    const typing = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName);
    if (event.code === "Space" && !typing) { spacePressed = true; event.preventDefault(); }
    if (typing) return;
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    else if (command && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
    else if (command && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelection(); }
    else if (command && event.key.toLowerCase() === "c") { event.preventDefault(); copySelection(); }
    else if (command && event.key.toLowerCase() === "v") { event.preventDefault(); pasteSelection(); }
    else if (command && event.key.toLowerCase() === "s") { event.preventDefault(); saveLocal(); }
    else if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); deleteSelection(); }
    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const distance = event.shiftKey ? 10 : 1;
      moveSelection(event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0, event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0);
    } else if (!command && event.key.toLowerCase() === "v") setMode("select");
    else if (!command && event.key.toLowerCase() === "c") setMode("connect");
    else if (!command && event.key.toLowerCase() === "t") setMode("text");
  }

  function onKeyUp(event) {
    if (event.code === "Space") spacePressed = false;
    if (nudgePending && event.key.startsWith("Arrow")) { nudgePending = false; commit("Moved selection"); }
  }

  function bindEvents() {
    document.querySelector(".toolbar").addEventListener("click", (event) => {
      const mode = event.target.closest("[data-mode]");
      const action = event.target.closest("[data-action]");
      if (mode) setMode(mode.dataset.mode);
      if (action) handleToolbar(action.dataset.action);
    });
    refs.shapeList.addEventListener("click", (event) => {
      const item = event.target.closest("[data-shape]");
      if (item) addNode(item.dataset.shape, visibleCenter());
    });
    refs.shapeList.addEventListener("keydown", (event) => {
      if (["Enter", " "].includes(event.key) && event.target.dataset.shape) { event.preventDefault(); addNode(event.target.dataset.shape, visibleCenter()); }
    });
    refs.shapeList.addEventListener("dragstart", (event) => {
      const item = event.target.closest("[data-shape]");
      if (item) event.dataTransfer.setData("text/x-flowchart-shape", item.dataset.shape);
    });
    refs.svg.addEventListener("dragover", (event) => { if (event.dataTransfer.types.includes("text/x-flowchart-shape")) event.preventDefault(); });
    refs.svg.addEventListener("drop", (event) => { const type = event.dataTransfer.getData("text/x-flowchart-shape"); if (type) { event.preventDefault(); addNode(type, screenToWorld(event.clientX, event.clientY)); } });
    refs.svg.addEventListener("pointerdown", onPointerDown);
    refs.svg.addEventListener("pointermove", onPointerMove);
    refs.svg.addEventListener("pointerup", onPointerUp);
    refs.svg.addEventListener("pointercancel", onPointerUp);
    refs.svg.addEventListener("dblclick", (event) => {
      const node = event.target.closest?.("[data-node-id]");
      const edgeText = event.target.closest?.("[data-text-edge]");
      if (node) beginTextEditing("node", node.dataset.nodeId);
      else if (edgeText) beginTextEditing("edge", edgeText.dataset.textEdge);
      else if (event.target.closest?.(".workspace-bg, .grid")) {
        const textNode = addNode("text", screenToWorld(event.clientX, event.clientY)); beginTextEditing("node", textNode.id);
      }
      event.preventDefault();
    });
    refs.svg.addEventListener("wheel", (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault(); zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX, event.clientY);
    }, { passive: false });
    refs.editor.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); editing.cancelled = true; finishTextEditing(false); }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); finishTextEditing(true); }
    });
    refs.editor.addEventListener("blur", () => finishTextEditing(true));
    refs.propertiesContent.addEventListener("change", handlePropertyChange);
    refs.propertiesContent.addEventListener("click", handlePropertiesClick);
    refs.title.addEventListener("change", () => { state.documentTitle = refs.title.value.trim() || "Untitled Flowchart"; refs.title.value = state.documentTitle; commit("Renamed document"); });
    refs.snap.addEventListener("change", () => { state.snap = refs.snap.checked; commit(state.snap ? "Snap enabled" : "Snap disabled"); render(); });
    refs.fileInput.addEventListener("change", async () => {
      const file = refs.fileInput.files[0]; refs.fileInput.value = "";
      if (!file) return;
      try { loadProject(JSON.parse(await file.text()), "Imported project"); } catch { setStatus("That file is not a valid project"); }
    });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", () => { spacePressed = false; });
    new ResizeObserver(() => {
      const rect = refs.svg.getBoundingClientRect();
      refs.svg.setAttribute("viewBox", `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`);
    }).observe(refs.shell);
  }

  createShapePalette();
  bindEvents();
  refs.title.value = state.documentTitle;
  refs.snap.checked = state.snap;
  setMode("select");
  requestAnimationFrame(fitToScreen);
})();
