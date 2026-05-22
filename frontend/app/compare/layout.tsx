import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "学校对比 · 最多同时对比3所高校 · 水卢冷门高报引擎",
  description: "横向对比多所学校的录取数据、学科评估、就业质量、城市等级。最多同时对比3所高校，帮你做出更明智的志愿选择。",
  keywords: "学校对比,院校对比,高校比较,志愿对比,录取数据对比",
  openGraph: {
    title: "学校对比 · 最多同时对比3所高校",
    description: "横向对比多所学校的录取数据、学科评估、就业质量、城市等级。最多同时对比3所高校。",
    url: "https://www.theyuanxi.cn/compare",
    siteName: "水卢冷门高报引擎",
    locale: "zh_CN",
    type: "website",
  },
  alternates: {
    canonical: "https://www.theyuanxi.cn/compare",
  },
};

export default function CompareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
