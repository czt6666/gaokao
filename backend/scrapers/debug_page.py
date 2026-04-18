"""Debug: 网络请求拦截调试工具"""
import asyncio, sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

async def main():
    from playwright.async_api import async_playwright

    api_calls = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900},
            locale="zh-CN",
        )
        await context.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined})")
        page = await context.new_page()

        # 记录 API 请求
        async def on_request(request):
            url = request.url
            if any(x in url for x in ['api', 'score', 'data', 'province', 'major', 'admission']):
                api_calls.append({"url": url, "method": request.method})

        page.on("request", on_request)

        url = "https://www.gaokao.cn/school/31/provincescore"
        print(f"访问: {url}")
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)

        # 点击广东
        await page.evaluate("""
            () => {
                const items = document.querySelectorAll('[class*="province-switch"] [class*="item"]');
                for (const el of items) {
                    if (el.textContent.trim() === '广东') { el.click(); return; }
                }
            }
        """)
        await page.wait_for_timeout(3000)

        print(f"\n拦截到 {len(api_calls)} 个 API 请求:")
        for c in api_calls[:20]:
            print(f"  [{c['method']}] {c['url']}")

        await browser.close()

asyncio.run(main())
