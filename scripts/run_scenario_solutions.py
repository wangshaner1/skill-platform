"""批量生成并执行四个场景的 Skill，输出 Markdown 报告。

用法：python scripts/run_scenario_solutions.py [0|1|2|3]
 0=电商运营分析  1=销售经营分析  2=用户增长分析  3=零售门店分析
不带参数时依次运行全部四个场景。
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.sample_data import (  # noqa: E402
    SAMPLE_INPUT_ECOM,
    SAMPLE_INPUT_GROWTH,
    SAMPLE_INPUT_RETAIL,
    SAMPLE_INPUT_SALES,
    SAMPLE_REQUIREMENT_ECOM,
    SAMPLE_REQUIREMENT_GROWTH,
    SAMPLE_REQUIREMENT_RETAIL,
    SAMPLE_REQUIREMENT_SALES,
)
from app.skill_executor import execute_skill  # noqa: E402
from app.skill_generator import generate_skill  # noqa: E402
from app.store import SkillStore  # noqa: E402


SCENARIOS = [
    {
        "name": "电商运营分析AI员工",
        "requirement": SAMPLE_REQUIREMENT_ECOM,
        "input": SAMPLE_INPUT_ECOM,
    },
    {
        "name": "销售经营分析AI员工",
        "requirement": SAMPLE_REQUIREMENT_SALES,
        "input": SAMPLE_INPUT_SALES,
    },
    {
        "name": "用户增长分析AI员工",
        "requirement": SAMPLE_REQUIREMENT_GROWTH,
        "input": SAMPLE_INPUT_GROWTH,
    },
    {
        "name": "零售门店分析AI员工",
        "requirement": SAMPLE_REQUIREMENT_RETAIL,
        "input": SAMPLE_INPUT_RETAIL,
    },
]


def build_report(scenario, skill, result):
    parts = []
    parts.append(f"# {scenario['name']}：Skill 生成与执行方案")
    parts.append("")
    parts.append(f"- 生成需求：{scenario['requirement']}")
    parts.append(f"- Skill ID：`{skill['id']}`")
    parts.append(f"- Skill 名称：{skill['name']}")
    parts.append(f"- 创建时间：{skill['created_at']}")
    parts.append("")
    parts.append("## 一、Skill 配置（完整 JSON）")
    parts.append("")
    parts.append("```json")
    parts.append(json.dumps(skill, ensure_ascii=False, indent=2))
    parts.append("```")
    parts.append("")
    parts.append("## 二、调用 Skill 执行的输入数据")
    parts.append("")
    parts.append("```json")
    parts.append(json.dumps(scenario["input"], ensure_ascii=False, indent=2))
    parts.append("```")
    parts.append("")
    parts.append("## 三、确定性指标快照")
    parts.append("")
    if result["metrics"]:
        for k, v in result["metrics"].items():
            parts.append(f"- {k}：{v}")
    else:
        parts.append("（本场景指标由 LLM 依据输入数据计算，未启用规则指标）")
    parts.append("")
    parts.append("## 四、Skill 执行结果")
    parts.append("")
    parts.append(result["markdown"])
    parts.append("")
    return "\n".join(parts)


def run_one(index):
    scenario = SCENARIOS[index]
    store = SkillStore()
    existing = next(
        (s for s in store.list() if s.get("requirement") == scenario["requirement"]),
        None,
    )
    if existing:
        skill = existing
        print(f"[{index}] 复用已生成 Skill：{skill['name']}（{skill['id']}）")
    else:
        print(f"[{index}] 开始生成：{scenario['name']}")
        skill = generate_skill(scenario["requirement"], store=store)
        print(f"[{index}] 生成完成：{skill['name']}（{skill['id']}）")

    print(f"[{index}] 开始执行：{scenario['name']}")
    result = execute_skill(skill, scenario["input"])
    print(f"[{index}] 执行完成")

    out_dir = ROOT / "output" / "scenarios"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{scenario['name']}.md"
    out_file.write_text(build_report(scenario, skill, result), encoding="utf-8")
    print(f"[{index}] 报告已保存：{out_file}")


def main():
    args = sys.argv[1:]
    if args:
        indexes = [int(args[0])]
    else:
        indexes = list(range(len(SCENARIOS)))
    for i in indexes:
        run_one(i)


if __name__ == "__main__":
    main()
