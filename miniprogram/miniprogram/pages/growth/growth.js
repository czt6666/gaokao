// pages/growth/growth.js
// 收藏 · 已收藏的美国大学

Page({
  data: {
    favSchools: [],   // 已收藏的学校完整数据（存 storage）
  },

  onLoad() {
    this._loadFavs();
  },

  onShow() {
    // 每次切回来刷新（可能在浏览页刚收藏了新学校）
    this._loadFavs();
  },

  _loadFavs() {
    const favSchools = wx.getStorageSync('favSchools') || [];
    this.setData({ favSchools });
  },

  // 点击学校卡片 → 详情页
  viewSchool(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const school = this.data.favSchools.find(s => String(s.unitId) === String(id));
    wx.navigateTo({
      url: `/pages/school-detail/school-detail?apiUnit=${id}&apiName=${encodeURIComponent(school ? school.name : '')}`,
    });
  },

  // 从收藏列表中移除
  removeFav(e) {
    const unitId = e.currentTarget.dataset.unitid;
    wx.showModal({
      title: '取消收藏',
      content: '确认取消收藏这所学校？',
      confirmColor: '#FF3B30',
      success: (res) => {
        if (!res.confirm) return;
        const favSchools = this.data.favSchools.filter(
          s => String(s.unitId) !== String(unitId)
        );
        wx.setStorageSync('favSchools', favSchools);
        this.setData({ favSchools });
        wx.showToast({ title: '已取消收藏', icon: 'none', duration: 1200 });
      },
    });
  },

  // 清空全部收藏
  confirmClearAll() {
    if (this.data.favSchools.length === 0) return;
    wx.showModal({
      title: '清空收藏',
      content: `确认清空全部 ${this.data.favSchools.length} 所收藏院校？`,
      confirmColor: '#FF3B30',
      success: (res) => {
        if (!res.confirm) return;
        wx.setStorageSync('favSchools', []);
        this.setData({ favSchools: [] });
        wx.showToast({ title: '已清空收藏', icon: 'none', duration: 1200 });
      },
    });
  },

  // 去浏览页
  goBrowse() {
    wx.navigateTo({ url: '/pages/schools/schools' });
  },
});
