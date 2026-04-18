import type { Metadata, Viewport } from "next";
import "./globals.css";
import FloatingService from "@/components/FloatingService";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: "水卢冷门高报引擎 · 高考志愿智能决策系统",
  description: "输入高考位次，精确计算每所学校的录取概率，发现低知名度高就业率的冷门好校。覆盖3,217所高校，融合多年历史录取数据+就业真实数据。袁希团队出品。",
  keywords: "高考志愿,志愿填报,录取概率,高考位次,冷门好学校,志愿参考,高考择校,院校推荐,水卢,高考2025,大学推荐",
  authors: [{ name: "袁希团队" }],
  openGraph: {
    title: "水卢冷门高报引擎 · 高考志愿智能决策系统",
    description: "输入位次，精确计算录取概率，发现别人看不到的冷门好校。多年历史数据+就业真实数据。袁希团队出品。",
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
    description: "输入位次，精确计算录取概率，发现别人看不到的冷门好校。袁希团队出品。",
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
      name: "袁希团队",
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
    <html lang="zh-CN">
      <head>
        {/* 百度站长验证 — 登录 https://ziyuan.baidu.com/ 后替换 content 值 */}
        <meta name="baidu-site-verification" content="BAIDU_VERIFY_CODE" />
        {/* 结构化数据 */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        {children}
        <FloatingService />
      </body>
    </html>
  );
}
