// pages/my-reports/my-reports.js
// 艺圆智探 · 我的报告 — 历史付费查询记录
// v3 — 双保险：localStorage + 云端，任意一个有数据都能显示

// 读取 localStorage 本地备份报告列表
function _readLocalReports() {
  try {
    return JSON.parse(wx.getStorageSync('local_reports') || '[]');
  } catch (e) {
    return [];
  }
}

// 将原始报告对象格式化为列表项
function _formatReport(r, i) {
  var ts      = r.createdAt ? new Date(r.createdAt) : null;
  var dateStr = ts
    ? (ts.getFullYear() + '/' + (ts.getMonth() + 1) + '/' + ts.getDate())
    : '未知日期';
  return {
    _id:          r._id        || '',
    orderNo:      r.orderNo    || '',
    rank:         r.rank       || 0,
    province:     r.province   || '',
    subject:      r.subject    || '不限',
    examMode:     r.examMode   || '',
    constraints:  r.constraints || {},
    totalMatched: r.totalMatched || 0,
    surgeCount:   r.surgeCount   || 0,
    stableCount:  r.stableCount  || 0,
    safeCount:    r.safeCount    || 0,
    gemsCount:    r.gemsCount    || 0,
    dateStr:      dateStr,
    idx:          i,
  };
}

