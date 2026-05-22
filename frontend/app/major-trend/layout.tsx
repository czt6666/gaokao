import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "专业风向标 · 热门专业趋势分析、就业前景预测 · 水卢冷门高报引擎",
  description: "分析各专业报考热度趋势、就业前景、薪资水平。了解哪些专业正在崛起，哪些正在衰落，帮你选择未来4年有竞争力的专业方向。",
  keywords: "专业趋势,热门专业,就业前景,专业排名,薪资预测,专业选择",
  openGraph: {
    title: "专业风向标 · 热门专业趋势分析、就业前景预测",
    description: "分析各专业报考热度趋势、就业前景、薪资水平。了解哪些专业正在崛起，哪些正在衰落。",
    url: "https://www.theyuanxi.cn/major-trend",
    siteName: "水卢冷门高报引擎",
    locale: "zh_CN",
    type: "website",
  },
  alternates: {
    canonical: "https://www.theyuanxi.cn/major-trend",
  },
};

export default function MajorTrendLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
