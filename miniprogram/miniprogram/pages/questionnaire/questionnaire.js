// pages/questionnaire/questionnaire.js — 评估问卷页
const { QUESTIONS, PARTS, FREQUENCY_OPTIONS } = require('../../utils/questions');

Page({
  data: {
    // 问卷状态
    currentIndex: 0,          // 当前题目索引
    totalCount: 0,            // 总题目数
    progress: 0,              // 进度百分比 0-100
    currentQuestion: null,    // 当前题目对象
    answers: {},              // 所有答案 { key: value }

    // UI 状态
    inputValue: '',           // 文本/数字输入框的值
    selectedValue: null,      // 单选题选中的值
    frequencyValue: null,     // 频率题选中的值
    frequencyOptions: [],     // 频率选项列表

    // 部分信息
    currentPart: 1,
    currentPartTitle: '',
    parts: [],

    // 提交状态
    isSubmitting: false,
    showPartTransition: false,  // 切换到新部分时显示过渡动画
    transitionPartTitle: '',
    transitionMessage: '',      // 每个题组切换时的温暖过渡语
  },

  // 每个部分对应的过渡提示语（减少问卷感，增加对话感）
  _TRANSITION_MESSAGES: {
    '多元智能评估': '了解了基本情况，接下来我们聊聊孩子真正擅长什么',
    '思维模式观察': '很好，现在来看看孩子思考问题的独特方式',
    '家庭背景': '快过半了！背景信息帮助我们给出更精准的建议',
    '目标与期望': '最后一组，聊聊你们对未来的期待',
  },

  onLoad() {
    this.setData({
      totalCount: QUESTIONS.length,
      frequencyOptions: FREQUENCY_OPTIONS,
      parts: PARTS,
    });
    this._loadQuestion(0);
  },

  // ── 加载指定题目 ──
  _loadQuestion(index) {
    if (index >= QUESTIONS.length) {
      // 已经是最后一题，直接提交
      this._submitAssessment();
      return;
    }

    const q = QUESTIONS[index];
    const progress = Math.round((index / QUESTIONS.length) * 100);
    const existingAnswer = this.data.answers[q.key];

    // 检查是否切换了部分
    const prevPart = index > 0 ? QUESTIONS[index - 1].part : q.part;
    const partChanged = (q.part !== prevPart) && index > 0;

    if (partChanged) {
      // 显示部分切换动画（含温暖过渡语）
      const msg = this._TRANSITION_MESSAGES[q.partTitle] || '继续，你做得很好';
      this.setData({
        showPartTransition: true,
        transitionPartTitle: q.partTitle,
        transitionMessage: msg,
      });
      setTimeout(() => {
        this.setData({ showPartTransition: false });
        this._setQuestionData(q, index, progress, existingAnswer);
      }, 1800);
    } else {
      this._setQuestionData(q, index, progress, existingAnswer);
    }
  },

  _setQuestionData(q, index, progress, existingAnswer) {
    this.setData({
      currentIndex: index,
      currentQuestion: q,
      progress,
      currentPart: q.part,
      currentPartTitle: q.partTitle,
      // 重置输入状态
      inputValue: (q.type === 'input' || q.type === 'number') && existingAnswer
        ? String(existingAnswer) : '',
      selectedValue: (q.type === 'choice') && existingAnswer ? existingAnswer : null,
      frequencyValue: (q.type === 'frequency') && existingAnswer ? existingAnswer : null,
    });
  },

  // ── 输入框变化 ──
  onInputChange(e) {
    this.setData({ inputValue: e.detail.value });
  },

  // ── 单选题点击 ──
  onChoiceSelect(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ selectedValue: value });
    // 单选题自动跳下一题（延迟300ms让用户看到选中效果）
    setTimeout(() => this._saveAndNext(), 300);
  },

  // ── 频率题点击 ──
  onFrequencySelect(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ frequencyValue: value });
    setTimeout(() => this._saveAndNext(), 300);
  },

  // ── 下一题按钮（input/number类型用） ──
  onNext() {
    const q = this.data.currentQuestion;
    // 基本验证
    if (q.type === 'input' || q.type === 'number') {
      if (!this.data.inputValue.trim()) {
        wx.showToast({ title: '请填写此项', icon: 'none' });
        return;
      }
    }
    this._saveAndNext();
  },

  // ── 上一题 ──
  onPrev() {
    const idx = this.data.currentIndex;
    if (idx > 0) {
      this._loadQuestion(idx - 1);
    }
  },

  // ── 保存当前答案并跳到下一题 ──
  _saveAndNext() {
    const q = this.data.currentQuestion;
    const answers = { ...this.data.answers };

    // 根据题型取值
    if (q.type === 'input') {
      answers[q.key] = this.data.inputValue.trim();
    } else if (q.type === 'number') {
      answers[q.key] = Number(this.data.inputValue);
    } else if (q.type === 'choice') {
      answers[q.key] = this.data.selectedValue;
    } else if (q.type === 'frequency') {
      answers[q.key] = this.data.frequencyValue;
    }

    this.setData({ answers });

    const nextIndex = this.data.currentIndex + 1;
    if (nextIndex >= QUESTIONS.length) {
      // 最后一题答完
      this._submitAssessment();
    } else {
      this._loadQuestion(nextIndex);
    }
  },

  // ── 提交问卷，跳转结果页 ──
  _submitAssessment() {
    if (this.data.isSubmitting) return;
    this.setData({ isSubmitting: true });

    const answers = this.data.answers;

    // 计算多元智能评分
    const miScores = this._calcMIScores(answers);

    // 计算成长型思维评分
    const mindsetScore = this._calcMindsetScore(answers);

    // 打包评估数据
    const assessmentData = {
      answers,
      miScores,
      mindsetScore,
      childName: answers.childName || '孩子',
      childAge: answers.childAge || 0,
      schoolStage: answers.schoolStage,
      timestamp: Date.now(),
    };

    // 存入本地缓存
    wx.setStorageSync('assessmentData', assessmentData);

    // 跳转到生成报告页
    wx.navigateTo({
      url: '/pages/result/result',
      success: () => {
        this.setData({ isSubmitting: false });
      },
      fail: () => {
        this.setData({ isSubmitting: false });
        wx.showToast({ title: '跳转失败，请重试', icon: 'none' });
      }
    });
  },

  // ── 多元智能计算 ──
  _calcMIScores(answers) {
    const mi = {
      linguistic:     this._avg([answers.mi_linguistic_1, answers.mi_linguistic_2]),
      logical:        this._avg([answers.mi_logical_1, answers.mi_logical_2]),
      spatial:        this._avg([answers.mi_spatial_1, answers.mi_spatial_2]),
      musical:        this._avg([answers.mi_musical_1]),
      bodily:         this._avg([answers.mi_bodily_1]),
      interpersonal:  this._avg([answers.mi_interpersonal_1]),
      intrapersonal:  this._avg([answers.mi_intrapersonal_1]),
      naturalist:     this._avg([answers.mi_naturalist_1]),
    };
    return mi;
  },

  _avg(vals) {
    const valid = vals.filter(v => v !== undefined && v !== null);
    if (!valid.length) return 0;
    return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10;
  },

  // ── 成长型思维计算 ──
  _calcMindsetScore(answers) {
    const freqKeys = ['mindset_persistence', 'mindset_learning_from_others', 'mindset_feedback'];
    const freqAvg = this._avg(freqKeys.map(k => answers[k]));

    // challenge_response 转分值
    const challengeMap = { excited: 4, cautious: 3, anxious: 2, avoids: 1 };
    const challengeScore = challengeMap[answers.mindset_challenge_response] || 2;

    return Math.round(((freqAvg * 3 + challengeScore) / 4) * 10) / 10;
  },
});
