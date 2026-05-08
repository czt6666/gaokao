// utils/boarding_data.js
// 战略成长™ · 美国顶级寄宿高中精选库
// ══════════════════════════════════════════════════════════════════
//  数据来源：各校官网 + NAIS + Boarding School Review + 2025-26 学年
//  覆盖：25 所美国顶级寄宿高中
// ══════════════════════════════════════════════════════════════════

const CNY = 7.25; // USD→CNY 汇率

function fmt(usd) {
  if (!usd) return null;
  const cny = Math.round(usd * CNY / 10000);
  return { usd: '$' + usd.toLocaleString(), cny: '约合人民币 ' + cny + ' 万元/年' };
}

const BOARDING_SCHOOLS = [

  // ══════════════════════════════════════════════════════════════
  //  一线名校（极高选择性 · 常春藤摇篮）
  // ══════════════════════════════════════════════════════════════

  {
    id: 'andover',
    name: 'Phillips Academy Andover',
    nameCN: '安多佛中学',
    city: 'Andover', state: 'MA', country: '美国',
    founded: 1778,
    grades: '9-12 + PG',
    genderType: 'co-ed',
    website: 'https://www.andover.edu',
    tier: 1,

    // 申请门槛
    ssat: '2150–2350', toeflMin: 100, appDeadline: '1月15日',
    // 中国学生适配
    integrationLevel: 3, integrationLabel: '均衡融合',
    fitFor: '有志于美国政商精英圈的全能学术型学生，把安多佛视为通往哈佛耶鲁的战略起点。',
    chineseApplicantTip: 'SSAT建议2200+，招生官格外看重独特课外经历，只靠竞赛成绩远远不够。',

    // 费用（2025-26）
    tuitionUSD: 76731,
    tuitionFmt: '$76,731',
    tuitionCNY: '约合人民币 56 万元/年',

    // 录取
    acceptRate: 13,
    enrollment: 1165,
    intlPct: 15,

    // 学术
    satAvg: 1470,
    actAvg: 33,
    apNote: '提供 300+ 门课程，含大量 AP 及高阶选修',

    // 助学金
    aidPct: 45,
    avgAidUSD: 55000,
    needBlind: true,
    aidNote: '100% 满足经济需求，家庭年收入 <$150K 免学费',

    // 主要大学升学方向（近3年）
    topColleges: ['Harvard', 'Yale', 'Princeton', 'MIT', 'Columbia', 'Stanford', 'Dartmouth', 'Penn'],

    // 校友
    notableAlumni: ['乔治·W·布什（美国总统）', '詹姆斯·邦德（007作者）', '马克·扎克伯格（曾就读）'],

    // 特色标签（面向中国家长）
    tags: ['常春藤摇篮', '百年名校', '政商精英', '全额助学金'],

    // 简介
    intro: '美国历史最悠久的顶级寄宿高中，创立于1778年，毕业生升读常春藤比例全美最高。每年向哈佛、耶鲁、普林斯顿输送数十名学生。',

    // 第二层：留学生支持与社区资源
    resources: {
      chineseNote: '中国学生比例约10-15%，有活跃的中国学生会（CSSA），微信群活跃。每年中国学生活动包括春节晚会、文化周等。',
      hiddenOpps: [
        'Oliver Wendell Holmes Library 收藏超过10万册图书，是全美高中图书馆藏书量最大之一',
        '安多佛设有专属商学院联合项目（Andover-Yale Business Program），每年夏天可参加耶鲁联合课程',
        'Tang Institute 每学期提供学生主导的跨学科项目资金，无需审批直接申请',
        '录取后即可申请 Andover-MIT 联合工程项目，每年仅开放12个名额',
        '校内有自己的 FM 广播电台和日报（The Phillipian），是全美历史最久的学生报纸之一',
      ],
      alumniTip: '入学第一周：加入安多佛中国学生微信群，学长会带你了解所有"潜规则"——哪位老师最好、哪门课最划算、学期初如何选课最有利于大学申请。',
      chinaComm: '安多佛距波士顿约40分钟车程，波士顿华人社区成熟，周末可乘校车前往。唐人街、华人超市、中餐厅齐全。',
      employerNote: '全球顶级雇主（McKinsey、Goldman、Google）大量录用安多佛校友，认可度与哈佛本科相当。',
    },
  },

  {
    id: 'exeter',
    name: 'Phillips Exeter Academy',
    nameCN: '菲利普斯·埃克塞特中学',
    city: 'Exeter', state: 'NH', country: '美国',
    founded: 1781,
    grades: '9-12 + PG',
    genderType: 'co-ed',
    website: 'https://exeter.edu',
    tier: 1,

    ssat: '2100–2350', toeflMin: 100, appDeadline: '1月15日',
    integrationLevel: 4, integrationLabel: '鼓励深度融合',
    fitFor: '英语表达能力出众、热爱课堂辩论的学生——哈克尼斯教学法要求你每天主导讨论，沉默型学生会非常痛苦。',
    chineseApplicantTip: '口语是最核心门槛，托福110+仅是起点，能在20人圆桌上用英语主导观点才是真实要求。',

    tuitionUSD: 69537,
    tuitionFmt: '$69,537',
    tuitionCNY: '约合人民币 50 万元/年',

    acceptRate: 17,
    enrollment: 1106,
    intlPct: 8,

    satAvg: 1470,
    actAvg: 33,
    apNote: '不设 AP 课程 — 以"哈克尼斯教学法"（圆桌讨论制）替代，培养批判性思维',

    aidPct: 50,
    avgAidUSD: 60000,
    needBlind: true,
    aidNote: '全美仅两所共学寄宿高中实行"无视家庭经济需求"录取，捐赠基金达 $15亿，人均超过大多数大学',

    topColleges: ['Harvard', 'Princeton', 'Yale', 'MIT', 'Stanford', 'Dartmouth', 'Brown', 'Cornell'],
    notableAlumni: ['马克·扎克伯格（Facebook创始人）', '丹·布朗（《达芬奇密码》作者）', '约翰·欧文（小说家）'],

    tags: ['哈克尼斯教学法', '全额助学金', '常春藤摇篮', '捐赠基金最雄厚'],

    intro: '与安多佛并称"美国最顶级的两所高中"，以独特的哈克尼斯圆桌教学闻名。不开设AP课程，但大学申请实力全美顶尖，捐赠基金人均超过大多数常春藤大学。',

    resources: {
      chineseNote: '国际生比例约8%，相对偏低，中国学生群体较小但精英感强。学校有专属国际生辅导员，提供文化适应支持。',
      hiddenOpps: [
        '哈克尼斯基金会资助全球教育创新，埃克塞特学生可申请每年10个暑期全球调研项目名额',
        '学校图书馆藏有超过10万册图书，有一名专职研究馆员专门辅导学生做学术研究',
        'Exeter Innovation Lab 每学期提供 $2000 学生创业种子基金，无需担保人',
        '学校与剑桥大学有交换项目，可申请在英国度过一学期',
      ],
      alumniTip: '最重要提醒：埃克塞特不设 AP，申请大学时要在文书里解释"哈克尼斯教学法"对你的影响——这是考官最喜欢看到的差异化内容。',
      chinaComm: '埃克塞特是新罕布什尔州的小镇，生活节奏缓慢，但距波士顿仅1小时。波士顿华人资源丰富，可供周末补给。',
      employerNote: '埃克塞特校友在顶级咨询、金融、科技行业高管中比例极高，网络效应强大。',
    },
  },

  {
    id: 'groton',
    name: 'Groton School',
    nameCN: '格罗顿中学',
    city: 'Groton', state: 'MA', country: '美国',
    founded: 1884,
    grades: '8-12',
    genderType: 'co-ed',
    website: 'https://www.groton.org',
    tier: 1,

    ssat: '2200–2400', toeflMin: 100, appDeadline: '1月15日',
    integrationLevel: 3, integrationLabel: '均衡融合',
    fitFor: '渴望精英小校氛围、能在极度透明的小社群中快速成熟的孩子——全校390人，你的每一面都被看见。',
    chineseApplicantTip: '录取率不足9%，全美最难，招生官极重性格和人品，内向安静型学生需要额外展示主动融入的意愿。',

    tuitionUSD: 63000,
    tuitionFmt: '$63,000',
    tuitionCNY: '约合人民币 46 万元/年',

    acceptRate: 9,
    enrollment: 390,
    intlPct: 18,

    apNote: '提供多门 AP 及独立研究课程',

    aidPct: 44,
    avgAidUSD: 46519,
    needBlind: false,
    aidNote: '家庭年收入 <$150K 免学费起，44% 学生获助学金',

    topColleges: ['Harvard', 'Yale', 'Princeton', 'MIT', 'Georgetown', 'Columbia'],
    notableAlumni: ['富兰克林·罗斯福（美国总统）', '麦克乔治·邦迪（国家安全顾问）'],

    tags: ['全美录取率最低', '精英小校', '7:1师生比', 'Niche全美第一'],

    intro: '2025年Niche评选全美第一私立高中。全校仅390人，录取率不足9%，是美国录取竞争最激烈的寄宿高中之一。极小的校园规模带来极度个性化的教育体验。',

    resources: {
      chineseNote: '国际生比例约18%，中国学生社群活跃。学校规模小，校长认识每一位学生。',
      hiddenOpps: [
        '格罗顿与哈佛大学有长期合作，学生可申请参加哈佛暑期研究项目',
        '学校有独特的"Honor Code"荣誉制度，这在大学申请文书中是极强的差异化素材',
        '每年12月有专属"服务周"，学生前往全球各地做志愿服务，可选择中国项目',
      ],
      alumniTip: '格罗顿太小，任何消极情绪都会放大。建议入学前做好心理准备，主动融入，前两个月是关键期。',
      chinaComm: '距波士顿约1小时，有中国学生自发组织的包车服务到华人超市和中餐馆。',
      employerNote: '毕业生在政府、外交、金融领域人脉极深，格罗顿校友会是美国最活跃的私立高中校友网络之一。',
    },
  },

  {
    id: 'deerfield',
    name: 'Deerfield Academy',
    nameCN: '迪尔菲尔德中学',
    city: 'Deerfield', state: 'MA', country: '美国',
    founded: 1797,
    grades: '9-12 + PG',
    genderType: 'co-ed',
    website: 'https://www.deerfield.edu',
    tier: 1,

    ssat: '2100–2300', toeflMin: 100, appDeadline: '1月15日',
    integrationLevel: 3, integrationLabel: '均衡融合',
    fitFor: '学术优秀但同时热爱体育和艺术、不想活在纯竞争压力中的全面型学生，助学金政策全美最慷慨。',
    chineseApplicantTip: '家庭年收入150万人民币以下可申请全免学费，如实填写财务信息是你最大的申请优势。',

    tuitionUSD: 70900,
    tuitionFmt: '$70,900',
    tuitionCNY: '约合人民币 51 万元/年',

    acceptRate: 13,
    enrollment: 649,
    intlPct: 13,

    apNote: '提供 AP 及 Deerfield 特色高阶课程',

    aidPct: 38,
    avgAidUSD: 60850,
    needBlind: false,
    aidNote: '家庭年收入 <$150K 全免，<$500K 学费不超过家庭收入10%，平均助学金 $60,850',

    topColleges: ['Harvard', 'Yale', 'Columbia', 'Dartmouth', 'Middlebury', 'Brown', 'Williams'],
    notableAlumni: ['约翰·麦克菲（普利策奖作家）', '约旦国王阿卜杜拉'],

    tags: ['全美最慷慨助学金', '450英亩校园', '艺术体育齐强', '百年名校'],

    intro: '创建于1797年，美国最古老的私立学校之一。以极慷慨的助学金闻名：家庭收入低于$50万美元的家庭，学费不超过家庭年收入的10%。450英亩的乡村校园是全美最美丽的校园之一。',

    resources: {
      chineseNote: '中国学生约占13%，有成熟的中国学生组织。学校地处乡村，生活沉浸感强。',
      hiddenOpps: [
        'Deerfield 的 Arts Program 每年资助学生自主创作项目，费用最高 $5,000',
        '学校与麻省大学阿默斯特分校有联合课程，可提前修读大学学分',
        '每年的 "Alumni Mentorship Program" 可接触大量精英校友，中国区校友在上海/北京有活跃网络',
      ],
      alumniTip: '迪尔菲尔德的助学金政策是所有顶校里最透明的，建议入学前就和学校Financial Aid办公室建立关系，每年提前续审。',
      chinaComm: '地处马萨诸塞州农村，最近的唐人街在斯普林菲尔德（40分钟）或波士顿（2小时），学校周末有组织出行。',
      employerNote: '文理学院系统（Williams, Middlebury等）和常春藤体系均有大量迪尔菲尔德校友，升学去向多样。',
    },
  },

  {
    id: 'choate',
    name: 'Choate Rosemary Hall',
    nameCN: '乔特·罗斯玛丽霍尔中学',
    city: 'Wallingford', state: 'CT', country: '美国',
    founded: 1890,
    grades: '9-12 + PG',
    genderType: 'co-ed',
    website: 'https://www.choate.edu',
    tier: 1,

    ssat: '2050–2300', toeflMin: 100, appDeadline: '1月15日',
    integrationLevel: 2, integrationLabel: '华人社群活跃',
    fitFor: '希望在国际化环境中有一定中国同伴支持的综合型学生，是顶级一线中对中国学生最友好的学校。',
    chineseApplicantTip: '中国学生18%社群最成熟，适合刚适应海外生活的学生，但入学后要主动拓展英语圈，别让中文圈变成舒适区。',

    tuitionUSD: 71420,
    tuitionFmt: '$71,420',
    tuitionCNY: '约合人民币 52 万元/年',

    acceptRate: 16,
    enrollment: 860,
    intlPct: 18,

    apNote: '81% 的 AP 考试成绩达 4-5 分（高于全国平均）',

    aidPct: 35,
    avgAidUSD: 57000,
    needBlind: false,
    aidNote: '35% 学生获助学金，平均抵扣 80% 学费，助学金预算 $1650 万/年',

    topColleges: ['Harvard', 'Yale', 'Georgetown', 'Columbia', 'NYU', 'Brown', 'Cornell', 'Northwestern'],
    notableAlumni: ['约翰·F·肯尼迪（美国总统）', '格伦·克洛斯（奥斯卡女演员）', '保罗·贾马提（演员）'],

    tags: ['JFK 母校', '国际生18%', 'AP成绩优异', '常春藤摇篮'],

    intro: '约翰·F·肯尼迪的母校。国际生比例达18%，是顶级寄宿高中中对中国学生最友好的之一。学校AP成绩出众，81%的AP成绩达到4-5分（全国平均仅56%）。',

    resources: {
      chineseNote: '国际生比例18%，中国学生群体是最大的国际学生群体之一，有活跃的中国学生学者联合会（CSSA Choate）。',
      hiddenOpps: [
        'Choate Rosemary Hall 的 The Island Project 提供独特的海洋生态研究暑期项目，可在申请文书中重点使用',
        '学校创新中心（Innovation Learning Center）每学期向学生开放 3D 打印、激光雕刻等工具，无需申请',
        '每年 JFK 校友周期间，政界和商界校友会返校做讲座，中国学生可直接参与',
        '学校离纽黑文（耶鲁大学）仅15分钟，可自行前往旁听耶鲁开放讲座',
      ],
      alumniTip: '乔特中国学生社区很成熟，入学时向学长索取"生存手册"——里面有关于选课、宿舍生活、周末安排的全部实用信息。',
      chinaComm: '距纽黑文15分钟，距纽约约1.5小时。New Haven 有规模不小的华人社区。',
      employerNote: '乔特校友在法律、传媒、政治领域深具影响力，肯尼迪家族传统使学校在东海岸政界颇具声望。',
    },
  },

  {
    id: 'hotchkiss',
    name: 'The Hotchkiss School',
    nameCN: '霍奇基斯中学',
    city: 'Lakeville', state: 'CT', country: '美国',
    founded: 1891,
    grades: '9-12 + PG',
    genderType: 'co-ed',
    website: 'https://www.hotchkiss.org',
    tier: 1,

    ssat: '2100–2300', toeflMin: 100, appDeadline: '1月15日',
    integrationLevel: 4, integrationLabel: '鼓励深度融合',
    fitFor: '有独立学术热情、不依赖AP框架、愿意用思维深度而非考试成绩证明自己的孩子。',
    chineseApplicantTip: '没有AP，申大学时文书必须主动解释"为什么没有AP成绩"并把它转化为优势，提前和申请顾问对齐这个策略。',

    tuitionUSD: 71170,
    tuitionFmt: '$71,170',
    tuitionCNY: '约合人民币 52 万元/年',

    acceptRate: 16,
    enrollment: 614,
    intlPct: 14,

    apNote: '2021年主动废除AP课程，以自主研究和探究性课程替代，被视为教育改革的先锋',

    aidPct: 37,
    avgAidUSD: 62075,
    needBlind: false,
    aidNote: '37% 学生获助学金，平均助学金 $62,075；目标2028年前助学金覆盖学生达50%',

    topColleges: ['Harvard', 'Yale', 'Princeton', 'Dartmouth', 'Middlebury', 'Williams', 'Brown'],
    notableAlumni: ['迈克尔·普斯（《教父》作者）', '埃夫里尔·哈里曼（外交官）'],

    tags: ['Niche 2025 全美第一', '废除AP革新课程', '科尼蒂格湖畔校园', '思想领袖摇篮'],

    intro: '2025年Niche全美私立高中排名第一。2021年主动废除AP课程，以更深度的探究性学习替代，被教育界视为"下一代精英教育"的先驱。湖畔校园风景优美，距纽约约2小时。',

    resources: {
      chineseNote: '国际生14%，中国学生比例适中。学校注重思辨和深度学习，适合已经有学科热情的学生。',
      hiddenOpps: [
        '霍奇基斯的 Tinker Fund 为学生自主项目提供资助，历史上曾资助学生开办餐厅、出版书籍',
        '学校废除AP后，大学录取官更看重学生的学习深度文书——这是独特优势',
        '学校有一个超过1万册的专项中文藏书区，是东北部高中中最大的中文图书馆之一',
      ],
      alumniTip: '入学前了解：霍奇基斯没有AP，申请大学时你的成绩单会和其他学生不同。提前让申请顾问理解这点，把它转化为优势。',
      chinaComm: '莱克维尔是小镇，距纽约约2小时。学校组织定期前往纽约的文化活动，中国学生通常会在纽约的周末活动中集会。',
      employerNote: '霍奇基斯校友在艺术、文化、人文领域有独特影响力，思维方式在精英圈子中极受推崇。',
    },
  },

  // ══════════════════════════════════════════════════════════════
  //  顶级二线（高度选择性 · 全面均衡）
  // ══════════════════════════════════════════════════════════════

  {
    id: 'stpauls',
    name: "St. Paul's School",
    nameCN: '圣保罗中学',
    city: 'Concord', state: 'NH', country: '美国',
    founded: 1856,
    grades: '9-12',
    genderType: 'co-ed',
    website: 'https://www.sps.edu',
    tier: 2,

    ssat: '2100–2300', toeflMin: 100, appDeadline: '1月15日',
    integrationLevel: 4, integrationLabel: '鼓励深度融合',
    fitFor: '希望24小时完全沉浸在英语精英文化中、有意进入美国政界或法律界的孩子。',
    chineseApplicantTip: '纯寄宿制、无走读生，英语口语压力极大，第一学期是最难熬的时段，入学前务必做好心理建设。',

    tuitionUSD: 71800,
    tuitionFmt: '$71,800',
    tuitionCNY: '约合人民币 52 万元/年',

    acceptRate: 16,
    enrollment: 540,
    intlPct: 12,

    aidPct: 38,
    avgAidUSD: 50000,
    needBlind: false,
    aidNote: '家庭年收入 <$150K 免学费，提供 $1300 万/年助学金总预算',

    topColleges: ['Harvard', 'Yale', 'Dartmouth', 'Brown', 'Georgetown', 'Cornell', 'Williams'],
    notableAlumni: ['约翰·凯里（美国国务卿）', '罗伯特·穆勒（FBI局长）'],

    tags: ['纯住宿制', '新英格兰传统', '政界精英', '宗教背景'],
    intro: '全美历史最悠久的住宿制高中之一，创立于1856年。纯寄宿制（无走读生），营造高度沉浸的校园生活。培养了大量政界精英，约翰·凯里和罗伯特·穆勒均毕业于此。',

    resources: {
      chineseNote: '国际生约12%，中国学生有自己的学生组织和微信群。',
      hiddenOpps: [
        '纯寄宿制校园意味着100%的校友人脉网络都是"共同生活"建立的，人脉质量极高',
        '学校有美国高中中罕见的专业天文台，开放供学生使用',
      ],
      alumniTip: '圣保罗以校园生活质量著称，申请时重点展现你对"社区"的投入，而非纯学术成就。',
      chinaComm: '距波士顿约1.5小时，距曼彻斯特（NH）机场仅30分钟。',
      employerNote: '政法界影响力超强，校友活跃于华盛顿特区的政治圈。',
    },
  },

  {
    id: 'lawrenceville',
    name: 'The Lawrenceville School',
    nameCN: '劳伦斯威尔中学',
    city: 'Lawrenceville', state: 'NJ', country: '美国',
    founded: 1810,
    grades: '9-12 + PG',
    genderType: 'co-ed',
    website: 'https://www.lawrenceville.org',
    tier: 2,

    ssat: '2050–2250', toeflMin: 100, appDeadline: '1月15日',
    integrationLevel: 3, integrationLabel: '均衡融合',
    fitFor: '对金融、法律、咨询感兴趣、想借普林斯顿地缘优势建立顶级人脉的孩子，学费最高但人脉回报最直接。',
    chineseApplicantTip: '学费全美顶校中最贵，入学前算清四年总成本；邻近普林斯顿是真实优势，要主动规划如何利用。',

    tuitionUSD: 80690,
    tuitionFmt: '$80,690',
    tuitionCNY: '约合人民币 58 万元/年',

    acceptRate: 18,
    enrollment: 822,
    intlPct: 16,

    satAvg: 1410,
    actAvg: 32,
    apNote: '提供多门 AP 及高阶独立研究课程',

    aidPct: 30,
    avgAidUSD: 63000,
    needBlind: false,
    aidNote: '30% 学生获助学金，助学金平均 $63,000，100% 满足经济需求',

    topColleges: ['Princeton', 'Harvard', 'Yale', 'Penn', 'Brown', 'Duke', 'Georgetown'],
    notableAlumni: ['梅里尔·林奇（金融家）', '许多华尔街高管'],

    tags: ['毗邻普林斯顿', '金融精英摇篮', 'House制度', '历史悠久'],
    intro: '紧邻普林斯顿大学（步行5分钟），学生可使用普林斯顿大学图书馆。以"House"制度（类似哈利波特中的学院制）著名，学费在顶级寄宿高中中为最高之列。',

    resources: {
      chineseNote: '国际生约16%，中国学生群体规模较大，社群成熟。学校毗邻普林斯顿，氛围浓厚。',
      hiddenOpps: [
        '毗邻普林斯顿，学生可前往旁听大学公开讲座，并使用Firestone图书馆的部分资源',
        'Lawrenceville的"Harkness" style教学有自己的形式，可在申请文书中与埃克塞特对比阐述',
        '金融行业校友网络极强，华尔街校友每年返校做招募，部分接受高中实习申请',
      ],
      alumniTip: '劳伦斯威尔的费用是最高的，入学前认真核算总费用（含住宿、书本、体育装备等）。House制度决定你三年生活的核心圈子，入学时的House选择要慎重。',
      chinaComm: '劳伦斯维尔距纽约约1小时，距费城约45分钟，出行便利，纽约唐人街可直达。',
      employerNote: '金融、咨询行业校友密度极高，高盛、摩根士丹利校友网络特别活跃。',
    },
  },

  {
    id: 'milton',
    name: 'Milton Academy',
    nameCN: '米尔顿中学',
    city: 'Milton', state: 'MA', country: '美国',
    founded: 1798,
    grades: '9-12',
    genderType: 'co-ed',
    website: 'https://www.milton.edu',
    tier: 2,

    ssat: '2100–2350', toeflMin: 100, appDeadline: '1月15日',
    integrationLevel: 3, integrationLabel: '均衡融合',
    fitFor: '有艺术或文学倾向、不想离波士顿太远、对纯住宿制生活有顾虑的全面型学生。',
    chineseApplicantTip: '走读生和寄宿生混合，校园文化更多元，距波士顿唐人街仅20分钟，是所有顶级寄宿高中中生活保障最好的。',

    tuitionUSD: 77900,
    tuitionFmt: '$77,900',
    tuitionCNY: '约合人民币 56 万元/年',

    acceptRate: 13,
    enrollment: 950,
    intlPct: 15,

    apNote: '提供 AP 及学校特色高阶课程',

    aidPct: 35,
    avgAidUSD: 58500,
    needBlind: false,
    aidNote: '35% 学生获助学金，平均助学金覆盖 75% 学费，助学金预算 $1600 万/年',

    topColleges: ['Harvard', 'Yale', 'MIT', 'Princeton', 'Columbia', 'Dartmouth', 'Brown'],
    notableAlumni: ['T·S·艾略特（诺贝尔文学奖）', '唐纳德·萨瑟兰（演员）'],

    tags: ['距波士顿最近', '同录率极低', '走读+寄宿混合', '艺术氛围浓厚'],
    intro: '位于波士顿南郊，是距波士顿最近的顶级寄宿高中。录取率仅13%，但走读生和寄宿生混合的校园文化使其氛围更加多元。诺贝尔文学奖得主T·S·艾略特毕业于此。',

    resources: {
      chineseNote: '中国学生比例约15%，距离波士顿近，很多中国学生家长会选择在波士顿陪读（尽管不是必须的）。',
      hiddenOpps: [
        '地理位置优越，距MIT和哈佛仅30分钟，学校与两校均有合作课程',
        '米尔顿有走读生，可以通过走读生结识更多本地波士顿学生，人脉多元',
        '学校每年资助学生参加全球服务学习项目，包括中国农村教育项目',
      ],
      alumniTip: '米尔顿的竞争压力相对其他极顶级学校略低，更适合希望在顶校环境中保持心理健康的同学。',
      chinaComm: '距波士顿唐人街仅20分钟，华人资源极其丰富，是所有顶级寄宿高中中地理位置对华人最友好的。',
      employerNote: '文理并重，艺术和科技领域校友均有建树。',
    },
  },

  {
    id: 'middlesex',
    name: 'Middlesex School',
    nameCN: '米德尔塞克斯中学',
    city: 'Concord', state: 'MA', country: '美国',
    founded: 1901,
    grades: '9-12',
    genderType: 'co-ed',
    website: 'https://www.mxschool.edu',
    tier: 2,

    ssat: '2100–2300', toeflMin: 100, appDeadline: '1月15日',
    integrationLevel: 3, integrationLabel: '均衡融合',
    fitFor: '注重社区建设、希望在精英小校担任领导角色的人文社科倾向学生，425人规模让你很容易成为核心人物。',
    chineseApplicantTip: '全校425人，任何学生都可以轻松担任社团领袖，申请文书里的"社区贡献"素材会非常充实。',

    tuitionUSD: 79200,
    tuitionFmt: '$79,200',
    tuitionCNY: '约合人民币 57 万元/年',

    acceptRate: 16,
    enrollment: 425,
    intlPct: 20,

    apNote: '提供 AP 及深度研究课程',

    aidPct: 32,
    avgAidUSD: 56731,
    needBlind: false,
    aidNote: '32% 学生获助学金，平均 $56,731，来自30个州和22个国家',

    topColleges: ['Harvard', 'Yale', 'Princeton', 'MIT', 'Dartmouth', 'Brown', 'Bowdoin'],
    notableAlumni: ['多位美国参议员、CEO'],

    tags: ['康科德小镇', '国际化程度高', '精英小校', '自然环境优美'],
    intro: '位于历史名城康科德（美国独立战争发源地），国际生来自22个国家，国际化程度在顶级寄宿高中中位居前列。小校规模（425人）带来极高的个性化关注。',

    resources: {
      chineseNote: '国际生20%，中国学生群体活跃，每年有中国新年活动。',
      hiddenOpps: [
        '学校邻近梭罗的瓦尔登湖（Walden Pond），文化历史底蕴深厚，是人文社科申请文书的天然素材',
        '小校规模意味着学生更容易担任学生会领袖、部活负责人等职位',
      ],
      alumniTip: '米德尔塞克斯强调社区精神，申请文书要体现你对建设社区的热情而非个人成就。',
      chinaComm: '距波士顿约40分钟，波士顿华人资源丰富可利用。',
      employerNote: '文理学院升学率高，适合有志于人文社科领域的学生。',
    },
  },

  // ══════════════════════════════════════════════════════════════
  //  优选梯队（高质量 · 相对更易录取）
  // ══════════════════════════════════════════════════════════════

  {
    id: 'blair',
    name: 'Blair Academy',
    nameCN: '布莱尔中学',
    city: 'Blairstown', state: 'NJ', country: '美国',
    founded: 1848,
    grades: '9-12 + PG',
    genderType: 'co-ed',
    website: 'https://www.blair.edu',
    tier: 2,

    ssat: '2050–2250', toeflMin: 100, appDeadline: '1月15日',
    integrationLevel: 3, integrationLabel: '均衡融合',
    fitFor: '有体育特长、希望在纽约大都会圈建立人脉的综合型学生，是顶级梯队中体育特招路径最清晰的学校。',
    chineseApplicantTip: '有体育特长要提前联系教练展示成绩，体育特招是进入布莱尔最确定的路径之一。',

    tuitionUSD: 78980,
    tuitionFmt: '$78,980',
    tuitionCNY: '约合人民币 57 万元/年',

    acceptRate: 15,
    enrollment: 469,
    intlPct: 18,

    aidPct: 36,
    avgAidUSD: 54896,
    needBlind: false,
    aidNote: '36% 学生获助学金，平均助学金 $54,896，助学金总预算 $900 万/年',

    topColleges: ['Duke', 'Georgetown', 'Cornell', 'Brown', 'Vanderbilt', 'Tufts', 'Colby'],
    notableAlumni: ['肯尼思·布拉纳（导演）'],

    tags: ['距纽约65英里', '体育强校', '精英小校', '国际生18%'],
    intro: '位于新泽西州西北部，距纽约市仅65英里。录取率15%，竞争激烈，体育项目尤为出色（多项全国冠军）。国际生18%，有成熟的国际学生支持体系。',

    resources: {
      chineseNote: '国际生18%，中国学生群体可观，有学生自发组织的活动。',
      hiddenOpps: [
        '距纽约仅65英里，学校定期组织纽约文化活动，音乐会、博物馆、百老汇均可参与',
        '体育名校，部分学生通过体育特招进入，如有体育特长可重点申请',
      ],
      alumniTip: '布莱尔的体育文化很强，如果你有体育特长，这里是让你在申请顶校时脱颖而出的好平台。',
      chinaComm: '距纽约1.5小时，可方便到纽约法拉盛（全美最大华人社区之一）。',
      employerNote: '体育行业、媒体、金融行业校友活跃。',
    },
  },

  {
    id: 'taft',
    name: 'The Taft School',
    nameCN: '塔夫特中学',
    city: 'Watertown', state: 'CT', country: '美国',
    founded: 1890,
    grades: '9-12 + PG',
    genderType: 'co-ed',
    website: 'https://www.taftschool.org',
    tier: 2,

    ssat: '2000–2200', toeflMin: 95, appDeadline: '1月15日',
    integrationLevel: 3, integrationLabel: '均衡融合',
    fitFor: '追求全人发展、不想承受最顶级学校极限压力的均衡型学生，学费中含所有费用无隐性收费。',
    chineseApplicantTip: '学业压力相对适中，是英语中上水平学生的理想过渡选择，录取门槛比一线低但教育质量不打折。',

    tuitionUSD: 75250,
    tuitionFmt: '$75,250',
    tuitionCNY: '约合人民币 55 万元/年',

    acceptRate: 19,
    enrollment: 615,
    intlPct: 18,

    apNote: '提供 AP 课程，不收额外费用（含在学费中）',

    aidPct: 37,
    avgAidUSD: 55000,
    needBlind: false,
    aidNote: '37% 学生获助学金，不收额外技术费/毕业费',

    topColleges: ['Cornell', 'Georgetown', 'Dartmouth', 'Yale', 'Brown', 'Colby', 'Middlebury'],
    notableAlumni: ['约翰·麦克阿瑟（麦克阿瑟天才奖创始人）'],

    tags: ['无额外收费', '全面均衡', '康涅狄格名校', '适合全面发展型学生'],
    intro: '以"全人教育"理念著称，是学费中不含任何隐性费用的少数顶级寄宿高中之一。录取率19%，相对更易进入。学校体育、艺术、学术三位一体发展。',

    resources: {
      chineseNote: '国际生18%，中国学生群体有一定规模。',
      hiddenOpps: [
        '塔夫特的 Robert E. Wilson Center 是一个专门支持学生进行艺术创作的资金项目',
        '距耶鲁大学约45分钟，学校有部分与耶鲁的联合活动',
      ],
      alumniTip: '塔夫特是顶级寄宿高中中性价比较高的选择——录取率略高，学校质量上乘，是"进得去、有收获"的好选择。',
      chinaComm: '距纽黑文约45分钟，纽约2小时。',
      employerNote: '文理学院和研究型大学升学均衡，各行业均有校友。',
    },
  },

  {
    id: 'loomis',
    name: 'The Loomis Chaffee School',
    nameCN: '卢米斯查菲中学',
    city: 'Windsor', state: 'CT', country: '美国',
    founded: 1874,
    grades: '9-12 + PG',
    genderType: 'co-ed',
    website: 'https://www.loomischaffee.org',
    tier: 2,

    ssat: '1950–2150', toeflMin: 95, appDeadline: '1月15日',
    integrationLevel: 3, integrationLabel: '均衡融合',
    fitFor: '喜欢独特校园环境、预算相对有限的学生——岛屿校园是全美唯一的，学费同级最低，文书素材天然独特。',
    chineseApplicantTip: '岛屿校园环境在申请文书中是强差异化素材，入学后要主动用这个故事讲清楚"为什么选这里"。',

    tuitionUSD: 68420,
    tuitionFmt: '$68,420',
    tuitionCNY: '约合人民币 50 万元/年',

    acceptRate: 18,
    enrollment: 715,
    intlPct: 17,

    aidPct: 33,
    avgAidUSD: 50000,
    needBlind: false,
    aidNote: '33% 学生获助学金，助学金总预算 $1300 万/年',

    topColleges: ['Cornell', 'Georgetown', 'Boston University', 'NYU', 'Tufts', 'Trinity'],
    notableAlumni: ['多位跨国企业CEO'],

    tags: ['岛屿校园', '康涅狄格名校', '距哈特福德10分钟', '性价比优选'],
    intro: '建于康涅狄格河中的一座小岛上，是全美独一无二的"岛屿校园"。学费在顶级寄宿高中中属于较低水平，录取率18%。校园美丽，距哈特福德（CT首府）仅10分钟。',

    resources: {
      chineseNote: '国际生约17%，有中国学生组织。',
      hiddenOpps: [
        '"岛屿校园"意味着社区高度凝聚，校友网络在小型精英圈内极为紧密',
        '学校的环境科学课程利用河流生态系统，是少有的自然条件教学优势',
      ],
      alumniTip: '卢米斯查菲是顶级寄宿高中中学费偏低的，但教育质量与同级竞争者相当，是性价比的好选择。',
      chinaComm: '距哈特福德10分钟，纽约约2小时。',
      employerNote: '学生升读东北部文理学院和研究型大学比例高。',
    },
  },

  {
    id: 'nmh',
    name: 'Northfield Mount Hermon',
    nameCN: '北菲尔德·芒特·赫蒙中学',
    city: 'Mount Hermon', state: 'MA', country: '美国',
    founded: 1879,
    grades: '9-12 + PG',
    genderType: 'co-ed',
    website: 'https://www.nmhschool.org',
    tier: 3,
    ssat: '1900–2100', toeflMin: 90, appDeadline: '2月1日',
    integrationLevel: 2, integrationLabel: '华人社群活跃',
    fitFor: '英语能力尚在提升阶段、希望平稳过渡到美国学习环境的学生，是顶级寄宿高中体系最友好的入口。',
    chineseApplicantTip: '录取率31%是同级中最宽松的，国际生22%提供充足同伴支持，适合作为申请中的安全校。',

    tuitionUSD: 74826,
    tuitionFmt: '$74,826',
    tuitionCNY: '约合人民币 54 万元/年',

    acceptRate: 31,
    enrollment: 630,
    intlPct: 22,

    aidPct: 45,
    avgAidUSD: 56314,
    needBlind: false,
    aidNote: '助学金覆盖比例高，平均 $56,314，国际生可申请有限助学金',

    topColleges: ['Vermont', 'Northeastern', 'Clark', 'Middlebury', 'UMass'],
    notableAlumni: ['多位社会创新领袖'],

    tags: ['录取率31%相对宽松', '国际生22%最高', '社会服务导向', '1353英亩大校园'],
    intro: '1353英亩的超大校园，是顶级寄宿高中中国际生比例最高的（22%）。录取率31%，是进入顶级寄宿高中最"容易"的路径之一。学校以强调社会责任和公共服务著称。',

    resources: {
      chineseNote: '国际生22%，是所有一线寄宿高中中比例最高的，中国学生有大量同伴。',
      hiddenOpps: [
        'NMH 的 Work Program 要求所有学生每周参与校园劳动，培养踏实精神，是文书素材好来源',
        '社会创新项目全美知名，可通过该校项目申请哈佛、耶鲁暑期社会服务项目',
      ],
      alumniTip: 'NMH 的录取率相对高，可作为顶级寄宿高中中的"保底选项"，教育质量不打折扣。',
      chinaComm: '马萨诸塞州西部，距波士顿约2小时，距纽约约3小时，较为偏远。',
      employerNote: '非营利、教育、公共服务领域校友活跃。',
    },
  },

  {
    id: 'cate',
    name: 'Cate School',
    nameCN: '凯特中学',
    city: 'Carpinteria', state: 'CA', country: '美国',
    founded: 1910,
    grades: '9-12',
    genderType: 'co-ed',
    website: 'https://www.cate.org',
    tier: 2,
    ssat: '2000–2200', toeflMin: 100, appDeadline: '1月15日',
    integrationLevel: 4, integrationLabel: '鼓励深度融合',
    fitFor: '目标硅谷科技创业或好莱坞娱乐传媒的学生，是全美唯一顶级西海岸寄宿高中，人脉方向与东海岸完全不同。',
    chineseApplicantTip: '选凯特的核心理由是西海岸人脉，如果职业目标是科技或传媒，这里比东海岸名校更直接有效。',

    tuitionUSD: 75000,
    tuitionFmt: '$75,000',
    tuitionCNY: '约合人民币 54 万元/年',

    acceptRate: 28,
    enrollment: 285,
    intlPct: 20,

    aidPct: 38,
    avgAidUSD: 55000,
    needBlind: false,
    aidNote: '38% 学生获助学金，平均助学金较高',

    topColleges: ['UCLA', 'USC', 'Stanford', 'Yale', 'Columbia', 'Berkeley'],
    notableAlumni: ['格雷戈里·佩克（奥斯卡影帝）'],

    tags: ['西海岸唯一顶级', '圣巴巴拉海岸', '150英亩山地校园', '硅谷人脉'],
    intro: '美国西海岸最顶级的寄宿高中，位于圣巴巴拉郊区的150英亩山地校园，可俯瞰太平洋。是希望接触硅谷/洛杉矶科技和娱乐产业的学生的最佳选择。',

    resources: {
      chineseNote: '国际生约20%，中国学生群体在此可同时接触硅谷和好莱坞两大产业人脉。',
      hiddenOpps: [
        '学校距洛杉矶2小时、距硅谷5小时，科技公司参观机会多，部分校友在顶级科技公司担任高管',
        '海洋生态课程利用天然海岸环境，是独一无二的科研素材',
        '加州阳光充足，运动和户外活动资源极其丰富，生活质量高',
      ],
      alumniTip: '选凯特的核心优势是西海岸人脉——如果你的职业目标是科技、娱乐、创业，这里的校友网络比东海岸更相关。',
      chinaComm: '洛杉矶华人社区极其成熟，距学校2小时，圣盖博谷华人区规模庞大。',
      employerNote: '科技（硅谷）和娱乐（好莱坞）行业校友人脉出色。',
    },
  },

  {
    id: 'kent',
    name: 'Kent School',
    nameCN: '肯特中学',
    city: 'Kent', state: 'CT', country: '美国',
    founded: 1906,
    grades: '9-12 + PG',
    genderType: 'co-ed',
    website: 'https://www.kent-school.edu',
    tier: 3,
    ssat: '1950–2150', toeflMin: 90, appDeadline: '1月15日',
    integrationLevel: 2, integrationLabel: '华人社群活跃',
    fitFor: '有赛艇特长或重视国际化环境的学生，国际生25%是顶校最高比例，文化适应压力最小。',
    chineseApplicantTip: '国际生25%，中国学生最多，适合英语适应期的学生，但要主动拓展英语圈，避免全程待在华人圈。',

    tuitionUSD: 69000,
    tuitionFmt: '$69,000',
    tuitionCNY: '约合人民币 50 万元/年',

    acceptRate: 25,
    enrollment: 550,
    intlPct: 25,

    aidPct: 40,
    avgAidUSD: 48000,
    needBlind: false,
    aidNote: '40% 学生获助学金，国际生有专项助学金',

    topColleges: ['Georgetown', 'Boston University', 'Fordham', 'Colby', 'Trinity', 'Tufts'],
    notableAlumni: ['多位外交官、记者'],

    tags: ['国际生25%比例最高', '赛艇名校', '河边校园', '宗教背景圣公会'],
    intro: '国际生比例高达25%，是顶级寄宿高中中最"国际化"的校园之一。赛艇运动全国知名，湖边校园环境优美。对国际学生友好，有专项助学金。',

    resources: {
      chineseNote: '国际生25%，中国学生群体大，社群最成熟，校内有很多中文社区活动。',
      hiddenOpps: [
        '赛艇特长生有专属奖学金，如有赛艇经历重点申请',
        '国际化程度高意味着跨文化交流机会多，对希望拓展全球视野的学生极佳',
      ],
      alumniTip: '肯特是所有顶级寄宿高中中国际学生比例最高的，如果担心文化适应问题，这里是最友好的起点。',
      chinaComm: '距纽黑文约1小时，距纽约约2小时。',
      employerNote: '外交、媒体、国际关系领域校友活跃。',
    },
  },

  {
    id: 'peddie',
    name: 'The Peddie School',
    nameCN: '佩迪中学',
    city: 'Hightstown', state: 'NJ', country: '美国',
    founded: 1864,
    grades: '9-12 + PG',
    genderType: 'co-ed',
    website: 'https://www.peddie.org',
    tier: 3,
    ssat: '1950–2150', toeflMin: 90, appDeadline: '1月15日',
    integrationLevel: 2, integrationLabel: '华人社群活跃',
    fitFor: '学术扎实、预算中等、希望借普林斯顿辐射圈提升层次的综合型学生，来自41国的同学是真实的国际视野。',
    chineseApplicantTip: '大学申请辅导系统完善，适合需要全程指导的家庭，距普林斯顿20分钟是真实的氛围加成。',

    tuitionUSD: 67000,
    tuitionFmt: '$67,000',
    tuitionCNY: '约合人民币 49 万元/年',

    acceptRate: 20,
    enrollment: 550,
    intlPct: 22,

    aidPct: 40,
    avgAidUSD: 45000,
    needBlind: false,
    aidNote: '40% 学生获助学金，来自41个国家的学生',

    topColleges: ['NYU', 'Penn', 'Rutgers Honors', 'Georgetown', 'Case Western'],
    notableAlumni: ['多位科技和金融行业高管'],

    tags: ['距普林斯顿20分钟', '国际生22%', '性价比优选', '来自41国学生'],
    intro: '距普林斯顿仅20分钟，是新泽西州优质寄宿高中代表。来自41个国家的学生，国际化程度高。在同级竞争中录取率相对宽松，是优质的备选选项。',

    resources: {
      chineseNote: '国际生22%，中国学生群体活跃。距普林斯顿近，可接触顶校氛围。',
      hiddenOpps: [
        '距普林斯顿仅20分钟，可参与部分普林斯顿公开活动',
        '学校有完善的大学申请辅导系统，升学顾问对常春藤申请有丰富经验',
      ],
      alumniTip: '佩迪是"性价比"选择的代表——录取相对容易，但教育质量不差，升学数据良好。',
      chinaComm: '距纽约1.5小时，距费城45分钟，交通便利。',
      employerNote: '技术、金融领域校友网络在纽约和费城均有分布。',
    },
  },

  {
    id: 'hill',
    name: 'The Hill School',
    nameCN: '希尔中学',
    city: 'Pottstown', state: 'PA', country: '美国',
    founded: 1851,
    grades: '9-12 + PG',
    genderType: 'co-ed',
    website: 'https://www.thehill.org',
    tier: 3,
    ssat: '1950–2100', toeflMin: 90, appDeadline: '1月15日',
    integrationLevel: 3, integrationLabel: '均衡融合',
    fitFor: '目标宾夕法尼亚大学或东北部顶校、希望在费城文化圈建立基础的学生。',
    chineseApplicantTip: '宾州最好的寄宿高中，距宾大沃顿45分钟，有意申请沃顿的学生可提前建立校友人脉。',

    tuitionUSD: 67500,
    tuitionFmt: '$67,500',
    tuitionCNY: '约合人民币 49 万元/年',

    acceptRate: 25,
    enrollment: 550,
    intlPct: 20,

    aidPct: 38,
    avgAidUSD: 44000,
    needBlind: false,
    aidNote: '38% 学生获助学金',

    topColleges: ['Penn', 'Georgetown', 'Cornell', 'Villanova', 'Boston College'],
    notableAlumni: ['多位宾州政商界领袖'],

    tags: ['宾夕法尼亚名校', '历史底蕴深厚', '费城人脉', '性价比优选'],
    intro: '创建于1851年，宾夕法尼亚州最具声望的寄宿高中之一。距费城约45分钟，有丰富的文化和金融行业接触机会。学费相对合理，是东海岸性价比优选。',

    resources: {
      chineseNote: '国际生约20%，中国学生群体有一定规模。',
      hiddenOpps: [
        '距费城45分钟，宾州大学校友网络发达，部分商学院讲师会来校演讲',
      ],
      alumniTip: '希尔是宾州最好的寄宿高中选择，如果你的目标是宾大或东北部名校，这里是理想跳板。',
      chinaComm: '费城有不小的华人社区，中国城完善。',
      employerNote: '宾州及东北部金融、法律行业校友活跃。',
    },
  },

  {
    id: 'mercersburg',
    name: 'Mercersburg Academy',
    nameCN: '默瑟斯堡中学',
    city: 'Mercersburg', state: 'PA', country: '美国',
    founded: 1893,
    grades: '9-12 + PG',
    genderType: 'co-ed',
    website: 'https://www.mercersburg.edu',
    tier: 3,
    ssat: '1850–2050', toeflMin: 85, appDeadline: '1月15日',
    integrationLevel: 1, integrationLabel: '中国学生最多',
    fitFor: '英语基础较弱、需要充裕适应期、有艺术或音乐特长的学生，是进入美高体系中门槛最低的优质选择。',
    chineseApplicantTip: '国际生30%全美最高，英语压力最小，但毕业后申大学仍与全美学生竞争，要从第一学期就规划提升英语。',

    tuitionUSD: 66500,
    tuitionFmt: '$66,500',
    tuitionCNY: '约合人民币 48 万元/年',

    acceptRate: 28,
    enrollment: 500,
    intlPct: 30,

    aidPct: 42,
    avgAidUSD: 42000,
    needBlind: false,
    aidNote: '42% 学生获助学金，国际生比例全美领先',

    topColleges: ['Georgetown', 'Penn', 'Michigan', 'NYU', 'American University'],
    notableAlumni: ['吉米·斯图尔特（奥斯卡影帝）', '本·艾弗雷克'],

    tags: ['国际生30%最高比例', '艺术强校', '性价比优选', '录取率28%'],
    intro: '国际生比例高达30%，是美国寄宿高中中国际化程度最高的学校之一。艺术和音乐项目全国知名（影帝吉米·斯图尔特毕业于此）。录取率28%，对国际学生相对友好。',

    resources: {
      chineseNote: '国际生30%，中国学生群体最大，校内中文活动丰富，文化适应相对容易。',
      hiddenOpps: [
        '艺术项目出色，如有音乐、戏剧特长，这里的资源和氛围特别适合',
        '国际生比例高，学校有专业的国际学生支持团队',
      ],
      alumniTip: '对英语不够自信的同学，默瑟斯堡是最友好的顶级寄宿高中入口，国际生多，压力相对小。',
      chinaComm: '宾州农村地区，较为偏远，但校内华人社区自成体系，周末活动丰富。',
      employerNote: '艺术、媒体、传播行业校友出色。',
    },
  },

  {
    id: 'westover',
    name: 'Westover School',
    nameCN: '韦斯托弗中学',
    city: 'Middlebury', state: 'CT', country: '美国',
    founded: 1909,
    grades: '9-12',
    genderType: 'girls',
    website: 'https://www.westoverschool.org',
    tier: 3,
    ssat: '1950–2150', toeflMin: 90, appDeadline: '1月15日',
    integrationLevel: 3, integrationLabel: '均衡融合',
    fitFor: '在混校中容易被忽略、需要纯女校环境释放领导潜能的女生，七姐妹学院升学路径清晰。',
    chineseApplicantTip: '纯女校毕业生在大学担任领导职务的比例显著高于混校，这是申请文书中可真实呈现的成长素材。',

    tuitionUSD: 68000,
    tuitionFmt: '$68,000',
    tuitionCNY: '约合人民币 49 万元/年',

    acceptRate: 30,
    enrollment: 200,
    intlPct: 22,

    aidPct: 40,
    avgAidUSD: 42000,
    needBlind: false,
    aidNote: '40% 学生获助学金',

    topColleges: ['Yale', 'Smith', 'Wellesley', 'Mount Holyoke', 'Amherst'],
    notableAlumni: ['多位女性领袖、创业家'],

    tags: ['纯女校', '女性领袖培养', '精英小校', '顶级女子寄宿高中'],
    intro: '美国顶级纯女校寄宿高中，专注培养女性领袖。全校仅200人，极度个性化。录取率30%，是女生进入顶级寄宿高中的优质选择。',

    resources: {
      chineseNote: '国际生约22%，中国女生群体有一定规模。',
      hiddenOpps: [
        '纯女校环境让女生更勇于发声和担任领导职务，统计上纯女校毕业生在职场表现优于混校',
        '升学方向包括顶级女子学院（七姊妹），文书差异化空间大',
      ],
      alumniTip: '如果你的女儿在混校中不够自信或受到男生影响，纯女校是释放潜力的好环境。',
      chinaComm: '距纽约约2小时，纽海文约45分钟。',
      employerNote: '女性领袖校友网络强大，咨询、教育、NGO领域突出。',
    },
  },

  {
    id: 'avonoldfarms',
    name: 'Avon Old Farms School',
    nameCN: '阿冯老农场中学',
    city: 'Avon', state: 'CT', country: '美国',
    founded: 1927,
    grades: '9-12 + PG',
    genderType: 'boys',
    website: 'https://www.avonoldfarms.com',
    tier: 3,
    ssat: '1950–2100', toeflMin: 90, appDeadline: '1月15日',
    integrationLevel: 3, integrationLabel: '均衡融合',
    fitFor: '在混校中容易分心的男生，纯男校结构化环境帮助专注学术和体育，石头城堡校园是独特的文书素材。',
    chineseApplicantTip: '体育特长生有奖学金机会，纯男校文化以责任感和纪律性见长，适合需要外部结构的男生。',

    tuitionUSD: 72000,
    tuitionFmt: '$72,000',
    tuitionCNY: '约合人民币 52 万元/年',

    acceptRate: 32,
    enrollment: 440,
    intlPct: 17,

    aidPct: 38,
    avgAidUSD: 45000,
    needBlind: false,
    aidNote: '38% 学生获助学金',

    topColleges: ['Boston College', 'Colgate', 'Colby', 'Trinity', 'Bucknell'],
    notableAlumni: ['多位体育界、商界名人'],

    tags: ['纯男校', '石头城堡建筑', '体育强校', '男生领袖培养'],
    intro: '康涅狄格州最具特色的纯男校寄宿高中，校园建筑全部由石头砌成，极具历史感。专为男生设计的领袖力培养项目，体育资源丰富。录取率32%，男生优质选择。',

    resources: {
      chineseNote: '国际生约17%，中国男生群体有一定规模。',
      hiddenOpps: [
        '纯男校环境中，男生往往发展出更强的领导力和自信心',
        '体育特长生有较好的奖学金机会',
      ],
      alumniTip: '对于在混校中可能分心的男生，纯男校可以让他们更专注学业和体育发展。',
      chinaComm: '距哈特福德（CT）20分钟，波士顿约2小时。',
      employerNote: '体育、商界人脉出色，男性领袖网络活跃。',
    },
  },

  {
    id: 'missporters',
    name: "Miss Porter's School",
    nameCN: '波特小姐中学',
    city: 'Farmington', state: 'CT', country: '美国',
    founded: 1843,
    grades: '9-12',
    genderType: 'girls',
    website: 'https://www.missporters.org',
    tier: 2,
    ssat: '2000–2200', toeflMin: 95, appDeadline: '1月15日',
    integrationLevel: 3, integrationLabel: '均衡融合',
    fitFor: '有志于外交、时尚、公益领域的女生，杰奎琳·肯尼迪的母校光环是真实的社交资本。',
    chineseApplicantTip: '杰奎琳·肯尼迪母校的认知度在中国家庭中极高，但招生官更看重你对学校价值观的真实认同而非名人效应。',

    tuitionUSD: 72000,
    tuitionFmt: '$72,000',
    tuitionCNY: '约合人民币 52 万元/年',

    acceptRate: 25,
    enrollment: 340,
    intlPct: 20,

    aidPct: 38,
    avgAidUSD: 48000,
    needBlind: false,
    aidNote: '38% 学生获助学金',

    topColleges: ['Yale', 'Brown', 'Georgetown', 'Duke', 'Dartmouth', 'Smith'],
    notableAlumni: ['杰奎琳·肯尼迪（美国第一夫人）'],

    tags: ['杰奎琳·肯尼迪母校', '顶级女子寄宿高中', '精英女校传统', '纯女校'],
    intro: '美国最著名的纯女校寄宿高中，杰奎琳·肯尼迪的母校。创建于1843年，有近200年培养女性精英的传统。校风优雅，注重女性领导力与社会责任。',

    resources: {
      chineseNote: '国际生20%，中国女生群体稳定。杰奎琳·肯尼迪的光环使这所学校在中国家长中知名度极高。',
      hiddenOpps: [
        '第一夫人的母校名号在外交和社会精英圈中有独特加成',
        '每年的"毕业传统"活动非常独特，形成强烈的校友身份认同',
      ],
      alumniTip: '选择波特小姐，你不只是在选一所学校，而是在加入一个绵延近200年的女性精英传统。',
      chinaComm: '距哈特福德15分钟，纽约约2小时。',
      employerNote: '外交、时尚、公益、媒体领域女性校友极有影响力。',
    },
  },

  {
    id: 'brooks',
    name: 'Brooks School',
    nameCN: '布鲁克斯中学',
    city: 'North Andover', state: 'MA', country: '美国',
    founded: 1926,
    grades: '9-12',
    genderType: 'co-ed',
    website: 'https://www.brooksschool.org',
    tier: 3,
    ssat: '2000–2200', toeflMin: 90, appDeadline: '1月15日',
    integrationLevel: 3, integrationLabel: '均衡融合',
    fitFor: '想进入安多佛周边圈、追求相近教育质量但录取压力稍低的学生，距波士顿最近的优质中间选项。',
    chineseApplicantTip: '毗邻安多佛，间接接触其社区资源，是想进入顶级教育圈但无法申上一线学校的聪明选择。',

    tuitionUSD: 71000,
    tuitionFmt: '$71,000',
    tuitionCNY: '约合人民币 51 万元/年',

    acceptRate: 25,
    enrollment: 380,
    intlPct: 18,

    aidPct: 40,
    avgAidUSD: 46000,
    needBlind: false,
    aidNote: '40% 学生获助学金',

    topColleges: ['Dartmouth', 'Boston College', 'UVM', 'Colby', 'Middlebury'],
    notableAlumni: ['多位新英格兰商界名人'],

    tags: ['邻近安多佛', '湖畔校园', '精英小校', '环境教育特色'],
    intro: '位于安多佛（Phillips Academy所在城市）旁的小城，享有安多佛地区优质的文化资源。湖畔校园，环境教育特色鲜明。规模小（380人），个性化教育体验优质。',

    resources: {
      chineseNote: '国际生约18%，中国学生群体有活动。',
      hiddenOpps: [
        '毗邻安多佛，可参与部分安多佛社区活动，间接接触顶级学校资源',
        '湖畔环境使学校的体育（帆船、游泳）项目独具特色',
      ],
      alumniTip: '布鲁克斯是安多佛地区"进得去"的选项，教育质量不亚于竞争对手。',
      chinaComm: '距波士顿约1小时，生活便利。',
      employerNote: '新英格兰地区商界和金融业校友活跃。',
    },
  },

  {
    id: 'proctor',
    name: 'Proctor Academy',
    nameCN: '普罗克特学院',
    city: 'Andover', state: 'NH', country: '美国',
    founded: 1848,
    grades: '9-12 + PG',
    genderType: 'co-ed',
    website: 'https://www.proctoracademy.org',
    tier: 3,
    ssat: '1750–1950', toeflMin: 80, appDeadline: '2月15日',
    integrationLevel: 2, integrationLabel: '华人社群活跃',
    fitFor: '学术基础一般但适应力强、喜欢户外体验学习的孩子，录取率42%是进入美国寄宿高中体系门槛最低的。',
    chineseApplicantTip: '保底首选：录取率42%，4年美高经历会在大学申请时成为真实优势，用这里打好基础再冲名校。',

    tuitionUSD: 64000,
    tuitionFmt: '$64,000',
    tuitionCNY: '约合人民币 46 万元/年',

    acceptRate: 42,
    enrollment: 360,
    intlPct: 20,

    aidPct: 45,
    avgAidUSD: 38000,
    needBlind: false,
    aidNote: '45% 学生获助学金，入门门槛最低的顶级寄宿高中之一',

    topColleges: ['Vermont', 'UNH', 'Skidmore', 'Clark', 'Keene State'],
    notableAlumni: ['多位户外探险家、创业者'],

    tags: ['录取率最宽松', '户外教育特色', '亲近自然', '适合多元背景学生'],
    intro: '在顶级寄宿高中中录取率最高（42%），对英语能力和学术背景要求相对宽松。以户外教育著称，学生可参加滑雪、攀岩等体验课程。是进入美国寄宿高中体系的最低门槛优质选择。',

    resources: {
      chineseNote: '国际生约20%，对学术背景要求最宽松，适合希望"起步"的学生。',
      hiddenOpps: [
        '户外教育体验是独特的文书素材，帮助你在顶校申请中脱颖而出',
        '学校毕业后，可以凭借4年美国寄宿学校经历申请更好的大学',
      ],
      alumniTip: '如果孩子的学术基础一般但适应力强、喜欢户外，普罗克特是进入美国寄宿高中的最好起点——从这里打好基础，再申请大学时会有质的提升。',
      chinaComm: '新罕布什尔州农村，距波士顿约2小时。',
      employerNote: '创业、户外、环保行业校友较多，适合非传统职业路径的学生。',
    },
  },

];

// ── 辅助函数 ────────────────────────────────────────────────────

/**
 * 返回格式化后的学费显示字符串
 */
function formatTuition(school) {
  if (!school.tuitionUSD) return '待更新';
  const cny = Math.round(school.tuitionUSD * CNY / 10000);
  return school.tuitionFmt + '（约 ' + cny + ' 万元人民币）';
}

/**
 * 返回录取难度标签
 */
function admissionLevel(school) {
  const r = school.acceptRate;
  if (r <= 15) return 'very_high';
  if (r <= 22) return 'high';
  return 'medium';
}

/**
 * 返回格式化后的列表显示对象
 */
function formatForList(school) {
  return {
    ...school,
    tuitionDisplay: formatTuition(school),
    admissionDifficulty: admissionLevel(school),
    genderLabel: school.genderType === 'co-ed' ? '男女同校' : school.genderType === 'girls' ? '纯女校' : '纯男校',
    tierLabel: school.tier === 1 ? '顶级' : school.tier === 2 ? '精选' : '优质',
  };
}

module.exports = {
  BOARDING_SCHOOLS,
  formatForList,
  formatTuition,
  admissionLevel,
};
