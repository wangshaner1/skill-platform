# 企业岗位经验 Skill 生成平台 Demo

本 Demo 实现面试题要求的最小可运行闭环：

自然语言输入 → Skill 自动生成 → Skill 配置展示 → 调用 Skill 执行任务 → 输出分析结果

默认演示场景：**抖音直播运营复盘**，LLM 使用阿里云百炼 `qwen3.7-plus` 的 OpenAI 兼容接口。

## 快速开始

```powershell
cd skill-platform-demo
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# 编辑 .env，填入 QWEN_API_KEY
python -m uvicorn app.main:app --reload --port 8000
```

打开浏览器访问 `http://127.0.0.1:8000`。

## 使用步骤

界面为对话式布局（参考 DeepSeek 网页版），操作流程：

1. 在底部输入框输入需求（如“帮我创建一个抖音直播运营复盘 Skill”），按回车或点击发送。
2. 助手返回自动生成的 Skill 配置卡片（名称、描述、场景、输入定义、分析流程、Agent Prompt、输出模板），可展开完整 JSON。
3. 点击卡片上的“使用示例数据执行”。
4. 助手返回指标概览与完整复盘报告。
5. 点击卡片上的“导出 Markdown”，可下载包含完整配置（含整份 JSON）的 Markdown 文档。
6. 导出的 `.md` 文件可直接复用：点左侧“导入 Skill”选择该文件，即可恢复为可执行、可再次导出的 Skill。

左侧栏支持历史对话回看与深色/浅色模式切换；“示例数据”按钮可查看或编辑执行时使用的输入数据；顶部“深度思考”开关会切换生成中的提示文案。

示例数据与 Skill 自动匹配：每个 Skill 首次打开时，系统按它的输入定义自动生成一份匹配的示例数据（按 Skill ID 缓存，不同版本各自独立）；执行前做必填字段、类型与异常值质量门禁，不合格直接拦截。

信任增强：执行结果会给出“分析模型”、数据质量提示、结论-指标一致性提示，并附“AI 生成，请复核”提醒。

每个对话独立保存为一条会话线程（存储在浏览器本地），互不混流：点击历史条目会单独打开对应对话，可删除不需要的会话；点“开启新对话”即开始一条全新的隔离会话。

任务运行绑定在会话上：生成或执行过程中切换到其他会话，原任务会在后台继续运行，回到原会话可看到实时进度和最终结果；运行中的会话在历史列表中会显示运行圆点。

## Redis 缓存

- 生成的 Skill 以“规范化需求”的 SHA-256 作为键写入 Redis（默认 TTL 30 天）。
- 相同需求再次请求时直接返回缓存，不再调用 LLM，节省成本；前端会显示“缓存命中”。
- Redis 不可用时自动降级为不缓存，不影响正常生成。
- 默认连接 `redis://127.0.0.1:6379/0`，可用环境变量 `REDIS_URL` 覆盖。
- Windows 本地可用仓库内的 `tools/redis/redis-server.exe --port 6379` 启动 Redis。

## 目录结构

```text
skill-platform-demo/
├─ app/
│  ├─ main.py              # FastAPI 入口与 API 路由
│  ├─ config.py            # 配置与 .env 加载
│  ├─ schemas.py           # Skill 配置 Schema
│  ├─ llm_client.py        # 阿里云百炼 OpenAI 兼容接口封装
│  ├─ skill_generator.py   # 自然语言 -> Skill 生成引擎
│  ├─ skill_executor.py    # Skill 执行引擎
│  ├─ store.py / db.py     # Skill 资产存储（SQLite + 版本历史）
│  ├─ cache.py             # Redis 缓存
│  ├─ clarifier.py         # 需求澄清
│  ├─ metrics_library.py   # 指标口径库
│  ├─ skill_validation.py  # 生成后语义校验
│  ├─ stats.py / audit.py  # 统计与审计
│  └─ sample_data.py       # 示例需求与示例输入数据
├─ static/
│  ├─ index.html
│  ├─ style.css
│  └─ app.js
├─ docs/
│  ├─ PRD.md
│  ├─ TECH_DESIGN.md
│  ├─ INTERVIEW_QA.md
│  ├─ OPTIMIZATION.md
│  └─ RISKS.md
├─ data/                   # 运行后生成的 Skill 资产
├─ requirements.txt
└─ .env.example
```

## 关键设计

- **Skill ≠ Prompt**：Skill 是一份结构化配置，包含名称、描述、场景、输入契约、分析流程、Agent Prompt、输出模板与版本。
- **生成防错**：LLM 输出必须通过 Pydantic Schema 校验，失败自动重试并携带错误信息。
- **执行防错**：先由规则引擎计算确定性指标，再交给 LLM 做解读，避免编造数字。
- **可运行闭环**：后端 FastAPI + 前端原生 HTML/JS，无需额外构建步骤。
- **流式输出**：生成与执行均使用 SSE 流式接口，AI 回复逐段到达并实时渲染，减少等待感。
- **Redis 缓存**：相同需求命中缓存直接返回，显著降低 LLM 调用成本。
- **需求澄清**：信息不足时先追问 1-3 个问题；需求明确时规则预判直接生成，不浪费 LLM 调用。
- **语义校验**：生成后做规则与主题一致性校验，不合格自动重试或报错，防止跑题 Skill。
- **SQLite + 版本管理**：Skill 资产入库，重复保存自动升版本并保留历史（`/api/skills/{id}/versions`）。
- **可观测性**：`/api/stats` 可查看 LLM 调用次数、缓存命中率等指标；所有请求有耗时日志。
- **安全加固**：输入长度限制、Prompt 注入防护、审计日志（需求只记录哈希不落原文）。
- **断线续跑**：生成/执行改为后台任务（独立线程 + 落库），刷新页面或断网后任务继续运行，重新连接可恢复进度并拿到完整结果，失败可一键重试。
- **安全与信任底线**：任务输入数据加密存储（Fernet，密钥不入库）；送模型前自动脱敏手机号/身份证/邮箱/银行卡；新 Skill 默认草稿、发布后才算正式可用；AI 报告附复核提示。
