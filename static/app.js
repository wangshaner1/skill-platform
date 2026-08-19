const $ = (sel) => document.querySelector(sel);

const chatThread = $("#chatThread");
const welcome = $("#welcome");
const input = $("#input");
const status = $("#status");

let currentSkill = null;
let deepThink = false;
let SAMPLE_INPUT = null;
const STORAGE_KEY = "skill_convos_v1";
let conversations = {};
let currentConversationId = null;
const uiRefs = {};
let saveTimer = null;

function esc(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setStatus(text, cls = "idle") {
  status.textContent = text;
  status.className = `status ${cls}`;
}

function scrollToBottom() {
  chatThread.scrollTop = chatThread.scrollHeight;
}

function loadConvos() {
  try {
    conversations = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    conversations = {};
  }
  // 页面刷新后，正在运行的任务已中断，清理残留的运行状态
  Object.values(conversations).forEach((c) => {
    if (c.running) c.running = null;
  });
}

function saveConvos() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    /* 本地存储不可用时静默降级 */
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveConvos();
  }, 400);
}

function showChat() {
  welcome.classList.add("hidden");
  chatThread.classList.remove("hidden");
}

function appendMsgEl(role, html) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = html;
  chatThread.appendChild(div);
  return div;
}

function renderMarkdown(text) {
  const lines = String(text).split(/\r?\n/);
  let html = "";
  let inList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inList) { html += "</ul>"; inList = false; }
      continue;
    }
    let content = esc(trimmed);
    content = content.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (/^###\s+/.test(content)) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h3>${content.replace(/^###\s+/, "")}</h3>`;
    } else if (/^##\s+/.test(content)) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h2>${content.replace(/^##\s+/, "")}</h2>`;
    } else if (/^#\s+/.test(content)) {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<h1>${content.replace(/^#\s+/, "")}</h1>`;
    } else if (/^[-*]\s+/.test(content)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${content.replace(/^[-*]\s+/, "")}</li>`;
    } else if (/^\d+\.\s+/.test(content)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${content.replace(/^\d+\.\s+/, "")}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<p>${content}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html;
}

async function api(path, options = {}) {
  const resp = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.detail || `请求失败：${resp.status}`);
  return data;
}

async function streamApi(path, body, onEvent) {
  const resp = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || `请求失败：${resp.status}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      onEvent(event);
    }
  }
}

function skillCardHtml(skill) {
  const cases = (skill.use_cases || [])
    .map((c) => `<span class="chip">${esc(c)}</span>`)
    .join("");
  const fields = (skill.input_schema || [])
    .map(
      (f) =>
        `<li><code>${esc(f.name)}</code> · ${esc(f.type)}${f.required ? "" : "（选填）"} — ${esc(f.description)}</li>`
    )
    .join("");
  const steps = (skill.analysis_steps || [])
    .map(
      (s) =>
        `<li><span class="step-no">${esc(s.order)}</span><div><strong>${esc(s.title)}</strong><span class="tag">${esc(s.method)}</span><p>${esc(s.goal)}</p></div></li>`
    )
    .join("");

  return `
  <div class="skill-card">
    <div class="skill-card-head">
      <div>
        <h3>${esc(skill.name)}</h3>
        <p>${esc(skill.description)}</p>
      </div>
      <span class="badge">v${esc(skill.version)}</span>
    </div>
    <section>
      <h4>使用场景</h4>
      <div class="chips">${cases}</div>
    </section>
    <section>
      <h4>输入数据定义</h4>
      <ul class="fields">${fields}</ul>
    </section>
    <section>
      <h4>分析流程</h4>
      <ol class="steps">${steps}</ol>
    </section>
    <section>
      <h4>Agent Prompt</h4>
      <pre>${esc(skill.agent_prompt)}</pre>
    </section>
    <section>
      <h4>输出结果模板</h4>
      <pre>${esc(skill.output_template)}</pre>
    </section>
    <div class="skill-card-footer">
      <button class="btn primary" data-execute>使用示例数据执行</button>
      <button class="btn" data-json-toggle>查看完整配置</button>
      <button class="btn" data-export>导出 Markdown</button>
    </div>
    <pre class="json hidden" data-json>${esc(JSON.stringify(skill, null, 2))}</pre>
  </div>`;
}

