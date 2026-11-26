/* llm-bench dashboard. Draws site/data.json (built by scripts/build_site_data.py).
   No dependencies, no build step. All statistics are precomputed; this file only draws.
   Every label from the data goes into the DOM through textContent, never innerHTML. */
"use strict";
(function () {
  // ------------------------------------------------------------------ palette (validated: see README)
  const SERIES = {
    light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
    dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"],
  };
  // Sequential blue, steps 100 -> 700. Light mode: low = light. Dark mode flips the anchor.
  const BLUE = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6",
    "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"];
  const CHROME = {
    light: { surface: "#fcfcfb", ink: "#0b0b0b", ink2: "#52514e", muted: "#898781", grid: "#e1e0d9",
      axis: "#c3c2b7", accent: "#2a78d6", soft: "#6da7ec", strong: "#184f95" },
    dark: { surface: "#1a1a19", ink: "#f0efec", ink2: "#c3c2b7", muted: "#898781", grid: "#2c2c2a",
      axis: "#383835", accent: "#3987e5", soft: "#2a78d6", strong: "#b7d3f6" },
  };
  const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" };

  function mode() {
    const t = document.documentElement.dataset.theme;
    if (t === "light" || t === "dark") return t;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  const C = () => Object.assign({ series: SERIES[mode()] }, CHROME[mode()]);
  const seq = (v) => {
    const i = Math.max(0, Math.min(12, Math.round(v * 12)));
    return mode() === "dark" ? BLUE[12 - i] : BLUE[i];
  };
  function lum(hex) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const inkOn = (hex) => (contrast(hex, "#ffffff") >= contrast(hex, "#0b0b0b") ? "#ffffff" : "#0b0b0b");

  // ------------------------------------------------------------------ vocabulary (public, no task content)
  const CAT = {
    all: "All categories", bug_localization: "Bug finding", bug_fix: "Bug fixing", feature: "Features",
    test_writing: "Test writing", debugging_rca: "Root-cause debugging", code_comprehension: "Code comprehension",
    security_review: "Security review", system_design: "System design", migration_data: "Migrations and data",
    ui_functional: "UI behaviour", honesty: "Honesty",
  };
  const KIND = { patch: "patch", findings: "findings", answer: "answer", rubric: "rubric" };
  const FLAG = {
    budget_exhausted: ["Ran out of budget", "Hit the turn, token, time or cost limit"],
    no_change: ["No change", "Finished without editing anything"],
    regression: ["Regression", "Broke a test that passed before"],
    test_tampering: ["Test tampering", "Edited or deleted tests instead of fixing code"],
    out_of_scope_edit: ["Out-of-scope edit", "Changed files outside the task's area"],
    no_verification: ["Didn't verify", "Never ran tests or the code before finishing"],
    overclaim: ["Overclaimed", "Said it was done or certain when it was not"],
    fabricated_reference: ["Made things up", "Cited files, lines or APIs that don't exist"],
    hallucinated_answer: ["Answered the unanswerable", "Gave an answer to a false-premise question"],
    wrong_abstention: ["Wrongly declined", "Said it couldn't tell when it could"],
    misread_task: ["Misread the task", "Solved a different problem"],
    wrong_localization: ["Wrong place", "Looked for the cause in the wrong code"],
    right_place_wrong_fix: ["Right place, wrong fix", "Found the code but fixed it incorrectly"],
    partial_fix: ["Partial fix", "Fixed some cases, not all"],
    symptom_patch: ["Patched the symptom", "Hid the failure instead of fixing the cause"],
    overengineered: ["Overengineered", "Far more change or machinery than needed"],
    shallow_reasoning: ["Shallow reasoning", "Missed the key constraint or trade-off"],
    gave_up: ["Gave up", "Stopped without a real attempt"],
    other: ["Other", "Reviewed by hand; none of the above"],
  };
  const SPLIT = { dev: "Dev", heldout: "Held-out" };
  const TRACK = {
    controlled: ["Controlled", "Every model gets the same agent loop, tools, prompts and limits."],
    native: ["Native agents", "Each model runs in its vendor's own coding CLI, in the same sandbox."],
  };

  // ------------------------------------------------------------------ formatting
  const MINUS = "−";
  const f2 = (v) => (v == null ? "–" : v.toFixed(2));
  const sgn = (v) => (v == null ? "–" : Math.abs(v) < 0.005 ? "0.00" : (v > 0 ? "+" : MINUS) + Math.abs(v).toFixed(2));
  const pct = (v) => (v == null ? "–" : Math.round(v * 100) + "%");
  const usd = (v) => (v == null ? "–" : v >= 100 ? "$" + Math.round(v).toLocaleString("en-US")
    : "$" + v.toFixed(v < 0.1 ? 3 : 2));
  const secs = (v) => (v == null ? "–" : v < 120 ? Math.round(v) + " s" : (v / 60).toFixed(1) + " min");
  const compact = (v) => (v == null ? "–" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e4 ? Math.round(v / 1e3) + "K"
    : Math.round(v).toLocaleString("en-US"));
  const ci = (e) => (e ? `[${f2(e.lo)}, ${f2(e.hi)}]` : "–");
  const num = (v) => (v == null ? "–" : Number(v).toLocaleString("en-US"));
  const day = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US",
    { month: "short", day: "numeric", timeZone: "UTC" });

  // ------------------------------------------------------------------ DOM helpers
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "style") Object.assign(e.style, v);
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return e;
  }
  const NS = "http://www.w3.org/2000/svg";
  function s(parent, tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  const mctx = document.createElement("canvas").getContext("2d");
  function measure(str, size = 12, weight = 400) {
    mctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    return mctx.measureText(String(str)).width;
  }
  const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
  function niceTicks(d0, d1, n = 5) {
    const span = d1 - d0;
    if (!(span > 0)) return [d0];
    const raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), e = raw / mag;
    const step = (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1) * mag;
    const out = [];
    for (let v = Math.ceil(d0 / step - 1e-9) * step; v <= d1 + step * 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function logTicks(d0, d1) {
    const out = [];
    for (let p = Math.floor(Math.log10(d0)); p <= Math.ceil(Math.log10(d1)); p++) {
      for (const m of [1, 2, 5]) { const v = m * Math.pow(10, p); if (v >= d0 && v <= d1) out.push(v); }
    }
    return out;
  }

  // ------------------------------------------------------------------ tooltip (values lead, labels follow)
  const tipEl = document.getElementById("tooltip");
  function showTip(x, y, title, rows) {
    tipEl.replaceChildren();
    if (title) tipEl.append(h("div", { class: "tt-title" }, title));
    for (const r of rows) {
      tipEl.append(h("div", { class: "tt-row" },
        h("span", { class: "tt-key", style: r.color ? { background: r.color } : {} }),
        h("b", null, r.value), h("span", { class: "l" }, r.label || "")));
    }
    tipEl.hidden = false;
    const w = tipEl.offsetWidth, ht = tipEl.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + w > innerWidth - 8) left = x - w - 14;
    if (top + ht > innerHeight - 8) top = y - ht - 14;
    tipEl.style.left = Math.max(8, left) + "px";
    tipEl.style.top = Math.max(8, top) + "px";
  }
  const hideTip = () => { tipEl.hidden = true; };
  function bindTip(node, content) {
    node.setAttribute("tabindex", "0");
    node.addEventListener("pointermove", (e) => { const [t, r] = content(); showTip(e.clientX, e.clientY, t, r); });
    node.addEventListener("pointerleave", hideTip);
    node.addEventListener("focus", () => {
      const b = node.getBoundingClientRect(); const [t, r] = content(); showTip(b.right, b.top + b.height / 2, t, r);
    });
    node.addEventListener("blur", hideTip);
    const [t, r] = content();
    node.setAttribute("aria-label", [t, ...r.map((x) => (x.label ? `${x.label}: ${x.value}` : x.value))].join("; "));
  }

  // ------------------------------------------------------------------ shared pieces
  function statusIcon(kind) {
    const svg = s(null, "svg", { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": "true" });
    if (kind === "good") {
      s(svg, "circle", { cx: 7, cy: 7, r: 7, fill: STATUS.good });
      s(svg, "path", { d: "M4 7.2l2 2 4-4.4", fill: "none", stroke: "#fff", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round" });
    } else if (kind === "warning") {
      s(svg, "path", { d: "M7 1L13.5 12.5H0.5Z", fill: STATUS.warning, "stroke-linejoin": "round" });
      s(svg, "rect", { x: 6.2, y: 4.8, width: 1.6, height: 4, rx: 0.8, fill: "#0b0b0b" });
      s(svg, "circle", { cx: 7, cy: 10.6, r: 0.9, fill: "#0b0b0b" });
    } else if (kind === "critical") {
      s(svg, "circle", { cx: 7, cy: 7, r: 7, fill: STATUS.critical });
      s(svg, "path", { d: "M4.6 4.6l4.8 4.8M9.4 4.6l-4.8 4.8", stroke: "#fff", "stroke-width": 1.8, "stroke-linecap": "round" });
    } else {
      s(svg, "circle", { cx: 7, cy: 7, r: 6, fill: "none", stroke: C().muted, "stroke-width": 1.5 });
      s(svg, "path", { d: "M4.5 7h5", stroke: C().muted, "stroke-width": 1.5, "stroke-linecap": "round" });
    }
    return svg;
  }
  const status = (kind, text) => h("span", { class: "status" }, statusIcon(kind), text);

  function legend(items) {
    return h("div", { class: "legend" }, items.map((it) => h("span", null,
      it.kind === "ramp" ? [h("span", { class: "dim" }, it.lo), h("span", { class: "key-ramp", style: { background: it.color } }), h("span", { class: "dim" }, it.hi)]
        : h("span", { class: it.kind === "line" ? "key-line" : "key-dot", style: { background: it.color } }),
      it.kind === "ramp" ? null : it.label)));
  }
  const rampCss = () => `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(seq).join(", ")})`;

  function tableView({ cols, rows }) {
    return h("div", { class: "tbl-wrap" }, h("table", null,
      h("thead", null, h("tr", null, cols.map((c) => h("th", { class: c.num ? "num" : null, scope: "col" }, c.label)))),
      h("tbody", null, rows.map((r) => h("tr", null, r.map((v, i) => h("td", { class: cols[i].num ? "num" : null }, v)))))));
  }

  function card({ id, title, sub, note, legendEl, draw, table, plain }) {
    const body = h("div", { class: "chart" });
    const asTable = state.tables.has(id);
    const btn = table ? h("button", {
      class: "toggle ghost", type: "button", "aria-pressed": String(asTable), "data-focus": id + "-toggle",
      onclick: () => { asTable ? state.tables.delete(id) : state.tables.add(id); state.refocus = id + "-toggle"; render(); },
    }, asTable ? "Show chart" : "Show table") : null;
    const el = h("section", { class: "card", id, "aria-labelledby": id + "-t" },
      h("div", { class: "card-head" }, h("h2", { id: id + "-t" }, title), btn),
      sub ? h("p", { class: "card-sub" }, sub) : null,
      legendEl && !asTable ? legendEl : null, body,
      note ? h("p", { class: "card-note" }, note) : null);
    const mount = () => {
      if (asTable && table) body.append(tableView(table()));
      else if (plain) body.append(plain());
      else draw(body, Math.max(260, body.clientWidth));
    };
    return { el, mount };
  }
  const empty = (text) => h("p", { class: "empty" }, text);

  // ------------------------------------------------------------------ state
  let DATA = null, MODELS = {};
  const state = { track: null, split: null, tables: new Set(), refocus: null };
  const slice = () => DATA.slices[`${state.track}/${state.split}`];
  const label = (key) => {
    const m = MODELS[key];
    if (!m) return key;
    return state.track === "native" ? `${m.label} · ${m.agent}` : m.label;
  };
  const colorOf = (key) => { const m = MODELS[key]; return m && m.slot != null ? C().series[m.slot] : C().muted; };
  const catsOf = (S) => DATA.meta.category_order.filter((c) => S.by_category[c]);

  // ------------------------------------------------------------------ charts
  // Row labels sit left of the plot; when they would take more than 40% of the width
  // (phones, long pair names) each label moves above its row instead of being cut off.
  function rowChartFrame(el, W, labels, nRows, right) {
    const need = Math.max(...labels.map((t) => measure(t, 12.5))) + 16;
    const stack = need > W * 0.4;
    const L = stack ? 4 : need;
    const T = 6, rowH = stack ? 46 : 34, B = 28;
    const H = T + nRows * rowH + B;
    const svg = s(el, "svg", { width: W, height: H });
    const f = { svg, L, R: right, T, rowH, B, H, plotB: T + nRows * rowH };
    f.rowTop = (i) => T + i * rowH;
    f.cy = (i) => T + i * rowH + (stack ? 31 : rowH / 2);
    f.label = (i, text) => (stack
      ? s(svg, "text", { x: L, y: T + i * rowH + 13, class: "ink" }, text)
      : s(svg, "text", { x: L - 12, y: f.cy(i) + 4, "text-anchor": "end", class: "ink" }, text));
    return f;
  }
  function xGrid(svg, x, ticks, y0, y1, fmt) {
    const g = s(svg, "g", { class: "grid" }), t = s(svg, "g", { class: "tick" });
    for (const v of ticks) {
      s(g, "line", { x1: x(v), x2: x(v), y1: y0, y2: y1 });
      s(t, "text", { x: x(v), y: y1 + 17, "text-anchor": "middle" }, fmt(v));
    }
  }

  // Dot + 95% interval per model. One series, so one colour and no legend box.
  function drawIntervals(el, W, rows) {
    const c = C();
    const f = rowChartFrame(el, W, rows.map((r) => r.label), rows.length, 54);
    const x = lin(0, 1, f.L, W - f.R);
    xGrid(f.svg, x, [0, 0.25, 0.5, 0.75, 1], f.T, f.plotB, (v) => (v === 0 || v === 1 ? String(v) : v.toFixed(2)));
    rows.forEach((r, i) => {
      const cy = f.cy(i);
      f.label(i, r.label);
      const g = s(f.svg, "g", { class: "mark" });
      s(g, "rect", { class: "hit", x: f.L, y: f.rowTop(i), width: W - f.R - f.L, height: f.rowH });
      s(g, "line", { class: "lift", x1: x(r.e.lo), x2: x(r.e.hi), y1: cy, y2: cy, stroke: c.accent, "stroke-width": 2, "stroke-linecap": "round" });
      s(g, "circle", { class: "lift", cx: x(r.e.mean), cy, r: 5, fill: c.accent, stroke: c.surface, "stroke-width": 2 });
      s(f.svg, "text", { x: W - f.R + 10, y: cy + 4, class: "ink" }, f2(r.e.mean));
      bindTip(g, () => [r.label, [
        { value: f2(r.e.mean), label: "mean score", color: c.accent },
        { value: ci(r.e), label: "95% interval" },
        { value: `${r.e.n_tasks} tasks, ${r.e.n_runs} runs`, label: "" }]]);
    });
  }

  // Paired differences: emphasis form. Accent when the interval excludes zero, grey when it doesn't.
  function drawForest(el, W, rows) {
    const c = C();
    const f = rowChartFrame(el, W, rows.map((r) => r.label), rows.length, 58);
    const m = Math.max(0.2, Math.ceil(Math.max(...rows.map((r) => Math.max(Math.abs(r.d.lo), Math.abs(r.d.hi)))) * 10) / 10);
    const x = lin(-m, m, f.L, W - f.R);
    const ticks = niceTicks(-m, m, W < 480 ? 2 : 4);
    xGrid(f.svg, x, ticks, f.T, f.plotB, (v) => (v === 0 ? "0" : sgn(v)));
    s(f.svg, "line", { class: "axis", x1: x(0), x2: x(0), y1: f.T, y2: f.plotB });
    rows.forEach((r, i) => {
      const cy = f.cy(i);
      const sure = r.d.lo > 0 || r.d.hi < 0;
      const col = sure ? c.accent : c.muted;
      f.label(i, r.label);
      const g = s(f.svg, "g", { class: "mark" });
      s(g, "rect", { class: "hit", x: f.L, y: f.rowTop(i), width: W - f.R - f.L, height: f.rowH });
      s(g, "line", { class: "lift", x1: x(r.d.lo), x2: x(r.d.hi), y1: cy, y2: cy, stroke: col, "stroke-width": 2, "stroke-linecap": "round" });
      s(g, "circle", { class: "lift", cx: x(r.d.mean), cy, r: 5, fill: col, stroke: c.surface, "stroke-width": 2 });
      s(f.svg, "text", { x: W - f.R + 10, y: cy + 4, class: sure ? "ink" : "muted" }, sgn(r.d.mean));
      bindTip(g, () => [r.label, [
        { value: sgn(r.d.mean), label: "mean difference", color: col },
        { value: `[${sgn(r.d.lo)}, ${sgn(r.d.hi)}]`, label: "95% interval" },
        { value: pct(r.d.p_a_better), label: "of resamples where the first is ahead" },
        { value: `${r.d.n_tasks} shared tasks`, label: sure ? "" : "can't tell apart" }]]);
    });
  }

  // Two values per row on one 0-1 axis (1 hue, 2 shades).
  function drawDumbbell(el, W, rows, names) {
    const c = C();
    const f = rowChartFrame(el, W, rows.map((r) => r.label), rows.length, Math.max(64, ...rows.map((r) => measure(r.right, 12) + 18)));
    const x = lin(0, 1, f.L, W - f.R);
    xGrid(f.svg, x, [0, 0.25, 0.5, 0.75, 1], f.T, f.plotB, (v) => (v === 0 || v === 1 ? String(v) : v.toFixed(2)));
    rows.forEach((r, i) => {
      const cy = f.cy(i);
      f.label(i, r.label);
      const g = s(f.svg, "g", { class: "mark" });
      s(g, "rect", { class: "hit", x: f.L, y: f.rowTop(i), width: W - f.R - f.L, height: f.rowH });
      s(g, "line", { x1: x(r.a), x2: x(r.b), y1: cy, y2: cy, stroke: c.axis, "stroke-width": 2 });
      s(g, "circle", { class: "lift", cx: x(r.a), cy, r: 5, fill: c.soft, stroke: c.surface, "stroke-width": 2 });
      s(g, "circle", { class: "lift", cx: x(r.b), cy, r: 5, fill: c.strong, stroke: c.surface, "stroke-width": 2 });
      s(f.svg, "text", { x: W - f.R + 10, y: cy + 4, class: "ink" }, r.right);
      bindTip(g, () => [r.label, [
        { value: f2(r.a), label: names[0], color: c.soft },
        { value: f2(r.b), label: names[1], color: c.strong }, ...(r.extra || [])]]);
    });
  }

  // Model x category. Sequential blue = score; whisker inside each cell = 95% interval on 0-1.
  function drawHeatmap(el, W, S) {
    const c = C();
    const cats = catsOf(S), models = S.order;
    const rowLabels = cats.map((k) => CAT[k] || k);
    const L = Math.min(Math.max(...rowLabels.map((t) => measure(t, 12.5, 500))) + 18, 200);
    const colW = Math.max(76, Math.min(170, (W - L) / models.length));  // narrow screens scroll sideways
    el.style.overflowX = "auto";
    const heads = models.map(label);
    const rotate = heads.some((t) => measure(t, 12) > colW - 8);
    const headH = rotate ? Math.min(110, Math.max(...heads.map((t) => measure(t, 12))) * 0.7 + 18) : 26;
    const cellH = 58, H = headH + cats.length * cellH + 4;
    const svg = s(el, "svg", { width: L + colW * models.length + (rotate ? 48 : 0), height: H });
    heads.forEach((t, j) => {
      const cx = L + colW * j + colW / 2;
      if (rotate) s(svg, "text", { x: cx - 4, y: headH - 8, transform: `rotate(-35 ${cx - 4} ${headH - 8})`, class: "ink" }, t);
      else s(svg, "text", { x: cx, y: headH - 10, "text-anchor": "middle", class: "ink" }, t);
    });
    cats.forEach((cat, i) => {
      const y = headH + i * cellH;
      const n = Math.max(0, ...Object.values(S.by_category[cat]).map((e) => e.n_tasks));
      s(svg, "text", { x: 0, y: y + cellH / 2 - 2, class: "ink", "font-weight": 500 }, CAT[cat] || cat);
      s(svg, "text", { x: 0, y: y + cellH / 2 + 14, class: "muted" }, `${n} task${n === 1 ? "" : "s"}`);
      models.forEach((m, j) => {
        const e = S.by_category[cat][m];
        const x0 = L + colW * j;
        const g = s(svg, "g", { class: "mark" });
        if (!e) {
          s(g, "rect", { x: x0 + 1, y: y + 1, width: colW - 2, height: cellH - 2, rx: 4, fill: "none", stroke: c.grid });
          s(g, "text", { x: x0 + colW / 2, y: y + cellH / 2 + 4, "text-anchor": "middle", class: "muted" }, "–");
          return;
        }
        const fill = seq(e.mean), ink = inkOn(fill);
        s(g, "rect", { class: "lift", x: x0 + 1, y: y + 1, width: colW - 2, height: cellH - 2, rx: 4, fill });
        s(g, "text", { x: x0 + colW / 2, y: y + 23, "text-anchor": "middle", fill: ink, style: `fill:${ink}`, "font-size": 14, "font-weight": 600 }, f2(e.mean));
        const wx = lin(0, 1, x0 + 10, x0 + colW - 10);
        s(g, "line", { x1: wx(0), x2: wx(1), y1: y + 35, y2: y + 35, stroke: ink, "stroke-opacity": 0.22, "stroke-width": 1 });
        s(g, "line", { x1: wx(e.lo), x2: wx(e.hi), y1: y + 35, y2: y + 35, stroke: ink, "stroke-opacity": 0.85, "stroke-width": 2, "stroke-linecap": "round" });
        s(g, "circle", { cx: wx(e.mean), cy: y + 35, r: 2.5, fill: ink });
        s(g, "text", { x: x0 + colW / 2, y: y + 50, "text-anchor": "middle", style: `fill:${ink};opacity:.85`, "font-size": 10.5 }, `n=${e.n_tasks}`);
        bindTip(g, () => [`${CAT[cat] || cat} · ${label(m)}`, [
          { value: f2(e.mean), label: "mean score" }, { value: ci(e), label: "95% interval" },
          { value: `${e.n_tasks} tasks, ${e.n_runs} runs`, label: "" }]]);
      });
    });
  }

  // Score vs cost (or time). Emphasis: models on the frontier in accent, dominated ones grey.
  function drawScatter(el, W, rows, xName, xFmt) {
    const c = C();
    rows = rows.filter((r) => r.x != null && r.x > 0);
    if (!rows.length) { el.append(empty("No priced runs in this slice.")); return; }
    const M = { l: 40, r: 18, t: 22, b: 40 }, H = 290;
    const svg = s(el, "svg", { width: W, height: H });
    const xs = rows.map((r) => r.x), lo = Math.min(...xs), hi = Math.max(...xs);
    const useLog = hi / lo >= 6;
    let x, ticks;
    if (useLog) {
      const d0 = lo / 1.5, d1 = hi * 1.5;
      const l = lin(Math.log10(d0), Math.log10(d1), M.l, W - M.r);
      x = (v) => l(Math.log10(v)); ticks = logTicks(d0, d1);
    } else {
      const d1 = hi * 1.15; x = lin(0, d1, M.l, W - M.r); ticks = niceTicks(0, d1, 5);
    }
    const y0 = Math.max(0, Math.floor(Math.min(...rows.map((r) => r.e.lo)) * 10) / 10);
    const y1 = Math.min(1, Math.ceil(Math.max(...rows.map((r) => r.e.hi)) * 10) / 10);
    const y = lin(y0, y1, H - M.b, M.t);
    const gg = s(svg, "g", { class: "grid" }), gt = s(svg, "g", { class: "tick" });
    for (const v of niceTicks(y0, y1, 4)) {
      s(gg, "line", { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) });
      s(gt, "text", { x: M.l - 8, y: y(v) + 4, "text-anchor": "end" }, v.toFixed(1));
    }
    s(svg, "line", { class: "axis", x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b });
    for (const v of ticks) s(gt, "text", { x: x(v), y: H - M.b + 17, "text-anchor": "middle" }, xFmt(v));
    s(svg, "text", { x: (M.l + W - M.r) / 2, y: H - 4, "text-anchor": "middle", class: "muted" }, xName + (useLog ? " (log scale)" : ""));
    s(svg, "text", { x: M.l - 8, y: 11, class: "muted", "text-anchor": "start" }, "Score");

    // Pareto frontier: walking from cheapest, a model is on it if nothing cheaper scores at least as high.
    const sorted = [...rows].sort((a, b) => a.x - b.x || b.e.mean - a.e.mean);
    let best = -Infinity;
    for (const r of sorted) { r.front = r.e.mean > best; if (r.front) best = r.e.mean; }
    const fr = sorted.filter((r) => r.front);
    if (fr.length > 1) {
      let d = `M${x(fr[0].x)},${y(fr[0].e.mean)}`;
      for (const r of fr.slice(1)) d += `H${x(r.x)}V${y(r.e.mean)}`;
      s(svg, "path", { d, fill: "none", stroke: c.accent, "stroke-opacity": 0.35, "stroke-width": 2, "stroke-linejoin": "round" });
    }
    const placed = sorted.map((r) => { const px = x(r.x), py = y(r.e.mean); return [px - 7, py - 7, px + 7, py + 7]; });
    for (const r of sorted) {
      const px = x(r.x), py = y(r.e.mean), col = r.front ? c.accent : c.muted;
      const g = s(svg, "g", { class: "mark" });
      s(g, "line", { x1: px, x2: px, y1: y(r.e.lo), y2: y(r.e.hi), stroke: col, "stroke-width": 2, "stroke-opacity": 0.5, "stroke-linecap": "round" });
      s(g, "circle", { class: "lift", cx: px, cy: py, r: 5, fill: col, stroke: c.surface, "stroke-width": 2 });
      s(g, "circle", { class: "hit", cx: px, cy: py, r: 14 });
      // Direct label: first spot (right, left, then above or below) that clears every point and earlier label.
      const tw = measure(r.label, 12);
      const spots = [[px + 9, py + 4, "start"], [px - 9, py + 4, "end"], [px + 6, py - 10, "start"],
        [px + 6, py + 18, "start"], [px - 6, py - 10, "end"], [px - 6, py + 18, "end"]];
      const boxOf = ([lx, ly, a]) => (a === "start" ? [lx, ly - 10, lx + tw, ly + 3] : [lx - tw, ly - 10, lx, ly + 3]);
      const inside = (b) => b[0] >= M.l && b[2] <= W - 2 && b[1] >= 0 && b[3] <= H - M.b;
      const spot = spots.find((sp) => inside(boxOf(sp)) && !placed.some((b) => overlap(b, boxOf(sp)))) || spots[0];
      placed.push(boxOf(spot));
      s(svg, "text", { x: spot[0], y: spot[1], "text-anchor": spot[2], class: r.front ? "ink" : "" }, r.label);
      bindTip(g, () => [r.label, [
        { value: f2(r.e.mean), label: "score", color: col }, { value: ci(r.e), label: "95% interval" },
        { value: xFmt(r.x), label: xName.toLowerCase() },
        { value: r.front ? "on the frontier" : "dominated", label: "" }]]);
    }
  }
  const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

  // Reliability diagram, one small panel per model.
  function drawCalibration(el, W, S) {
    const c = C();
    const keys = S.order.filter((k) => S.calibration[k]);
    if (!keys.length) { el.append(empty("No task in this slice asks for a confidence.")); return; }
    const wrap = h("div", { class: "panels" });
    el.append(wrap);
    const P = 196, M = { l: 32, r: 10, t: 8, b: 30 };
    for (const k of keys) {
      const cal = S.calibration[k];
      const gap = cal.mean_conf - cal.accuracy;
      const panel = h("div", { class: "panel" },
        h("h3", null, label(k)),
        h("p", { class: "small dim" }, `Brier ${cal.brier.toFixed(3)} · n=${cal.n} · ` +
          (Math.abs(gap) < 0.03 ? "about right on average" : gap > 0 ? `overconfident by ${Math.round(gap * 100)} pts` : `underconfident by ${Math.round(-gap * 100)} pts`)));
      wrap.append(panel);
      const svg = s(panel, "svg", { width: P, height: P });
      const x = lin(0, 1, M.l, P - M.r), y = lin(0, 1, P - M.b, M.t);
      const gg = s(svg, "g", { class: "grid" }), gt = s(svg, "g", { class: "tick" });
      for (const v of [0, 0.5, 1]) {
        s(gg, "line", { x1: x(v), x2: x(v), y1: y(0), y2: y(1) });
        s(gg, "line", { x1: x(0), x2: x(1), y1: y(v), y2: y(v) });
        s(gt, "text", { x: x(v), y: P - M.b + 15, "text-anchor": "middle" }, String(v));
        s(gt, "text", { x: M.l - 6, y: y(v) + 4, "text-anchor": "end" }, String(v));
      }
      s(svg, "line", { class: "axis", x1: x(0), y1: y(0), x2: x(1), y2: y(1) });
      s(svg, "text", { x: (M.l + P - M.r) / 2, y: P - 2, "text-anchor": "middle", class: "muted" }, "stated confidence");
      const pts = cal.bins.filter((b) => b.n > 0);
      if (pts.length > 1) {
        s(svg, "path", { d: pts.map((b, i) => `${i ? "L" : "M"}${x(b.mean_conf)},${y(b.accuracy)}`).join(""),
          fill: "none", stroke: c.accent, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" });
      }
      for (const b of pts) {
        const g = s(svg, "g", { class: "mark" });
        s(g, "circle", { class: "lift", cx: x(b.mean_conf), cy: y(b.accuracy), r: 4.5, fill: c.accent, stroke: c.surface, "stroke-width": 2 });
        s(g, "circle", { class: "hit", cx: x(b.mean_conf), cy: y(b.accuracy), r: 12 });
        bindTip(g, () => [`${label(k)} · said ${pct(b.lo)}–${pct(b.hi)}`, [
          { value: pct(b.accuracy), label: "actually right", color: c.accent },
          { value: pct(b.mean_conf), label: "mean stated confidence" }, { value: `${b.n} answers`, label: "" }]]);
      }
    }
  }

  // Score per run over time, one line per model. Categorical colour follows the model, not its rank.
  function drawTrends(el, W, S) {
    const c = C();
    const keys = S.order.filter((k) => (S.trends[k] || []).length);
    const dates = [...new Set(keys.flatMap((k) => S.trends[k].map((p) => p.date)))].sort();
    if (dates.length < 2) { el.append(empty("Needs runs on two or more dates.")); return; }
    const t = (d) => Date.parse(d + "T00:00:00Z");
    const R = Math.max(...keys.map((k) => measure(label(k), 12))) + 34;
    const M = { l: 40, r: R, t: 12, b: 34 }, H = 280;
    const svg = s(el, "svg", { width: W, height: H });
    const x = lin(t(dates[0]), t(dates[dates.length - 1]), M.l + 8, W - M.r);
    const means = keys.flatMap((k) => S.trends[k].map((p) => p.mean));
    const y0 = Math.max(0, Math.floor((Math.min(...means) - 0.05) * 10) / 10);
    const y1 = Math.min(1, Math.ceil((Math.max(...means) + 0.05) * 10) / 10);
    const y = lin(y0, y1, H - M.b, M.t);
    const gg = s(svg, "g", { class: "grid" }), gt = s(svg, "g", { class: "tick" });
    for (const v of niceTicks(y0, y1, 4)) {
      s(gg, "line", { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) });
      s(gt, "text", { x: M.l - 8, y: y(v) + 4, "text-anchor": "end" }, v.toFixed(1));
    }
    s(svg, "line", { class: "axis", x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b });
    const shown = dates.length <= 8 ? dates : dates.filter((_, i) => i % Math.ceil(dates.length / 6) === 0);
    for (const d of shown) s(gt, "text", { x: x(t(d)), y: H - M.b + 17, "text-anchor": "middle" }, day(d));

    const ends = [];
    for (const k of keys) {
      const pts = S.trends[k], col = colorOf(k);
      if (pts.length > 1) {
        s(svg, "path", { d: pts.map((p, i) => `${i ? "L" : "M"}${x(t(p.date))},${y(p.mean)}`).join(""),
          fill: "none", stroke: col, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" });
      }
      for (const p of pts) s(svg, "circle", { cx: x(t(p.date)), cy: y(p.mean), r: 4, fill: col, stroke: c.surface, "stroke-width": 2 });
      const last = pts[pts.length - 1];
      ends.push({ k, col, px: x(t(last.date)), py: y(last.mean), ly: y(last.mean) });
    }
    // End labels in a column; when they would collide, space them out and draw leader lines.
    ends.sort((a, b) => a.py - b.py);
    for (let i = 1; i < ends.length; i++) ends[i].ly = Math.max(ends[i].ly, ends[i - 1].ly + 15);
    const over = ends.length ? ends[ends.length - 1].ly - (H - M.b) : 0;
    if (over > 0) for (const e of ends) e.ly -= over;
    const lx = W - M.r + 14;
    for (const e of ends) {
      if (Math.abs(e.ly - e.py) > 2 || e.px < W - M.r - 1) {
        s(svg, "path", { d: `M${e.px + 6},${e.py}L${lx - 10},${e.py}L${lx - 4},${e.ly}`, fill: "none", stroke: c.axis, "stroke-width": 1 });
      }
      s(svg, "text", { x: lx, y: e.ly + 4, class: "ink" }, label(e.k));
    }

    // Crosshair: snaps to the nearest run date and lists every model there.
    const cross = s(svg, "line", { class: "axis", y1: M.t, y2: H - M.b, visibility: "hidden" });
    const overlay = s(svg, "rect", { class: "hit", x: M.l, y: M.t, width: W - M.r - M.l, height: H - M.b - M.t, tabindex: 0,
      "aria-label": "Score over time. Use left and right arrows to step through run dates." });
    let idx = dates.length - 1;
    const showAt = (i, cx, cy) => {
      idx = i;
      const d = dates[i], px = x(t(d));
      cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
      const rows = keys.map((k) => ({ k, p: S.trends[k].find((q) => q.date === d) })).filter((r) => r.p)
        .sort((a, b) => b.p.mean - a.p.mean)
        .map((r) => ({ value: f2(r.p.mean), label: `${label(r.k)}  ${ci(r.p)} · ${r.p.n_tasks} tasks`, color: colorOf(r.k) }));
      showTip(cx, cy, day(d) + (dates.length ? "" : ""), rows);
    };
    const nearest = (clientX) => {
      const bx = svg.getBoundingClientRect().left;
      let bi = 0, bd = Infinity;
      dates.forEach((d, i) => { const dd = Math.abs(x(t(d)) + bx - clientX); if (dd < bd) { bd = dd; bi = i; } });
      return bi;
    };
    overlay.addEventListener("pointermove", (e) => showAt(nearest(e.clientX), e.clientX, e.clientY));
    const hide = () => { hideTip(); cross.setAttribute("visibility", "hidden"); };
    overlay.addEventListener("pointerleave", hide);
    overlay.addEventListener("blur", hide);
    const kb = () => { const b = svg.getBoundingClientRect(); showAt(idx, b.left + x(t(dates[idx])), b.top + M.t + 20); };
    overlay.addEventListener("focus", kb);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault(); idx = Math.max(0, Math.min(dates.length - 1, idx + (e.key === "ArrowLeft" ? -1 : 1))); kb();
      }
    });
  }

  // ------------------------------------------------------------------ sections
  function banner() {
    const b = document.getElementById("banner");
    if (!DATA.meta.demo) { b.hidden = true; return; }
    b.replaceChildren(statusIcon("warning"), h("div", null, h("strong", null, "Demo data. "),
      "The models (demo/model-a and so on) are fictional and every score is synthetic, generated to exercise the layout. " +
      "Real results replace this automatically once data/results.jsonl has records."));
    b.hidden = false;
  }

  function filters() {
    const keys = Object.keys(DATA.slices);
    for (const dim of ["track", "split"]) {
      const box = document.getElementById("f-" + dim);
      box.replaceChildren();
      const opts = dim === "track" ? Object.keys(TRACK) : Object.keys(SPLIT);
      for (const v of opts) {
        const pos = dim === "track" ? 0 : 1;
        const id = `f-${dim}-${v}`;
        const input = h("input", { type: "radio", name: dim, id, value: v, checked: state[dim] === v,
          disabled: !keys.some((k) => k.split("/")[pos] === v) });
        input.addEventListener("change", () => { state[dim] = v; fixState(dim); syncHash(); render(); });
        box.append(input, h("label", { for: id }, dim === "track" ? TRACK[v][0] : SPLIT[v]));
      }
    }
    document.getElementById("filter-note").textContent = TRACK[state.track][1] +
      (state.split === "heldout" ? " Held-out tasks are run rarely, to check the dev results were not overfitted." : "");
  }
  function fixState(changed) {
    const ok = (t, sp) => DATA.slices[`${t}/${sp}`];
    if (ok(state.track, state.split)) return;
    const keys = Object.keys(DATA.slices).map((k) => k.split("/"));
    const hit = changed === "split" ? keys.find(([, sp]) => sp === state.split) : keys.find(([t]) => t === state.track);
    [state.track, state.split] = hit || keys[0];
  }
  function syncHash() { history.replaceState(null, "", `#track=${state.track}&split=${state.split}`); }

  function kpis(S) {
    const tile = (lab, val, sub) => h("div", { class: "kpi" }, h("div", { class: "label" }, lab), h("div", { class: "value" }, val), h("div", { class: "sub" }, sub));
    return h("div", { class: "kpis" },
      tile("Tasks", num(S.n_tasks), `${SPLIT[state.split]} split`),
      tile("Models", num(S.order.length), state.track === "native" ? "each in its own agent" : "same agent and tools"),
      tile("Runs counted", num(S.n_records), `latest per model and task, of ${num(S.n_records_all_runs)}`),
      tile("Smallest detectable gap", "±" + f2(S.power.detectable_gap), `between two models, at ${S.n_tasks} tasks`),
      tile("Spend, all runs", usd(S.total_cost_all_runs), S.cost_known_share != null && S.cost_known_share < 1 ? `${pct(1 - S.cost_known_share)} of runs unpriced` : "every run priced"),
      tile("Harness errors", num(S.n_harness_errors), S.n_pending_runs ? `${S.n_pending_runs} runs await finding review` : "left out of scores"));
  }

  function cheaperText(c) {
    const g = c.diff.mean;  // leader minus the cheaper model, paired
    const gap = Math.abs(g) < 0.005 ? "same score" : g > 0 ? `${f2(g)} lower` : `${f2(-g)} higher`;
    return `${label(c.model)}: ${Math.round((1 - c.cost_ratio) * 100)}% cheaper, ${gap}`;
  }

  function decisionCard(S) {
    const V = {
      clear: () => status("good", "Clear lead"), tied: () => status("neutral", "Can't separate"),
      too_few: () => status("warning", "Too few tasks"), single_model: () => status("neutral", "One model"),
    };
    const rows = S.recommendations;
    const plain = () => h("div", { class: "tbl-wrap" }, h("table", null,
      h("thead", null, h("tr", null, ["Work", "Tasks", "Best so far", "Score", "95% interval", "Next best", "Lead", "Lead interval", "Verdict", "Cheaper, statistically tied"]
        .map((t, i) => h("th", { scope: "col", class: [1, 3, 4, 6, 7].includes(i) ? "num" : null }, t)))),
      h("tbody", null, rows.map((r) => h("tr", null,
        h("td", null, r.category === "all" ? h("strong", null, CAT.all) : CAT[r.category] || r.category),
        h("td", { class: "num" }, r.n_tasks),
        h("td", { class: "nowrap" }, label(r.leader)),
        h("td", { class: "num" }, f2(r.leader_est.mean)),
        h("td", { class: "num dim" }, ci(r.leader_est)),
        h("td", { class: "nowrap" }, r.runner_up ? label(r.runner_up) : "–"),
        h("td", { class: "num" }, r.diff ? sgn(r.diff.mean) : "–"),
        h("td", { class: "num dim" }, r.diff ? `[${sgn(r.diff.lo)}, ${sgn(r.diff.hi)}]` : "–"),
        h("td", null, V[r.verdict]()),
        h("td", { class: "small" }, r.cheaper ? cheaperText(r.cheaper) : h("span", { class: "dim" }, "–")))))));
    return card({ id: "decide", title: "Which model for which work", plain,
      sub: "For each kind of work: the best model so far, and whether its lead over the next model is real. " +
        "Lead is the paired difference on the tasks both models ran.",
      note: `A lead is clear only when its 95% interval excludes zero and the two models share at least ${DATA.meta.min_tasks} tasks. ` +
        "\"Cheaper, statistically tied\" is the cheapest model whose interval against the leader still includes zero, shown with its gap. " +
        "Tied is not the same as equal: it means these tasks cannot tell the two apart." });
  }

  function overallCard(S) {
    const rows = S.order.map((k) => ({ label: label(k), e: S.overall[k] }));
    return card({ id: "overall", title: "Overall score",
      sub: "Mean score across tasks. The line is a 95% interval from a two-stage bootstrap: resample tasks, then repeated runs within each task.",
      draw: (el, W) => drawIntervals(el, W, rows),
      table: () => ({ cols: [{ label: "Model" }, { label: "Score", num: true }, { label: "95% interval", num: true }, { label: "Tasks", num: true }, { label: "Runs", num: true }, { label: "Latest run" }],
        rows: S.order.map((k) => { const e = S.overall[k]; return [label(k), f2(e.mean), ci(e), e.n_tasks, e.n_runs, e.latest_date]; }) }) });
  }

  function pairsCard(S) {
    const rows = S.pairs.map((p) => ({ label: `${label(p.a)} vs ${label(p.b)}`, d: p, a: p.a, b: p.b }))
      .sort((p, q) => q.d.mean - p.d.mean);
    const c = C();
    return card({ id: "pairs", title: "Paired differences",
      sub: "First model minus second, on the tasks both ran. Pairing removes task difficulty from the comparison, so these intervals are much narrower than comparing two overall scores.",
      legendEl: legend([{ color: c.accent, label: "interval excludes zero" }, { color: c.muted, label: "can't tell apart" }]),
      draw: (el, W) => (rows.length ? drawForest(el, W, rows) : el.append(empty("Needs at least two models."))),
      table: () => ({ cols: [{ label: "First" }, { label: "Second" }, { label: "Difference", num: true }, { label: "95% interval", num: true }, { label: "P(first ahead)", num: true }, { label: "Shared tasks", num: true }],
        rows: rows.map((r) => [label(r.a), label(r.b), sgn(r.d.mean), `[${sgn(r.d.lo)}, ${sgn(r.d.hi)}]`, pct(r.d.p_a_better), r.d.n_tasks]) }) });
  }

  function heatCard(S) {
    const cats = catsOf(S);
    return card({ id: "heat", title: "Score by category",
      sub: "Each cell is the mean score of one model on one kind of work. The line inside each cell is its 95% interval, on a 0 to 1 scale across the cell. With few tasks per category the lines are long: read them before the colours.",
      legendEl: legend([{ kind: "ramp", color: rampCss(), lo: "0", hi: "1 mean score" }]),
      draw: (el, W) => drawHeatmap(el, W, S),
      table: () => ({ cols: [{ label: "Category" }, ...S.order.map((k) => ({ label: label(k), num: true }))],
        rows: cats.map((cat) => [CAT[cat] || cat, ...S.order.map((k) => { const e = S.by_category[cat][k]; return e ? `${f2(e.mean)} ${ci(e)} n=${e.n_tasks}` : "–"; })]) }) });
  }

  function costCards(S) {
    const c = C();
    const base = S.order.map((k) => ({ k, label: label(k), e: S.overall[k], o: S.overall[k] }));
    const lg = () => legend([{ color: c.accent, label: "on the frontier: nothing cheaper scores higher" }, { color: c.muted, label: "dominated" }]);
    const tbl = () => ({ cols: [{ label: "Model" }, { label: "Score", num: true }, { label: "Cost per run", num: true }, { label: "Cost per pass", num: true }, { label: "Time per run", num: true }, { label: "Tokens per run", num: true }, { label: "Turns", num: true }],
      rows: base.map((r) => [r.label, f2(r.o.mean), usd(r.o.cost_per_run), usd(r.o.cost_per_pass), secs(r.o.latency_s), compact(r.o.tokens), r.o.turns == null ? "–" : r.o.turns.toFixed(1)]) });
    return [
      card({ id: "cost", title: "Score against cost", legendEl: lg(),
        sub: "Mean cost of one run at list prices. Runs with no known price are left out.",
        draw: (el, W) => drawScatter(el, W, base.map((r) => ({ ...r, x: r.o.cost_per_run })), "Cost per run", (v) => (v === 0 ? "$0" : usd(v))),
        table: tbl }),
      card({ id: "time", title: "Score against time", legendEl: lg(),
        sub: "Mean wall-clock time of one run, including tool calls and test runs in the sandbox.",
        draw: (el, W) => drawScatter(el, W, base.map((r) => ({ ...r, x: r.o.latency_s == null ? null : r.o.latency_s / 60 })), "Time per run",
          (v) => (v === 0 ? "0" : (Number.isInteger(v) ? v : v.toFixed(1)) + " min")),
        table: tbl }),
    ];
  }

  function reliabilityCard(S) {
    const c = C();
    const k = DATA.meta.k;
    const rows = S.order.filter((m) => S.overall[m].pass1 != null).map((m) => {
      const o = S.overall[m];
      return { label: label(m), a: o.pass1, b: o.passk, right: sgn(o.passk - o.pass1), extra: [{ value: `${o.n_pass_tasks} tasks`, label: "rubric tasks excluded" }] };
    });
    return card({ id: "reliab", title: "Reliability",
      sub: `pass@1 is the chance a single run passes. pass^${k} is the chance all ${k} runs pass, which is what you need when you can't check every answer. The number on the right is the drop.`,
      legendEl: legend([{ color: c.soft, label: "pass@1" }, { color: c.strong, label: `pass^${k}` }]),
      draw: (el, W) => drawDumbbell(el, W, rows, ["pass@1", `pass^${k}`]),
      table: () => ({ cols: [{ label: "Model" }, { label: "pass@1", num: true }, { label: `pass^${k}`, num: true }, { label: "Drop", num: true }, { label: "Tasks", num: true }],
        rows: S.order.map((m) => { const o = S.overall[m]; return [label(m), f2(o.pass1), f2(o.passk), sgn(o.passk - o.pass1), o.n_pass_tasks]; }) }) });
  }

  function calibrationCard(S) {
    return card({ id: "calib", title: "Calibration",
      sub: "Answer tasks ask for a confidence. Points on the diagonal mean the model is right as often as it says. Below the diagonal: overconfident. Lower Brier is better.",
      draw: (el, W) => drawCalibration(el, W, S),
      table: () => ({ cols: [{ label: "Model" }, { label: "Stated", num: true }, { label: "Answers", num: true }, { label: "Mean stated", num: true }, { label: "Right", num: true }],
        rows: S.order.filter((k) => S.calibration[k]).flatMap((k) => [
          [label(k), "all", S.calibration[k].n, pct(S.calibration[k].mean_conf), pct(S.calibration[k].accuracy) + ` (Brier ${S.calibration[k].brier.toFixed(3)})`],
          ...S.calibration[k].bins.filter((b) => b.n).map((b) => ["", `${pct(b.lo)}–${pct(b.hi)}`, b.n, pct(b.mean_conf), pct(b.accuracy)])]) }) });
  }

  function failureCard(S) {
    const F = S.failures, keys = S.order.filter((k) => F.by_model[k]);
    const flags = F.flags.filter((f) => f !== "harness_error");
    const meter = (share) => h("div", { class: "meter" },
      h("div", { class: "track" }, h("div", { class: "fill", style: { width: `${Math.max(0, Math.min(1, share)) * 100}%` } })),
      h("span", { class: "pct" }, pct(share)));
    const row = (name, desc, shareOf) => h("tr", null,
      h("td", null, h("div", null, name), desc ? h("div", { class: "small dim" }, desc) : null),
      keys.map((k) => { const m = F.by_model[k]; const v = m.runs ? shareOf(m) / m.runs : null; const td = h("td", null, v == null ? "–" : meter(v));
        bindTip(td, () => [`${name} · ${label(k)}`, [{ value: pct(v), label: "of runs" }, { value: `${shareOf(m)} of ${m.runs}`, label: "runs" }]]); return td; }));
    return card({ id: "fail", title: "How models fail",
      sub: "Share of each model's runs that carry each flag. Flags come from automatic checks on the diff, the tests and the transcript, plus a manual review for a few. One run can carry several.",
      plain: () => h("div", { class: "tbl-wrap" }, h("table", null,
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Flag"), keys.map((k) => h("th", { scope: "col" }, label(k))))),
        h("tbody", null, row("Did not pass", "Score below 1 on the run", (m) => m.failed),
          flags.map((f) => row((FLAG[f] || [f])[0], (FLAG[f] || [null, ""])[1], (m) => m.counts[f] || 0))))) });
  }

  function contaminationCard(S) {
    const c = C();
    const keys = S.order.filter((k) => S.contamination[k] && S.contamination[k].public && S.contamination[k].not_public);
    const rows = keys.map((k) => {
      const g = S.contamination[k];
      return { label: label(k), a: g.not_public.mean, b: g.public.mean,
        right: `${sgn(g.public.mean - g.not_public.mean)}  n=${g.public.n_tasks}/${g.not_public.n_tasks}`,
        extra: [{ value: `${g.public.n_tasks} vs ${g.not_public.n_tasks}`, label: "tasks" }, { value: MODELS[k].cutoff || "unknown", label: "training cutoff" }] };
    });
    return card({ id: "contam", title: "Contamination check",
      sub: "Some tasks come from bugs I fixed in a public repo. If a model scores much higher on tasks whose fix was public before its training cutoff, it may have seen the answer. Planted bugs have no public fix and are left out.",
      legendEl: rows.length ? legend([{ color: c.soft, label: "fix not public before cutoff" }, { color: c.strong, label: "fix public before cutoff" }]) : null,
      note: "With a handful of history-based tasks per model this is a smoke alarm, not proof. The number on the right is the gap, then the task counts.",
      draw: (el, W) => (rows.length ? drawDumbbell(el, W, rows, ["fix not public before cutoff", "fix public before cutoff"])
        : el.append(empty("No model in this slice has tasks on both sides of its training cutoff."))),
      table: () => ({ cols: [{ label: "Model" }, { label: "Cutoff" }, { label: "Public before cutoff", num: true }, { label: "Not public", num: true }, { label: "Unknown (planted)", num: true }],
        rows: S.order.map((k) => { const g = S.contamination[k] || {}; const fmt = (e) => (e ? `${f2(e.mean)} (n=${e.n_tasks})` : "–");
          return [label(k), (MODELS[k] || {}).cutoff || "–", fmt(g.public), fmt(g.not_public), fmt(g.unknown)]; }) }) });
  }

  function trendsCard(S) {
    const keys = S.order.filter((k) => (S.trends[k] || []).length);
    return card({ id: "trend", title: "Over time",
      sub: "Mean score of each run. A model's score moves between runs even when nothing changed: compare the change with the intervals in the tooltip before reading a trend into it.",
      legendEl: legend(keys.map((k) => ({ kind: "line", color: colorOf(k), label: label(k) }))),
      draw: (el, W) => drawTrends(el, W, S),
      table: () => ({ cols: [{ label: "Model" }, { label: "Date" }, { label: "Score", num: true }, { label: "95% interval", num: true }, { label: "Tasks", num: true }, { label: "Harness" }, { label: "Prompts" }],
        rows: keys.flatMap((k) => S.trends[k].map((p) => [label(k), p.date, f2(p.mean), ci(p), p.n_tasks, p.harness_version, p.prompt_version])) }) });
  }

  function tasksCard(S) {
    const keys = S.order;
    const H = { saturated: () => status("warning", "Saturated"), dead: () => status("critical", "Dead"),
      flat: () => status("warning", "Flat"), ok: () => h("span", { class: "dim" }, "ok") };
    const body = [];
    let cat = null;
    for (const t of S.tasks) {
      if (t.category !== cat) {
        cat = t.category;
        const n = S.tasks.filter((x) => x.category === cat).length;
        body.push(h("tr", { class: "group" }, h("td", { colspan: 6 + keys.length }, `${CAT[cat] || cat} · ${n} task${n === 1 ? "" : "s"}`)));
      }
      body.push(h("tr", null,
        h("td", { class: "mono" }, t.hid),
        h("td", { class: "dim" }, KIND[t.kind] || t.kind),
        h("td", { class: "num dim" }, t.difficulty ?? "–"),
        keys.map((k) => {
          const cell = t.cells[k];
          if (!cell) return h("td", { class: "cell none" }, "–");
          const fill = seq(cell.mean);
          const td = h("td", { class: "cell", style: { background: fill, color: inkOn(fill) } },
            t.kind === "rubric" ? f2(cell.mean) : `${cell.passes}/${cell.n}`);
          bindTip(td, () => [`${t.hid} · ${label(k)}`, [
            { value: f2(cell.mean), label: "mean score" },
            { value: `${cell.passes} of ${cell.n}`, label: "runs passed" },
            ...(cell.min !== cell.max ? [{ value: "flaky", label: "runs disagree" }] : [])]]);
          return td;
        }),
        h("td", { class: "num" }, f2(t.mean)),
        h("td", { class: "num dim" }, t.disc == null ? "n/a" : sgn(t.disc)),
        h("td", null, (H[t.status] || H.ok)())));
    }
    return card({ id: "tasks", title: "Tasks",
      sub: "Every task, with each model's passes out of its runs (mean score for rubric tasks). Task ids are keyed hashes: stable between runs, but they reveal nothing about the task.",
      note: "Health: saturated tasks no longer separate models; dead tasks are usually a broken key, not a hard task; flat tasks rank models differently from everything else. Discrimination needs at least five models (n/a below that).",
      plain: () => h("div", { class: "tbl-wrap" }, h("table", { class: "taskgrid" },
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Task"), h("th", { scope: "col" }, "Kind"), h("th", { scope: "col", class: "num" }, "Diff."),
          keys.map((k) => h("th", { scope: "col", class: "c" }, label(k))),
          h("th", { scope: "col", class: "num" }, "Mean"), h("th", { scope: "col", class: "num" }, "Discrim."), h("th", { scope: "col" }, "Health"))),
        h("tbody", null, body))) });
  }

  function footer() {
    const m = DATA.meta, S = slice();
    const f = document.getElementById("footer");
    f.replaceChildren(
      h("h3", null, "How to read this"),
      h("ul", null,
        h("li", null, "Every task scores 0 to 1: tests for code changes, a matched answer key for bug finding and questions, and a judge panel with a rubric for design. A run passes at a score of 1."),
        h("li", null, "Intervals are 95% two-stage bootstrap intervals. Comparisons between two models are paired on the tasks both ran."),
        h("li", null, `With ${S ? S.n_tasks : "–"} tasks, gaps smaller than about ${S ? f2(S.power.detectable_gap) : "–"} can't be told from noise. ` +
          (S ? S.power.table.map((r) => `A ${f2(r.gap)} gap needs about ${r.tasks} tasks`).join("; ") + "." : "")),
        h("li", null, "Each model's numbers come from its latest run of each task. The trend view keeps every run."),
        h("li", null, "Harness errors are counted but left out of scores.")),
      h("h3", null, "What is not published, and why"),
      h("ul", null,
        h("li", null, "Task prompts, the codebase snapshot, answer keys, hidden tests and transcripts stay private. Publishing any of them would let future models train on the answers."),
        h("li", null, "Task ids here are keyed hashes. Every record follows a closed schema with no free-text field, and CI scans the repo for the benchmark's canary string by hash.")),
      h("p", { class: "small dim", style: { marginTop: "16px" } },
        `Built ${m.generated} from ${m.sources.join(", ")} · ${num(m.n_records)} records, ${m.first_date} to ${m.last_date} · ` +
        `harness ${m.harness_versions.join(", ")} · prompts ${m.prompt_versions.join(", ")} · ${num(m.n_boot)} bootstrap resamples.`));
  }

  // ------------------------------------------------------------------ render
  function render() {
    hideTip();
    filters();
    const main = document.getElementById("app");
    const S = slice();
    main.replaceChildren();
    if (!S || !S.order.length) { main.append(empty("No scored runs in this slice yet.")); footer(); return; }
    const cards = [];
    const add = (parent, cs) => { for (const c of [].concat(cs)) { parent.append(c.el); cards.push(c); } };
    main.append(kpis(S));
    add(main, decisionCard(S));
    const g1 = h("div", { class: "grid2" }); main.append(g1);
    add(g1, [overallCard(S), pairsCard(S)]);
    add(main, heatCard(S));
    const g2 = h("div", { class: "grid2" }); main.append(g2);
    add(g2, costCards(S));
    const g3 = h("div", { class: "grid2" }); main.append(g3);
    add(g3, [reliabilityCard(S), contaminationCard(S)]);
    add(main, calibrationCard(S));
    add(main, failureCard(S));
    add(main, trendsCard(S));
    add(main, tasksCard(S));
    for (const c of cards) c.mount();
    footer();
    if (state.refocus) {
      const el = document.querySelector(`[data-focus="${state.refocus}"]`);
      if (el) el.focus();
      state.refocus = null;
    }
  }

  // ------------------------------------------------------------------ theme + boot
  const THEMES = ["auto", "light", "dark"];
  function applyTheme(t) {
    if (t === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    document.getElementById("theme").textContent = "Theme: " + t;
  }
  let theme = localStorage.getItem("llmbench-theme") || "auto";
  applyTheme(theme);
  document.getElementById("theme").addEventListener("click", () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    localStorage.setItem("llmbench-theme", theme);
    applyTheme(theme);
    if (DATA) render();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (DATA && theme === "auto") render(); });
  let rt = null, lastW = innerWidth;
  addEventListener("resize", () => {
    if (innerWidth === lastW) return;
    lastW = innerWidth; clearTimeout(rt); rt = setTimeout(() => DATA && render(), 150);
  });

  fetch("data.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((d) => {
      DATA = d;
      MODELS = Object.fromEntries(d.models.map((m) => [m.key, m]));
      const p = new URLSearchParams(location.hash.slice(1));
      const keys = Object.keys(d.slices);
      state.track = p.get("track") || "controlled";
      state.split = p.get("split") || "dev";
      if (!d.slices[`${state.track}/${state.split}`] && keys.length) [state.track, state.split] = keys[0].split("/");
      banner();
      render();
    })
    .catch(() => {
      document.getElementById("app").replaceChildren(empty(
        "Could not load data.json. Run python scripts/build_site_data.py, then serve the site/ folder over HTTP."));
    });
})();
