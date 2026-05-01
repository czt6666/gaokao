"""
Agent 联网搜索对话服务
- yunwu.ai /v1/responses + web_search_preview 内置联网搜索
- SSE 流式输出 + 意图识别导航
"""
import os, json, re, httpx
from typing import Iterator, List, Dict
from urllib.parse import urlencode

_API_KEY = os.getenv("YUNWU_API_KEY")
_BASE    = "https://yunwu.ai/v1"
_MODEL   = "gpt-4o-mini"

_SYSTEM_PROMPT = """你是「水卢冷门高报引擎」的AI志愿助手，专注于帮助高考生和家长做志愿填报决策。

你的核心能力：
1. 分析学校录取分数线、位次趋势
2. 解读专业就业前景、薪资数据
3. 制定冲稳保策略，搭配志愿组合
4. 解读新高考政策、选科建议

回答要求：
- 数据驱动，引用具体数字
- 简明扼要，重点突出
- 对不确定的信息明确说明
- 语言亲切，贴近考生实际需求

拒绝规则：
- 对于与高考、志愿填报、院校专业、升学规划完全无关的问题（如编程算法、数学题、娱乐八卦等），礼貌拒绝并引导回到志愿填报话题，不作实质性回答。"""

_PROVINCES = [
    "北京", "天津", "上海", "重庆", "河北", "河南", "云南", "辽宁", "黑龙江",
    "湖南", "安徽", "山东", "新疆", "江苏", "浙江", "江西", "湖北", "广西",
    "甘肃", "山西", "内蒙古", "陕西", "吉林", "福建", "贵州", "广东", "四川",
    "海南", "西藏", "青海", "宁夏",
]

# 选科组合 → URL subject 参数值
_SUBJECT_MAP = [
    (["物化生", "物理化学生物"],           "物理+化学+生物"),
    (["物化地", "物理化学地理"],           "物理+化学+地理"),
    (["物化政", "物理化学政治"],           "物理+化学+政治"),
    (["物生地", "物理生物地理"],           "物理+生物+地理"),
    (["物生政", "物理生物政治"],           "物理+生物+政治"),
    (["物地政", "物理地理政治"],           "物理+地理+政治"),
    (["史政地", "历史政治地理", "文科"],   "历史+政治+地理"),
    (["史化生", "历史化学生物"],           "历史+化学+生物"),
    (["史化地", "历史化学地理"],           "历史+化学+地理"),
    (["史化政", "历史化学政治"],           "历史+化学+政治"),
    (["史生地", "历史生物地理"],           "历史+生物+地理"),
    (["史生政", "历史生物政治"],           "历史+生物+政治"),
]


def _extract_params(messages: List[Dict]) -> Dict:
    """从对话历史中提取 province / rank / subject"""
    full_text = " ".join(m.get("content", "") for m in messages)

    # 省份：取最后出现的
    province = ""
    for p in _PROVINCES:
        if p in full_text:
            province = p

    # 位次：优先匹配 "位次xxxx" 或 "排名xxxx"，备选纯数字
    rank = ""
    m = re.search(r'(?:位次|排名)[：: ]?(\d{1,6})', full_text)
    if m:
        rank = m.group(1)

    # 选科
    subject = ""
    for patterns, value in _SUBJECT_MAP:
        if any(p in full_text for p in patterns):
            subject = value
            break

    return {"province": province, "rank": rank, "subject": subject}