function skillToMarkdown(skill) {
  const lines = [];
  lines.push(`# ${skill.name}`);
  lines.push("");
  lines.push(`> ${skill.description}`);
  lines.push("");
  lines.push(`- **Skill ID**：\`${skill.id}\``);
  lines.push(`- **版本**：${skill.version || "v1"}`);
  lines.push(`- **创建时间**：${skill.created_at || "-"}`);
  lines.push(`- **原始需求**：${skill.requirement || "-"}`);
  lines.push("");
  lines.push("## 使用场景");
  lines.push("");
  (skill.use_cases || []).forEach((c) => lines.push(`- ${c}`));
  lines.push("");
  lines.push("## 输入数据定义");
  lines.push("");
  lines.push("| 字段 | 类型 | 必填 | 说明 |");
  lines.push("|------|------|------|------|");
  (skill.input_schema || []).forEach((f) => {
    const desc = (f.description || "").replace(/\s+/g, " ").replace(/\|/g, "\\|");
    lines.push(`| ${f.name} | ${f.type} | ${f.required ? "是" : "否"} | ${desc} |`);
  });
  lines.push("");
  lines.push("## 分析流程");
  lines.push("");
  (skill.analysis_steps || []).forEach((s) => {
    lines.push(`${s.order}. **${s.title}**（${s.method}）：${s.goal}`);
    if (s.prompt) lines.push(`   - ${s.prompt}`);
  });
  lines.push("");
  lines.push("## Agent Prompt");
  lines.push("");
  lines.push("```text");
  lines.push(skill.agent_prompt);
  lines.push("```");
  lines.push("");
  lines.push("## 输出结果模板");
  lines.push("");
  lines.push("```text");
  lines.push(skill.output_template);
  lines.push("```");
  lines.push("");
  lines.push("## 完整配置（JSON）");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(skill, null, 2));
  lines.push("```");
  return lines.join("\n");
}

