// pages/admin-detail/admin-detail.js — 袁希™ 家庭档案详情
// 袁希咨询前的背景浏览页：读懂这个家庭，开场第一句就切中要害

Page({
  data: {
    loading: true,
    assessment: null,

    // 展示辅助
    MI_LABELS: {
      linguistic:'语言智能', logical:'逻辑数学', spatial:'空间视觉',
      musical:'音乐节奏', bodily:'身体运动', interpersonal:'人际交往',
      intrapersonal:'自我认知', naturalist:'自然探索',
    },
    stageMap: { primary:'小学', middle:'初中', high:'高中', preschool:'学前' },
    engMap: { weak:'薄弱', basic:'日常交流', good:'流畅表达', native:'接近母语' },
    acadMap: { low:'中下游', mid:'中等', upper_mid:'中上游', top:'年级前10%' },
    pathIconMap: {
      abroad_high:'✈️', abroad_uni:'🌏', hybrid:'🔄', gaokao:'📚',
    },
    schoolTypeMap: { public:'公立', private:'私立', bilingual:'双语', international:'国际学校' },
    stageColorMap: {
      new:'#1B3A6B', contacted:'#C49A22', consulting:'#2A7A5A',
      converted:'#5B3A8B', closed:'#9CA3AF',
    },
    stageLabelMap: {
      new:'新线索', contacted:'已联系', consulting:'咨询中',
      converted:'已成交', closed:'已关闭',
    },
    consensusLabelMap: { aligned:'对齐', diverged:'分歧', neutral:'模糊', 模糊:'模糊' },
    readTierLabelMap: { shallow:'浅读', moderate:'细读', deep:'深度阅读' },

    // 意向星级（加载后计算）
    intentStars: '★☆☆☆☆',

    // 备注编辑
    editingNote: false,
    noteInput: '',

    // 阶段切换菜单
    showStageMenu: false,
    stageOptions: [
      { key: 'new',        label: '新线索',  color: '#1B3A6B' },
      { key: 'contacted',  label: '已联系',  color: '#C49A22' },
      { key: 'consulting', label: '咨询中',  color: '#2A7A5A' },
      { key: 'converted',  label: '已成交',  color: '#5B3A8B' },
      { key: 'closed',     label: '已关闭',  color: '#9CA3AF' },
    ],

    // 家长问卷原文展开
    expandedAnswers: false,

    // 父问题映射（用于展示中文题目）
    parentQKeys: {
      home_rules_response:      '孩子对规定有异议时，您如何回应？',
      home_mistake_handling:    '孩子犯错时您如何处理？',
      home_rituals:             '有哪些固定家庭仪式或习惯？',
      comm_topics:              '孩子主动来找您聊什么？',
      comm_openness:            '孩子对您的开放程度如何？',
      comm_emotion_reading:     '您如何判断孩子的情绪状态？',
      personality_self_awareness: '孩子如何看待自己的优势和不足？',
      personality_pressure:     '遇到压力时孩子的表现如何？',
      personality_uniqueness:   '孩子与同龄人最不一样的特质是？',
      academic_strengths:       '学业上孩子擅长和不擅长什么？',
      academic_motivation:      '孩子的学习驱动力来自哪里？',
      academic_attitude:        '孩子对待学习的整体态度？',
      emotion_stress_response:  '面对压力或挫折时孩子如何应对？',
      emotion_regulation:       '孩子的情绪调节能力如何？',
      social_peer:              '孩子与同学/朋友的相处模式？',
      social_adult:             '孩子与成年人（老师等）的互动方式？',
      autonomy_self_manage:     '孩子的自我管理能力如何？',
      autonomy_decision:        '在自主决策方面孩子的表现？',
      interest_passion:         '孩子最深入持续的兴趣是什么？',
      interest_discovery:       '这个兴趣是如何被发现的？',
      family_parent_child_state:'您如何描述目前的亲子关系状态？',
      family_dynamic:           '家庭决策方式和家庭氛围？',
      values_ideal_person:      '您心目中理想的孩子未来状态？',
      values_future_alignment:  '孩子和您在未来方向上的一致程度？',
      reflection_hope:          '您对这次评估的期望是什么？',
    },
  },

  onLoad(options) {
    const docId = options.id;
    if (!docId) {
      wx.showToast({ title: '参数缺失', icon: 'none' });
      return;
    }
    this._loadDetail(docId);
  },

  onPullDownRefresh() {
    const a = this.data.assessment;
    if (a?._id) this._loadDetail(a._id);
    wx.stopPullDownRefresh();
  },

  _loadDetail(docId) {
    const code = wx.getStorageSync('adminVerified');
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'getAssessments',
      data: { adminCode: code, mode: 'detail', docId },
      success: (res) => {
        if (res.result?.success) {
          const a = res.result.assessment;
          // ── 计算意向度星级 ──────────────────────────────
          const bh = a.behavior || {};
          const visitCount = bh.visitCount || 1;
          let intentScore = 0;
          if (bh.ctaTapped)                    intentScore += 2;
          if (visitCount >= 3)                  intentScore += 2;
          else if (visitCount >= 2)             intentScore += 1;
          if (bh.readTier === 'deep')           intentScore += 2;
          else if (bh.readTier === 'moderate')  intentScore += 1;
          if (bh.aiChatStarted)                 intentScore += 1;
          if (bh.shareGenerated)                intentScore += 1;
          if (a.hasParentAnswers)               intentScore += 1;
          const intentStars = intentScore >= 7 ? '★★★★★'
                            : intentScore >= 5 ? '★★★★☆'
                            : intentScore >= 3 ? '★★★☆☆'
                            : intentScore >= 1 ? '★★☆☆☆'
                            : '★☆☆☆☆';
          this.setData({
            loading: false,
            assessment: a,
            noteInput: a.adminNote || '',
            intentStars,
          });
        } else {
          this.setData({ loading: false });
          wx.showToast({ title: '加载失败', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      },
    });
  },

  // ── 备注编辑 ──────────────────────────────────────────────────
  toggleEditNote() {
    this.setData({ editingNote: !this.data.editingNote });
  },

  onNoteInput(e) {
    this.setData({ noteInput: e.detail.value });
  },

  saveNote() {
    const code = wx.getStorageSync('adminVerified');
    const docId = this.data.assessment?._id;
    const note = this.data.noteInput;
    if (!docId) return;

    wx.cloud.callFunction({
      name: 'updateAssessmentNote',
      data: { adminCode: code, docId, note },
      success: (res) => {
        if (res.result?.success) {
          const a = { ...this.data.assessment, adminNote: note };
          this.setData({ assessment: a, editingNote: false });
          wx.showToast({ title: '已保存', icon: 'success' });
        }
      },
      fail: () => wx.showToast({ title: '保存失败', icon: 'none' }),
    });
  },

  // ── 阶段切换 ──────────────────────────────────────────────────
  toggleStageMenu() {
    this.setData({ showStageMenu: !this.data.showStageMenu });
  },

  setStage(e) {
    const stage = e.currentTarget.dataset.key;
    const code = wx.getStorageSync('adminVerified');
    const docId = this.data.assessment?._id;
    if (!docId) return;

    wx.cloud.callFunction({
      name: 'updateAssessmentNote',
      data: { adminCode: code, docId, adminStage: stage },
      success: (res) => {
        if (res.result?.success) {
          const a = { ...this.data.assessment, adminStage: stage };
          this.setData({ assessment: a, showStageMenu: false });
        }
      },
      fail: () => wx.showToast({ title: '更新失败', icon: 'none' }),
    });
  },

  // ── 家长原文展开 ──────────────────────────────────────────────
  toggleAnswers() {
    this.setData({ expandedAnswers: !this.data.expandedAnswers });
  },

  // ── 复制联系信息到剪贴板 ──────────────────────────────────────
  copyInfo() {
    const a = this.data.assessment;
    if (!a) return;
    const text = [
      `姓名：${a.childName}`,
      `年龄：${a.childAge}岁`,
      `学段：${this.data.stageMap[a.schoolStage] || a.schoolStage}`,
      `英语：${this.data.engMap[a.englishLevel] || '未填'}`,
      `学业：${this.data.acadMap[a.academicTier] || '未填'}`,
      `适配度：${a.overallScore}分`,
      `推荐路径：${a.primaryPathLabel}`,
      `AI盲区：${a.aiInsight?.blindspot || '未分析'}`,
      `备注：${a.adminNote || '无'}`,
    ].join('\n');
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '已复制', icon: 'success' }) });
  },
});
