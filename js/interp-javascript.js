/* ============================================================
   译码 CodeLens · JavaScript 运行器（本地真实执行）
   通过隐藏 iframe（sandbox 隔离）执行用户代码：
   - 捕获 console.log / info / warn / error 输出
   - 捕获运行时错误并翻译成通俗中文（尽量带行号）
   - 结果经 postMessage 异步回传，由 preview.js 打印
   - 死循环保护：父页面超时后可调用 stop() 销毁 iframe 停止
   ============================================================ */
(function () {
  "use strict";

  let frame = null;
  let seq = 0;
  let handler = null; // { id, onLog, onWarn, onErr, onDone }

  function ensureFrame() {
    if (frame && frame.isConnected) return frame;
    frame = document.createElement("iframe");
    frame.style.display = "none";
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-scripts");
    document.body.appendChild(frame);
    return frame;
  }

  function stop() {
    if (frame && frame.isConnected) frame.remove();
    frame = null;
  }

  /* ---------- 子页面引导代码（注入 srcdoc 执行） ---------- */
  function boot(code, id) {
    function post(type, text) {
      try { parent.postMessage({ __cl: id, type: type, text: text }, "*"); } catch (e) {}
    }
    function stringify(x) {
      if (typeof x === "string") return x;
      if (typeof x === "undefined") return "undefined";
      if (x === null) return "null";
      if (typeof x === "function") return String(x).slice(0, 80);
      try {
        const s = JSON.stringify(x);
        return s === undefined ? String(x) : s;
      } catch (e) { return String(x); }
    }
    function make(type) {
      return function () {
        const parts = [];
        for (let i = 0; i < arguments.length; i++) parts.push(stringify(arguments[i]));
        post(type, parts.join(" "));
      };
    }
    try { console.log = make("log"); } catch (e) {}
    try { console.info = make("log"); } catch (e) {}
    try { console.warn = make("warn"); } catch (e) {}
    try { console.error = make("err"); } catch (e) {}
    try { console.debug = make("log"); } catch (e) {}
    // 从堆栈中找“属于用户代码”的行号（栈里的注入文档行号会偏大，忽略）
    const codeLines = String(code).split("\n").length;
    function locateLine(stack) {
      const re = /:(\d+):\d+/g;
      let m, best = null;
      while ((m = re.exec(stack)) !== null) {
        const ln = parseInt(m[1], 10);
        if (ln >= 1 && ln <= codeLines) {
          if (best === null || ln > best) best = ln;
        }
      }
      return best;
    }
    window.onerror = function (msg, src, line, col, errObj) {
      const st = errObj && errObj.stack ? String(errObj.stack) : "";
      const ln = locateLine(st);
      post("err", (ln ? "第 " + ln + " 行：" : "") + String(msg));
    };
    const t0 = Date.now();
    try {
      (0, eval)(code);
      post("done", Date.now() - t0);
    } catch (e) {
      const sm = e && e.stack ? String(e.stack) : "";
      const ln = locateLine(sm);
      const line = ln ? "第 " + ln + " 行：" : "";
      let text;
      if (e instanceof TypeError) {
        text = "类型不对：可能把文字当数字用了，或调用了不存在的方法。" + (e.message ? "（" + e.message + "）" : "");
      } else if (e instanceof ReferenceError) {
        text = "名字不认识：用到了未声明/未定义的变量或函数。" + (e.message ? "（" + e.message + "）" : "");
      } else if (e instanceof SyntaxError) {
        text = "语法错误：写法和 JavaScript 规则不符，请检查括号、引号、分号是否成对。" + (e.message ? "（" + e.message + "）" : "");
      } else if (e instanceof RangeError) {
        text = "数字越界：" + (e.message || "");
      } else {
        text = "运行出错：" + (e && e.message ? e.message : String(e));
      }
      post("err", line + text);
      post("done", Date.now() - t0);
    }
  }

  /* ---------- 执行入口 ---------- */
  function run(code) {
    const id = ++seq;
    if (handler) handler.id = id;
    const f = ensureFrame();
    // 防 HTML 截断：把用户代码中的 "</" 转义为 "<\/"
    const safeCode = JSON.stringify(code).replace(/<\//g, "<\\/");
    const src =
      "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>" +
      "<scr" + "ipt>(" + boot.toString() + ")(" + safeCode + "," + id + ");</" + "script>" +
      "</body></html>";
    f.srcdoc = src;
    return id;
  }

  /* ---------- 父页面接收子页面消息 ---------- */
  function onMessage(ev) {
    const d = ev.data;
    if (!d || !d.__cl || !handler || handler.id !== d.__cl) return;
    if (d.type === "log") handler.onLog(d.text);
    else if (d.type === "warn") handler.onWarn(d.text);
    else if (d.type === "err") handler.onErr(d.text);
    else if (d.type === "done") handler.onDone(parseInt(d.text, 10) || 0);
  }

  function attach() {
    window.addEventListener("message", onMessage);
  }

  window.InterpJavaScript = {
    attach: attach,
    run: run,
    stop: stop,
    setHandler: function (h) { handler = h; },
  };
})();
