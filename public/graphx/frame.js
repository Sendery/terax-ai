/* Trusted frame adapter. Graph data never supplies script or markup. */
(() => {
  const token = location.hash.slice(1);
  const host = document.getElementById("graph");
  const status = document.getElementById("status");
  let graph = null;
  let generation = 0;
  const reply = (type, extra = {}) => parent.postMessage({ type, token, ...extra }, "*");
  const escape = value => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  addEventListener("message", async event => {
    if (event.source !== parent || event.data?.token !== token) return;
    if (event.data?.type === "terax:graphx:hello") { reply("terax:graphx:ready"); return; }
    if (event.data?.type !== "terax:graphx:render" || graph) return;
    const own = ++generation;
    try {
      graph?.destroy();
      const spec = event.data.spec;
      if (spec.tour) spec.tour.steps = spec.tour.steps.map(step => ({ ...step, body_html: escape(step.body || "") }));
      document.documentElement.dataset.theme = event.data.theme === "dark" ? "dark" : "light";
      GraphX.injectCSS();
      graph = GraphX.mount(host, spec, { height: Math.max(180, innerHeight), lang: spec.lang || "en" });
      status.hidden = true;
      await graph.ready;
      if (generation === own) reply("terax:graphx:rendered", { revision: event.data.revision });
    } catch (error) {
      if (generation !== own) return;
      status.hidden = false;
      status.textContent = "Graph layout failed. Edit the JSON and apply again.";
      reply("terax:graphx:error", { revision: event.data.revision });
    }
  });
  new ResizeObserver(() => host.style.setProperty("--gx-h", Math.max(180, innerHeight) + "px")).observe(document.body);
  addEventListener("pagehide", () => { generation++; graph?.destroy(); });
  reply("terax:graphx:ready");
})();
