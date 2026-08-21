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
let sampleSyncSeq = 0;

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
  // 兼容旧版本残留的运行标记
  Object.values(conversations).forEach((c) => {
    if (c.running) c.running = null;
    if (!c.activeTask) c.activeTask = null;
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

async function streamApi(path, onEvent, method = "POST", body = null) {
  const resp = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
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
  const statusBadge =
    skill.status === "published"
      ? '<span class="badge ok">已发布</span>'
      : '<span class="badge draft">草稿</span>';
  const publishBtn =
    skill.status === "published" ? "" : '<button class="btn" data-publish>发布 Skill</button>';

  return `
  <div class="skill-card">
    <div class="skill-card-head">
      <div>
        <h3>${esc(skill.name)}</h3>
        <p>${esc(skill.description)}</p>
      </div>
      <span class="badge">v${esc(skill.version)}</span>
      ${statusBadge}
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
      ${publishBtn}
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
    const runDot = conv.activeTask ? '<span class="run-dot" title="运行中"></span>' : "";
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
  if (conv.activeTask) {
    renderRunningUI(convId);
  }
  $("#chatTitle").textContent = conv.title || "新对话";
  scrollToBottom();
}

function renderRunningUI(convId) {
  const conv = conversations[convId];
  const task = conv && conv.activeTask;
  if (!task) return;
  const label = task.kind === "generate" ? "正在生成 Skill 配置…" : "正在按分析流程处理数据…";
  const note = task.disconnected
    ? `<div class="disconnect-note"><span>连接中断，任务仍在后台运行</span><button class="btn" data-attach>重新连接</button></div>`
    : "";
  const box = appendMsgEl(
    "assistant",
    `<div class="assistant-body">
      <div class="assistant-label"><span class="avatar">S</span> ${label}</div>
      <div class="stream-box"><pre class="stream-json"></pre><span class="cursor"></span></div>
      ${note}
    </div>`
  );
  const pre = box.querySelector(".stream-json");
  pre.textContent = task.progress || "";
  uiRefs[convId] = { box, pre };
  scrollToBottom();
}

function updateTaskProgressUI(convId) {
  if (convId !== currentConversationId) return;
  const refs = uiRefs[convId];
  const conv = conversations[convId];
  const task = conv && conv.activeTask;
  if (!refs || !refs.box || !refs.box.isConnected || !task) return;
  refs.pre.textContent = task.progress || "";
  scrollToBottom();
}

/* ---------- 后台任务（断线可续跑） ---------- */

async function createAndRunTask(convId, kind, params) {
  const conv = conversations[convId];
  if (!conv) return;
  setStatus("正在创建任务…", "loading");
  const task = await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ kind, ...params }),
  });
  conv.activeTask = {
    id: task.id,
    kind,
    params,
    progress: task.progress || "",
    disconnected: false,
  };
  saveConvos();
  renderHistory();
  if (convId === currentConversationId) {
    setStatus(kind === "generate" ? "正在生成 Skill…" : "正在执行 Skill…", "loading");
    renderConversation(convId);
  }
  attachTask(convId);
}

async function attachTask(convId) {
  const conv = conversations[convId];
  const task = conv && conv.activeTask;
  if (!task) return;
  if (convId === currentConversationId) {
    setStatus("任务运行中…", "loading");
    if (!uiRefs[convId] || !uiRefs[convId].box || !uiRefs[convId].box.isConnected) {
      renderConversation(convId);
    }
  }
  try {
    await streamApi(`/api/tasks/${task.id}/stream`, (ev) => {
      const c = conversations[convId];
      if (!c || !c.activeTask || c.activeTask.id !== task.id) return;
      if (ev.type === "delta") {
        c.activeTask.progress = (c.activeTask.progress || "") + ev.content;
        c.activeTask.disconnected = false;
        if (convId === currentConversationId) updateTaskProgressUI(convId);
        scheduleSave();
      } else if (ev.type === "result") {
        finishTask(convId, task.id, ev);
      } else if (ev.type === "error") {
        failTask(convId, task.id, ev.message);
      }
    }, "GET");
  } catch (err) {
    const c = conversations[convId];
    if (!c || !c.activeTask || c.activeTask.id !== task.id) return;
    c.activeTask.disconnected = true;
    saveConvos();
    if (convId === currentConversationId) {
      renderConversation(convId);
      setStatus("连接中断，任务仍在后台运行", "loading");
    }
  }
}

function finishTask(convId, taskId, ev) {
  const c = conversations[convId];
  if (!c || !c.activeTask || c.activeTask.id !== taskId) return;
  if (ev.kind === "generate") {
    const skill = ev.skill;
    c.skill = skill;
    c.title = skill.name;
    const cachedLabel = ev.cached ? "Skill 已生成（缓存命中）" : "Skill 已生成";
    c.messages.push({
      role: "assistant",
      html:
        `<div class="assistant-body"><div class="assistant-label"><span class="avatar">S</span> ${cachedLabel}</div>` +
        skillCardHtml(skill) +
        `</div>`,
    });
    if (convId === currentConversationId) {
      currentSkill = skill;
      $("#chatTitle").textContent = skill.name;
      syncSampleData(skill);
    }
  } else {
    const metricsHtml = Object.entries(ev.metrics || {})
      .map(([k, v]) => `<span class="metric"><strong>${esc(k)}</strong>${esc(v)}</span>`)
      .join("");
    const qualityWarn =
      ev.quality && ev.quality.warnings && ev.quality.warnings.length
        ? `<div class="quality-note">数据质量提示：${esc(ev.quality.warnings.join("；"))}</div>`
        : "";
    const consistencyWarn =
      ev.consistency && ev.consistency.passed === false && ev.consistency.missing.length
        ? `<div class="consistency-warn">一致性提示：已计算指标（${esc(ev.consistency.missing.join("，"))}）未在报告中出现，请人工核对。</div>`
        : "";
    const modelLine = ev.model ? `<div class="meta-line">分析模型：${esc(ev.model)}</div>` : "";
    c.messages.push({
      role: "assistant",
      html:
        `<div class="assistant-body"><div class="assistant-label"><span class="avatar">S</span> 分析完成</div>` +
        `${qualityWarn}` +
        `<div class="metrics">${metricsHtml}</div>` +
        `<div class="md">${renderMarkdown(ev.markdown || "")}</div>` +
        `${consistencyWarn}` +
        `${modelLine}` +
        `<p class="review-note">本报告由 AI 生成，关键指标请结合原始数据复核。</p></div>`,
    });
  }
  c.activeTask = null;
  saveConvos();
  renderHistory();
  if (convId === currentConversationId) {
    renderConversation(convId);
    setStatus(ev.kind === "generate" ? "生成成功" : "执行完成", "ok");
  }
}

function failTask(convId, taskId, message) {
  const c = conversations[convId];
  if (!c || !c.activeTask || c.activeTask.id !== taskId) return;
  c.pendingRetry = { kind: c.activeTask.kind, params: c.activeTask.params };
  c.messages.push({
    role: "assistant",
    html: `<div class="error-box">${esc(message)}<div class="error-actions"><button class="btn primary" data-task-retry>重试</button></div></div>`,
  });
  c.activeTask = null;
  saveConvos();
  renderHistory();
  if (convId === currentConversationId) {
    renderConversation(convId);
    setStatus("任务失败", "error");
  }
}

/* ---------- 生成 / 执行入口 ---------- */

async function generateSkill(requirement, convId) {
  const conv = conversations[convId];
  if (!conv || conv.activeTask) return;
  await createAndRunTask(convId, "generate", { requirement });
}

async function executeSkill() {
  const convId = currentConversationId;
  const conv = conversations[convId];
  const skill = currentSkill || (conv && conv.skill);
  if (!conv || !skill) return;
  if (conv.activeTask) {
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
  const userHtml = `<div class="bubble">使用示例数据执行「${esc(skill.name)}」</div>`;
  conv.messages.push({ role: "user", html: userHtml });
  saveConvos();
  renderHistory();
  showChat();
  appendMsgEl("user", userHtml);
  scrollToBottom();
  await createAndRunTask(convId, "execute", { skill_id: skill.id, input_data: inputData });
}

async function publishSkill() {
  if (!currentSkill) return;
  setStatus("正在发布…", "loading");
  try {
    const updated = await api(`/api/skills/${currentSkill.id}/publish`, {
      method: "POST",
    });
    const conv = conversations[currentConversationId];
    if (conv) {
      conv.skill = updated;
      currentSkill = updated;
      saveConvos();
      renderConversation(currentConversationId);
      setStatus("已发布", "ok");
    }
  } catch (err) {
    setStatus(err.message, "error");
  }
}

/* ---------- 澄清 / 会话切换 / 导入 / 发送 ---------- */

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

function loadConversation(id) {
  const conv = conversations[id];
  if (!conv) return;
  renderConversation(id);
  setStatus(conv.activeTask ? "任务运行中…" : "已加载", conv.activeTask ? "loading" : "ok");
  renderHistory();
  syncSampleData(conv.skill);
  if (conv.activeTask) attachTask(id);
  if (window.innerWidth <= 860) {
    $("#sidebar").classList.remove("open");
  }
}

function send() {
  const requirement = input.value.trim();
  if (!requirement) return;
  const conv = conversations[currentConversationId];
  if (!conv) return;
  if (conv.activeTask) {
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
    activeTask: null,
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
    showChat();
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

  if (e.target.closest("[data-attach]")) {
    const conv = conversations[currentConversationId];
    if (conv && conv.activeTask) {
      conv.activeTask.disconnected = false;
      saveConvos();
      renderConversation(currentConversationId);
      attachTask(currentConversationId);
    }
    return;
  }

  if (e.target.closest("[data-task-retry]")) {
    const conv = conversations[currentConversationId];
    const retry = conv && conv.pendingRetry;
    if (!retry) return;
    conv.pendingRetry = null;
    saveConvos();
    createAndRunTask(currentConversationId, retry.kind, retry.params);
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
  if (e.target.closest("[data-publish]")) {
    publishSkill();
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
  // 恢复未完成的后台任务（断线/刷新后继续）
  Object.values(conversations).forEach((conv) => {
    if (conv.activeTask) attachTask(conv.id);
  });
}

init();
