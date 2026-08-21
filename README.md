# DataAgent Skill 平台

> 把优秀员工的岗位经验，沉淀为企业可自建、可复用、可治理的 AI 员工能力。

DataAgent Skill 平台是数花智算推出的企业 AI 员工技能平台。业务人员用自然语言描述岗位经验，系统自动生成结构化、可执行的 Skill（AI 员工技能），并可直接调用执行——让每个门店、每个团队都拥有“金牌店长 / 销售冠军”级别的经营分析能力，全程无需写代码。

## 解决的业务问题

- 经验难复制：资深店长、分析师的方法论随人走，离职即流失，新员工上手周期 2-3 个月
- 报告耗时：区域经理每周手工汇总各门店经营数据 6-8 小时，口径不统一、对比失真
- 通用模型不可用：ChatGPT 类产品不懂企业数据口径，无法直接产出可用的经营报告
- 不敢用 AI：输出不可验证、不可治理，企业无法把 AI 结论用于经营决策

## 典型业务场景

- 门店经营分析：店长一句话创建「门店经营分析 AI 员工」，自动输出坪效、人效、连带率与改进建议
- 直播运营复盘：每场直播结束自动生成复盘报告（流量、转化、货品、粉丝沉淀）
- 电商店铺诊断：流量、转化、客单、商品结构、渠道 ROI 一键复盘
- 销售团队复盘：目标达成、区域差异、客户分层与回款分析
- 用户增长分析：渠道效率、留存、激活漏斗与付费转化

## 核心能力

- 自然语言创建 AI 员工：需求澄清 → Skill 生成 → 语义校验 → 草稿 / 发布审核
- 指标口径库：27+ 业务指标由规则引擎统一计算，杜绝口径漂移
- 流式输出 + 断线续跑：长任务后台运行，刷新或断网后可恢复进度
- 缓存降本：相同需求 Redis 命中秒回，显著降低模型调用成本
- 数据安全：输入数据加密存储、敏感信息送模型前脱敏、审计日志、报告复核提示
- 质量保障：数据质量门禁、结论-指标一致性检查、Skill 版本管理

## 使用流程

1. 输入需求，如“帮我创建一个门店经营分析 AI 员工”；信息不足时系统先追问澄清。
2. 系统生成 Skill 配置（名称、描述、场景、输入定义、分析流程、Agent Prompt、输出模板），并自动匹配示例数据。
3. 确认后发布 Skill（草稿 → 已发布），或直接使用示例数据执行。
4. 查看分析报告：指标概览、复盘结论、优化建议，附模型与复核提示。

## 快速开始

```powershell
cd skill-platform-demo
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# 编辑 .env，填入 QWEN_API_KEY、REDIS_URL
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

浏览器访问 `http://127.0.0.1:8000`。

容器化部署：

```bash
export QWEN_API_KEY=your_key
docker compose up --build
```

## 技术栈

- 后端：Python 3.9、FastAPI、Pydantic
- 存储：SQLite（生产可迁移 PostgreSQL）+ Redis
- 前端：原生 HTML / CSS / JavaScript
- 模型：阿里云百炼 qwen3.7-plus（OpenAI 兼容接口，可通过环境变量替换）

## 目录结构

```text
skill-platform-demo/
├─ app/                    # 后端应用
│  ├─ main.py              # 接口入口
│  ├─ skill_generator.py   # Skill 生成引擎
│  ├─ skill_executor.py    # Skill 执行引擎
│  ├─ tasks.py             # 后台任务（断线续跑）
│  ├─ metrics_library.py   # 指标口径库
│  ├─ data_quality.py      # 数据质量门禁
│  ├─ consistency.py       # 结论一致性检查
│  ├─ crypto.py            # 输入加密
│  ├─ masking.py           # 敏感信息脱敏
│  ├─ cache.py             # Redis 缓存
│  └─ ... 
├─ static/                 # 前端
├─ docs/                   # 产品与技术文档
├─ scripts/                # 行业场景批量脚本
├─ output/                 # 行业解决方案报告与示例数据
├─ Dockerfile / docker-compose.yml
└─ requirements.txt
```

## 文档导航

- 产品需求文档：[docs/PRD.md](docs/PRD.md)
- 技术方案说明：[docs/TECH_DESIGN.md](docs/TECH_DESIGN.md)
- 客户常见问题：[docs/FAQ.md](docs/FAQ.md)
- 产品路线图：[docs/ROADMAP.md](docs/ROADMAP.md)
- 企业级风险与合规清单：[docs/RISKS.md](docs/RISKS.md)
