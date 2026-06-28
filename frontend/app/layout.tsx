import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import VConsoleLoader from "@/components/VConsoleLoader";
import FloatingService from "@/components/FloatingService";
import VersionChecker from "@/components/VersionChecker";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: "水卢冷门高报引擎 · 高考志愿智能决策系统",
  description: "输入高考位次，精确计算每所学校的录取概率，发现低知名度高就业率的冷门好校。覆盖3,217所高校，融合多年历史录取数据+就业真实数据。",
  keywords: "高考志愿,志愿填报,录取概率,高考位次,冷门好学校,志愿参考,高考择校,院校推荐,水卢,高考2025,大学推荐",
  authors: [{ name: "水卢教育" }],
  openGraph: {
    title: "水卢冷门高报引擎 · 高考志愿智能决策系统",
    description: "输入位次，精确计算录取概率，发现别人看不到的冷门好校。多年历史数据+就业真实数据。",
    url: "https://www.theyuanxi.cn",
    siteName: "水卢冷门高报引擎",
    locale: "zh_CN",
    type: "website",
    images: [
      {
        url: "https://www.theyuanxi.cn/og-image.png",
        width: 1200,
        height: 630,
        alt: "水卢冷门高报引擎 — 高考志愿智能决策",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "水卢冷门高报引擎 · 高考志愿智能决策系统",
    description: "输入位次，精确计算录取概率，发现别人看不到的冷门好校。",
    images: ["https://www.theyuanxi.cn/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  alternates: {
    canonical: "https://www.theyuanxi.cn",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://www.theyuanxi.cn/#website",
      url: "https://www.theyuanxi.cn",
      name: "水卢冷门高报引擎",
      description: "高考志愿智能决策系统，输入位次精确计算录取概率",
      inLanguage: "zh-CN",
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: "https://www.theyuanxi.cn/results?rank={rank}&province={province}",
        },
        "query-input": "required name=rank",
      },
    },
    {
      "@type": "Organization",
      "@id": "https://www.theyuanxi.cn/#organization",
      name: "水卢教育",
      url: "https://www.theyuanxi.cn",
      description: "专注高考志愿填报智能化的技术团队",
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 百度站长验证 — 登录 https://ziyuan.baidu.com/ 获取 */}
        <meta name="baidu-site-verification" content="codeva-gBf887uEor" />
        {/* 谷歌搜索控制台验证 — 登录 https://search.google.com/search-console 获取 */}
        <meta name="google-site-verification" content="01bq_X9qg0R0xg6pVc8oAuxxLqymHqq5VLXskpOgh4Q" />
        {/* 必应站长工具验证 — 登录 https://www.bing.com/webmasters 获取 */}
        <meta name="msvalidate.01" content="5A20DD5D661CD45F8C47A404F1D24B4C" />
        {/* 360搜索站长平台验证 — 登录 https://zhanzhang.so.com/ 获取 */}
        <meta name="360-site-verification" content="ab79439c0f87a9a988e14f8812c86be6" />
        {/* 搜狗站长平台验证 — 登录 https://zhanzhang.sogou.com/ 获取 */}
        <meta name="sogou_site_verification" content="4ai3WCh2fu" />
        {/* 结构化数据 */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* 百度自动推送：页面加载后自动将 URL 推送给百度蜘蛛，加速收录 */}
        <Script id="baidu-push" strategy="afterInteractive">
          {`
            (function(){
              var bp = document.createElement('script');
              var curProtocol = window.location.protocol.split(':')[0];
              if (curProtocol === 'https') {
                bp.src = 'https://zz.bdstatic.com/linksubmit/push.js';
              } else {
                bp.src = 'http://push.zhanzhang.baidu.com/push.js';
              }
              var s = document.getElementsByTagName("script")[0];
              s.parentNode.insertBefore(bp, s);
            })();
          `}
        </Script>
        {/* 百度统计：官方建议放在全站 </head> 前；此处用 next/script 等价注入 */}
        <Script id="baidu-analytics" strategy="afterInteractive">
          {`
            var _hmt = _hmt || [];
            (function() {
              var hm = document.createElement("script");
              hm.src = "https://hm.baidu.com/hm.js?49f1e8897e3961600fcd76d504307049";
              var s = document.getElementsByTagName("script")[0];
              s.parentNode.insertBefore(hm, s);
            })();
          `}
        </Script>
      </head>
      <body>
        {children}
        <VConsoleLoader />
        <FloatingService />
        <VersionChecker />
      </body>
    </html>
  );
}
