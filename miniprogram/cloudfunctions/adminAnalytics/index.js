// cloudfunctions/adminAnalytics/index.js
// 袁希™ · 智能问卷自学习分析引擎
// ═══════════════════════════════════════════════════════════════
//  聚合所有历史评估数据，生成：
//   1. 问题健康度（每道题的回答质量分布）
//   2. 灵魂进化建议（哪些问题需要优化和原因）
//   3. 智能分布（最常见的多元智能组合）
//   4. 路径分布（家长最倾向的教育路径）
//   5. 综合灵魂健康分（问卷整体效能评分）
// ═══════════════════════════════════════════════════════════════

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const ADMIN_CODE = process.env.ADMIN_CODE || 'wangzi@YX2024';

// 问题标签（对应 FLOW 里的 id）
const Q_LABELS = {
  // ── 多元智能评估题 ──
  q_linguistic:          '语言表达（自由时间做什么）',
  q_logical:             '逻辑推理（搞不明白时的反应）',
  q_spatial:             '空间想象（进入状态的事物）',
  q_musical:             '音乐节奏（音乐感知）',
  q_bodily:              '身体运动（协调能力）',
  q_interpersonal:       '人际交往（同龄群体角色）',
  q_intrapersonal:       '自我认知（坚持判断）',
  q_naturalist:          '探索钻研（钻进去的状态）',
  q_mindset:             '成长型思维（挫折处理方式）',
  // ── 目标规划题 ──
  q_goal_at_25:          '25岁理想状态',
  q_school_type:         '就读学校类型',
  q_education_path:      '教育路径偏好',
  q_english_level:       '英语水平',
  q_academic_tier:       '学术成绩档位',
  q_education_budget:    '家庭教育预算',
  q_subject_interest:    '学科兴趣方向（RIASEC）',
  q_geography:           '目标国家/地区',
  // ── 家长问卷 ──
  q_parent_uniqueness:   '家长视角—孩子特质',
  q_parent_future:       '家长视角—理想未来',
  q_parent_convo:        '家长视角—亲子话题',
  q_parent_relationship: '家长视角—亲子关系',
  q_parent_hope:         '家长视角—评测期望',
};

const MI_LABELS = {
  linguistic: '语言智能', logical: '逻辑数学', spatial: '空间视觉',
  musical: '音乐节奏', bodily: '身体运动', interpersonal: '人际交往',
  intrapersonal: '自我认知', naturalist: '自然探索',
};

const PATH_LABELS = {
  gaokao:               '高考国内路线',
  highschool_abroad:    '高中出国',
  university_abroad:    '大学出国',
  international_school: '国际学校',
  undecided:            '未定',
};

const SUBJECT_LABELS = {
  stem:           'STEM理工',
  natural_science:'自然生命科学',
  business:       '商科创业',
  humanities:     '人文社科',
  arts_design:    '艺术创意',
  communication:  '传播表达',
  undecided:      '未定/探索中',
};

const GEO_LABELS = {
  us:           '🇺🇸 美国',
  uk:           '🇬🇧 英国',
  canada:       '🇨🇦 加拿大',
  au_nz:        '🇦🇺 澳洲/新西兰',
  asia_pacific: '🌏 新加坡/香港/日本',
  europe:       '🇪🇺 欧洲大陆',
  cn_only:      '🇨🇳 国内为主',
  open:         '完全开放',
};

