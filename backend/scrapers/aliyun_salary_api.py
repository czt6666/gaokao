"""
阿里云市场 - 薪酬数据 API 对接
================================
产品：各行业各地区职位薪酬水平数据 (cmapi025767)
地址：https://market.aliyun.com/detail/cmapi025767
价格：1元/次

使用前：
1. 登录阿里云 → 云市场 → 搜索 "薪酬" → 购买该API
2. 购买后在 "已购买的服务" 中获取 APPCODE
3. 设置环境变量: export ALIYUN_APPCODE="你的APPCODE"
4. 运行: python3 scrapers/aliyun_salary_api.py --test

备注：阿里云市场 API 标准调用方式
  - 鉴权：请求头 Authorization: APPCODE {your_appcode}
  - 网关域名：*.market.alicloudapi.com 或产品文档指定
  - 格式：REST JSON
"""
from __future__ import annotations

import sys, os, json, time, argparse, logging
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests
from database import SessionLocal, engine
from sqlalchemy import text

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("aliyun_salary")

APPCODE = os.getenv("ALIYUN_APPCODE", "")

# ── 阿里云市场 API 调用 ──────────────────────────────────────
# 注意：以下 API endpoint 和参数格式需要在购买后查看实际文档
# 阿里云市场 API 的标准调用格式如下（具体path和params购买后可见）

API_HOST = "https://ali-salary.showapi.com"  # 示例，需替换为实际域名
HEADERS = {
    "Authorization": f"APPCODE {APPCODE}",
    "Content-Type": "application/json; charset=UTF-8",
}


def query_salary(industry: str = "", city: str = "", position: str = "") -> dict:
    """
    查询薪酬数据
    参数需根据购买后的API文档调整
    """
    if not APPCODE:
        log.error("请设置环境变量 ALIYUN_APPCODE")
        return {}

    params = {}
    if industry:
        params["industry"] = industry
    if city:
        params["city"] = city
    if position:
        params["position"] = position

    try:
        resp = requests.get(
            f"{API_HOST}/salary-query",  # 需替换为实际endpoint
            headers=HEADERS,
            params=params,
            timeout=10
        )
        resp.raise_for_status()
        data = resp.json()
        log.info(f"查询成功: {industry}/{city}/{position}")
        return data
    except Exception as e:
        log.error(f"查询失败: {e}")
        return {}


def batch_query_for_majors():
    """
    批量查询：将大学专业映射到行业+职位，查询真实薪资
    """
    if not APPCODE:
        log.error("请先设置 ALIYUN_APPCODE 环境变量")
        log.info("获取方式：")
        log.info("  1. 访问 https://market.aliyun.com/detail/cmapi025767")
        log.info("  2. 购买API（1元/次）")
        log.info("  3. 在 '已购买的服务' 中复制 APPCODE")
        log.info("  4. export ALIYUN_APPCODE='你的APPCODE'")
        return

    db = SessionLocal()

    # 查询计划：行业×城市 组合
    # 主要城市（覆盖主要就业去向）
    cities = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "南京", "西安", "重庆"]

    # 行业关键词（对应我们的专业映射）
    industries = [
        "互联网/IT", "金融", "制造业", "医疗/医药",
        "教育", "法律", "房地产/建筑", "电子/半导体",
        "消费品/零售", "物流/供应链"
    ]

    results = []
    total_queries = 0

    for ind in industries:
        for city in cities:
            data = query_salary(industry=ind, city=city)
            if data:
                results.append({
                    "industry": ind,
                    "city": city,
                    "data": data,
                })
                total_queries += 1
                time.sleep(0.5)  # 避免限速

    # 保存结果
    output_path = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                               "data", "aliyun_salary_data.json")
    with open(output_path, "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    log.info(f"完成 {total_queries} 次查询，结果保存到 {output_path}")
    log.info(f"预估费用：¥{total_queries}")

    db.close()


def test_api():
    """测试API连通性"""
    if not APPCODE:
        print("❌ APPCODE 未设置")
        print("\n请按以下步骤操作：")
        print("  1. 访问 https://market.aliyun.com/detail/cmapi025767")
        print("  2. 点击「立即购买」购买API（1元/次）")
        print("  3. 购买后进入「已购买的服务」")
        print("  4. 复制 APPCODE")
        print("  5. 终端执行: export ALIYUN_APPCODE='你的APPCODE'")
        print("  6. 重新运行: python3 scrapers/aliyun_salary_api.py --test")
        return

    print(f"APPCODE: {APPCODE[:8]}...{APPCODE[-4:]}")
    print("测试查询: 互联网行业 + 北京...")
    result = query_salary(industry="互联网/IT", city="北京")
    if result:
        print(f"✅ API连通！返回数据: {json.dumps(result, ensure_ascii=False, indent=2)[:500]}")
    else:
        print("❌ 查询失败，请检查APPCODE和网络")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="阿里云薪酬API对接")
    p.add_argument("--test", action="store_true", help="测试API连通性")
    p.add_argument("--batch", action="store_true", help="批量查询行业×城市薪资")
    args = p.parse_args()

    if args.test:
        test_api()
    elif args.batch:
        batch_query_for_majors()
    else:
        test_api()
