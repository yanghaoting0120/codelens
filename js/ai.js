/* ============================================================
   译码 CodeLens · AI 增强释义模块
   兼容任意 OpenAI 格式接口（DeepSeek / Kimi / 通义 / Ollama…）
   配置仅保存在本机浏览器 localStorage，不上传任何服务器
   ============================================================ */
(function () {
  "use strict";

  const STORE_KEY = "codelens_ai_config_v1";
  const DEFAULT_CONFIG = {
    enabled: false,
    baseUrl: "https://api.deepseek.com",
    key: "",
    model: "deepseek-chat",
  };

  // 注意：示例必须是合法 JSON（早期版本用「行号」这类占位符当示例，
  // 模型会照着写出畸形结构：把 lines/terms 塞进 overview 并漏掉最后的 }）
  const SYSTEM_PROMPT =
    "你是一位极有耐心的编程老师，专门给完全没学过编程的普通人讲解代码。\n" +
    "要求：\n" +
    "1. 用通俗、形象、口语化的中文讲解，避免堆砌术语；必须使用术语时先给大白话解释。\n" +
    "2. 解释文字里不要夹英文双引号。\n" +
    "3. 只输出一个 JSON 对象，不要输出任何其他文字、注释或 Markdown 代码块。\n" +
    "结构固定为 overview / lines / terms 三个平级字段，lines 和 terms 不要放进 overview 里。例如：\n" +
    '{"overview":{"title":"打印一句问候","summary":"这段代码调用 print，把一句话显示在屏幕上。"},' +
    '"lines":[{"no":1,"explanation":"调用 print，把括号里的内容显示到屏幕上。"}],' +
    '"terms":[{"term":"print","meaning":"把内容显示到屏幕上的命令。"}]}\n' +
    "lines 的 no 是数字，对应输入代码的真实行号（跳过空行）；terms 给出 3-8 个该代码中最值得讲解的术语。";

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return Object.assign({}, DEFAULT_CONFIG);
      return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
    } catch (e) {
      return Object.assign({}, DEFAULT_CONFIG);
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
  }

  function normalizeBase(url) {
    let u = (url || "").trim().replace(/\/+$/, "");
    if (!u) u = DEFAULT_CONFIG.baseUrl;
    return u;
  }

  function endpoint(base) {
    const u = normalizeBase(base);
    if (/\/chat\/completions$/.test(u)) return u;
    return u + "/chat/completions";
  }

  async function request(cfg, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    try {
      const resp = await fetch(endpoint(cfg.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + cfg.key.trim(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!resp.ok) {
        let detail = "";
        try {
          const err = await resp.json();
          detail = err.error && (err.error.message || err.error.code) ? "：" + (err.error.message || err.error.code) : "";
        } catch (e) { /* ignore */ }
        throw new Error("接口返回 " + resp.status + detail);
      }
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /** 测试连接：发一个极小的请求 */
  async function testConnection(cfg) {
    const data = await request(cfg, {
      model: cfg.model.trim() || "deepseek-chat",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
    });
    if (!data || !data.choices || !data.choices.length) {
      throw new Error("返回内容异常，请检查模型名称");
    }
    return true;
  }

  /* ---------- 容错解析 ----------
     模型偶尔不守格式（实测约 6 成概率）：把 lines/terms 塞进 overview 里，
     于是根对象少一个 }，JSON.parse 在末尾报错。这里逐级兜底：
     严格解析 → 去掉 Markdown 围栏 → 补全缺失的收尾括号 → 正则逐条捞。 */

  function stripFence(s) {
    const t = String(s).trim()
      .replace(/^```[a-zA-Z]*\s*/, "")
      .replace(/\s*```$/, "");
    const i = t.indexOf("{"), j = t.lastIndexOf("}");
    return i >= 0 && j > i ? t.slice(i, j + 1) : t;
  }

  /** 补全缺失的收尾括号（跳过字符串内部的括号） */
  function balance(s) {
    const stack = [];
    let inStr = false, esc = false;
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
    }
    let out = s;
    if (inStr) out += '"';
    for (let k = stack.length - 1; k >= 0; k--) out += stack[k] === "{" ? "}" : "]";
    return out;
  }

  function tryParse(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  const unesc = (s) => String(s).replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");

  /** 结构归一化：lines / terms 允许出现在顶层或 overview 里面，no 允许是字符串 */
  function normalize(obj) {
    const result = { overview: null, lines: [], terms: [] };
    const ov = obj.overview && typeof obj.overview === "object" ? obj.overview : null;
    if (ov && (ov.title || ov.summary)) {
      result.overview = { title: ov.title || "这段代码", summary: ov.summary || "" };
    }
    const linesSrc = Array.isArray(obj.lines) ? obj.lines : (ov && Array.isArray(ov.lines) ? ov.lines : []);
    for (const l of linesSrc) {
      const no = l && (typeof l.no === "number" ? l.no : parseInt(l.no, 10));
      if (l && isFinite(no) && l.explanation) {
        result.lines.push({ no: no, explanation: String(l.explanation) });
      }
    }
    const termsSrc = Array.isArray(obj.terms) ? obj.terms : (ov && Array.isArray(ov.terms) ? ov.terms : []);
    for (const t of termsSrc) {
      if (t && t.term && t.meaning) {
        result.terms.push({ term: String(t.term), meaning: String(t.meaning) });
      }
    }
    return result;
  }

  /** 最后兜底：结构彻底坏掉时，用正则把能捞到的条目捞出来 */
  function salvage(raw) {
    const result = { overview: null, lines: [], terms: [] };
    let m;
    const lineRe = /"no"\s*:\s*"?(\d+)"?\s*,\s*"explanation"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    while ((m = lineRe.exec(raw))) {
      result.lines.push({ no: parseInt(m[1], 10), explanation: unesc(m[2]) });
    }
    const termRe = /"term"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"meaning"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    while ((m = termRe.exec(raw))) {
      result.terms.push({ term: unesc(m[1]), meaning: unesc(m[2]) });
    }
    const t = raw.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const s = raw.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (t || s) {
      result.overview = { title: t ? unesc(t[1]) : "这段代码", summary: s ? unesc(s[1]) : "" };
    }
    return result;
  }

  function parseReply(content) {
    const raw = stripFence(content);
    const obj = tryParse(content) || tryParse(raw) ||
      tryParse(balance(raw).replace(/,(\s*[}\]])/g, "$1"));
    return obj ? normalize(obj) : salvage(raw);
  }

  /** AI 解释代码，失败时抛出异常（由调用方降级到离线引擎） */
  async function explain(code, langName) {
    const cfg = loadConfig();
    const data = await request(cfg, {
      model: cfg.model.trim() || "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "语言：" + langName + "\n请讲解下面这段代码：\n```\n" + code + "\n```",
        },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
      stream: false,
    });

    const content = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";
    if (!content) throw new Error("AI 没有返回内容");

    const result = parseReply(content);
    if (!result.overview && !result.lines.length && !result.terms.length) {
      throw new Error("AI 返回内容不完整");
    }
    return result;
  }

  window.AI = {
    loadConfig,
    saveConfig,
    testConnection,
    explain,
    isConfigured: function () {
      const cfg = loadConfig();
      return !!(cfg.key && cfg.model);
    },
  };
})();
