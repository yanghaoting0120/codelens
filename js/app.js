/* ============================================================
   译码 CodeLens · 主逻辑
   布局（左释义 4 : 右代码 6，可拖拽）、编辑器高亮、释义渲染、
   行号联动、AI 增强调度
   ============================================================ */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const state = {
    lang: "python",
    code: "",
    hlResult: null,   // HL.render 缓存
    result: null,     // 最近一次离线解释结果
    aiSeq: 0,         // AI 请求序号（防乱序）
    timer: null,      // 输入防抖
    explainTimer: null,
  };

  const KIND_CLASS = {
    comment: "k-comment", output: "k-output", input: "k-output", var: "k-var",
    loop: "k-loop", cond: "k-cond", func: "k-func", class: "k-class",
    import: "k-import", html: "k-html", close: "k-html", selector: "k-var",
    prop: "k-var", media: "k-import", doc: "k-import", main: "k-func",
    block: "k-other", call: "k-other", return: "k-func", other: "k-other",
  };

  const LANG_FILE = {
    python: "main.py", php: "index.php", html: "index.html",
    css: "style.css", c: "main.c", cpp: "main.cpp",
  };
  const LANG_PLACEHOLDER = {
    python: "在这里输入 Python 代码，例如：print(&quot;你好，世界&quot;)",
    php: "在这里输入 PHP 代码，例如：&lt;?php echo &quot;你好&quot;; ?&gt;",
    html: "在这里输入 HTML 代码，例如：&lt;p&gt;你好&lt;/p&gt;",
    css: "在这里输入 CSS 代码，例如：body { color: red; }",
    c: "在这里输入 C 代码，例如：printf(&quot;你好&quot;);",
    cpp: "在这里输入 C++ 代码，例如：cout &lt;&lt; &quot;你好&quot;;",
  };

  const EMPTY_HTML =
    '<div class="empty-state">' +
    '<div class="empty-ico"><svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.2"/><line x1="15.2" y1="15.2" x2="20.5" y2="20.5"/><path d="M8 10.5h5"/><path d="M8 13.5h3"/></svg></div>' +
    "<h3>这里会“翻译”你的代码</h3>" +
    "<p>在右侧输入或粘贴任意代码，释义就会显示在这里：</p>" +
    "<ul><li><b>整体概览</b> —— 这段代码是干什么的</li>" +
    "<li><b>逐行讲解</b> —— 每一行在说什么</li>" +
    "<li><b>关键术语</b> —— 陌生词一看就懂</li></ul>" +
    '<button id="btnEmptySample" class="btn ghost">先看个示例 →</button>' +
    "</div>";

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function toast(msg, type) {
    const el = $("toast");
    el.textContent = msg;
    el.className = "toast" + (type ? " " + type : "");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add("hidden"), 3000);
  }

  /* ================= 编辑器 ================= */

  function renderEditor() {
    state.hlResult = HL.render(state.code, state.lang);

    // 行号层
    const gutter = state.hlResult.lines
      .map((l) => '<div class="g-line" data-no="' + l.no + '">' + l.no + "</div>")
      .join("");
    $("gutterLayer").innerHTML = gutter;

    // 高亮层
    const pre = state.hlResult.lines
      .map((l) => {
        const html = l.tokens.length ? HL.toHtml(l.tokens) : "&nbsp;";
        return '<div class="line" data-no="' + l.no + '">' + html + "</div>";
      })
      .join("");
    $("preLayer").innerHTML = pre;
  }

  function syncScroll() {
    const t = $("codeInput");
    $("preLayer").style.transform = "translate(" + (-t.scrollLeft) + "px," + (-t.scrollTop) + "px)";
    $("gutterLayer").style.transform = "translateY(" + (-t.scrollTop) + "px)";
  }

  function updateStat() {
    const lines = state.code ? state.code.split("\n").length : 0;
    const chars = state.code.length;
    $("footStat").textContent = lines + " 行 · " + chars + " 字符";
  }

  function setModeBadge(text, cls) {
    const el = $("footMode");
    el.textContent = text;
    el.className = "mode-badge" + (cls ? " " + cls : "");
  }

  /** 高亮并滚动到某一行 */
  function selectLine(no) {
    const preLine = $("preLayer").querySelector('.line[data-no="' + no + '"]');
    const gLine = $("gutterLayer").querySelector('.g-line[data-no="' + no + '"]');
    if (preLine) preLine.classList.add("hl");
    if (gLine) gLine.classList.add("hl");

    // 编辑器滚动到该行（居中）；行高随代码字号设置变化
    const lh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--code-lh")) || 24;
    const wrap = $("editorWrap");
    const lineTop = (no - 1) * lh + 16;
    const target = Math.max(0, lineTop - wrap.clientHeight / 2 + lh);
    const t = $("codeInput");
    t.scrollTop = target;
    syncScroll();

    // 释义面板滚动到对应条目并点亮
    const item = $("explainBody").querySelector('.line-item[data-no="' + no + '"]');
    if (item) {
      $("explainBody").querySelectorAll(".line-item.active").forEach((x) => x.classList.remove("active"));
      item.classList.add("active");
      const top = item.offsetTop - $("explainPanel").querySelector(".panel-head").offsetHeight - 12;
      $("explainBody").scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }

    clearTimeout(selectLine._t);
    selectLine._t = setTimeout(() => {
      if (preLine) preLine.classList.remove("hl");
      if (gLine) gLine.classList.remove("hl");
      if (item) item.classList.remove("active");
    }, 2000);
  }

  /* ================= 释义渲染 ================= */

  function statsChips(stats) {
    const items = [
      [stats.lines, "行代码"],
      [stats.funcs, "个函数"],
      [stats.classes, "个类"],
      [stats.loops, "处循环"],
      [stats.conds, "处判断"],
      [stats.vars, "处变量"],
      [stats.outputs, "处输出"],
      [stats.comments, "处注释"],
    ].filter(([v]) => v > 0);
    return items
      .map(([v, label]) => '<span class="stat-chip"><b>' + v + "</b>" + label + "</span>")
      .join("");
  }

  function lineCodeHtml(no) {
    const line = state.hlResult && state.hlResult.lines.find((l) => l.no === no);
    if (line && line.tokens.length) return HL.toHtml(line.tokens);
    const raw = (state.result && state.result.lines.find((l) => l.no === no) || { code: "" }).code;
    return '<span class="tok-plain">' + esc(raw || " ") + "</span>";
  }

  function renderExplain(result, mode) {
    const body = $("explainBody");
    if (!result || !result.lines || !result.lines.length) {
      body.innerHTML = EMPTY_HTML;
      $("explainMeta").textContent = "等待代码…";
      bindEmptySample();
      return;
    }
    const ov = result.overview;
    $("explainMeta").textContent = ov.langName + " · 共 " + result.lines.length + " 行讲解";

    let html = "";
    // AI 徽标
    if (mode === "ai") {
      html += '<div class="ai-note"><span class="spark"></span>AI 增强释义 · 讲解更口语化</div>';
    }
    // 概览卡
    html +=
      '<div class="x-card overview-card">' +
      '<div class="card-label">整体概览</div>' +
      '<div class="overview-title">' + esc(ov.title) + "</div>" +
      '<div class="overview-summary">' + esc(ov.summary) + "</div>" +
      '<div class="overview-stats">' + statsChips(ov.stats) + "</div>" +
      (ov.extra ? '<div class="overview-summary" style="margin-top:10px">' + esc(ov.extra) + "</div>" : "") +
      "</div>";

    // 逐行讲解
    html += '<div class="x-card"><div class="card-label">逐行讲解 <span style="text-transform:none;letter-spacing:0">（点击条目可定位到代码行）</span></div>';
    for (const line of result.lines) {
      const kindCls = KIND_CLASS[line.kind] || "k-other";
      html +=
        '<div class="line-item" data-no="' + line.no + '">' +
        '<div class="line-no">' + line.no + "</div>" +
        '<div class="line-main">' +
        '<span class="kind-badge ' + kindCls + '">' + esc(line.label || "语句") + "</span>" +
        '<div class="line-code">' + lineCodeHtml(line.no) + "</div>" +
        '<div class="line-explain">' + esc(line.explanation) + "</div>" +
        "</div></div>";
    }
    html += "</div>";

    // 术语
    if (result.terms && result.terms.length) {
      html += '<div class="x-card"><div class="card-label">关键术语</div>';
      for (const t of result.terms) {
        html +=
          '<div class="term-item"><div class="term-name">' + esc(t.name || t.term) + "</div>" +
          '<div class="term-meaning">' + esc(t.meaning) + "</div></div>";
      }
      html += "</div>";
    }

    body.innerHTML = html;
  }

  function bindEmptySample() {
    const btn = $("btnEmptySample");
    if (btn) btn.addEventListener("click", () => loadSample());
  }

  /* ================= 解释流程 ================= */

  function doExplain(opts) {
    opts = opts || {};
    const code = state.code;
    if (!code.trim()) {
      $("explainBody").innerHTML = EMPTY_HTML;
      $("explainMeta").textContent = "等待代码…";
      setModeBadge("内置引擎");
      bindEmptySample();
      return;
    }

    const langName = ENGINE.LANG_NAMES[state.lang];
    const local = ENGINE.explain(code, state.lang);
    state.result = local;

    const aiCfg = AI.loadConfig();
    const aiWanted = opts.forceAI ? true : (aiCfg.enabled && AI.isConfigured());
    if (!aiWanted) {
      renderExplain(local, "local");
      setModeBadge("内置引擎");
      return;
    }

    // 先展示本地结果，同时异步请求 AI
    renderExplain(local, "local");
    setModeBadge("AI 解释中…", "ai");
    $("explainBody").insertAdjacentHTML(
      "afterbegin",
      '<div class="loading-line"><span class="spinner"></span>AI 正在思考，稍等片刻…</div>'
    );

    const seq = ++state.aiSeq;
    AI.explain(code, langName)
      .then((aiResult) => {
        if (seq !== state.aiSeq) return; // 已有更新的请求
        const merged = mergeResults(local, aiResult);
        state.result = merged;
        renderExplain(merged, "ai");
        setModeBadge("AI 增强", "ai");
      })
      .catch((err) => {
        if (seq !== state.aiSeq) return;
        renderExplain(local, "local");
        setModeBadge("内置引擎");
        toast("AI 释义失败，已自动回退到内置引擎：" + (err.message || err), "error");
      });
  }

  /** 合并离线结果与 AI 结果：AI 优先，离线兜底 */
  function mergeResults(local, ai) {
    const merged = {
      overview: {
        title: (ai.overview && ai.overview.title) || local.overview.title,
        summary: (ai.overview && ai.overview.summary) || local.overview.summary,
        stats: local.overview.stats,
        extra: local.overview.extra,
        langName: local.overview.langName,
        intro: local.overview.intro,
      },
      lines: [],
      terms: [],
    };
    const aiByNo = {};
    for (const l of ai.lines) aiByNo[l.no] = l.explanation;
    for (const l of local.lines) {
      merged.lines.push({
        no: l.no,
        code: l.code,
        kind: l.kind,
        label: l.label,
        explanation: aiByNo[l.no] || l.explanation,
      });
    }
    const seen = new Set();
    for (const t of ai.terms) {
      if (!seen.has(t.term)) { merged.terms.push({ name: t.term, meaning: t.meaning }); seen.add(t.term); }
    }
    for (const t of local.terms) {
      if (!seen.has(t.name)) { merged.terms.push(t); seen.add(t.name); }
      if (merged.terms.length >= 12) break;
    }
    return merged;
  }

  /* ================= 输入流 ================= */

  function onInput() {
    state.code = $("codeInput").value;
    updateStat();
    clearTimeout(state.timer);
    clearTimeout(state.explainTimer);
    state.timer = setTimeout(renderEditor, 120);
    window.Preview.onCodeChange(state.code);
    if ($("autoExplain").checked) {
      state.explainTimer = setTimeout(() => doExplain(), 480);
    }
  }

  function setCode(text) {
    $("codeInput").value = text;
    state.code = text;
    updateStat();
    renderEditor();
    syncScroll();
    window.Preview.onCodeChange(text);
    doExplain();
  }

  /* ================= 语言与示例 ================= */

  function applyLang(lang) {
    state.lang = lang;
    $("fileName").textContent = LANG_FILE[lang];
    $("footLang").textContent = ENGINE.LANG_NAMES[lang];
    $("codeInput").placeholder = LANG_PLACEHOLDER[lang];
    window.Preview.setLang(lang);
    if (state.code.trim()) {
      renderEditor();
      doExplain();
    }
  }

  function loadSample() {
    const code = window.SAMPLES[state.lang];
    setCode(code);
    toast("已载入 " + ENGINE.LANG_NAMES[state.lang] + " 示例代码");
  }

  /* ================= 个性化设置（主题色 / 背景 / 字号 / 行为） ================= */

  const PREFS_KEY = "codelens_prefs_v1";
  const DEFAULT_PREFS = {
    accent: "cyan",
    bg: "night",
    codeSize: "m",
    uiSize: "m",
    autoExplain: true,
    autoRun: true,
  };

  const THEMES = {
    cyan:    { a: "#7aa7ff", a2: "#a78bfa", rgb: "122,167,255", rgb2: "167,139,250" },   // 柔光蓝紫（默认）
    violet:  { a: "#a78bfa", a2: "#e879f9", rgb: "167,139,250", rgb2: "232,121,249" },   // 紫罗兰
    emerald: { a: "#34d399", a2: "#22d3ee", rgb: "52,211,153",  rgb2: "34,211,238" },    // 翡翠绿
    blue:    { a: "#60a5fa", a2: "#818cf8", rgb: "96,165,250",  rgb2: "129,140,248" },   // 天蓝
    orange:  { a: "#fbbf24", a2: "#fb7185", rgb: "251,191,36",  rgb2: "251,113,133" },   // 落日橙
    pink:    { a: "#f472b6", a2: "#a78bfa", rgb: "244,114,182", rgb2: "167,139,250" },   // 樱花粉
    gold:    { a: "#fde68a", a2: "#f59e0b", rgb: "253,230,138", rgb2: "245,158,11" },    // 星光金
    teal:    { a: "#2dd4bf", a2: "#60a5fa", rgb: "45,212,191",  rgb2: "96,165,250" },    // 极光青
  };

  const BACKGROUNDS = {
    night: {
      bg0: "#070b1a", bg1: "#0d1430", bg2: "#0a1a2e",
      blob1: "rgba(90,140,255,0.50)", blob2: "rgba(150,110,255,0.45)",
      blob3: "rgba(56,189,248,0.26)", blob4: "rgba(244,114,182,0.20)",
    },
    nebula: {
      bg0: "#140a26", bg1: "#1c0f38", bg2: "#12081f",
      blob1: "rgba(167,139,250,0.50)", blob2: "rgba(232,121,249,0.36)",
      blob3: "rgba(96,165,250,0.32)", blob4: "rgba(167,139,250,0.24)",
    },
    forest: {
      bg0: "#071710", bg1: "#0d2419", bg2: "#091c13",
      blob1: "rgba(52,211,153,0.42)", blob2: "rgba(34,211,238,0.32)",
      blob3: "rgba(163,230,53,0.26)", blob4: "rgba(52,211,153,0.20)",
    },
    obsidian: {
      bg0: "#05070d", bg1: "#0a0e18", bg2: "#070a12",
      blob1: "rgba(148,163,184,0.30)", blob2: "rgba(100,116,139,0.25)",
      blob3: "rgba(148,163,184,0.18)", blob4: "rgba(100,116,139,0.15)",
    },
  };

  const CODE_SIZES = {
    s: { size: "11px", lh: "19px" },
    m: { size: "13.5px", lh: "24px" },
    l: { size: "16px", lh: "28px" },
  };

  const UI_SIZES = {
    s: "12px",
    m: "13px",
    l: "14.5px",
  };

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return Object.assign({}, DEFAULT_PREFS);
      return Object.assign({}, DEFAULT_PREFS, JSON.parse(raw));
    } catch (e) {
      return Object.assign({}, DEFAULT_PREFS);
    }
  }

  function savePrefs(prefs) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }

  let prefs = loadPrefs();

  /** 把偏好应用到界面（CSS 变量 + 控件状态） */
  function applyPrefs() {
    const root = document.documentElement;
    const th = THEMES[prefs.accent] || THEMES.cyan;
    root.style.setProperty("--accent", th.a);
    root.style.setProperty("--accent-2", th.a2);
    root.style.setProperty("--accent-rgb", th.rgb);
    root.style.setProperty("--accent2-rgb", th.rgb2);

    const bg = BACKGROUNDS[prefs.bg] || BACKGROUNDS.night;
    root.style.setProperty("--bg-0", bg.bg0);
    root.style.setProperty("--bg-1", bg.bg1);
    root.style.setProperty("--bg-2", bg.bg2);
    root.style.setProperty("--blob-1", bg.blob1);
    root.style.setProperty("--blob-2", bg.blob2);
    root.style.setProperty("--blob-3", bg.blob3);
    root.style.setProperty("--blob-4", bg.blob4);

    const cs = CODE_SIZES[prefs.codeSize] || CODE_SIZES.m;
    // 手机端：代码字号小于 16px 时，iOS 聚焦输入框会自动放大页面，强制用安全字号
    const isMobile = window.matchMedia && window.matchMedia("(max-width: 920px)").matches;
    const effSize = isMobile && parseFloat(cs.size) < 16 ? { size: "16px", lh: "28px" } : cs;
    root.style.setProperty("--code-size", effSize.size);
    root.style.setProperty("--code-lh", effSize.lh);

    root.style.setProperty("--ui-size", UI_SIZES[prefs.uiSize] || UI_SIZES.m);

    // 行为开关同步（顶部/预览栏）
    const ae = $("autoExplain"), ar = $("autoRun");
    if (ae) ae.checked = prefs.autoExplain;
    if (ar) ar.checked = prefs.autoRun;
    const pe = $("prefAutoExplain"), pr = $("prefAutoRun");
    if (pe) pe.checked = prefs.autoExplain;
    if (pr) pr.checked = prefs.autoRun;

    // 选中态
    document.querySelectorAll("#swatches .swatch").forEach((b) => {
      b.classList.toggle("on", b.dataset.accent === prefs.accent);
    });
    document.querySelectorAll("#bgOptions .bg-opt").forEach((b) => {
      b.classList.toggle("on", b.dataset.bg === prefs.bg);
    });
    document.querySelectorAll("#codeSizeSeg button").forEach((b) => {
      b.classList.toggle("on", b.dataset.size === prefs.codeSize);
    });
    document.querySelectorAll("#uiSizeSeg button").forEach((b) => {
      b.classList.toggle("on", b.dataset.size === prefs.uiSize);
    });
  }

  function initPrefsControls() {
    document.querySelectorAll("#swatches .swatch").forEach((b) => {
      b.addEventListener("click", () => {
        prefs.accent = b.dataset.accent;
        savePrefs(prefs);
        applyPrefs();
      });
    });
    document.querySelectorAll("#bgOptions .bg-opt").forEach((b) => {
      b.addEventListener("click", () => {
        prefs.bg = b.dataset.bg;
        savePrefs(prefs);
        applyPrefs();
      });
    });
    document.querySelectorAll("#codeSizeSeg button").forEach((b) => {
      b.addEventListener("click", () => {
        prefs.codeSize = b.dataset.size;
        savePrefs(prefs);
        applyPrefs();
        const names = { s: "小", m: "中", l: "大" };
        toast("代码字号已调整为：" + names[b.dataset.size], "ok");
      });
    });
    document.querySelectorAll("#uiSizeSeg button").forEach((b) => {
      b.addEventListener("click", () => {
        prefs.uiSize = b.dataset.size;
        savePrefs(prefs);
        applyPrefs();
        const names = { s: "小", m: "中", l: "大" };
        toast("界面字号已调整为：" + names[b.dataset.size], "ok");
      });
    });
    $("prefAutoExplain").addEventListener("change", (e) => {
      prefs.autoExplain = e.target.checked;
      savePrefs(prefs);
      const ae = $("autoExplain");
      if (ae) ae.checked = e.target.checked;
      if (e.target.checked && state.code.trim()) doExplain();
    });
    $("prefAutoRun").addEventListener("change", (e) => {
      prefs.autoRun = e.target.checked;
      savePrefs(prefs);
      const ar = $("autoRun");
      if (ar) ar.checked = e.target.checked;
      if (e.target.checked && state.code.trim()) window.Preview.runNow();
    });
    // 顶部/预览栏开关反向同步到偏好
    $("autoExplain").addEventListener("change", (e) => {
      prefs.autoExplain = e.target.checked;
      savePrefs(prefs);
      const pe = $("prefAutoExplain");
      if (pe) pe.checked = e.target.checked;
    });
    $("autoRun").addEventListener("change", (e) => {
      prefs.autoRun = e.target.checked;
      savePrefs(prefs);
      const pr = $("prefAutoRun");
      if (pr) pr.checked = e.target.checked;
    });
    $("btnResetPrefs").addEventListener("click", () => {
      prefs = Object.assign({}, DEFAULT_PREFS);
      savePrefs(prefs);
      applyPrefs();
      toast("外观已恢复默认", "ok");
    });
  }

  /* ================= AI 设置 ================= */

  function refreshAiButton() {
    const cfg = AI.loadConfig();
    const on = cfg.enabled && AI.isConfigured();
    $("btnAI").classList.toggle("on", on);
  }

  function openSettings() {
    const cfg = AI.loadConfig();
    $("aiEnabled").checked = cfg.enabled;
    $("aiBaseUrl").value = cfg.baseUrl;
    $("aiKey").value = cfg.key;
    $("aiModel").value = cfg.model;
    applyPrefs(); // 刷新外观控件的选中态
    $("settingsModal").classList.remove("hidden");
  }

  function closeSettings() {
    $("settingsModal").classList.add("hidden");
  }

  function saveSettings() {
    const cfg = {
      enabled: $("aiEnabled").checked,
      baseUrl: $("aiBaseUrl").value.trim(),
      key: $("aiKey").value.trim(),
      model: $("aiModel").value.trim(),
    };
    AI.saveConfig(cfg);
    refreshAiButton();
    closeSettings();
    if (cfg.enabled && AI.isConfigured() && state.code.trim()) {
      toast("已保存，正在用 AI 重新解释…", "ok");
      doExplain();
    } else {
      toast("设置已保存", "ok");
    }
  }

  /* ================= 拖拽分隔条 ================= */

  function initDivider() {
    const divider = $("divider");
    divider.addEventListener("mousedown", (e) => {
      e.preventDefault();
      document.body.classList.add("resizing");
      divider.classList.add("dragging");
      const onMove = (ev) => {
        const rect = document.querySelector("main").getBoundingClientRect();
        let pct = ((ev.clientX - rect.left) / rect.width) * 100;
        pct = Math.min(70, Math.max(22, pct));
        document.documentElement.style.setProperty("--explain-w", pct + "%");
      };
      const onUp = () => {
        document.body.classList.remove("resizing");
        divider.classList.remove("dragging");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  /* ================= 初始化 ================= */

  function init() {
    const input = $("codeInput");

    // 顶部栏
    $("langSelect").addEventListener("change", (e) => applyLang(e.target.value));
    $("btnSample").addEventListener("click", loadSample);
    $("btnExplain").addEventListener("click", () => doExplain({ forceAI: true }));
    $("btnSettings").addEventListener("click", openSettings);
    $("btnAI").addEventListener("click", () => {
      const cfg = AI.loadConfig();
      if (!AI.isConfigured()) {
        openSettings();
        toast("请先在设置中填写 API Key 再开启 AI 增强");
        return;
      }
      cfg.enabled = !cfg.enabled;
      AI.saveConfig(cfg);
      refreshAiButton();
      toast(cfg.enabled ? "AI 增强已开启" : "AI 增强已关闭", "ok");
      if (cfg.enabled && state.code.trim()) doExplain();
      else if (!cfg.enabled) doExplain();
    });

    // 编辑器
    input.addEventListener("input", onInput);
    input.addEventListener("scroll", syncScroll);
    input.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        doExplain({ forceAI: true });
      } else if (e.key === "Tab") {
        e.preventDefault();
        const start = input.selectionStart, end = input.selectionEnd;
        input.value = input.value.slice(0, start) + "    " + input.value.slice(end);
        input.selectionStart = input.selectionEnd = start + 4;
        input.dispatchEvent(new Event("input"));
      }
    });

    // 释义面板点击定位
    $("explainBody").addEventListener("click", (e) => {
      const item = e.target.closest(".line-item");
      if (item) selectLine(parseInt(item.dataset.no, 10));
    });

    // 面板按钮
    $("btnClearCode").addEventListener("click", () => setCode(""));
    $("btnClearExplain").addEventListener("click", () => {
      $("explainBody").innerHTML = EMPTY_HTML;
      $("explainMeta").textContent = "等待代码…";
      bindEmptySample();
    });

    // 设置弹窗
    $("btnCloseSettings").addEventListener("click", closeSettings);
    $("settingsModal").addEventListener("click", (e) => {
      if (e.target === $("settingsModal")) closeSettings();
    });
    $("btnSaveSettings").addEventListener("click", saveSettings);
    $("btnTestAI").addEventListener("click", async () => {
      const cfg = {
        enabled: $("aiEnabled").checked,
        baseUrl: $("aiBaseUrl").value.trim(),
        key: $("aiKey").value.trim(),
        model: $("aiModel").value.trim(),
      };
      if (!cfg.key || !cfg.model) { toast("请先填写 API Key 和模型名称"); return; }
      const btn = $("btnTestAI");
      btn.disabled = true;
      btn.textContent = "测试中…";
      try {
        await AI.testConnection(cfg);
        toast("连接成功！AI 可用", "ok");
      } catch (err) {
        toast("连接失败：" + (err.message || err), "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "测试连接";
      }
    });

    initDivider();
    window.Preview.init();
    initPrefsControls();

    // 初始状态
    applyPrefs();
    applyLang("python");
    refreshAiButton();
    if (!applyUrlAndPending()) loadSample();
  }

  /** 接收蛙课堂联动：URL ?lang= 预选语言 + localStorage 传入的代码 */
  function applyUrlAndPending() {
    try {
      // URL 语言参数：?lang=python|php|html|css|c|cpp
      const m = location.search.match(/[?&]lang=([a-z]+)/i);
      if (m && LANG_FILE[m[1].toLowerCase()]) {
        const lang = m[1].toLowerCase();
        applyLang(lang);
        $("langSelect").value = lang;
      }
      // 课程联动：localStorage 里带过来的代码（同域共享，10 分钟内有效）
      const raw = localStorage.getItem("codelens_pending");
      if (raw) {
        localStorage.removeItem("codelens_pending");
        const p = JSON.parse(raw);
        if (p && p.code && Date.now() - (p.ts || 0) < 10 * 60 * 1000) {
          if (p.lang && LANG_FILE[p.lang]) {
            applyLang(p.lang);
            $("langSelect").value = p.lang;
          }
          setCode(p.code);
          toast("已从蛙课堂带入代码，释义与运行结果如下", "ok");
          return true;
        }
      }
    } catch (e) { /* 忽略异常 */ }
    return false;
  }

  document.addEventListener("DOMContentLoaded", init);
})();
