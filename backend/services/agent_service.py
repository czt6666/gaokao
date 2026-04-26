"""
Agent 联网搜索对话服务
- DuckDuckGo Instant Answer API 搜索
- DeepSeek Chat Function Calling
- SSE 流式输出
"""
import os, json, httpx
from typing import Iterator, List, Dict, Any, Optional

_DEEPSEEK_API_KEY = os.getenv("YUNWU_API_KEY", os.getenv("DEEPSEEK_API_KEY", ""))
_DEEPSEEK_BASE    = "https://yunwu.ai/v1"
_MODEL            = "gpt-4o"

_SYSTEM_PROMPT = """你是「水卢冷门高报引擎」的AI志愿助手，专注于帮助高考生和家长做志愿填报决策。

你的核心能力：
1. 分析学校录取分数线、位次趋势
2. 解读专业就业前景、薪资数据
3. 制定冲稳保策略，搭配志愿组合
4. 解读新高考政策、选科建议

使用搜索工具的时机：
- 用户询问最新数据（2024/2025年录取分数线、政策变化）
- 用户询问具体学校/专业的最新信息
- 涉及时效性强的招生政策、考试大纲变化

不需要搜索的情况：
- 志愿填报通用策略（冲稳保比例、平行志愿规则）
- 专业选择建议（根据用户兴趣、就业方向）
- 一般性的高考知识问答

回答要求：
- 数据驱动，引用具体数字
- 简明扼要，重点突出
- 对不确定的信息明确说明
- 语言亲切，贴近考生实际需求"""

_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "duckduckgo_search",
            "description": "搜索互联网获取最新高考相关信息，包括录取分数线、招生政策、院校动态等。当需要最新数据或时效性信息时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词，建议使用中文，如「北京大学2024计算机录取分数线」"
                    }
                },
                "required": ["query"]
            }
        }
    }
]


def duckduckgo_search(query: str) -> List[Dict[str, str]]:
    """调用 DuckDuckGo Instant Answer API，返回前5条结果"""
    try:
        resp = httpx.get(
            "https://api.duckduckgo.com/",
            params={"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"},
            timeout=8.0,
            headers={"User-Agent": "Mozilla/5.0 (compatible; GaokaoBot/1.0)"},
            follow_redirects=True,
        )
        resp.raise_for_status()
        data = resp.json()

        results = []

        # AbstractText（摘要）
        if data.get("AbstractText"):
            results.append({
                "title": data.get("Heading", query),
                "snippet": data["AbstractText"][:300],
                "url": data.get("AbstractURL", ""),
            })

        # RelatedTopics
        for topic in data.get("RelatedTopics", []):
            if len(results) >= 5:
                break
            if isinstance(topic, dict) and topic.get("Text"):
                results.append({
                    "title": topic.get("Text", "")[:60],
                    "snippet": topic.get("Text", "")[:300],
                    "url": topic.get("FirstURL", ""),
                })

        # Results（直接搜索结果）
        for r in data.get("Results", []):
            if len(results) >= 5:
                break
            if r.get("Text"):
                results.append({
                    "title": r.get("Text", "")[:60],
                    "snippet": r.get("Text", "")[:300],
                    "url": r.get("FirstURL", ""),
                })

        return results[:5]

    except Exception as e:
        print(f"[agent_service] duckduckgo_search error: {e}")
        return []


