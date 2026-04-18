"""冷门院校/专业「未来展望」生成服务
使用 DeepSeek API 基于结构化数据生成 5-10 年发展趋势分析。
结果缓存到 SQLite，避免重复调用。
"""
import os, json, time, hashlib, httpx
from typing import Optional, Dict, Any

_DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
_DEEPSEEK_BASE    = "https://api.deepseek.com/v1"
_MODEL            = "deepseek-chat"

# ── 内存缓存（LRU, 最多 200 条，每条有效 7 天）──────────────────────
_cache: dict = {}
_CACHE_TTL   = 7 * 86400   # 7 天
_CACHE_MAX   = 200


def _cache_key(school: str, major: str) -> str:
    raw = f"{school}:{major}"
    return hashlib.md5(raw.encode()).hexdigest()


def _cache_get(key: str) -> Optional[str]:
    entry = _cache.get(key)
    if not entry:
        return None
    if time.time() - entry["ts"] > _CACHE_TTL:
        _cache.pop(key, None)
        return None
    return entry["text"]


def _cache_set(key: str, text: str):
    if len(_cache) >= _CACHE_MAX:
        oldest = min(_cache, key=lambda k: _cache[k]["ts"])
        _cache.pop(oldest, None)
    _cache[key] = {"text": text, "ts": time.time()}


# ── 国家重点政策方向（用于 prompt 上下文）──────────────────────────
_POLICY_DIRECTIONS = """
2025-2035年国家重点发展方向（用于判断专业前景）：
1. 新质生产力：人工智能、量子计算、半导体芯片、新能源
2. 双碳战略：碳中和、环境工程、新能源汽车、储能技术
3. 数字中国：大数据、云计算、网络安全、数字经济
4. 健康中国：生物医药、公共卫生、中医药现代化、养老产业
5. 制造强国：高端装备、航空航天、海洋工程、新材料
6. 粮食安全：农业科技、种业、食品工程
7. 文化自信：文化创意、数字传媒、国际传播
8. 教育强国：师范教育、职业教育改革
9. 法治中国：涉外法律、知识产权、数据合规
10. 乡村振兴：农村规划、农业经济、生态保护
"""


def _build_prompt(school_data: Dict[str, Any]) -> str:
    """构造结构化 prompt"""
    school = school_data.get("school_name", "")
    major  = school_data.get("major_name", "")
    city   = school_data.get("city", "")
    tier   = school_data.get("tier", "")

    # 就业数据
    emp = school_data.get("employment") or {}
    salary = emp.get("avg_salary") or 0
    emp_rate = emp.get("school_employment_rate") or 0
    postgrad = emp.get("school_postgrad_rate") or 0

    # 学科评估
    strong = school_data.get("strong_subjects") or []

    # 历史位次趋势
    hist = school_data.get("recent_data") or school_data.get("recent_years_data") or []
    hist_str = ", ".join(
        f"{h.get('year')}年: {h.get('min_rank', '?')}位"
        for h in sorted(hist, key=lambda x: x.get("year", 0))
    ) if hist else "暂无"

    # 冷门标签
    gems = school_data.get("all_gems") or []
    gem_labels = [g.get("gem_type_label", "") for g in gems if g.get("gem_type_label")]

    # 大小年
    bsy = school_data.get("big_small_year") or {}

    # 标签
    tags = school_data.get("tags") or []
    tags_str = ", ".join(tags[:5]) if tags else ""

    salary_str = f"¥{salary // 1000}k/月" if salary else "暂无"
    emp_str    = f"{emp_rate * 100:.0f}%" if emp_rate else "暂无"
    pg_str     = f"{postgrad * 100:.0f}%" if postgrad else "暂无"

    return f"""你是一位中国高等教育与职业发展分析专家。请基于以下数据，为该院校/专业生成一份「未来展望」分析。

## 院校信息
- 学校：{school}
- 专业：{major}
- 城市：{city}
- 层次：{tier}
- 标签：{tags_str}
- A类学科：{", ".join(strong) if strong else "无"}

## 就业数据
- 毕业生平均月薪：{salary_str}
- 就业率：{emp_str}
- 深造率：{pg_str}

## 录取趋势
- 近年最低位次：{hist_str}
- 冷门特征：{", ".join(gem_labels) if gem_labels else "无"}

{_POLICY_DIRECTIONS}

## 输出要求
请生成 250-350 字的分析，包含以下内容：
1. **行业前景（5-10年）**：该专业对应行业的发展趋势
2. **政策利好**：与哪些国家战略方向相关
3. **就业预判**：毕业生供需关系、薪资增长潜力
4. **风险提示**：需要注意的不确定因素
5. **综合建议**：一句话总结该冷门专业的核心价值

语言风格：专业客观、数据驱动、避免绝对化表述。用"预计""趋势上看""值得关注"等措辞。
不要使用 markdown 格式，用纯文本段落。"""