exports.main = async (event, context) => {
  if (event.adminCode !== ADMIN_CODE) {
    return { success: false, error: '无权限' };
  }

  try {
    // ── 1. 获取所有评估（最多 100 条，cloud DB 单次上限）──────────
    const countRes = await db.collection('assessments').count();
    const total = countRes.total;

    if (total === 0) {
      return {
        success: true,
        data: {
          totalSessions: 0,
          soulHealthScore: 0,
          soulHealthLabel: '暂无数据',
          questionHealth: [],
          evolutionSuggestions: [],
          miDistribution: [],
          pathDistribution: [],
          subjectDistribution: [],
          geoDistribution: [],
        },
      };
    }

    const limit = Math.min(total, 100);
    const res = await db.collection('assessments')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const docs = res.data;
    const n = docs.length;

    // ── 2. 问题健康度聚合 ──────────────────────────────────────────
    // 每道题的核心信号：质量分布、追问触发率、追问成功率、平均答案长度
    const qStats = {};

    docs.forEach(doc => {
      // 兼容两种字段名（qualityLog 是新格式，老数据可能没有）
      const ql = doc.questionLog || doc.qualityLog;
      if (!Array.isArray(ql) || ql.length === 0) return;

      ql.forEach(entry => {
        const qId = entry.qId;
        if (!qId) return;

        if (!qStats[qId]) {
          qStats[qId] = {
            total: 0,
            q0: 0, q1: 0, q2: 0, q3: 0,   // 质量分布
            probed: 0,                        // 触发追问次数
            probeSuccess: 0,                  // 追问后质量提升次数
            totalFirstLen: 0,
            totalFinalLen: 0,
          };
        }

        const s = qStats[qId];
        s.total++;

        const firstQ  = entry.firstQuality  ?? 2;
        const finalQ  = entry.finalQuality  ?? firstQ;

        // 记录首次质量分布（反映问题本身的引导效果）
        if      (firstQ === 0) s.q0++;
        else if (firstQ === 1) s.q1++;
        else if (firstQ === 2) s.q2++;
        else if (firstQ === 3) s.q3++;

        if (entry.probed) {
          s.probed++;
          if (finalQ > firstQ) s.probeSuccess++; // 追问后质量确实提升了
        }

        s.totalFirstLen += entry.firstLen || entry.firstAnswer?.length || 0;
        s.totalFinalLen += entry.finalLen  || entry.finalAnswer?.length || entry.firstLen || 0;
      });
    });

    // 计算健康分 + 生成进化建议
    const questionHealth = Object.entries(qStats).map(([qId, s]) => {
      const avgQ         = (s.q0 * 0 + s.q1 * 1 + s.q2 * 2 + s.q3 * 3) / s.total;
      const probeRate    = s.probed      / s.total;
      const depthRate    = s.q3          / s.total;
      const shallowRate  = (s.q0 + s.q1) / s.total;
      const probeSuccRate = s.probed > 0 ? s.probeSuccess / s.probed : 1;
      const avgFirstLen  = Math.round(s.totalFirstLen / s.total);
      const avgFinalLen  = Math.round(s.totalFinalLen / s.total);

      // ── 综合健康分（满分 100）──────────────────────────────
      // 平均质量占 60 分（最高3分 → 60分），追问率占 20 分（越低越好），深度率占 20 分
      let healthScore = avgQ * 20 + (1 - probeRate) * 20 + depthRate * 20;
      healthScore = Math.round(Math.min(100, Math.max(0, healthScore)));

      const healthLevel =
        healthScore >= 75 ? '优'     :
        healthScore >= 55 ? '良'     :
        healthScore >= 35 ? '待提升' : '问题较大';

      const healthColor =
        healthScore >= 75 ? '#34C759' :
        healthScore >= 55 ? '#FFD60A' :
        healthScore >= 35 ? '#FF9F0A' : '#FF3B30';

      // ── 进化建议（诊断 → 症状 → 药方）─────────────────────
      let suggestion = null;
      let urgency    = 'none';
      let issueLabel = '';

      if (s.total >= 5) { // 至少5条数据才建议
        if (shallowRate > 0.55) {
          urgency    = 'critical';
          issueLabel = `${Math.round(shallowRate * 100)}% 的回答质量低`;
          suggestion = `超过半数家长给出敷衍或简略回答。这道题可能太抽象——试着加入时间锚点（"上次"、"最近"）或具体情境词，让家长有画面感可以描述。`;
        } else if (probeRate > 0.50) {
          urgency    = 'moderate';
          issueLabel = `${Math.round(probeRate * 100)}% 需要追问`;
          suggestion = `超过一半的家长需要二次引导才能给出合格回答。问题本身可能让人感到不知从何说起，考虑在题目中内嵌一个具体角度，例如"比如上周有没有……"。`;
        } else if (depthRate < 0.08 && s.total >= 10) {
          urgency    = 'moderate';
          issueLabel = `深度回答只有 ${Math.round(depthRate * 100)}%`;
          suggestion = `几乎没有家长给出真正有深度的回答。可以在问题末尾加一句："不用说"很好"或"很差"——说一个你亲眼观察到的具体场景就好"，降低门槛、提升真实性。`;
        } else if (probeSuccRate < 0.25 && s.probed >= 5) {
          urgency    = 'moderate';
          issueLabel = `追问成功率 ${Math.round(probeSuccRate * 100)}%`;
          suggestion = `当前追问策略效果差——即使追问，质量也没有提升。追问的切入角度需要换一个方向，目前的追问可能还是太宽泛。`;
        }
      }

      return {
        qId,
        label:           Q_LABELS[qId] || qId,
        total:           s.total,
        avgQuality:      Math.round(avgQ * 10) / 10,
        avgQualityBar:   Math.round(avgQ / 3 * 100),  // 0-100 供进度条渲染
        probeRate:       Math.round(probeRate    * 100),
        depthRate:       Math.round(depthRate    * 100),
        shallowRate:     Math.round(shallowRate  * 100),
        probeSuccRate:   Math.round(probeSuccRate * 100),
        avgFirstLen,
        avgFinalLen,
        healthScore,
        healthLevel,
        healthColor,
        dist: { q0: s.q0, q1: s.q1, q2: s.q2, q3: s.q3 },
        suggestion,
        issueLabel,
        urgency,
      };
    })
    .filter(q => q.total > 0)
    .sort((a, b) => a.healthScore - b.healthScore); // 最需改进的排前面

    // ── 3. 多元智能分布 ────────────────────────────────────────────
    const miStats = {};
    Object.keys(MI_LABELS).forEach(k => { miStats[k] = { sum: 0, count: 0, topCount: 0 }; });

    docs.forEach(doc => {
      const scores = doc.miScores || {};
      const validEntries = Object.entries(scores)
        .filter(([k, v]) => MI_LABELS[k] && v != null && !isNaN(v));

      if (validEntries.length === 0) return;

      validEntries.forEach(([k, v]) => {
        const rawScore = v <= 1 ? v * 5 : v;  // 归一化 0-1 → 1-5
        miStats[k].sum   += rawScore;
        miStats[k].count++;
      });

      // 标记该用户最高智能
      const topEntry = validEntries.reduce((max, curr) => curr[1] > max[1] ? curr : max, validEntries[0]);
      if (topEntry && miStats[topEntry[0]]) {
        miStats[topEntry[0]].topCount++;
      }
    });

    const miDistribution = Object.entries(miStats)
      .map(([key, s]) => ({
        key,
        label:     MI_LABELS[key],
        avgScore:  s.count > 0 ? Math.round(s.sum / s.count * 10) / 10 : 0,
        avgScoreBar: s.count > 0 ? Math.round(s.sum / s.count / 5 * 100) : 0,
        topCount:  s.topCount,
        topPct:    n > 0 ? Math.round(s.topCount / n * 100) : 0,
      }))
      .sort((a, b) => b.avgScore - a.avgScore);

    // ── 4. 教育路径分布 ───────────────────────────────────────────
    const pathCounts = {};
    docs.forEach(doc => {
      const path =
        doc.educationPath ||
        doc.childAnswers?.education_path_preference ||
        doc.answers?.education_path_preference ||
        'undecided';
      pathCounts[path] = (pathCounts[path] || 0) + 1;
    });

    const pathDistribution = Object.entries(pathCounts)
      .map(([path, count]) => ({
        path,
        label: PATH_LABELS[path] || path,
        count,
        pct: Math.round(count / n * 100),
      }))
      .sort((a, b) => b.count - a.count);

    // ── 4b. 学科兴趣分布 ─────────────────────────────────────────
    const subjectCounts = {};
    docs.forEach(doc => {
      const subj =
        doc.subjectInterest ||
        doc.childAnswers?.subject_interest ||
        'undecided';
      subjectCounts[subj] = (subjectCounts[subj] || 0) + 1;
    });

    const subjectDistribution = Object.entries(subjectCounts)
      .map(([key, count]) => ({
        key,
        label: SUBJECT_LABELS[key] || key,
        count,
        pct: Math.round(count / n * 100),
      }))
      .sort((a, b) => b.count - a.count);

    // ── 4c. 目标国家分布 ──────────────────────────────────────────
    const geoCounts = {};
    docs.forEach(doc => {
      const geo =
        doc.geoPreference ||
        doc.childAnswers?.geo_preference ||
        'open';
      geoCounts[geo] = (geoCounts[geo] || 0) + 1;
    });

    const geoDistribution = Object.entries(geoCounts)
      .map(([key, count]) => ({
        key,
        label: GEO_LABELS[key] || key,
        count,
        pct: Math.round(count / n * 100),
      }))
      .sort((a, b) => b.count - a.count);

    // ── 5. 总分分布 ──────────────────────────────────────────────
    const allScores = docs.map(d => d.overallScore).filter(s => s != null && s > 0 && s <= 100);
    const scoreStats = allScores.length > 0 ? {
      avg:  Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length),
      min:  Math.min(...allScores),
      max:  Math.max(...allScores),
      dist: {
        under50: allScores.filter(s => s < 50).length,
        s50_65:  allScores.filter(s => s >= 50 && s < 65).length,
        s65_80:  allScores.filter(s => s >= 65 && s < 80).length,
        over80:  allScores.filter(s => s >= 80).length,
      },
    } : null;

    // ── 6. 参与度分布 ─────────────────────────────────────────────
    let engHigh = 0, engMid = 0, engLow = 0;
    docs.forEach(doc => {
      const avg = doc.avgAnswerDepth;
      if      (avg >= 2.2) engHigh++;
      else if (avg >= 1.3) engMid++;
      else if (avg != null) engLow++;
    });

    // ── 7. 灵魂健康综合分 ─────────────────────────────────────────
    // 核心公式：问题平均健康分 - 严重问题惩罚 - 中度问题惩罚
    const criticalCount  = questionHealth.filter(q => q.urgency === 'critical').length;
    const moderateCount  = questionHealth.filter(q => q.urgency === 'moderate').length;
    const avgQHealth     = questionHealth.length > 0
      ? questionHealth.reduce((s, q) => s + q.healthScore, 0) / questionHealth.length
      : 70;

    let soulHealthScore = Math.round(avgQHealth - criticalCount * 12 - moderateCount * 4);
    soulHealthScore = Math.max(0, Math.min(100, soulHealthScore));

    const soulHealthLabel =
      soulHealthScore >= 80 ? '灵魂活跃'  :
      soulHealthScore >= 60 ? '状态良好'  :
      soulHealthScore >= 40 ? '需要调整'  : '亟需进化';

    const soulHealthColor =
      soulHealthScore >= 80 ? '#34C759' :
      soulHealthScore >= 60 ? '#FFD60A' :
      soulHealthScore >= 40 ? '#FF9F0A' : '#FF3B30';

    // 进化建议清单（排序：严重→中度→轻微）
    const evolutionSuggestions = questionHealth
      .filter(q => q.urgency !== 'none' && q.suggestion)
      .sort((a, b) => {
        const order = { critical: 0, moderate: 1, minor: 2, none: 3 };
        return (order[a.urgency] || 3) - (order[b.urgency] || 3);
      })
      .slice(0, 6);

    // 完成率：完成了家长部分的用户占比
    const completedParent = docs.filter(d =>
      d.hasParentAnswers || (d.parentAnswerCount && d.parentAnswerCount >= 2)
    ).length;

    return {
      success: true,
      data: {
        totalSessions:   n,
        analyzedAt:      new Date().toISOString(),
        completionRate:  Math.round(completedParent / n * 100),

        soulHealthScore,
        soulHealthLabel,
        soulHealthColor,
        criticalIssues:  criticalCount,
        moderateIssues:  moderateCount,

        questionHealth,
        evolutionSuggestions,
        miDistribution,
        pathDistribution,
        subjectDistribution,
        geoDistribution,
        scoreStats,

        engagementDistribution: {
          high:    engHigh,
          mid:     engMid,
          low:     engLow,
          total:   engHigh + engMid + engLow,
          highPct: (engHigh + engMid + engLow) > 0 ? Math.round(engHigh / (engHigh + engMid + engLow) * 100) : 0,
          midPct:  (engHigh + engMid + engLow) > 0 ? Math.round(engMid  / (engHigh + engMid + engLow) * 100) : 0,
          lowPct:  (engHigh + engMid + engLow) > 0 ? Math.round(engLow  / (engHigh + engMid + engLow) * 100) : 0,
        },
      },
    };

  } catch (err) {
    console.error('[adminAnalytics]', err);
    return { success: false, error: err.message };
  }
};
