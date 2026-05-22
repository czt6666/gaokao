import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "全国高校库 · 3,217所大学录取分数线、专业查询 · 水卢冷门高报引擎",
  description: "搜索全国3,217所高校的录取分数线、专业设置、学科评估、就业数据。按专业找学校，输入位次查看可报院校，覆盖985/211/双一流及普通本科。",
  keywords: "高校库,大学查询,录取分数线,专业查询,985院校,211院校,双一流,高考志愿",
  openGraph: {
    title: "全国高校库 · 3,217所大学录取分数线查询",
    description: "搜索全国高校录取分数线、专业设置、学科评估、就业数据。按专业找学校，输入位次查看可报院校。",
    url: "https://www.theyuanxi.cn/search",
    siteName: "水卢冷门高报引擎",
    locale: "zh_CN",
    type: "website",
  },
  alternates: {
    canonical: "https://www.theyuanxi.cn/search",
  },
};

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