def generate_outlook(school_data: Dict[str, Any]) -> str:
    """为一个冷门学校/专业生成未来展望文本。
    返回 250-350 字的分析文本，失败返回空字符串。"""
    school = school_data.get("school_name", "")
    major  = school_data.get("major_name", "")

    # 1. 检查缓存
    key = _cache_key(school, major)
    cached = _cache_get(key)
    if cached:
        return cached

    # 2. 检查 API Key
    api_key = _DEEPSEEK_API_KEY or os.getenv("DEEPSEEK_API_KEY", "")
    if not api_key:
        return ""

    # 3. 构造 prompt
    prompt = _build_prompt(school_data)

    # 4. 调用 DeepSeek API
    try:
        resp = httpx.post(
            f"{_DEEPSEEK_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": _MODEL,
                "messages": [
                    {"role": "system", "content": "你是中国高等教育与职业发展分析专家，善于基于数据做出客观、专业的趋势分析。"},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.7,
                "max_tokens": 800,
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
        text = data["choices"][0]["message"]["content"].strip()

        # 5. 缓存
        _cache_set(key, text)
        return text

    except Exception as e:
        print(f"[future_outlook] DeepSeek API error: {e}")
        return ""


def get_cached_outlooks(results: list) -> Dict[str, str]:
    """仅从缓存获取已生成的展望文本（零延迟，不调用 API）。"""
    outlooks = {}
    seen = set()
    for r in results:
        if not r.get("is_hidden_gem"):
            continue
        school = r.get("school_name", "")
        major  = r.get("major_name", "")
        if school in seen:
            continue
        seen.add(school)
        key = _cache_key(school, major)
        cached = _cache_get(key)
        if cached:
            outlooks[school] = cached
    return outlooks


def trigger_batch_async(results: list, max_schools: int = 5):
    """后台线程异步生成展望（不阻塞调用者）。
    生成完成后自动写入缓存，下次 PDF 请求即可读取。"""
    import threading

    gems = []
    seen = set()
    for r in results:
        if not r.get("is_hidden_gem"):
            continue
        school = r.get("school_name", "")
        major  = r.get("major_name", "")
        if school in seen:
            continue
        # 跳过已缓存的
        key = _cache_key(school, major)
        if _cache_get(key):
            continue
        seen.add(school)
        gems.append(r)

    gems.sort(key=lambda x: x.get("gem_score", 0), reverse=True)
    gems = gems[:max_schools]

    if not gems:
        return

    def _worker():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            futures = {pool.submit(generate_outlook, r): r.get("school_name", "") for r in gems}
            for future in concurrent.futures.as_completed(futures, timeout=60):
                try:
                    future.result()  # 结果自动写入缓存
                except Exception:
                    pass
        print(f"[future_outlook] 后台生成完成: {len(gems)} 所冷门学校")

    t = threading.Thread(target=_worker, daemon=True)
    t.start()


def generate_outlooks_batch(results: list, max_schools: int = 5) -> Dict[str, str]:
    """同步批量生成（仅用于独立测试，PDF 生成中不使用此函数）。"""
    import concurrent.futures

    gems = []
    seen = set()
    for r in results:
        if not r.get("is_hidden_gem"):
            continue
        school = r.get("school_name", "")
        if school in seen:
            continue
        seen.add(school)
        gems.append(r)
    gems.sort(key=lambda x: x.get("gem_score", 0), reverse=True)
    gems = gems[:max_schools]

    if not gems:
        return {}

    outlooks = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        future_map = {pool.submit(generate_outlook, r): r.get("school_name", "") for r in gems}
        for future in concurrent.futures.as_completed(future_map, timeout=45):
            school = future_map[future]
            try:
                text = future.result()
                if text:
                    outlooks[school] = text
            except Exception:
                pass
    return outlooks