def _detect_actions(messages: List[Dict]) -> List[Dict]:
    """意图识别，返回导航按钮列表"""
    user_msg = next(
        (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
        "",
    )
    params = _extract_params(messages)
    province, rank, subject = params["province"], params["rank"], params["subject"]

    # 拼接 results URL
    results_params: Dict = {}
    if province: results_params["province"] = province
    if rank:     results_params["rank"]     = rank
    if subject:  results_params["subject"]  = subject
    results_url = "/results?" + urlencode(results_params) if results_params else "/results"

    actions: List[Dict] = []

    # 意图：填写分数 / 使用指引
    if re.search(r'如何|怎么用|开始|填写|输入分数|填分|我的分数|填报志愿|怎么填', user_msg):
        actions.append({"label": "填写分数", "url": "/#query-form", "icon": "📝", "desc": "输入位次或模考分获取推荐"})

    # 意图：推荐结果
    if re.search(r'推荐|能上|可以报|冲稳保|志愿|什么学校|哪些学校|查推荐|看推荐|适合报|适合我', user_msg):
        if rank or province:
            actions.append({"label": "查看推荐结果", "url": results_url, "icon": "🎯", "desc": f"{province or ''}{'位次'+rank if rank else ''} 推荐"})
        else:
            actions.append({"label": "填写分数获取推荐", "url": "/", "icon": "📝", "desc": "先输入分数，再查推荐"})

    # 意图：学校库
    if re.search(r'搜索学校|查学校|学校库|院校库|浏览学校|所有学校|学校名单|学校列表', user_msg):
        actions.append({"label": "浏览学校库", "url": "/search?tab=school", "icon": "🏫", "desc": "搜索全国高校信息"})

    # 意图：学校对比
    if re.search(r'对比|比较|学校对比|比一比|哪个更好|哪所好|哪个学校好', user_msg):
        actions.append({"label": "学校对比", "url": "/compare", "icon": "⚖️", "desc": "横向对比多所学校"})

    return actions


def _parse_inline_sources(text: str) -> List[Dict]:
    """从文本中提取来源，兼容多种格式"""
    sources: List[Dict] = []
    seen_urls: set = set()
    seen_names: set = set()

    for m in re.finditer(r'[\[【]([^\]】]*)[\]】]\((https?://[^)]+)\)', text):
        label, url = m.group(1).strip(), m.group(2).strip()
        if url not in seen_urls:
            seen_urls.add(url)
            title = label if label and label not in ("来源", "source", "") else url
            sources.append({"title": title, "url": url})

    for m in re.finditer(r'【来源：([^】]+)】', text):
        for name in re.split(r'[，,、]', m.group(1)):
            name = name.strip()
            if name and not re.match(r'^\d+$', name) and name not in seen_names:
                seen_names.add(name)
                sources.append({"title": name, "url": ""})

    return sources


def stream_agent_turn(messages: List[Dict], session_id: str = "") -> Iterator[str]:
    """主循环：yield SSE 格式字符串"""

    def sse(obj: dict) -> str:
        return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"

    if not _API_KEY:
        yield sse({"type": "token", "content": "API Key 未配置，无法生成回答。"})
        yield sse({"type": "meta", "searched": False, "query": "", "sources": []})
        yield "data: [DONE]\n\n"
        return

    sources: List[Dict] = []
    search_query = ""

    try:
        with httpx.stream(
            "POST",
            f"{_BASE}/responses",
            headers={
                "Authorization": f"Bearer {_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": _MODEL,
                "instructions": _SYSTEM_PROMPT,
                "input": messages,
                "tools": [{"type": "web_search_preview"}],
                "stream": True,
            },
            timeout=60.0,
        ) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line or not line.startswith("data: "):
                    continue
                raw = line[6:]
                if raw.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(raw)
                    chunk_type = chunk.get("type", "")

                    if chunk_type == "response.output_item.done":
                        item = chunk.get("item", {})
                        if item.get("type") == "web_search_call":
                            queries = item.get("action", {}).get("queries", [])
                            if queries:
                                search_query = queries[0]
                            yield sse({"type": "status", "content": f"正在搜索：{search_query}"})

                    elif chunk_type == "response.output_text.annotation.added":
                        ann = chunk.get("annotation", {})
                        if ann.get("type") == "url_citation":
                            entry = {"title": ann.get("title", ""), "url": ann.get("url", "")}
                            if entry not in sources:
                                sources.append(entry)

                    elif chunk_type == "response.output_text.done":
                        full_text = chunk.get("text", "")
                        if not sources:
                            sources = _parse_inline_sources(full_text)

                    elif chunk_type == "response.output_text.delta":
                        content = chunk.get("delta", "")
                        if content:
                            yield sse({"type": "token", "content": content})

                    elif "choices" in chunk:
                        delta = chunk["choices"][0].get("delta", {})
                        content = delta.get("content", "")
                        if content:
                            yield sse({"type": "token", "content": content})
                except Exception:
                    continue

    except Exception as e:
        yield sse({"type": "token", "content": f"\n（生成出错：{e}）"})

    yield sse({"type": "meta", "searched": True, "query": search_query, "sources": sources})

    actions = _detect_actions(messages)
    if actions:
        yield sse({"type": "actions", "actions": actions})

    yield "data: [DONE]\n\n"


def run_agent_turn(messages: List[Dict]) -> Dict:
    """非流式版本（备用）"""
    if not _API_KEY:
        return {"content": "AI 服务暂时不可用。", "searched": False, "query": ""}

    try:
        resp = httpx.post(
            f"{_BASE}/responses",
            headers={
                "Authorization": f"Bearer {_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": _MODEL,
                "instructions": _SYSTEM_PROMPT,
                "input": messages,
                "tools": [{"type": "web_search_preview"}],
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
        if "output" in data:
            for item in data["output"]:
                if item.get("type") == "message":
                    for part in item.get("content", []):
                        if part.get("type") == "output_text":
                            text = part["text"]
                            return {
                                "content": text,
                                "searched": True,
                                "query": "",
                                "sources": _parse_inline_sources(text),
                                "actions": _detect_actions([]),
                            }
        if "choices" in data:
            content = data["choices"][0]["message"]["content"]
            return {"content": content, "searched": True, "query": "", "sources": _parse_inline_sources(content)}
        return {"content": str(data), "searched": True, "query": "", "sources": []}
    except Exception as e:
        return {"content": f"请求失败：{e}", "searched": False, "query": "", "sources": []}
