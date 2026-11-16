/* Trusted frame adapter. Graph data never supplies script or markup. */
(() => {
  const token = location.hash.slice(1);
  const host = document.getElementById("graph");
  const status = document.getElementById("status");
  let graph = null;
  let generation = 0;
  let owner = null;
  let rendered = false;
  let capture = null;
  const reply = (type, extra = {}) => parent.postMessage({ type, token, ...owner, ...extra }, "*");
  const escape = value => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const receipt = () => {
    const svg = host.querySelector(".gx-svg");
    const rect = svg?.getBoundingClientRect();
    return { nodes: host.querySelectorAll(".gx-node").length, paths: host.querySelectorAll("svg path").length,
      width: Math.round(rect?.width || 0), height: Math.round(rect?.height || 0) };
  };
  const cancelCapture = () => { capture?.cancel(); capture = null; };
  async function snapshot(requestId) {
    if (!rendered || capture || typeof requestId !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(requestId)) {
      reply("terax:graphx:capture-error", { requestId }); return;
    }
    const own = generation, width = innerWidth, height = innerHeight;
    let image = null, canvas = null, stopped = false;
    const task = { requestId, cancel() { stopped = true; if (image) { image.src = ""; image.onerror?.(); } } };
    capture = task;
    try {
      if (width < 1 || height < 1 || width > 7680 || height > 4320 || width * height > 16777216) throw Error("size");
      const clone = host.cloneNode(true);
      const sources = [host, ...host.querySelectorAll("*")], clones = [clone, ...clone.querySelectorAll("*")];
      if (sources.length > 12000) throw Error("nodes");
      let styleBytes = 0;
      for (let i = 0; i < sources.length; i++) {
        const source = sources[i], target = clones[i], style = getComputedStyle(source);
        let css = "";
        for (const property of style) {
          if (property === "cursor" || property === "pointer-events") continue;
          css += property + ":" + style.getPropertyValue(property) + ";";
        }
        styleBytes += css.length;
        if (styleBytes > 6 * 1024 * 1024) throw Error("styles");
        target.setAttribute("style", css);
        target.removeAttribute("class");
        if (source instanceof HTMLInputElement) target.setAttribute("value", source.value);
        if (source instanceof HTMLTextAreaElement) target.textContent = source.value;
      }
      clone.style.cssText += ";margin:0;position:relative;inset:auto;transform:none;width:" + width + "px;height:" + height + "px;overflow:hidden;";
      const markup = new XMLSerializer().serializeToString(clone);
      if (markup.length > 8 * 1024 * 1024) throw Error("markup");
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><foreignObject width="100%" height="100%">' + markup + '</foreignObject></svg>';
      image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve; image.onerror = () => reject(Error("image"));
        image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      });
      if (stopped || generation !== own || width !== innerWidth || height !== innerHeight) throw Error("retired");
      canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw Error("canvas");
      context.drawImage(image, 0, 0);
      const png = canvas.toDataURL("image/png");
      if (png.length > 12 * 1024 * 1024) throw Error("bytes");
      reply("terax:graphx:captured", { requestId, png, width, height, receipt: receipt() });
    } catch {
      if (!stopped && generation === own) reply("terax:graphx:capture-error", { requestId });
    } finally {
      if (image) { image.onload = null; image.onerror = null; image.src = ""; }
      if (canvas) canvas.width = canvas.height = 0;
      if (capture === task) capture = null;
    }
  }
  addEventListener("message", async event => {
    if (event.source !== parent || event.data?.token !== token) return;
    const data = event.data;
    if (data.type === "terax:graphx:hello") { reply("terax:graphx:ready"); return; }
    if (owner && data.documentId === owner.documentId && data.revision === owner.revision) {
      if (data.type === "terax:graphx:capture") { void snapshot(data.requestId); return; }
      if (data.type === "terax:graphx:cancel-capture") { if (capture?.requestId === data.requestId) cancelCapture(); return; }
    }
    if (data.type !== "terax:graphx:render" || graph || typeof data.documentId !== "string" || data.documentId.length > 64 || !Number.isSafeInteger(data.revision)) return;
    owner = { documentId: data.documentId, revision: data.revision };
    const own = ++generation;
    try {
      const spec = data.spec;
      if (spec.tour) spec.tour.steps = spec.tour.steps.map(step => ({ ...step, body_html: escape(step.body || "") }));
      document.documentElement.dataset.theme = data.theme === "dark" ? "dark" : "light";
      GraphX.injectCSS();
      graph = GraphX.mount(host, spec, { height: Math.max(180, innerHeight), lang: spec.lang || "en" });
      status.hidden = true;
      await graph.ready;
      if (generation === own) {
        rendered = true;
        reply("terax:graphx:rendered", { receipt: receipt() });
      }
    } catch {
      if (generation !== own) return;
      status.hidden = false;
      status.textContent = "Graph layout failed. Edit the JSON and apply again.";
      reply("terax:graphx:error");
    }
  });
  new ResizeObserver(() => host.style.setProperty("--gx-h", Math.max(180, innerHeight) + "px")).observe(document.body);
  addEventListener("pagehide", () => { generation++; rendered = false; cancelCapture(); graph?.destroy(); });
  reply("terax:graphx:ready");
})();
