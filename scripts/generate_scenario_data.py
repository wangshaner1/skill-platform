"""为四个场景的 Skill 各生成一份实例数据。

用法：python scripts/generate_scenario_data.py [0|1|2|3]
 0=电商运营分析  1=销售经营分析  2=用户增长分析  3=零售门店分析
不带参数时依次生成全部四个场景。
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.sample_data import (  # noqa: E402
    SAMPLE_REQUIREMENT_ECOM,
    SAMPLE_REQUIREMENT_GROWTH,
    SAMPLE_REQUIREMENT_RETAIL,
    SAMPLE_REQUIREMENT_SALES,
)
from app.sample_generator import generate_sample_data  # noqa: E402
from app.store import SkillStore  # noqa: E402


SCENARIOS = [
    {"name": "电商运营分析AI员工", "requirement": SAMPLE_REQUIREMENT_ECOM},
    {"name": "销售经营分析AI员工", "requirement": SAMPLE_REQUIREMENT_SALES},
    {"name": "用户增长分析AI员工", "requirement": SAMPLE_REQUIREMENT_GROWTH},
    {"name": "零售门店分析AI员工", "requirement": SAMPLE_REQUIREMENT_RETAIL},
]


def update_cache(requirement, data):
    cache_file = ROOT / "data" / "sample_data_cache.json"
    cache = {}
    if cache_file.exists():
        try:
            cache = json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            cache = {}
    cache[requirement] = data
    cache_file.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def run_one(index):
    scenario = SCENARIOS[index]
    store = SkillStore()
    skill = next(
        (s for s in store.list() if s.get("requirement") == scenario["requirement"]),
        None,
    )
    if not skill:
        print(f"[{index}] 未找到 Skill：{scenario['name']}")
        return

    print(f"[{index}] 正在生成实例数据：{skill['name']}")
    data = generate_sample_data(skill)
    out_dir = ROOT / "output" / "example_data"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{scenario['name']}.json"
    out_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    update_cache(skill["requirement"], data)
    print(f"[{index}] 实例数据已保存：{out_file}")


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