def call_deepseek_non_stream(messages: List[Dict], use_tools: bool = True) -> Optional[Dict]:
    """非流式调用 DeepSeek（决策阶段），返回 choice 字典"""
    api_key = _DEEPSEEK_API_KEY or os.getenv("DEEPSEEK_API_KEY", "")
    if not api_key:
        return None

    payload: Dict[str, Any] = {
        "model": _MODEL,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 1000,
    }
    if use_tools:
        payload["tools"] = _TOOLS
        payload["tool_choice"] = "auto"

    try:
        resp = httpx.post(
            f"{_DEEPSEEK_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]
    except Exception as e:
        print(f"[agent_service] call_deepseek_non_stream error: {e}")
        return None


def stream_deepseek(messages: List[Dict]) -> Iterator[str]:
    """流式调用 DeepSeek，逐 token yield 字符串"""
    api_key = _DEEPSEEK_API_KEY or os.getenv("DEEPSEEK_API_KEY", "")
    if not api_key:
        yield "（API Key 未配置，无法生成回答）"
        return

    try:
        with httpx.stream(
            "POST",
            f"{_DEEPSEEK_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": _MODEL,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 2000,
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
                    delta = chunk["choices"][0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield content
                except Exception:
                    continue
    except Exception as e:
        print(f"[agent_service] stream_deepseek error: {e}")
        yield f"\n（生成出错：{e}）"


def stream_agent_turn(messages: List[Dict], session_id: str = "") -> Iterator[str]:
    """
    主循环：yield SSE 格式字符串
    格式：data: {json}\n\n
    """
    # 构造带 system prompt 的消息列表
    full_messages = [{"role": "system", "content": _SYSTEM_PROMPT}] + messages

    def sse(obj: dict) -> str:
        return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"

    # Step 1: 非流式调用（决策是否需要搜索）
    choice = call_deepseek_non_stream(full_messages, use_tools=True)

    if choice is None:
        yield sse({"type": "token", "content": "AI 服务暂时不可用，请检查 API Key 配置。"})
        yield sse({"type": "meta", "searched": False, "query": ""})
        yield "data: [DONE]\n\n"
        return

    finish_reason = choice.get("finish_reason", "stop")
    message = choice.get("message", {})

    searched = False
    search_query = ""
    search_results = []

    # Step 2: 处理 tool_calls
    if finish_reason == "tool_calls":
        tool_calls = message.get("tool_calls", [])
        for tc in tool_calls:
            if tc.get("function", {}).get("name") == "duckduckgo_search":
                try:
                    args = json.loads(tc["function"].get("arguments", "{}"))
                    search_query = args.get("query", "")
                except Exception:
                    search_query = ""

                yield sse({"type": "status", "content": "正在搜索..."})

                search_results = duckduckgo_search(search_query)
                searched = True

                yield sse({"type": "status", "content": f"已获取 {len(search_results)} 条结果"})

        # 构造包含搜索结果的消息，进行流式最终回答
        search_content = ""
        if search_results:
            items = []
            for i, r in enumerate(search_results, 1):
                items.append(f"{i}. {r['title']}\n{r['snippet']}\n来源：{r['url']}")
            search_content = "搜索结果：\n" + "\n\n".join(items)
        else:
            search_content = "搜索未返回有效结果，请基于已有知识回答。"

        # 将 assistant 工具调用消息 + 工具结果 加入消息链
        tool_call_id = tool_calls[0]["id"] if tool_calls else "call_0"
        final_messages = full_messages + [
            {"role": "assistant", "content": None, "tool_calls": message.get("tool_calls", [])},
            {
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": search_content,
            },
        ]

        # 流式输出最终回答
        for token in stream_deepseek(final_messages):
            yield sse({"type": "token", "content": token})

    else:
        # Step 3: 直接有内容，分块推送
        content = message.get("content", "")
        if content:
            chunk_size = 20
            for i in range(0, len(content), chunk_size):
                chunk = content[i:i + chunk_size]
                yield sse({"type": "token", "content": chunk})
        else:
            # 备用：直接流式调用
            for token in stream_deepseek(full_messages):
                yield sse({"type": "token", "content": token})

    # Step 4: 完成
    yield sse({"type": "meta", "searched": searched, "query": search_query})
    yield "data: [DONE]\n\n"


def run_agent_turn(messages: List[Dict]) -> Dict:
    """非流式版本（备用），返回完整 dict"""
    full_messages = [{"role": "system", "content": _SYSTEM_PROMPT}] + messages

    choice = call_deepseek_non_stream(full_messages, use_tools=True)
    if choice is None:
        return {"content": "AI 服务暂时不可用。", "searched": False, "query": ""}

    finish_reason = choice.get("finish_reason", "stop")
    message = choice.get("message", {})

    searched = False
    search_query = ""

    if finish_reason == "tool_calls":
        tool_calls = message.get("tool_calls", [])
        for tc in tool_calls:
            if tc.get("function", {}).get("name") == "duckduckgo_search":
                try:
                    args = json.loads(tc["function"].get("arguments", "{}"))
                    search_query = args.get("query", "")
                except Exception:
                    search_query = ""

                search_results = duckduckgo_search(search_query)
                searched = True

                search_content = ""
                if search_results:
                    items = []
                    for i, r in enumerate(search_results, 1):
                        items.append(f"{i}. {r['title']}\n{r['snippet']}\n来源：{r['url']}")
                    search_content = "搜索结果：\n" + "\n\n".join(items)
                else:
                    search_content = "搜索未返回有效结果，请基于已有知识回答。"

                tool_call_id = tc.get("id", "call_0")
                final_messages = full_messages + [
                    {"role": "assistant", "content": None, "tool_calls": message.get("tool_calls", [])},
                    {"role": "tool", "tool_call_id": tool_call_id, "content": search_content},
                ]

                final_choice = call_deepseek_non_stream(final_messages, use_tools=False)
                if final_choice:
                    return {
                        "content": final_choice.get("message", {}).get("content", ""),
                        "searched": searched,
                        "query": search_query,
                    }

    return {
        "content": message.get("content", ""),
        "searched": searched,
        "query": search_query,
    }
