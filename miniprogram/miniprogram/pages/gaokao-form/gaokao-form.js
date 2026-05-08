// pages/gaokao-form/gaokao-form.js
// 艺圆智探 · 我的志愿表

const FORM_KEY = 'gaokao_form_v3';

function probColor(prob) {
  if (prob === null || prob === undefined) return '#8E8E93';
  if (prob >= 0.7) return '#059669';
  if (prob >= 0.4) return '#C9922A';
  return '#DC2626';
}

function probText(prob) {
  if (prob === null || prob === undefined) return '—';
  return Math.round(prob * 100) + '%';
}

function probPct(prob) {
  if (!prob) return 0;
  return Math.min(100, Math.round(prob * 100));
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} 添加`;
  } catch (e) {
    return '';
  }
}

const ACTION_CLASS = { '冲': 'rush', '稳': 'stable', '保': 'safe' };

function enrichItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, idx) => {
    const prob = item.probability;
    return {
      ...item,
      _idx: idx,
      _probColor: probColor(prob),
      _probText: probText(prob),
      _probPct: probPct(prob),
      _dateStr: formatDate(item.addedAt),
      _actionClass: ACTION_CLASS[item.action] || 'stable',
    };
  });
}

function loadRaw() {
  try {
    return JSON.parse(wx.getStorageSync(FORM_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function saveRaw(list) {
  try {
    wx.setStorageSync(FORM_KEY, JSON.stringify(list));
  } catch (e) {}
}

Page({
  data: {
    list: [],
  },

  onLoad() {
    this._refresh();
  },

  onShow() {
    this._refresh();
  },

  _refresh() {
    const raw = loadRaw();
    this.setData({ list: enrichItems(raw) });
  },

  // 删除指定项
  deleteItem(e) {
    const index = Number(e.currentTarget.dataset.index);
    wx.showModal({
      title: '删除志愿',
      content: `确定删除第 ${index + 1} 志愿？`,
      confirmText: '删除',
      confirmColor: '#DC2626',
      success: (res) => {
        if (!res.confirm) return;
        const raw = loadRaw();
        raw.splice(index, 1);
        saveRaw(raw);
        this._refresh();
        wx.showToast({ title: '已删除', icon: 'none' });
      },
    });
  },

  // 上移
  moveUp(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index <= 0) return;
    const raw = loadRaw();
    const tmp = raw[index];
    raw[index] = raw[index - 1];
    raw[index - 1] = tmp;
    saveRaw(raw);
    this._refresh();
  },

  // 下移
  moveDown(e) {
    const index = Number(e.currentTarget.dataset.index);
    const raw = loadRaw();
    if (index >= raw.length - 1) return;
    const tmp = raw[index];
    raw[index] = raw[index + 1];
    raw[index + 1] = tmp;
    saveRaw(raw);
    this._refresh();
  },

  // 空状态：跳转到志愿查询
  goQuery() {
    wx.switchTab({ url: '/pages/gaokao/gaokao' });
  },
});