// 合并云端+本地列表，以 orderNo 去重，orderNo 相同保留云端版本
function _mergeReports(cloudList, localList) {
  var seen = {};
  var result = [];
  cloudList.forEach(function(r) {
    if (r.orderNo) seen[r.orderNo] = true;
    result.push(r);
  });
  localList.forEach(function(r) {
    if (!r.orderNo || !seen[r.orderNo]) {
      result.push(r);
    }
  });
  // 按 createdAt 降序
  result.sort(function(a, b) {
    var ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    var tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
  return result;
}

Page({
  data: {
    reports:        [],
    loading:        true,
    empty:          false,
    downloadingIdx: -1,
  },

  onLoad: function() {
    this._loadReports();
  },

  onShow: function() {
    this._loadReports();
  },

  // 云端 + 本地双源加载报告列表
  _loadReports: function() {
    var self = this;
    self.setData({ loading: true });

    // 先立即展示本地数据（零延迟）
    var localRaw  = _readLocalReports();
    if (localRaw.length > 0) {
      var localFmt = localRaw.map(_formatReport);
      self.setData({ reports: localFmt, loading: false, empty: false });
    }

    // 再拉取云端数据并合并
    wx.cloud.callFunction({
      name: 'gaokaoQuery',
      data: { type: 'getReports' },
      success: function(res) {
        var cloudRaw = (res.result && res.result.data) || [];
        var merged   = _mergeReports(cloudRaw, localRaw);
        var reports  = merged.map(_formatReport);
        self.setData({ reports: reports, loading: false, empty: reports.length === 0 });
      },
      fail: function(err) {
        console.error('[my-reports] getReports fail:', err);
        // 云端失败时仍用本地数据
        if (localRaw.length === 0) {
          self.setData({ loading: false, empty: true });
          wx.showToast({ title: '网络异常，请重试', icon: 'none' });
        } else {
          self.setData({ loading: false });
        }
      },
    });
  },

  // 查看报告详情（跳回结果页，触发实时重拉完整数据）
  viewReport: function(e) {
    var idx    = e.currentTarget.dataset.idx;
    var report = this.data.reports[idx];
    if (!report) return;

    var app = getApp();
    app.globalData = app.globalData || {};

    // 设置查询参数（携带约束参数）
    app.globalData.gaokaoQuery = {
      rank:        report.rank,
      province:    report.province,
      subject:     report.subject  || '',
      exam_mode:   report.examMode || '',
      constraints: report.constraints || {},
    };

    // 用空占位（is_paid: false），让结果页 onLoad 自动走 _reloadResults 拉取完整数据
    app.globalData.gaokaoResult = {
      surge: [], stable: [], safe: [], hidden_gems: [],
      total_matched: report.totalMatched || 0,
      is_paid: false,
    };

    // 恢复本地 order_no，结果页凭此触发付费验证
    if (report.orderNo) {
      try {
        var key = 'paid_' + report.province + '_' + report.rank + '_' + (report.subject || 'all');
        wx.setStorageSync(key, report.orderNo);
      } catch (e) {}
    }
    wx.navigateTo({ url: '/pages/gaokao-results/gaokao-results' });
  },

  // 下载 PDF（走云函数代理，与结果页逻辑统一）
  downloadPDF: function(e) {
    var idx    = e.currentTarget.dataset.idx;
    var report = this.data.reports[idx];
    if (!report) return;

    if (!report.orderNo) {
      wx.showToast({ title: '找不到订单，无法生成PDF', icon: 'none' });
      return;
    }
    if (this.data.downloadingIdx === idx) return; // 防止重复点击
    this.setData({ downloadingIdx: idx });

    this._tryDownloadPDF(report, idx);
  },

  _tryDownloadPDF: function(report, idx, retryCount) {
    var self  = this;
    var retry = retryCount || 0;
    wx.showLoading({ title: retry > 0 ? '重试中...' : '正在生成PDF报告...' });

    // 70 秒超时保护
    if (this._pdfTimer) { clearTimeout(this._pdfTimer); this._pdfTimer = null; }
    this._pdfTimer = setTimeout(function() {
      if (self.data.downloadingIdx === idx) {
        wx.hideLoading();
        self.setData({ downloadingIdx: -1 });
        if (retry < 1) {
          wx.showModal({
            title: '报告生成中',
            content: '首次生成需要较长时间，系统已在后台缓存。点击「重试」即可快速获取。',
            confirmText: '重试',
            cancelText: '稍后再试',
            success: function(r) {
              if (r.confirm) {
                self.setData({ downloadingIdx: idx });
                self._tryDownloadPDF(report, idx, retry + 1);
              }
            },
          });
        } else {
          wx.showToast({ title: '生成超时，请稍后重试', icon: 'none' });
        }
      }
    }, 70000);

    var payload = {
      type:     'fetchPDF',
      province: report.province || '',
      rank:     report.rank     || 0,
      subject:  report.subject  || '',
      order_no: report.orderNo,
    };
    var c = report.constraints || {};
    ['c_major', 'c_city', 'c_nature', 'c_tier'].forEach(function(k) {
      if (c[k]) payload[k] = c[k];
    });
    wx.cloud.callFunction({
      name: 'gaokaoQuery',
      data: payload,
      success: function(res) {
        wx.hideLoading();
        if (self._pdfTimer) { clearTimeout(self._pdfTimer); self._pdfTimer = null; }

        if (res.result && res.result.success && res.result.fileID) {
          wx.cloud.downloadFile({
            fileID: res.result.fileID,
            success: function(dlRes) {
              self.setData({ downloadingIdx: -1 });
              wx.showModal({
                title: '📄 PDF已生成',
                content: '报告已生成，点击打开后可直接查看。如需保存，请点击右上角「···」选择保存方式。',
                showCancel: false,
                confirmText: '打开报告',
                success: function() {
                  wx.openDocument({
                    filePath: dlRes.tempFilePath,
                    fileType: 'pdf',
                    showMenu: true,
                    fail: function() {
                      wx.showToast({ title: '无法打开PDF，请检查设备', icon: 'none' });
                    },
                  });
                },
              });
            },
            fail: function(err) {
              self.setData({ downloadingIdx: -1 });
              console.error('[my-reports] cloud download fail:', err);
              wx.showToast({ title: '下载失败，请重试', icon: 'none' });
            },
          });
        } else {
          var errMsg = (res.result && res.result.error) || 'PDF生成失败';

          // timeout → 自动重试（后端已缓存，重试通常秒出）
          if (errMsg.indexOf('timeout') !== -1 && retry < 1) {
            console.log('[my-reports] timeout, auto-retry #' + (retry + 1));
            self._tryDownloadPDF(report, idx, retry + 1);
            return;
          }

          self.setData({ downloadingIdx: -1 });
          if (errMsg.indexOf('支付核验') !== -1) {
            wx.showModal({
              title: '报告生成中',
              content: '支付正在核验中，请稍等片刻后再试。',
              showCancel: false,
              confirmText: '好的',
            });
          } else if (errMsg.indexOf('timeout') !== -1) {
            wx.showModal({
              title: '报告生成中',
              content: '报告内容较多，生成时间较长。请等待30秒后点击「重试」。',
              confirmText: '重试',
              cancelText: '稍后再试',
              success: function(r) {
                if (r.confirm) {
                  self.setData({ downloadingIdx: idx });
                  self._tryDownloadPDF(report, idx, retry + 1);
                }
              },
            });
          } else {
            wx.showToast({ title: errMsg, icon: 'none' });
          }
        }
      },
      fail: function(err) {
        wx.hideLoading();
        if (self._pdfTimer) { clearTimeout(self._pdfTimer); self._pdfTimer = null; }

        var errStr = (err && err.errMsg) || String(err);
        // 超时自动重试
        if ((errStr.indexOf('timeout') !== -1 || errStr.indexOf('time out') !== -1) && retry < 1) {
          self._tryDownloadPDF(report, idx, retry + 1);
          return;
        }

        self.setData({ downloadingIdx: -1 });
        console.error('[my-reports] fetchPDF fail:', err);
        if (errStr.indexOf('timeout') !== -1 || errStr.indexOf('time out') !== -1) {
          wx.showModal({
            title: '报告生成中',
            content: '报告正在后台生成，请等待约30秒后点击「重试」。',
            confirmText: '重试',
            cancelText: '稍后再试',
            success: function(r) {
              if (r.confirm) {
                self.setData({ downloadingIdx: idx });
                self._tryDownloadPDF(report, idx, retry + 1);
              }
            },
          });
        } else {
          wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
        }
      },
    });
  },

  onUnload: function() {
    if (this._pdfTimer) { clearTimeout(this._pdfTimer); this._pdfTimer = null; }
  },

  goBack: function() {
    wx.switchTab({ url: '/pages/gaokao/gaokao' });
  },
});
