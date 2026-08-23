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

  const SYSTEM_PROMPT =
    "你是一位极有耐心的编程老师，专门给完全没学过编程的普通人讲解代码。\n" +
    "要求：\n" +
    "1. 用通俗、形象、口语化的中文讲解，避免堆砌术语；必须使用术语时先给大白话解释。\n" +
    "2. 只输出一个 JSON 对象，不要输出任何其他文字、注释或 Markdown 代码块。\n" +
    "JSON 格式：\n" +
    '{"overview":{"title":"一句话标题，说明这段代码是做什么的","summary":"2-4 句话的整体通俗解释"},"lines":[{"no":行号,"explanation":"该行的通俗解释，15-50 字"}],"terms":[{"term":"术语名","meaning":"通俗解释，1-2 句"}]}\n' +
    "其中 lines 的 no 必须对应输入代码的行号（跳过空行），terms 给出 3-8 个该代码中最值得讲解的术语。";

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

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      // 容错：尝试提取第一个 { ... }
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("AI 返回的不是有效 JSON");
      parsed = JSON.parse(m[0]);
    }

    const result = { overview: null, lines: [], terms: [] };
    if (parsed.overview) {
      result.overview = {
        title: parsed.overview.title || "这段代码",
        summary: parsed.overview.summary || "",
      };
    }
    if (Array.isArray(parsed.lines)) {
      for (const l of parsed.lines) {
        if (l && typeof l.no === "number" && l.explanation) {
          result.lines.push({ no: l.no, explanation: String(l.explanation) });
        }
      }
    }
    if (Array.isArray(parsed.terms)) {
      for (const t of parsed.terms) {
        if (t && t.term && t.meaning) {
          result.terms.push({ term: String(t.term), meaning: String(t.meaning) });
        }
      }
    }
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
