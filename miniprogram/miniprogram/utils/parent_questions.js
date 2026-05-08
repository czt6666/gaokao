// utils/parent_questions.js — 家长评估问卷题目库
// 全开放式主观题，供家长自由作答
// 11个维度，24道题

const PARENT_PARTS = [
  { id: 1, title: '家庭环境与教养方式', icon: '🏠' },
  { id: 2, title: '亲子沟通与情感连接', icon: '💬' },
  { id: 3, title: '孩子的性格与自我认知', icon: '🌱' },
  { id: 4, title: '学业表现与学习动力', icon: '📚' },
  { id: 5, title: '情绪管理与心理健康', icon: '🌊' },
  { id: 6, title: '社会交往与人际发展', icon: '🤝' },
  { id: 7, title: '自主性与自我管理',   icon: '⚙️' },
  { id: 8, title: '兴趣爱好与潜力方向', icon: '✨' },
  { id: 9, title: '家庭关系系统',       icon: '🔗' },
  { id: 10, title: '价值观与未来方向',  icon: '🧭' },
  { id: 11, title: '开放反思',          icon: '🪞' },
];

const PARENT_QUESTIONS = [

  // ─── 第一部分：家庭环境与教养方式 ───
  {
    id: 'pq_01',
    part: 1,
    partTitle: '家庭环境与教养方式',
    key: 'home_rules_response',
    question: '当孩子对家里的规定或要求有异议时，您通常是怎么回应的？',
  },
  {
    id: 'pq_02',
    part: 1,
    partTitle: '家庭环境与教养方式',
    key: 'home_mistake_handling',
    question: '孩子犯错时，您一般会怎么处理？能描述一个具体的场景吗？',
  },
  {
    id: 'pq_03',
    part: 1,
    partTitle: '家庭环境与教养方式',
    key: 'home_rituals',
    question: '您和孩子之间，有哪些固定的家庭仪式或生活习惯？',
  },

  // ─── 第二部分：亲子沟通与情感连接 ───
  {
    id: 'pq_04',
    part: 2,
    partTitle: '亲子沟通与情感连接',
    key: 'comm_topics',
    question: '孩子通常会主动来找您聊什么？',
  },
  {
    id: 'pq_05',
    part: 2,
    partTitle: '亲子沟通与情感连接',
    key: 'comm_openness',
    question: '在什么情况下，孩子愿意向您说出心里话？',
  },
  {
    id: 'pq_06',
    part: 2,
    partTitle: '亲子沟通与情感连接',
    key: 'comm_emotion_reading',
    question: '您通常通过什么来判断孩子今天的情绪状态？',
  },

  // ─── 第三部分：孩子的性格与自我认知 ───
  {
    id: 'pq_07',
    part: 3,
    partTitle: '孩子的性格与自我认知',
    key: 'personality_traits',
    question: '在您的观察中，孩子最突出的性格特点是什么？',
  },
  {
    id: 'pq_08',
    part: 3,
    partTitle: '孩子的性格与自我认知',
    key: 'personality_self_awareness',
    question: '您认为孩子对自己的认识是否准确？他/她在哪些方面高估或低估了自己？',
  },

  // ─── 第四部分：学业表现与学习动力 ───
  {
    id: 'pq_09',
    part: 4,
    partTitle: '学业表现与学习动力',
    key: 'academic_motivation',
    question: '孩子对学习的热情和主动性是什么状态？',
  },
  {
    id: 'pq_10',
    part: 4,
    partTitle: '学业表现与学习动力',
    key: 'academic_potential_gap',
    question: '您觉得孩子现在的学业表现，与他/她真实的能力相比，是否有落差？',
  },

  // ─── 第五部分：情绪管理与心理健康 ───
  {
    id: 'pq_11',
    part: 5,
    partTitle: '情绪管理与心理健康',
    key: 'emotion_stress_response',
    question: '孩子遇到挫折或压力时，通常是什么反应？',
  },
  {
    id: 'pq_12',
    part: 5,
    partTitle: '情绪管理与心理健康',
    key: 'emotion_concerns',
    question: '您观察到孩子在情绪或心理方面，有哪些让您留意或担心的地方？',
  },

  // ─── 第六部分：社会交往与人际发展 ───
  {
    id: 'pq_13',
    part: 6,
    partTitle: '社会交往与人际发展',
    key: 'social_peer_relations',
    question: '孩子和同学的关系大致是什么状态？',
  },
  {
    id: 'pq_14',
    part: 6,
    partTitle: '社会交往与人际发展',
    key: 'social_conflict_handling',
    question: '孩子遇到人际冲突时，通常是怎么应对的？',
  },

  // ─── 第七部分：自主性与自我管理 ───
  {
    id: 'pq_15',
    part: 7,
    partTitle: '自主性与自我管理',
    key: 'autonomy_self_manage',
    question: '孩子在生活和学习上，自我管理的情况怎么样？',
  },
  {
    id: 'pq_16',
    part: 7,
    partTitle: '自主性与自我管理',
    key: 'autonomy_supervision',
    question: '您通常需要在哪些方面对孩子进行额外的督促和提醒？',
  },

  // ─── 第八部分：兴趣爱好与潜力方向 ───
  {
    id: 'pq_17',
    part: 8,
    partTitle: '兴趣爱好与潜力方向',
    key: 'interest_passion',
    question: '孩子最投入、最享受的事情是什么？',
  },
  {
    id: 'pq_18',
    part: 8,
    partTitle: '兴趣爱好与潜力方向',
    key: 'interest_potential',
    question: '在您看来，孩子最有潜力发展的方向是哪些？',
  },

  // ─── 第九部分：家庭关系系统 ───
  {
    id: 'pq_19',
    part: 9,
    partTitle: '家庭关系系统',
    key: 'family_parent_child_state',
    question: '您感觉您和孩子的关系目前处于什么状态？',
  },
  {
    id: 'pq_20',
    part: 9,
    partTitle: '家庭关系系统',
    key: 'family_major_events',
    question: '家庭中近期是否有对孩子产生影响的重要变化或事件？',
  },

  // ─── 第十部分：价值观与未来方向 ───
  {
    id: 'pq_21',
    part: 10,
    partTitle: '价值观与未来方向',
    key: 'values_ideal_person',
    question: '您希望孩子成长为什么样的人？',
  },
  {
    id: 'pq_22',
    part: 10,
    partTitle: '价值观与未来方向',
    key: 'values_future_alignment',
    question: '对于孩子的未来，您和孩子的想法是否一致？有哪些分歧？',
  },

  // ─── 第十一部分：开放反思 ───
  {
    id: 'pq_23',
    part: 11,
    partTitle: '开放反思',
    key: 'reflection_self',
    question: '作为家长，您觉得自己在哪些方面还有改进的空间？',
  },
  {
    id: 'pq_24',
    part: 11,
    partTitle: '开放反思',
    key: 'reflection_hope',
    question: '通过这次评估，您最希望了解孩子的什么？',
  },

];

module.exports = { PARENT_QUESTIONS, PARENT_PARTS };
