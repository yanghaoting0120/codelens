/* ============================================================
   译码 CodeLens · 实时预览 / 运行结果
   HTML、CSS → iframe 实时渲染成网页画面
   Python / PHP / C / C++ → 内置本地解释器真实运行，显示输出
   全部离线可用；自动运行有步数保护（防死循环卡死）
   ============================================================ */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const state = {
    lang: "python",
    code: "",
    timer: null,
  };

  /* CSS 预览用的示例页面结构（把用户样式套在上面展示效果） */
  const CSS_DEMO =
    '<div class="page">' +
    "<h1>标题示例</h1>" +
    "<h2>二级标题</h2>" +
    '<p>这是一段<b>示例</b>文字，用来展示你的样式效果。<a href="#">链接文字</a></p>' +
    "<button>按钮</button>" +
    '<div class="card">' +
    "<h3>卡片标题</h3>" +
    "<p>卡片里的内容：颜色、圆角、阴影、内边距都会应用到这些元素上。</p>" +
    "</div>" +
    '<div class="card"><ul><li>列表项一</li><li>列表项二</li></ul></div>' +
    "</div>";

  const HINTS = {
    html: "HTML 网页实时渲染 —— 改代码马上看到画面",
    css: "CSS 样式实时套用在示例页面上",
    python: "Python 本地解释器运行",
    php: "PHP 本地解释器运行",
    c: "C 本地解释器运行",
    cpp: "C++ 本地解释器运行",
  };

  const MODE_INFO = {
    python: "在右侧输入 Python 代码，这里会显示程序运行结果（print 输出的内容）。",
    php: "在右侧输入 PHP 代码，这里会显示 echo / print 输出的内容。",
    c: "在右侧输入 C 代码，这里会显示 printf 输出的内容。",
    cpp: "在右侧输入 C++ 代码，这里会显示 cout 输出的内容。",
  };

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function init() {
    $("btnRun").addEventListener("click", runNow);
    $("previewInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") runNow();
    });
    $("previewToggle").addEventListener("click", () => {
      $("previewPanel").classList.toggle("collapsed");
      $("previewToggle").textContent = $("previewPanel").classList.contains("collapsed") ? "▸" : "▾";
    });
  }

  function isWeb() {
    return state.lang === "html" || state.lang === "css";
  }

  function setLang(lang) {
    state.lang = lang;
    $("previewHint").textContent = HINTS[lang] || "";
    const web = isWeb();
    $("previewFrame").classList.toggle("hidden", !web);
    $("previewConsole").classList.toggle("hidden", web);
    $("previewInput").classList.toggle("hidden", web);
    if (web) {
      if (state.code.trim()) renderFrame();
    } else {
      clearConsole();
      showInfo(MODE_INFO[lang] || "");
    }
  }

  function onCodeChange(code) {
    state.code = code;
    clearTimeout(state.timer);
    const delay = isWeb() ? 350 : 650;
    state.timer = setTimeout(() => {
      if (isWeb()) renderFrame();
      else if ($("autoRun").checked) runInterp(code, state.lang);
    }, delay);
  }

  /** 立即刷新（手动运行按钮） */
  function runNow() {
    clearTimeout(state.timer);
    if (isWeb()) renderFrame();
    else runInterp(state.code, state.lang);
  }

  /* ---------- HTML / CSS 渲染 ---------- */

  function renderFrame() {
    const frame = $("previewFrame");
    if (state.lang === "html") {
      frame.srcdoc = state.code;
    } else {
      frame.srcdoc =
        '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        "<style>" + state.code + "</style>" +
        "</head><body style=\"margin:0;padding:14px;font-family:'PingFang SC','Microsoft YaHei',sans-serif;\">" +
        CSS_DEMO +
        '<div style="margin-top:16px;padding:8px 12px;border:1px dashed rgba(0,0,0,.2);border-radius:8px;font-size:12px;color:#888;">' +
        "↑ 这是用于展示样式的示例页面，你写的 CSS 已经套用在上面的元素上。" +
        "</div></body></html>";
    }
  }

  /* ---------- 解释型语言运行 ---------- */

  function clearConsole() {
    $("previewConsole").innerHTML = "";
    $("previewInput").classList.remove("need-input");
  }

  function showInfo(text) {
    $("previewConsole").innerHTML =
      '<div class="p-info">' + esc(text) + "</div>";
  }

  function consolePrint(text, cls) {
    const con = $("previewConsole");
    const lines = String(text).split("\n");
    for (const line of lines) {
      const div = document.createElement("div");
      div.className = "p-" + cls;
      div.textContent = line;
      con.appendChild(div);
    }
    // 防止刷屏：超过 300 行截断
    while (con.childElementCount > 300) con.removeChild(con.firstChild);
    con.scrollTop = con.scrollHeight;
  }

  function runInterp(code, lang) {
    clearConsole();
    if (!code.trim()) {
      showInfo("在右侧输入代码后，这里会显示运行结果。");
      return;
    }
    const input = $("previewInput").value;
    const t0 = Date.now();
    let r = null;
    if (lang === "python") r = window.InterpPython.run(code, { input: input });
    else if (lang === "c" || lang === "cpp") r = window.InterpC.run(code, { input: input });
    else if (lang === "php") r = window.InterpPHP.run(code, { input: input });
    if (!r) {
      showInfo("这个语言暂时不支持本地运行。");
      return;
    }
    if (r.output) consolePrint(r.output, "out");
    if (r.ok) {
      consolePrint("✓ 运行完成（本地解释器 · " + r.ms + " ms）", "info");
    } else {
      consolePrint("✗ " + r.error, "err");
      if (r.error.indexOf("需要输入") >= 0) {
        $("previewInput").classList.add("need-input");
        $("previewInput").focus();
      }
    }
  }

  window.Preview = { init, setLang, onCodeChange, runNow };
})();