function downloadMarkdown(skill) {
  const md = skillToMarkdown(skill);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = (skill.name || "skill").replace(/[\\/:*?"<>|]/g, "_");
  a.href = url;
  a.download = `${safeName}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let sampleSyncSeq = 0;

async function syncSampleData(skill) {
  if (!skill || !skill.id) return;
  const seq = ++sampleSyncSeq;
  const statusEl = $("#sampleStatus");
  statusEl.textContent = "正在生成匹配示例数据";
  statusEl.className = "sample-status loading";
  try {
    const data = await api(
      "/api/sample/generate",
      { method: "POST", body: JSON.stringify({ skill_id: skill.id }) }
    );
    if (seq !== sampleSyncSeq) return;
    if (data.input_data) {
      $("#inputData").value = JSON.stringify(data.input_data, null, 2);
      statusEl.textContent = data.generated
        ? "已生成当前 Skill 的示例数据"
        : "已加载当前 Skill 的示例数据";
      statusEl.className = "sample-status ok";
      setTimeout(() => {
        if (seq === sampleSyncSeq) statusEl.textContent = "";
      }, 4000);
    }
  } catch {
    if (seq !== sampleSyncSeq) return;
    statusEl.textContent = "示例数据生成失败，请点击“示例数据”重试";
    statusEl.className = "sample-status error";
  }
}

/* ---------- 会话渲染 ---------- */

function renderHistory() {
  const list = $("#historyList");
  list.innerHTML = "";
  const items = Object.values(conversations)
    .filter((c) => c.messages && c.messages.length)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "还没有对话";
    list.appendChild(empty);
    return;
  }
  const label = document.createElement("div");
  label.className = "group-label";
  label.textContent = "最近对话";
  list.appendChild(label);
  items.forEach((conv) => {
    const item = document.createElement("button");
    item.className = "history-item" + (conv.id === currentConversationId ? " active" : "");
    item.dataset.convId = conv.id;
    const runDot = conv.running ? '<span class="run-dot" title="运行中"></span>' : "";
    item.innerHTML = `
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>
      </svg>
      <span>${esc(conv.title || "新对话")}</span>
      ${runDot}
      <span class="delete-conv" title="删除对话">×</span>`;
    list.appendChild(item);
  });
}

function renderConversation(convId) {
  const conv = conversations[convId];
  if (!conv) return;
  currentConversationId = convId;
  currentSkill = conv.skill || null;
  chatThread.innerHTML = "";
  delete uiRefs[convId];
  showChat();
  for (const m of conv.messages || []) {
    appendMsgEl(m.role, m.html);
  }
  if (conv.running) {
    renderRunningUI(convId);
  }
  $("#chatTitle").textContent = conv.title || "新对话";
  scrollToBottom();
}

function renderRunningUI(convId) {
  const conv = conversations[convId];
  if (!conv || !conv.running) return;
  const r = conv.running;
  if (r.type === "generate") {
    const box = appendMsgEl(
      "assistant",
      `<div class="assistant-body">
        <div class="assistant-label"><span class="avatar">S</span> ${esc(r.label)}</div>
        <div class="stream-box"><pre class="stream-json"></pre><span class="cursor"></span></div>
      </div>`
    );
    const pre = box.querySelector(".stream-json");
    pre.textContent = r.text;
    uiRefs[convId] = { box, pre };
  } else {
    const box = appendMsgEl(
      "assistant",
      `<div class="assistant-body">
        <div class="assistant-label"><span class="avatar">S</span> 正在按分析流程处理数据…</div>
        <div class="metrics"></div>
        <div class="md stream-md"><span class="cursor"></span></div>
      </div>`
    );
    const metricsEl = box.querySelector(".metrics");
    const mdEl = box.querySelector(".stream-md");
    if (r.metrics) {
      metricsEl.innerHTML = Object.entries(r.metrics)
        .map(([k, v]) => `<span class="metric"><strong>${esc(k)}</strong>${esc(v)}</span>`)
        .join("");
    }
    mdEl.innerHTML = renderMarkdown(r.text) + '<span class="cursor"></span>';
    uiRefs[convId] = { box, metricsEl, mdEl };
  }
  scrollToBottom();
}

function updateRunningUI(convId) {
  if (convId !== currentConversationId) return;
  const refs = uiRefs[convId];
  const conv = conversations[convId];
  if (!refs || !refs.box || !refs.box.isConnected || !conv || !conv.running) return;
  const r = conv.running;
  if (r.type === "generate") {
    refs.pre.textContent = r.text;
  } else {
    if (r.metrics) {
      refs.metricsEl.innerHTML = Object.entries(r.metrics)
        .map(([k, v]) => `<span class="metric"><strong>${esc(k)}</strong>${esc(v)}</span>`)
        .join("");
    }
    refs.mdEl.innerHTML = renderMarkdown(r.text) + '<span class="cursor"></span>';
  }
  scrollToBottom();
}

/* ---------- 生成 / 执行（绑定到会话，切换不中断） ---------- */

async function generateSkill(requirement, convId) {
  const conv = conversations[convId];
  if (!conv || conv.running) return;
  conv.running = { type: "generate", text: "", label: "正在生成 Skill 配置…" };
  saveConvos();
  renderHistory();
  if (convId === currentConversationId) {
    setStatus(deepThink ? "深度思考中…" : "正在生成 Skill…", "loading");
    renderConversation(convId);
  }
  try {
    await streamApi("/api/skills/generate/stream", { requirement }, (ev) => {
      const c = conversations[convId];
      if (!c || !c.running) return;
      if (ev.type === "delta") {
        c.running.text += ev.content;
        updateRunningUI(convId);
        scheduleSave();
      } else if (ev.type === "result") {
        c.running = null;
        c.skill = ev.skill;
        c.title = ev.skill.name;
        const cachedLabel = ev.cached ? "Skill 已生成（缓存命中）" : "Skill 已生成";
        c.messages.push({
          role: "assistant",
          html:
            `<div class="assistant-body"><div class="assistant-label"><span class="avatar">S</span> ${cachedLabel}</div>` +
            skillCardHtml(ev.skill) +
            `</div>`,
        });
        saveConvos();
        renderHistory();
        if (convId === currentConversationId) {
          currentSkill = ev.skill;
          $("#chatTitle").textContent = ev.skill.name;
          renderConversation(convId);
          syncSampleData(ev.skill);
          setStatus("生成成功", "ok");
        }
      } else if (ev.type === "error") {
        throw new Error(ev.message);
      }
    });
  } catch (err) {
    const c = conversations[convId];
    if (!c) return;
    c.running = null;
    c.messages.push({
      role: "assistant",
      html: `<div class="error-box">${esc(err.message)}</div>`,
    });
    saveConvos();
    renderHistory();
    if (convId === currentConversationId) {
      renderConversation(convId);
      setStatus("生成失败", "error");
    }
  }
}

async function executeSkill() {
  const convId = currentConversationId;
  const conv = conversations[convId];
  const skill = currentSkill || (conv && conv.skill);
  if (!conv || !skill) return;
  if (conv.running) {
    setStatus("当前会话正在运行，请稍候", "error");
    return;
  }
  let inputData;
  try {
    inputData = JSON.parse($("#inputData").value);
  } catch {
    setStatus("示例数据不是合法 JSON", "error");
    return;
  }
  conv.messages.push({
    role: "user",
    html: `<div class="bubble">使用示例数据执行「${esc(skill.name)}」</div>`,
  });
  conv.running = { type: "execute", text: "", metrics: null };
  saveConvos();
  renderHistory();
  if (convId === currentConversationId) {
    setStatus("正在执行 Skill…", "loading");
    renderConversation(convId);
  }
  try {
    await streamApi(`/api/skills/${skill.id}/execute/stream`, { input_data: inputData }, (ev) => {
      const c = conversations[convId];
      if (!c || !c.running) return;
      if (ev.type === "metrics") {
        c.running.metrics = ev.metrics;
        updateRunningUI(convId);
      } else if (ev.type === "delta") {
        c.running.text += ev.content;
        updateRunningUI(convId);
        scheduleSave();
      } else if (ev.type === "done") {
        const running = c.running;
        const mdText = running.text;
        const metricsHtml = Object.entries(running.metrics || {})
          .map(([k, v]) => `<span class="metric"><strong>${esc(k)}</strong>${esc(v)}</span>`)
          .join("");
        c.running = null;
        c.messages.push({
          role: "assistant",
          html:
            `<div class="assistant-body"><div class="assistant-label"><span class="avatar">S</span> 分析完成</div>` +
            `<div class="metrics">${metricsHtml}</div>` +
            `<div class="md">${renderMarkdown(mdText)}</div></div>`,
        });
        saveConvos();
        renderHistory();
        if (convId === currentConversationId) {
          renderConversation(convId);
          setStatus("执行完成", "ok");
        }
      } else if (ev.type === "error") {
        throw new Error(ev.message);
      }
    });
  } catch (err) {
    const c = conversations[convId];
    if (!c) return;
    c.running = null;
    c.messages.push({
      role: "assistant",
      html: `<div class="error-box">${esc(err.message)}</div>`,
    });
    saveConvos();
    renderHistory();
    if (convId === currentConversationId) {
      renderConversation(convId);
      setStatus("执行失败", "error");
    }
  }
}

/* ---------- 会话切换 / 导入 / 发送 ---------- */

function loadConversation(id) {
  const conv = conversations[id];
  if (!conv) return;
  renderConversation(id);
  syncSampleData(conv.skill);
  setStatus(conv.running ? "正在运行中…" : "已加载", conv.running ? "loading" : "ok");
  renderHistory();
  if (window.innerWidth <= 860) {
    $("#sidebar").classList.remove("open");
  }
}

async function startGeneration(requirement, convId) {
  setStatus("正在判断是否需要补充信息…", "loading");
  try {
    const res = await api("/api/clarify", {
      method: "POST",
      body: JSON.stringify({ requirement }),
    });
    if (res.need && res.questions && res.questions.length) {
      const conv = conversations[convId];
      if (!conv) return;
      conv.pendingRequirement = requirement;
      saveConvos();
      showChat();
      const qHtml = res.questions
        .map(
          (q, i) =>
            `<div class="clarify-row"><label>${i + 1}. ${esc(q)}</label><input class="clarify-input" data-q="${i}" placeholder="请输入" /></div>`
        )
        .join("");
      appendMsgEl(
        "assistant",
        `<div class="assistant-body"><div class="assistant-label"><span class="avatar">S</span> 生成前需要补充几个信息</div><div class="clarify-card">${qHtml}<div class="clarify-row"><label>自定义需求补充（选填）：</label><textarea class="clarify-input" data-custom rows="2" placeholder="除了上面的问题，还有其它要求或业务背景可以写在这里，例如：重点看利润、按周输出报告、需要对比上月…"></textarea></div><div class="clarify-actions"><button class="btn primary" data-clarify-submit>提交并生成</button><button class="btn" data-clarify-skip>跳过，直接生成</button></div></div></div>`
      );
      scrollToBottom();
      setStatus("等待补充信息", "idle");
      return;
    }
    generateSkill(requirement, convId);
  } catch (err) {
    setStatus(err.message, "error");
  }
}

function send() {
  const requirement = input.value.trim();
  if (!requirement) return;
  const conv = conversations[currentConversationId];
  if (!conv) return;
  if (conv.running) {
    setStatus("当前会话正在运行，请稍候", "error");
    return;
  }
  const userHtml = `<div class="bubble">${esc(requirement)}</div>`;
  conv.messages.push({ role: "user", html: userHtml });
  saveConvos();
  renderHistory();
  showChat();
  appendMsgEl("user", userHtml);
  scrollToBottom();
  input.value = "";
  input.style.height = "auto";
  startGeneration(requirement, currentConversationId);
}

function newChat() {
  chatThread.innerHTML = "";
  currentSkill = null;
  currentConversationId = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  conversations[currentConversationId] = {
    id: currentConversationId,
    title: "新对话",
    skill: null,
    messages: [],
    createdAt: Date.now(),
  };
  delete uiRefs[currentConversationId];
  saveConvos();
  welcome.classList.remove("hidden");
  chatThread.classList.add("hidden");
  $("#chatTitle").textContent = "新对话";
  input.value = "";
  input.style.height = "auto";
  setStatus("待命", "idle");
  renderHistory();
}

async function importSkill(content) {
  setStatus("正在导入 Skill…", "loading");
  try {
    const skill = await api("/api/skills/import", {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    newChat();
    const conv = conversations[currentConversationId];
    conv.skill = skill;
    conv.title = skill.name;
    conv.messages = [
      { role: "user", html: `<div class="bubble">导入 Skill：${esc(skill.name)}</div>` },
      {
        role: "assistant",
        html:
          `<div class="assistant-body"><div class="assistant-label"><span class="avatar">S</span> 导入成功，可直接执行</div>` +
          skillCardHtml(skill) +
          `</div>`,
      },
    ];
    saveConvos();
    renderConversation(currentConversationId);
    syncSampleData(skill);
    renderHistory();
    setStatus("导入成功", "ok");
  } catch (err) {
    setStatus(err.message, "error");
  }
}

/* ---------- Events ---------- */

$("#newChatBtn").addEventListener("click", newChat);

$("#importBtn").addEventListener("click", () => {
  $("#importFile").click();
});

$("#importFile").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const text = await file.text();
  await importSkill(text);
  e.target.value = "";
});

$("#sendBtn").addEventListener("click", send);

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
});

$("#deepThinkBtn").addEventListener("click", () => {
  deepThink = !deepThink;
  $("#deepThinkBtn").classList.toggle("active", deepThink);
});

$("#sampleDataBtn").addEventListener("click", () => {
  const panel = $("#dataPanel");
  const wasHidden = panel.classList.contains("hidden");
  panel.classList.toggle("hidden");
  if (wasHidden && currentSkill && !panel.classList.contains("hidden")) {
    syncSampleData(currentSkill);
  }
});

$("#dataCloseBtn").addEventListener("click", () => {
  $("#dataPanel").classList.add("hidden");
});

$("#themeBtn").addEventListener("click", () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
});

$("#menuBtn").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
});

$("#chips").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  input.value = chip.textContent.trim();
  send();
});

chatThread.addEventListener("click", (e) => {
  const clarifyAction = e.target.closest("[data-clarify-submit], [data-clarify-skip]");
  if (clarifyAction) {
    const conv = conversations[currentConversationId];
    const requirement = conv && conv.pendingRequirement;
    if (!requirement) return;
    const card = clarifyAction.closest(".clarify-card");
    const customEl = card ? card.querySelector("[data-custom]") : null;
    const customText = customEl ? customEl.value.trim() : "";
    let answers = [];
    if (clarifyAction.matches("[data-clarify-submit]") && card) {
      card.querySelectorAll(".clarify-input").forEach((inp) => {
        if (inp === customEl) return;
        const val = inp.value.trim();
        if (val) answers.push(val);
      });
    }
    const extraParts = [];
    if (answers.length) extraParts.push(answers.join("；"));
    if (customText) extraParts.push(`自定义需求：${customText}`);
    const suffix = extraParts.length ? `（补充：${extraParts.join("；")}）` : "";
    const userHtml = `<div class="bubble">${esc(requirement)}${suffix}</div>`;
    conv.messages.push({ role: "user", html: userHtml });
    conv.pendingRequirement = null;
    saveConvos();
    renderHistory();
    appendMsgEl("user", userHtml);
    scrollToBottom();
    const contextParts = [];
    if (answers.length) contextParts.push(answers.join("；"));
    if (customText) contextParts.push(customText);
    const context = contextParts.length
      ? `${requirement}\n补充信息：${contextParts.join("；")}`
      : requirement;
    generateSkill(context, currentConversationId);
    return;
  }
  const jsonToggle = e.target.closest("[data-json-toggle]");
  if (jsonToggle) {
    const card = jsonToggle.closest(".skill-card");
    const jsonPre = card.querySelector("[data-json]");
    const hidden = jsonPre.classList.toggle("hidden");
    jsonToggle.textContent = hidden ? "查看完整配置" : "收起完整配置";
    return;
  }
  if (e.target.closest("[data-export]")) {
    if (currentSkill) downloadMarkdown(currentSkill);
    return;
  }
  if (e.target.closest("[data-execute]")) {
    executeSkill();
  }
});

$("#historyList").addEventListener("click", (e) => {
  const deleteBtn = e.target.closest(".delete-conv");
  if (deleteBtn) {
    const item = deleteBtn.closest("[data-conv-id]");
    const id = item.dataset.convId;
    delete conversations[id];
    delete uiRefs[id];
    saveConvos();
    if (id === currentConversationId) {
      newChat();
    } else {
      renderHistory();
    }
    return;
  }
  const item = e.target.closest("[data-conv-id]");
  if (!item) return;
  loadConversation(item.dataset.convId);
});

/* ---------- Init ---------- */

async function init() {
  loadConvos();
  renderHistory();
  newChat();
  try {
    const sample = await api("/api/sample");
    SAMPLE_INPUT = sample.input_data;
    $("#inputData").value = JSON.stringify(SAMPLE_INPUT, null, 2);
    setStatus("就绪", "idle");
  } catch (err) {
    setStatus(err.message, "error");
  }
}

init();
