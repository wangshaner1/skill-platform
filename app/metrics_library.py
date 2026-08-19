"""指标口径库：统一指标公式、字段映射与计算逻辑，规则引擎优先于 LLM。"""


def _safe_div(a, b):
    try:
        a = float(a or 0)
        b = float(b or 0)
    except (TypeError, ValueError):
        return 0
    return round(a / b * 100, 2) if b else 0


def _ratio(a, b):
    try:
        a = float(a or 0)
        b = float(b or 0)
    except (TypeError, ValueError):
        return 0
    return round(a / b, 2) if b else 0


def _sum_field(data, key, field):
    total = 0
    for item in data.get(key, []) or []:
        try:
            total += float(item.get(field) or 0)
        except (TypeError, ValueError):
            pass
    return total


# 每个指标：key（输出名）、requires（需要的字段，全部存在才计算）、compute（返回数值）
METRICS = [
    # ---- 抖音直播 ----
    {
        "key": "成交转化率(%)",
        "name": "成交转化率",
        "requires": ["观看人数", "成交人数"],
        "compute": lambda d: _safe_div(d.get("成交人数"), d.get("观看人数")),
    },
    {
        "key": "客单价(元)",
        "name": "客单价",
        "requires": ["总GMV(元)", "成交人数"],
        "compute": lambda d: _ratio(d.get("总GMV(元)"), d.get("成交人数")),
    },
    {
        "key": "退款率(%)",
        "name": "退款率",
        "requires": ["退款金额(元)", "总GMV(元)"],
        "compute": lambda d: _safe_div(d.get("退款金额(元)"), d.get("总GMV(元)")),
    },
    {
        "key": "新增粉丝率(%)",
        "name": "新增粉丝率",
        "requires": ["新增粉丝", "观看人数"],
        "compute": lambda d: _safe_div(d.get("新增粉丝"), d.get("观看人数")),
    },
    {
        "key": "互动率(%)",
        "name": "互动率",
        "requires": ["互动次数", "观看人数"],
        "compute": lambda d: _safe_div(d.get("互动次数"), d.get("观看人数")),
    },
    {
        "key": "每小时GMV(元)",
        "name": "每小时GMV",
        "requires": ["总GMV(元)", "直播时长(小时)"],
        "compute": lambda d: _ratio(d.get("总GMV(元)"), d.get("直播时长(小时)")),
    },
    # ---- 电商运营 ----
    {
        "key": "访客支付转化率(%)",
        "name": "访客支付转化率",
        "requires": ["支付买家数", "访客数"],
        "compute": lambda d: _safe_div(d.get("支付买家数"), d.get("访客数")),
    },
    {
        "key": "电商客单价(元)",
        "name": "电商客单价",
        "requires": ["支付金额(元)", "支付买家数"],
        "compute": lambda d: _ratio(d.get("支付金额(元)"), d.get("支付买家数")),
    },
    {
        "key": "电商退款率(%)",
        "name": "电商退款率",
        "requires": ["退款金额(元)", "支付金额(元)"],
        "compute": lambda d: _safe_div(d.get("退款金额(元)"), d.get("支付金额(元)")),
    },
    {
        "key": "推广ROI",
        "name": "推广ROI",
        "requires": ["支付金额(元)", "推广费用(元)"],
        "compute": lambda d: _ratio(d.get("支付金额(元)"), d.get("推广费用(元)")),
    },
    {
        "key": "优惠券费用占比(%)",
        "name": "优惠券费用占比",
        "requires": ["优惠券成本(元)", "支付金额(元)"],
        "compute": lambda d: _safe_div(d.get("优惠券成本(元)"), d.get("支付金额(元)")),
    },
    # ---- 销售经营 ----
    {
        "key": "销售目标达成率(%)",
        "name": "销售目标达成率",
        "requires": ["实际销售额(元)", "目标销售额(元)"],
        "compute": lambda d: _safe_div(d.get("实际销售额(元)"), d.get("目标销售额(元)")),
    },
    {
        "key": "销售回款率(%)",
        "name": "销售回款率",
        "requires": ["回款金额(元)", "实际销售额(元)"],
        "compute": lambda d: _safe_div(d.get("回款金额(元)"), d.get("实际销售额(元)")),
    },
    {
        "key": "新客占比(%)",
        "name": "新客占比",
        "requires": ["新签客户数", "续约客户数"],
        "compute": lambda d: _safe_div(d.get("新签客户数"), (d.get("新签客户数", 0) or 0) + (d.get("续约客户数", 0) or 0)),
    },
    {
        "key": "客户流失率(%)",
        "name": "客户流失率",
        "requires": ["流失客户数", "续约客户数"],
        "compute": lambda d: _safe_div(d.get("流失客户数"), (d.get("流失客户数", 0) or 0) + (d.get("续约客户数", 0) or 0)),
    },
    {
        "key": "销售费用率(%)",
        "name": "销售费用率",
        "requires": ["销售费用(元)", "实际销售额(元)"],
        "compute": lambda d: _safe_div(d.get("销售费用(元)"), d.get("实际销售额(元)")),
    },
    # ---- 用户增长 ----
    {
        "key": "注册付费转化率(%)",
        "name": "注册付费转化率",
        "requires": ["付费用户数", "新增注册用户"],
        "compute": lambda d: _safe_div(d.get("付费用户数"), d.get("新增注册用户")),
    },
    {
        "key": "活跃付费率(%)",
        "name": "活跃付费率",
        "requires": ["付费用户数", "活跃用户数"],
        "compute": lambda d: _safe_div(d.get("付费用户数"), d.get("活跃用户数")),
    },
    {
        "key": "注册激活率(%)",
        "name": "注册激活率",
        "requires": ["激活漏斗"],
        "compute": lambda d: _safe_div(d.get("激活漏斗", {}).get("完成首次使用"), d.get("激活漏斗", {}).get("注册")),
    },
    {
        "key": "次日留存率(%)",
        "name": "次日留存率",
        "requires": ["留存率"],
        "compute": lambda d: (float(d.get("留存率", {}).get("次日留存") or 0) * 100),
    },
    # ---- 零售门店 ----
    {
        "key": "门店总销售额(元)",
        "name": "门店总销售额",
        "requires": ["门店列表"],
        "compute": lambda d: _sum_field(d, "门店列表", "销售额(元)"),
    },
    {
        "key": "门店总成交单数",
        "name": "门店总成交单数",
        "requires": ["门店列表"],
        "compute": lambda d: _sum_field(d, "门店列表", "成交单数"),
    },
    {
        "key": "门店总客流",
        "name": "门店总客流",
        "requires": ["门店列表"],
        "compute": lambda d: _sum_field(d, "门店列表", "客流"),
    },
    {
        "key": "门店综合客单价(元)",
        "name": "门店综合客单价",
        "requires": ["门店列表"],
        "compute": lambda d: _ratio(_sum_field(d, "门店列表", "销售额(元)"), _sum_field(d, "门店列表", "成交单数")),
    },
    {
        "key": "门店综合成交率(%)",
        "name": "门店综合成交率",
        "requires": ["门店列表"],
        "compute": lambda d: _safe_div(_sum_field(d, "门店列表", "成交单数"), _sum_field(d, "门店列表", "客流")),
    },
    {
        "key": "门店综合坪效(元/㎡)",
        "name": "门店综合坪效",
        "requires": ["门店列表"],
        "compute": lambda d: _ratio(_sum_field(d, "门店列表", "销售额(元)"), _sum_field(d, "门店列表", "营业面积(㎡)")),
    },
    {
        "key": "门店综合人效(元/人)",
        "name": "门店综合人效",
        "requires": ["门店列表"],
        "compute": lambda d: _ratio(_sum_field(d, "门店列表", "销售额(元)"), _sum_field(d, "门店列表", "员工数")),
    },
]


def compute_metrics(data: dict) -> dict:
    """按输入字段自动匹配并计算所有可用指标。"""
    result = {}
    for metric in METRICS:
        if all(key in data for key in metric["requires"]):
            try:
                value = metric["compute"](data)
                if value is not None:
                    result[metric["key"]] = value
            except Exception:
                continue
    return result
