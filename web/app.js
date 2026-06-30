// Contract Risk Radar frontend

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const icon = (id) => `<svg><use href="#${id}"/></svg>`;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const ACCEPTED = new Set(["txt", "md", "text"]);
const state = { files: [], example: null };
let lastData = null;

const dropzone = $("#dropzone"), fileInput = $("#file-input"), fileList = $("#file-list"), runBtn = $("#run-btn"), hint = $("#input-hint");
const extOf = (n) => (n.toLowerCase().split(".").pop() || "");

function appendAudit(summary) {
  const a = document.querySelector(".audit"); if (!a) return;
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  a.appendChild(el("div", null, `<span class="a-time">[${ts}]</span> <span class="a-agent">Reviewer</span>: ${esc(summary)}`));
}

function renderFiles() {
  fileList.innerHTML = "";
  state.files.forEach((f, i) => {
    const li = el("li", null, `<span>${esc(f.name)}</span><span class="fl-kind">${(f.size / 1024).toFixed(0)} KB</span><button class="fl-x">&times;</button>`);
    li.querySelector(".fl-x").onclick = () => { state.files.splice(i, 1); renderFiles(); updateRun(); };
    fileList.appendChild(li);
  });
}
function addFiles(list) {
  const warn = [];
  for (const f of list) {
    if (!ACCEPTED.has(extOf(f.name))) { warn.push(`${f.name}: unsupported`); continue; }
    if (state.files.some((x) => x.name === f.name && x.size === f.size)) continue;
    if (state.files.length >= 3) { warn.push("max 3 files"); break; }
    state.files.push(f);
  }
  renderFiles(); updateRun();
  if (warn.length) hint.textContent = "Skipped — " + warn.join("; ");
}
function updateRun() { runBtn.disabled = !(state.files.length || $("#text-input").value.trim()); hint.textContent = ""; }

dropzone.onclick = () => fileInput.click();
dropzone.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } };
fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ""; };
["dragover", "dragenter"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); }));
dropzone.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
$("#text-input").addEventListener("input", updateRun);

async function loadExamples() {
  try {
    const names = await (await fetch("/api/examples")).json();
    if (!Array.isArray(names)) return;
    const box = $("#example-chips");
    names.forEach((n) => {
      const chip = el("button", "chip"); chip.textContent = n.replace(/_/g, " ");
      chip.onclick = async () => {
        const was = state.example === n;
        document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
        if (was) { state.example = null; $("#text-input").value = ""; }
        else { chip.classList.add("active"); state.example = n; try { const d = await (await fetch("/api/example/" + encodeURIComponent(n))).json(); $("#text-input").value = d.text || ""; } catch (e) {} }
        updateRun();
      };
      box.appendChild(chip);
    });
  } catch (e) {}
}

runBtn.onclick = () => {
  const fd = new FormData();
  fd.append("text", $("#text-input").value || "");
  if (state.example && !$("#text-input").value.trim()) fd.append("example", state.example);
  state.files.forEach((f) => fd.append("files", f, f.name));

  $("#setup").classList.add("hidden");
  $("#review").classList.remove("hidden");
  $("#findings-pane").innerHTML = "";
  $("#doc-body").textContent = "Loading...";
  $("#run-status").textContent = "Starting review...";
  $("#reset-row").classList.add("hidden");
  $("#review").scrollIntoView({ behavior: "smooth", block: "start" });

  (async () => {
    let job;
    try { job = await (await fetch("/api/process", { method: "POST", body: fd })).json(); }
    catch (e) { return showError("Could not reach the server."); }
    if (!job || !job.job_id) return showError("The server did not start a job.");
    let done = false;
    const es = new EventSource("/api/events/" + job.job_id);
    es.onmessage = (msg) => {
      let ev; try { ev = JSON.parse(msg.data); } catch (e) { return; }
      if (ev.type === "progress") $("#run-status").textContent = ev.status;
      else if (ev.type === "result") { done = true; es.close(); render(ev.data, ev.contract); }
      else if (ev.type === "error") { done = true; es.close(); showError(ev.message); }
    };
    es.onerror = () => { es.close(); if (!done) showError("Lost connection during the review. Please retry."); };
  })();
};

function showError(message) {
  $("#run-status").textContent = "";
  $("#doc-body").textContent = "";
  $("#findings-pane").innerHTML = `<div class="panel"><h3>${icon("i-alert")} Review failed</h3><p class="para">${esc(message)}</p><p class="para muted">Confirm OPENAI_API_KEY is set in .env, then retry.</p></div>`;
  $("#reset-row").classList.remove("hidden");
}

