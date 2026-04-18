"""
backend/services/llm_reason.py

LLM 推荐理由生成服务 — 仅用于 PDF 报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
职责：为每所推荐学校生成 60-100 字的个性化叙述。
     严格基于结构化数据，禁止 LLM 自行补充事实。
     有 7 天缓存 + fallback 到现有模板理由。

成本估算：
  每份报告 ~15 所学校 × 300 tokens × Claude Haiku 定价
  ≈ ¥0.10-0.15 / 份（可忽略不计）

调用时机：pdf_export.py 生成每所学校卡片时调用。
"""

import hashlib
import os
import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ── 配置 ───────────────────────────────────────────────────────
_API_KEY  = os.getenv("ANTHROPIC_API_KEY") or os.getenv("DEEPSEEK_API_KEY", "")
_LLM_PROVIDER = "anthropic" if os.getenv("ANTHROPIC_API_KEY") else "deepseek"
_CACHE_TTL_DAYS = 7

_SYSTEM_PROMPT = """你是一位高考志愿规划专家，正在为一位学生撰写志愿推荐报告。

你的任务：根据提供的学校数据，用 60-100 字向这位学生说明为什么这所学校值得认真考虑。

写作要求：
1. 直接对学生说话，第二人称视角（"你的位次...""这所学校适合..."）
2. 有温度、有判断，不要像在读数据报表
3. 着重说明 1-2 个最有说服力的理由，不要堆砌所有数字
4. 最多引用 2 个具体数字，其余用定性描述代替
5. 如果是冷门推荐，要说清楚"被低估在哪里、机会在哪里"
6. 严格只使用提供的数据，禁止添加任何未提供的事实或数字

禁止：
- 不许出现"该校"（改用校名或"这所学校"）
- 不许重复数字堆砌
- 不许说模糊套话如"综合实力雄厚""就业前景广阔"
"""


def _build_prompt(school: dict, student: dict) -> str:
    """将结构化数据构建为 LLM 输入 prompt。"""
    emp  = school.get("employment") or {}
    rev  = school.get("review_data") or {}
    gem  = school.get("top_gem") or {}
    subj = school.get("strong_subjects") or []

    # 学生信息
    s_province = student.get("province", "")
    s_rank     = student.get("rank", 0)
    s_subject  = student.get("subject", "")

    # 学校基本信息
    name     = school.get("school_name", "")
    city     = school.get("city", "")
    is_985   = school.get("is_985", "否") == "是"
    is_211   = school.get("is_211", "否") == "是"
    rank2025 = school.get("rank_2025") or 0
    prob     = school.get("probability", 0)
    tier_label = {"冲": "冲刺志愿", "稳": "稳妥志愿", "保": "保底志愿"}.get(school.get("tier", ""), "")
    gem_desc = gem.get("gem_description", "")
    swarm_disc = school.get("swarm_discovery", False)

    # 就业数据
    salary      = emp.get("avg_salary") or emp.get("salary")
    emp_rate    = emp.get("school_employment_rate") or emp.get("employment_rate")
    postgrad    = emp.get("school_postgrad_rate") or emp.get("postgrad_rate")
    top_city    = emp.get("school_top_city") or emp.get("top_city", "")
    top_ind     = emp.get("school_top_industry") or emp.get("top_industry", "")

    # 口碑
    sentiment   = rev.get("sentiment_score", 0.5) if rev else 0.5
    sent_delta  = rev.get("sentiment_delta", 0) if rev else 0
    pos_kws     = (rev.get("top_positive") or []) if rev else []

    # 构建 prompt
    lines = [
        f"【学生信息】省份：{s_province}，位次：{s_rank}，选科：{s_subject}",
        f"",
        f"【学校】{name}（{city}）",
    ]
    tags = []
    if is_985: tags.append("985")
    if is_211: tags.append("211")
    if rank2025 > 0: tags.append(f"软科#{rank2025}")
    if tags: lines.append(f"标签：{'、'.join(tags)}")
    lines.append(f"录取概率：约{prob:.0f}%（{tier_label}）")

    if subj: lines.append(f"优势学科：{'、'.join(subj[:3])}")
    if gem_desc: lines.append(f"冷门价值：{gem_desc}")
    if swarm_disc: lines.append("群体智能：300个虚拟学生Agent集体强推（综合吸引力超出统计概率预期）")

    if salary: lines.append(f"毕业平均薪资：{salary:,}元/月")
    if emp_rate: lines.append(f"就业率：{emp_rate*100:.0f}%")
    if postgrad: lines.append(f"深造率：{postgrad*100:.0f}%")
    if top_city: lines.append(f"主要就业城市：{top_city}")
    if top_ind:  lines.append(f"主要就业行业：{top_ind}")

    if sentiment > 0.5:
        mood = "在校生评价积极" + (f"（高于同层次院校）" if sent_delta > 0.05 else "")
        lines.append(f"口碑：{mood}")
        if pos_kws: lines.append(f"常见好评：{'、'.join(pos_kws[:3])}")

    lines += ["", "请用 60-100 字为这位学生写推荐理由："]
    return "\n".join(lines)


