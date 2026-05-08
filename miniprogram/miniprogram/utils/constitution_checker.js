// utils/constitution_checker.js
// 袁希™ — 系统宪法输出守卫 v1
// ─────────────────────────────────────────────────────────────────────
// 职责：在 AI 生成文本展示给用户之前，扫描6类宪法违规并修正
// 调用位置：_onAnalysisComplete(cd, analysisText) 中，展示前执行
// 输出：{ text: string, violations: string[], patched: boolean }
// ─────────────────────────────────────────────────────────────────────

// ══ 6类宪法违规检测规则 ═══════════════════════════════════════════════
// 每条规则：{ id, name, test(text), patch(text) }
// test → 返回 true 表示存在违规
// patch → 对文本进行最小侵入式修正，返回修正后字符串

const CONSTITUTION_RULES = [

  // ── 规则1：终局判断（禁止出现"适合/不适合"的直接定论）────────────
  {
    id:   'no_terminal_verdict',
    name: '禁止终局判断',
    test(text) {
      // 检测"你孩子适合出国" / "最适合国内" / "不适合留学" 等终局表述
      return /孩子(非常|很|最|比较|确实|更|挺)?适合(出国|留学|国内高考|读国际学校|高考|海外)/
          .test(text)
        || /不适合(出国|留学|高考|海外|国际学校)/.test(text);
    },
    patch(text) {
      // 将"适合"替换为"在当前条件下更倾向于"
      return text
        .replace(/(孩子)(非常|很|最|比较|确实|更|挺)?(适合)(出国|留学|国内高考|读国际学校|高考|海外)/g,
          '$1在当前条件下$3$4')
        .replace(/不适合(出国|留学|高考|海外|国际学校)/g,
          '在当前条件下选择$1需要先解决几个关键约束');
    },
  },

  // ── 规则2：模板式三步计划（禁止"第一步/第二步/第三步"结构）─────────
  {
    id:   'no_template_steps',
    name: '禁止模板化步骤',
    test(text) {
      // 检测连续出现 第一步...第二步 或 1.xxx 2.xxx 3.xxx
      return /(第一步|第一，|Step 1|1\.)[\s\S]{0,200}(第二步|第二，|Step 2|2\.)/.test(text);
    },
    patch(text) {
      // 不直接改内容，但追加宪法级别警示（因为内容改动风险太高）
      // 在文本末尾追加"以下为阶段性参考方向"替代原始"步骤"框架
      if (!text.includes('以下方向供参考')) {
        text = text + '\n\n（以上为阶段性参考方向，具体行动需结合孩子实际进展动态调整，而非固定执行步骤。）';
      }
      return text;
    },
  },

  // ── 规则3：遗漏关键约束（预算/语言/家庭接受度未提及即下结论）──────
  {
    id:   'must_show_constraints',
    name: '必须提及关键约束',
    test(text) {
      // 如果文本超过200字且推荐了出国路径，但完全没提到预算/费用/语言/英语
      const hasOverseasRec = /出国|留学|海外|境外学校|国际学校/.test(text);
      const hasConstraints = /预算|费用|万元|语言|英语|家庭接受|家长/.test(text);
      return hasOverseasRec && !hasConstraints && text.length > 200;
    },
    patch(text) {
      return text + '\n\n注：以上路径判断已假设预算、语言准备和家庭支持等条件具备。如任一条件存在差距，路径优先级需相应调整。';
    },
  },

  // ── 规则4：过度乐观（"一定/肯定/必然成功/没问题"等绝对化表述）──────
  {
    id:   'no_overconfidence',
    name: '禁止过度乐观承诺',
    test(text) {
      return /一定(能|会|可以|没问题|成功)|(肯定|必然|100%)(能|会|成功|顺利)|没有任何问题/.test(text);
    },
    patch(text) {
      return text
        .replace(/一定(能|会|可以|没问题|成功)/g, '在条件具备时可以$1')
        .replace(/(肯定|必然|100%)(能|会|成功|顺利)/g, '有较大概率$2')
        .replace(/没有任何问题/g, '目前暂无明显阻碍');
    },
  },

  // ── 规则5：贴标签（"你孩子是...型/类孩子"等人格定性）──────────────
  {
    id:   'no_labeling',
    name: '禁止人格/类型标签',
    test(text) {
      return /孩子是(典型的|标准的|明显的|那种|一个)([\u4e00-\u9fa5]{2,6}型|[\u4e00-\u9fa5]{2,6}类)/.test(text)
          || /属于(典型|标准|明显)(的)?([\u4e00-\u9fa5]{2,6}型|[\u4e00-\u9fa5]{2,6}孩子)/.test(text);
    },
    patch(text) {
      return text
        .replace(/孩子是(典型的|标准的|明显的|那种|一个)([\u4e00-\u9fa5]{2,6}型|[\u4e00-\u9fa5]{2,6}类)/g,
          '孩子目前的表现中有$2的倾向')
        .replace(/属于(典型|标准|明显)(的)?([\u4e00-\u9fa5]{2,6}型|[\u4e00-\u9fa5]{2,6}孩子)/g,
          '在当前阶段表现出$3的特征');
    },
  },

  // ── 规则6：独立输出缺失（报告不包含任何不确定性/限制条件声明）──────
  {
    id:   'must_include_uncertainty',
    name: '必须包含不确定性声明',
    test(text) {
      // 如果文本超过300字但完全没有"根据目前信息/当前阶段/有待验证/建议"等限定词
      const hasHedge = /根据目前|当前阶段|有待验证|建议|可以考虑|需要进一步|参考方向|仅供参考/.test(text);
      return !hasHedge && text.length > 300;
    },
    patch(text) {
      // 在第一个换行处后插入限定声明
      const insertPos = text.indexOf('\n\n');
      if (insertPos > -1) {
        return text.slice(0, insertPos)
          + '\n\n（以下分析基于本次对话收集的信息，供参考方向判断，非最终结论。）\n\n'
          + text.slice(insertPos + 2);
      }
      return '（以下分析基于本次对话收集的信息，供参考方向判断，非最终结论。）\n\n' + text;
    },
  },
];

// ══ 主函数：checkAndPatch(text) ═══════════════════════════════════════
// 输入：AI生成的原始报告文本
// 输出：{ text: string, violations: string[], patched: boolean }
function checkAndPatch(text) {
  if (!text) return { text: '', violations: [], patched: false };

  let result    = text;
  const violations = [];
  let patched   = false;

  for (const rule of CONSTITUTION_RULES) {
    try {
      if (rule.test(result)) {
        violations.push(rule.id);
        const after = rule.patch(result);
        if (after !== result) {
          result  = after;
          patched = true;
        }
      }
    } catch (e) {
      console.warn('[constitution_checker] rule error:', rule.id, e);
    }
  }

  return { text: result, violations, patched };
}

// ══ 记录违规到 cd（供 case_log 消费）═══════════════════════════════
function recordConstitutionViolations(cd, violations) {
  if (!cd || !violations || violations.length === 0) return;
  cd._constitutionViolations = violations;
}

module.exports = { checkAndPatch, recordConstitutionViolations, CONSTITUTION_RULES };
