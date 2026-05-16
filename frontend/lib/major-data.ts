export interface MajorSubcategory {
  name: string;
  keywords: string[];
}

export interface MajorCategory {
  name: string;
  subcategories: MajorSubcategory[];
}

export const MAJOR_CATEGORIES: MajorCategory[] = [
  {
    name: "哲学",
    subcategories: [
      { name: "哲学类", keywords: ["哲学", "逻辑", "宗教", "伦理"] },
    ],
  },
  {
    name: "经济学",
    subcategories: [
      { name: "经济学类", keywords: ["经济"] },
      { name: "财政学类", keywords: ["财政", "税收"] },
      { name: "金融学类", keywords: ["金融", "保险", "投资", "精算"] },
      { name: "经济与贸易类", keywords: ["贸易", "商务"] },
    ],
  },
  {
    name: "法学",
    subcategories: [
      { name: "法学类", keywords: ["法学", "知识产权"] },
      { name: "政治学类", keywords: ["政治", "外交"] },
      { name: "社会学类", keywords: ["社会", "人类"] },
      { name: "民族学类", keywords: ["民族"] },
      { name: "马克思主义理论类", keywords: ["马克思", "思想"] },
      { name: "公安学类", keywords: ["治安", "侦查", "公安", "警察", "警务"] },
    ],
  },
  {
    name: "教育学",
    subcategories: [
      { name: "教育学类", keywords: ["教育", "学前", "小学"] },
      { name: "体育学类", keywords: ["体育", "运动"] },
    ],
  },
  {
    name: "文学",
    subcategories: [
      { name: "中国语言文学类", keywords: ["汉语", "中文"] },
      { name: "外国语言文学类", keywords: ["英语", "外语", "翻译"] },
      { name: "新闻传播学类", keywords: ["新闻", "广告", "出版", "传媒"] },
    ],
  },
  {
    name: "历史学",
    subcategories: [
      { name: "历史学类", keywords: ["历史", "考古", "文物"] },
    ],
  },
  {
    name: "理学",
    subcategories: [
      { name: "数学类", keywords: ["数学", "数据"] },
      { name: "物理学类", keywords: ["物理", "声学"] },
      { name: "化学类", keywords: ["化学", "分子"] },
      { name: "天文学类", keywords: ["天文"] },
      { name: "地理科学类", keywords: ["地理"] },
      { name: "大气科学类", keywords: ["大气", "气象"] },
      { name: "海洋科学类", keywords: ["海洋"] },
      { name: "地球物理学类", keywords: ["地球", "空间"] },
      { name: "地质学类", keywords: ["地质"] },
      { name: "生物科学类", keywords: ["生物", "生态"] },
      { name: "心理学类", keywords: ["心理"] },
      { name: "统计学类", keywords: ["统计"] },
    ],
  },
  {
    name: "工学",
    subcategories: [
      { name: "力学类", keywords: ["力学"] },
      { name: "机械类", keywords: ["机械", "车辆", "汽车", "机器人", "智造"] },
      { name: "仪器类", keywords: ["仪器", "测控"] },
      { name: "材料类", keywords: ["材料", "冶金", "高分子"] },
      { name: "能源动力类", keywords: ["能源", "动力", "储能"] },
      { name: "电气类", keywords: ["电气", "电网"] },
      { name: "电子信息类", keywords: ["电子", "信息", "光电", "电信"] },
      { name: "计算机类", keywords: ["计算机", "软件", "网络", "安全", "物联网", "大数据", "智能", "虚拟", "区块链", "密码"] },
      { name: "土木类", keywords: ["土木", "建造"] },
      { name: "水利类", keywords: ["水利", "水文"] },
      { name: "测绘类", keywords: ["测绘", "遥感"] },
      { name: "化工与制药类", keywords: ["化工", "制药"] },
      { name: "地质类", keywords: ["勘查"] },
      { name: "矿业类", keywords: ["采矿", "石油", "油气"] },
      { name: "纺织类", keywords: ["纺织", "服装"] },
      { name: "轻工类", keywords: ["轻工", "包装"] },
      { name: "交通运输类", keywords: ["交通", "运输"] },
      { name: "海洋工程类", keywords: ["船舶", "轮机"] },
      { name: "航空航天类", keywords: ["航空", "航天", "飞行器"] },
      { name: "兵器类", keywords: ["武器", "兵器"] },
      { name: "核工程类", keywords: ["核"] },
      { name: "农业工程类", keywords: ["农业"] },
      { name: "林业工程类", keywords: ["林业", "木材"] },
      { name: "环境科学与工程类", keywords: ["环境", "环保"] },
      { name: "生物医学工程类", keywords: ["医学", "康复"] },
      { name: "食品科学与工程类", keywords: ["食品", "粮食"] },
      { name: "建筑类", keywords: ["建筑", "规划", "园林"] },
      { name: "安全科学与工程类", keywords: ["安全", "应急"] },
      { name: "生物工程类", keywords: ["生物"] },
      { name: "公安技术类", keywords: ["公安", "技术", "消防", "网络安全"] },
    ],
  },
  {
    name: "农学",
    subcategories: [
      { name: "植物生产类", keywords: ["农学", "园艺", "植物"] },
      { name: "自然保护与环境生态类", keywords: ["生态", "保护"] },
      { name: "动物生产类", keywords: ["动物"] },
      { name: "动物医学类", keywords: ["兽医"] },
      { name: "林学类", keywords: ["林学", "森林"] },
      { name: "水产类", keywords: ["水产", "渔业"] },
      { name: "草学类", keywords: ["草业"] },
    ],
  },
  {
    name: "医学",
    subcategories: [
      { name: "基础医学类", keywords: ["医学"] },
      { name: "临床医学类", keywords: ["临床", "麻醉", "影像"] },
      { name: "口腔医学类", keywords: ["口腔"] },
      { name: "公共卫生与预防医学类", keywords: ["预防", "卫生"] },
      { name: "中医学类", keywords: ["中医", "针灸", "推拿"] },
      { name: "中西医结合类", keywords: ["中西医"] },
      { name: "药学类", keywords: ["药学", "药物"] },
      { name: "中药学类", keywords: ["中药"] },
      { name: "法医学类", keywords: ["法医"] },
      { name: "医学技术类", keywords: ["检验", "康复", "医学"] },
      { name: "护理学类", keywords: ["护理", "助产"] },
    ],
  },
  {
    name: "管理学",
    subcategories: [
      { name: "管理科学与工程类", keywords: ["管理", "工程", "造价"] },
      { name: "工商管理类", keywords: ["工商", "会计", "财务", "营销", "人力", "审计"] },
      { name: "农业经济管理类", keywords: ["农林"] },
      { name: "公共管理类", keywords: ["公共", "行政", "社保"] },
      { name: "图书情报与档案管理类", keywords: ["档案", "图书", "情报"] },
      { name: "物流管理与工程类", keywords: ["物流", "供应链"] },
      { name: "工业工程类", keywords: ["工业"] },
      { name: "电子商务类", keywords: ["电商", "商务"] },
      { name: "旅游管理类", keywords: ["旅游", "酒店", "会展"] },
    ],
  },
  {
    name: "艺术学",
    subcategories: [
      { name: "艺术学理论类", keywords: ["艺术"] },
      { name: "音乐与舞蹈学类", keywords: ["音乐", "舞蹈"] },
      { name: "戏剧与影视学类", keywords: ["戏剧", "影视", "表演", "动画"] },
      { name: "美术学类", keywords: ["美术", "绘画", "雕塑", "摄影"] },
      { name: "设计学类", keywords: ["视觉", "产品", "环境", "服装", "数字"] },
    ],
  },
];

/** 根据选中的专业类名称，返回对应的所有关键词（去重） */
export function getKeywordsByCategories(categoryNames: string[]): string[] {
  const set = new Set<string>();
  for (const cat of MAJOR_CATEGORIES) {
    for (const sub of cat.subcategories) {
      if (categoryNames.includes(sub.name)) {
        for (const kw of sub.keywords) {
          set.add(kw);
        }
      }
    }
  }
  return Array.from(set);
}

/** 获取所有专业类名称的扁平列表 */
export const ALL_SUBCATEGORIES: string[] = MAJOR_CATEGORIES.flatMap(
  (c) => c.subcategories.map((s) => s.name)
);
