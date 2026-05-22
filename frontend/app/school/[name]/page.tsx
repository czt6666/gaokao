import type { Metadata } from "next";
import SchoolDetailClient from "./SchoolDetailClient";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface SchoolPageProps {
  params: Promise<{ name: string }>;
}

async function fetchSchoolMeta(name: string) {
  try {
    const res = await fetch(
      `${API}/api/school/${encodeURIComponent(name)}`,
      { next: { revalidate: 86400 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.school || null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: SchoolPageProps): Promise<Metadata> {
  const { name } = await params;
  const schoolName = decodeURIComponent(name);
  const school = await fetchSchoolMeta(schoolName);

  const title = school
    ? `${school.name}录取分数线、专业介绍、就业数据 · 水卢冷门高报引擎`
    : `${schoolName} · 高校详情 · 水卢冷门高报引擎`;

  const description = school
    ? `${school.name}位于${school.province}${school.city}，${school.tier}院校。查看${school.name}历年录取分数线、专业设置、学科评估、就业薪资等详细数据，输入位次计算录取概率。`
    : `查看${schoolName}的历年录取数据、专业分析、学科评估、就业质量报告。输入高考位次，精确计算录取概率。`;

  const keywords = school
    ? `${school.name},${school.name}录取分数线,${school.name}专业,${school.name}就业,${school.province}高考志愿,${school.tier}院校`
    : `${schoolName},录取分数线,高考志愿,院校推荐`;

  return {
    title,
    description,
    keywords,
    openGraph: {
      title,
      description,
      url: `https://www.theyuanxi.cn/school/${encodeURIComponent(schoolName)}`,
      siteName: "水卢冷门高报引擎",
      locale: "zh_CN",
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    alternates: {
      canonical: `https://www.theyuanxi.cn/school/${encodeURIComponent(schoolName)}`,
    },
  };
}

export default async function SchoolPage({ params }: SchoolPageProps) {
  const { name } = await params;
  const schoolName = decodeURIComponent(name);
  return <SchoolDetailClient schoolName={schoolName} />;
}