function highlight(raw, findings) {
  const ranges = [], used = [];
  findings.forEach((f, i) => {
    const c = (f.citation || "").trim();
    if (!c) return;
    let from = 0, idx;
    while ((idx = raw.indexOf(c, from)) !== -1) {
      const end = idx + c.length;
      if (!used.some((u) => idx < u.end && end > u.start)) { ranges.push({ start: idx, end, i, sev: (f.severity || "low").toLowerCase() }); used.push({ start: idx, end }); break; }
      from = idx + 1;
    }
  });
  ranges.sort((a, b) => a.start - b.start);
  let html = "", pos = 0;
  ranges.forEach((r) => {
    html += esc(raw.slice(pos, r.start));
    html += `<mark class="hl sev-${r.sev}" id="hl-${r.i}">${esc(raw.slice(r.start, r.end))}</mark>`;
    pos = r.end;
  });
  html += esc(raw.slice(pos));
  return html;
}

const ROUTE = { sign_ready: "Sign-ready", negotiate: "Negotiate", escalate: "Escalate to legal" };
const ACTION = { sent_for_signature: "Sent for signature", returned_to_counterparty: "Returned to counterparty", escalated_to_legal: "Escalated to legal" };

function render(d, contract) {
  lastData = d;
  $("#run-status").textContent = "";
  const ix = d.intake || {}, rep = d.report || {}, adv = d.advice || {}, risk = d.risk || {};
  const findings = rep.findings || [];

  // document
  $("#doc-title").textContent = ix.title || "Contract";
  $("#doc-meta").textContent = [ix.contract_type, ix.counterparty].filter(Boolean).join(" · ");
  $("#doc-body").innerHTML = highlight(contract || "", findings);

  // findings pane
  const pane = $("#findings-pane");
  pane.innerHTML = "";

  // risk score
  const sevColor = { high: "var(--high)", medium: "var(--medium)", low: "var(--low)" };
  const bandColor = risk.score >= 80 ? "var(--high)" : risk.score >= 55 ? "var(--high)" : risk.score >= 25 ? "var(--medium)" : "var(--low)";
  const c = risk.counts || {};
  pane.appendChild(el("div", "panel", `<h3>Deal risk</h3>
    <div class="riskbar"><div class="rn" style="color:${bandColor}">${risk.score ?? "—"}</div>
      <div class="rmeta"><div class="band" style="color:${bandColor}">${esc(risk.band || "")}</div>
        <div class="counts"><span class="sevdot high"></span>${c.high || 0} high<span class="sevdot medium"></span>${c.medium || 0} medium<span class="sevdot low"></span>${c.low || 0} low</div></div></div>`));

  // recommendation
  pane.appendChild(el("div", "panel", `<h3>Recommendation</h3>
    <div class="banner route-${esc(adv.route || "")}"><span class="b-dot"></span><span class="b-main">${ROUTE[adv.route] || esc(adv.route || "—")}</span><span class="b-conf">confidence ${adv.confidence != null ? Math.round(adv.confidence * 100) + "%" : "—"}</span></div>
    <p class="para">${esc(adv.rationale || "")}</p>
    ${(adv.negotiation_points || []).length ? `<p class="subhead">Negotiation points</p><ul class="points">${adv.negotiation_points.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`));

  // findings
  const fp = el("div", "panel");
  fp.innerHTML = `<h3>Findings (${findings.length})</h3>` + (findings.length ? "" : `<p class="para muted">No material issues found.</p>`);
  findings.forEach((f, i) => {
    const sev = (f.severity || "low").toLowerCase();
    const item = el("div", "finding sev-" + sev);
    item.innerHTML = `<div class="f-top"><span class="f-head">${esc(f.clause_heading || "Clause")}</span><span class="sev-badge ${sev}">${esc(sev)}</span></div>
      <div class="f-cat">${esc(f.category || "")}</div>
      <p class="f-issue">${esc(f.issue || "")}</p>
      <div class="redline"><div class="rl-label">Suggested redline</div>${esc(f.suggested_redline || "")}<button class="copy" title="Copy">${icon("i-copy")}</button></div>`;
    item.querySelector(".copy").onclick = (e) => { e.stopPropagation(); navigator.clipboard && navigator.clipboard.writeText(f.suggested_redline || ""); };
    item.onclick = () => {
      const m = document.getElementById("hl-" + i);
      if (m) { m.scrollIntoView({ behavior: "smooth", block: "center" }); m.classList.remove("flash"); void m.offsetWidth; m.classList.add("flash"); }
    };
    fp.appendChild(item);
  });
  if (rep.missing_clauses && rep.missing_clauses.length) {
    fp.appendChild(el("div", null, `<p class="subhead">Missing standard clauses</p><div class="tagrow">${rep.missing_clauses.map((x) => `<span class="tag warn">${esc(x)}</span>`).join("")}</div>`));
  }
  pane.appendChild(fp);

  // decision
  const dec = el("div", "panel");
  const cur = adv.route || "";
  const opts = Object.keys(ROUTE).map((k) => `<option value="${k}"${k === cur ? " selected" : ""}>${ROUTE[k]}</option>`).join("");
  dec.innerHTML = `<h3>Decision</h3>
    <div class="override"><label class="ov-label">Route <select class="ov-route">${opts}</select></label>
      <textarea class="ov-note" rows="2" placeholder="Reviewer note (optional)"></textarea></div>
    <div class="actions"><button class="btn-approve">${icon("i-check")} Approve</button><button class="btn-reject">Reject</button>
      <button class="btn-ghost btn-dl">${icon("i-download")} JSON</button></div>
    <div class="decision-made muted"></div>`;
  pane.appendChild(dec);

  const note = dec.querySelector(".decision-made"), aBtn = dec.querySelector(".btn-approve"), rBtn = dec.querySelector(".btn-reject");
  const routeSel = dec.querySelector(".ov-route"), noteEl = dec.querySelector(".ov-note");
  async function finalize(decision) {
    aBtn.disabled = rBtn.disabled = true; note.style.color = "var(--muted-ink)"; note.innerHTML = `<span class="spinner"></span> Triggering action...`;
    const chosen = routeSel.value, rnote = noteEl.value.trim(), over = chosen !== adv.route;
    try {
      const fin = await (await fetch("/api/finalize", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, intake: d.intake, report: d.report, advice: Object.assign({}, adv, { route: chosen }), note: rnote }) })).json();
      if (fin.error) { note.textContent = "Could not finalize: " + fin.error; note.style.color = "var(--high)"; aBtn.disabled = rBtn.disabled = false; return; }
      note.textContent = "";
      appendAudit(`${decision}` + (over ? ` · route -> ${ROUTE[chosen] || chosen}` : "") + (rnote ? ` · note: ${rnote}` : ""));
      outcome(fin, pane, { aBtn, rBtn, note });
    } catch (e) { note.textContent = "Could not finalize. Please retry."; note.style.color = "var(--high)"; aBtn.disabled = rBtn.disabled = false; }
  }
  aBtn.onclick = () => finalize("approved");
  rBtn.onclick = () => finalize("rejected");
  dec.querySelector(".btn-dl").onclick = () => { const b = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }); const a = el("a"); a.href = URL.createObjectURL(b); a.download = "contract_review.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };

  // audit
  pane.appendChild(el("div", "panel", `<h3>${icon("i-clip")} Audit trail</h3><div class="audit">` +
    (d.audit_log || []).map((e) => `<div><span class="a-time">[${esc(e.timestamp)}]</span> <span class="a-agent">${esc(e.agent)}</span>: ${esc(e.summary)}</div>`).join("") + `</div>`));

  $("#reset-row").classList.remove("hidden");
}

function outcome(fin, pane, ctrl) {
  const ok = fin.decision === "approved";
  const p = el("div", "panel");
  p.innerHTML = `<h3>${icon(ok ? "i-check" : "i-alert")} Outcome</h3>
    <div class="banner route-${ok ? "sign_ready" : "escalate"}"><span class="b-dot"></span><span class="b-main">${esc(ACTION[fin.action] || fin.action || "")}</span></div>
    <p class="para">${esc(fin.action_summary || "")}</p>
    <p class="subhead">Cover note</p><div class="info-box">${esc(fin.cover_note || "")}</div>
    ${(fin.next_steps || []).length ? `<p class="subhead">Next steps</p><ul class="points">${fin.next_steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <div class="actions"><button class="btn-ghost btn-copy">Copy cover note</button><button class="btn-ghost btn-reopen">${icon("i-redo")} Reopen</button></div>`;
  p.querySelector(".btn-copy").onclick = () => navigator.clipboard && navigator.clipboard.writeText(fin.cover_note || "");
  p.querySelector(".btn-reopen").onclick = () => { p.remove(); if (ctrl) { ctrl.aBtn.disabled = false; ctrl.rBtn.disabled = false; ctrl.note.textContent = ""; } appendAudit("review reopened"); };
  pane.appendChild(p);
  p.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

$("#reset-btn").onclick = () => {
  state.files = []; state.example = null; fileInput.value = ""; $("#text-input").value = "";
  renderFiles(); document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
  $("#review").classList.add("hidden"); $("#reset-row").classList.add("hidden"); $("#setup").classList.remove("hidden");
  updateRun(); window.scrollTo({ top: 0, behavior: "smooth" });
};

loadExamples();

/* ============================================================
   Bring-your-own OpenAI key (for public / self-hosted demo).
   Adds a top-bar button; stores the key in localStorage and
   sends it as X-OpenAI-Key on every /api/ request. The server
   uses it if present, otherwise falls back to its .env key.
   ============================================================ */
(function () {
  var KEY = "OPENAI_KEY";
  var _fetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    opts = opts || {};
    var k = localStorage.getItem(KEY);
    if (k && typeof url === "string" && url.indexOf("/api/") === 0) {
      opts = Object.assign({}, opts);
      opts.headers = Object.assign({}, opts.headers || {}, { "X-OpenAI-Key": k });
    }
    return _fetch(url, opts);
  };

  var ACC = "var(--accent, var(--teal, var(--accent-deep, #2563eb)))";
  var CARD = "var(--card, var(--panel, var(--paper, #ffffff)))";
  var INK = "var(--ink, #1a1a1a)";
  var LINE = "var(--line, #dddddd)";
  var MUTED = "var(--muted, var(--slate, var(--muted-ink, #888888)))";
  var css =
    ".kk-btn{display:inline-flex;align-items:center;gap:7px;border:1px solid " + LINE + ";background:" + CARD + ";color:" + INK + ";font:inherit;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:999px;cursor:pointer}" +
    ".kk-btn:hover{border-color:" + ACC + "}" +
    ".kk-dot{width:8px;height:8px;border-radius:50%;background:#d9a33a}" +
    ".kk-dot.on{background:#2aa676}" +
    ".kk-ov{position:fixed;inset:0;background:rgba(10,15,20,.55);display:grid;place-items:center;z-index:99999;padding:20px}" +
    ".kk-card{background:" + CARD + ";color:" + INK + ";border:1px solid " + LINE + ";border-radius:14px;max-width:440px;width:100%;padding:24px;box-shadow:0 30px 80px -30px rgba(0,0,0,.5);font-family:inherit}" +
    ".kk-card h4{margin:0 0 6px;font-size:18px}" +
    ".kk-card p{margin:0 0 14px;font-size:13px;color:" + MUTED + "}" +
    ".kk-card input{width:100%;box-sizing:border-box;border:1px solid " + LINE + ";border-radius:10px;padding:11px 13px;font:inherit;font-size:14px;background:" + CARD + ";color:" + INK + "}" +
    ".kk-card input:focus{outline:none;border-color:" + ACC + "}" +
    ".kk-row{display:flex;gap:10px;margin-top:14px}" +
    ".kk-save{flex:1;border:none;cursor:pointer;background:" + ACC + ";color:#fff;border-radius:10px;padding:11px;font:inherit;font-weight:600}" +
    ".kk-clear{border:1px solid " + LINE + ";background:transparent;color:" + INK + ";border-radius:10px;padding:11px 16px;cursor:pointer;font:inherit;font-weight:600}" +
    ".kk-note{margin-top:12px;font-size:11.5px;color:" + MUTED + ";line-height:1.5}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  var btn = document.createElement("button");
  btn.className = "kk-btn";
  btn.type = "button";
  function refresh() {
    var has = !!localStorage.getItem(KEY);
    btn.innerHTML = '<span class="kk-dot' + (has ? " on" : "") + '"></span>' + (has ? "API key set" : "Add API key");
  }
  function mount() {
    var h = document.querySelector(".nav-inner") || document.querySelector(".topbar");
    if (!h) {
      btn.style.position = "fixed"; btn.style.top = "14px"; btn.style.right = "16px"; btn.style.zIndex = "9998";
      document.body.appendChild(btn);
    } else {
      h.appendChild(btn);
    }
    refresh();
  }
  btn.onclick = function () {
    var ov = document.createElement("div"); ov.className = "kk-ov";
    var cur = localStorage.getItem(KEY) || "";
    var card = document.createElement("div"); card.className = "kk-card";
    card.innerHTML =
      "<h4>OpenAI API key</h4>" +
      "<p>Use your own key to run this demo. It is stored only in this browser and sent to your local server with each request.</p>" +
      '<input type="password" class="kk-in" placeholder="sk-..." autocomplete="off">' +
      '<div class="kk-row"><button class="kk-save" type="button">Save</button><button class="kk-clear" type="button">Clear</button></div>' +
      '<div class="kk-note">Stored in your browser (localStorage) on this device only. Never commit your key to the repo. If you leave this empty, the server uses its own .env key.</div>';
    ov.appendChild(card);
    card.querySelector(".kk-in").value = cur;
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    card.querySelector(".kk-save").onclick = function () {
      var v = card.querySelector(".kk-in").value.trim();
      if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY);
      refresh(); ov.remove();
    };
    card.querySelector(".kk-clear").onclick = function () { localStorage.removeItem(KEY); refresh(); ov.remove(); };
    document.body.appendChild(ov);
    card.querySelector(".kk-in").focus();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