def _cache_key(school: dict, student: dict) -> str:
    """生成缓存键：school_name + gem_type + rank_bucket + subject。"""
    rank  = student.get("rank", 0)
    bucket = (rank // 5000) * 5000   # 5000分一段
    parts = [
        school.get("school_name", ""),
        (school.get("top_gem") or {}).get("gem_type", ""),
        str(bucket),
        student.get("subject", ""),
        "1" if school.get("swarm_discovery") else "0",
    ]
    return hashlib.md5("|".join(parts).encode()).hexdigest()


def _call_anthropic(prompt: str) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    msg = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=200,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}]
    )
    return msg.content[0].text.strip()


def _call_deepseek(prompt: str) -> str:
    import httpx
    resp = httpx.post(
        "https://api.deepseek.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {os.getenv('DEEPSEEK_API_KEY')}"},
        json={
            "model": "deepseek-chat",
            "max_tokens": 200,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user",   "content": prompt},
            ]
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def generate_reason(
    school: dict,
    student: dict,
    db_session=None,
) -> str:
    """
    为一所推荐学校生成个性化推荐理由。
    优先读缓存，未命中则调用 LLM，失败则返回原模板理由。

    Args:
        school:     单条学校推荐结果（来自 _run_recommend_core）
        student:    学生信息 dict：{"province", "rank", "subject"}
        db_session: SQLAlchemy session（用于读写 llm_reason_cache 表）
    """
    fallback = school.get("reason") or ""

    if not _API_KEY:
        return fallback  # 未配置 API key → 静默使用模板

    key = _cache_key(school, student)

    # 1. 读缓存
    if db_session:
        try:
            from sqlalchemy import text
            row = db_session.execute(
                text("SELECT reason, created_at FROM llm_reason_cache WHERE cache_key=:k"),
                {"k": key}
            ).fetchone()
            if row:
                import datetime
                age_days = (datetime.datetime.utcnow() - row.created_at).days
                if age_days < _CACHE_TTL_DAYS:
                    return row.reason
        except Exception:
            pass

    # 2. 调用 LLM
    try:
        prompt = _build_prompt(school, student)
        if _LLM_PROVIDER == "anthropic":
            result = _call_anthropic(prompt)
        else:
            result = _call_deepseek(prompt)

        if not result or len(result) < 20:
            return fallback

        # 3. 写缓存
        if db_session:
            try:
                from sqlalchemy import text
                db_session.execute(text("""
                    INSERT OR REPLACE INTO llm_reason_cache (cache_key, reason, school_name, created_at)
                    VALUES (:k, :r, :s, datetime('now'))
                """), {"k": key, "r": result, "s": school.get("school_name", "")})
                db_session.commit()
            except Exception as ce:
                logger.warning(f"[LLMReason] 缓存写入失败: {ce}")

        return result

    except Exception as e:
        logger.warning(f"[LLMReason] LLM 调用失败，使用模板: {e}")
        return fallback


def generate_reasons_batch(
    schools: list,
    student: dict,
    db_session=None,
    max_schools: int = 15,
) -> dict:
    """
    批量为多所学校生成推荐理由（用于 PDF 报告）。
    限制最多 max_schools 所，优先处理冲/强推的学校。

    Returns:
        {school_name: reason_text}
    """
    # 优先级排序：群体强推 > 冷门推荐 > 高概率学校
    def priority(s):
        return (
            -int(s.get("swarm_discovery", False)),
            -int(s.get("is_hidden_gem", False)),
            -s.get("probability", 0),
        )

    # 去重（同校名只取一条）
    seen = {}
    for s in schools:
        nm = s["school_name"]
        if nm not in seen:
            seen[nm] = s

    to_process = sorted(seen.values(), key=priority)[:max_schools]

    results = {}
    for school in to_process:
        nm = school["school_name"]
        results[nm] = generate_reason(school, student, db_session)
        time.sleep(0.05)  # 避免 API 速率限制

    return results
