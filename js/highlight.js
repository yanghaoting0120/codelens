/* ============================================================
   译码 CodeLens · 多语言词法分析与语法高亮
   纯离线实现，支持：Python / PHP / HTML / CSS / C / C++
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 各语言词典 ---------- */
  const CFG = {
    python: {
      lineComments: ["#"],
      blockComment: null,
      strings: ['"', "'"],
      sigil: null,
      keywords: new Set(("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield").split(" ")),
      types: new Set(["int", "str", "float", "bool", "list", "dict", "set", "tuple", "bytes"]),
      builtins: new Set(("print len range input int float str bool list dict set tuple open type isinstance enumerate zip map filter sorted sum min max abs round repr format id hash").split(" ")),
    },
    php: {
      lineComments: ["//", "#"],
      blockComment: ["/*", "*/"],
      strings: ['"', "'", "`"],
      sigil: "$",
      keywords: new Set(("echo print if else elseif endif while endwhile for endfor foreach endforeach function return class public private protected static const new require require_once include include_once namespace use extends implements interface abstract final try catch finally throw switch case default break continue global isset unset empty array true false null and or xor not instanceof clone trait yield match fn").split(" ")),
      types: new Set(["int", "float", "string", "bool", "array", "object", "void", "mixed", "callable", "iterable"]),
      builtins: new Set(("strlen count array_push array_pop array_merge explode implode json_encode json_decode var_dump print_r date time rand min max abs in_array array_map array_filter isset empty unset die exit printf sprintf").split(" ")),
    },
    c: {
      lineComments: ["//"],
      blockComment: ["/*", "*/"],
      strings: ['"', "'"],
      sigil: null,
      keywords: new Set(("auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while").split(" ")),
      types: new Set(["int", "char", "float", "double", "void", "long", "short", "unsigned", "signed", "bool"]),
      builtins: new Set(("printf scanf puts gets putchar getchar malloc calloc realloc free strlen strcpy strncpy strcmp strcat sprintf fopen fclose fread fwrite fgets exit NULL true false main").split(" ")),
    },
    cpp: {
      lineComments: ["//"],
      blockComment: ["/*", "*/"],
      strings: ['"', "'"],
      sigil: null,
      keywords: new Set(("auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while class public private protected namespace using template typename new delete this virtual override friend operator bool string vector try catch throw constexpr auto").split(" ")),
      types: new Set(["int", "char", "float", "double", "void", "long", "short", "unsigned", "signed", "bool", "string", "auto"]),
      builtins: new Set(("cout cin endl std printf scanf puts gets malloc free sizeof strlen strcpy strcmp strcat vector string main NULL true false cerr clog").split(" ")),
    },
  };

  /* ---------- 通用逐行扫描器 ---------- */
  const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/;

  function tokenizeLine(line, cfg, state) {
    const tokens = [];
    let i = 0;
    const len = line.length;

    // 处于跨行块注释中
    if (state.inBlock) {
      const end = cfg.blockComment ? line.indexOf(cfg.blockComment[1]) : -1;
      if (end >= 0) {
        tokens.push({ type: "com", text: line.slice(0, end + cfg.blockComment[1].length) });
        i = end + cfg.blockComment[1].length;
        state.inBlock = false;
      } else {
        if (line.trim()) tokens.push({ type: "com", text: line });
        return tokens;
      }
    }

    while (i < len) {
      const c = line[i];

      // 空白
      if (/\s/.test(c)) {
        let j = i;
        while (j < len && /\s/.test(line[j])) j++;
        tokens.push({ type: "plain", text: line.slice(i, j) });
        i = j;
        continue;
      }

      // 行注释
      const lc = cfg.lineComments;
      if (lc && lc.some((p) => line.startsWith(p, i))) {
        tokens.push({ type: "com", text: line.slice(i) });
        break;
      }

      // 块注释开始
      const bc = cfg.blockComment;
      if (bc && line.startsWith(bc[0], i)) {
        const end = line.indexOf(bc[1], i + bc[0].length);
        if (end >= 0) {
          tokens.push({ type: "com", text: line.slice(i, end + bc[1].length) });
          i = end + bc[1].length;
        } else {
          tokens.push({ type: "com", text: line.slice(i) });
          state.inBlock = true;
          break;
        }
        continue;
      }

      // 字符串
      if (cfg.strings.includes(c)) {
        let j = i + 1;
        let closed = false;
        while (j < len) {
          if (line[j] === "\\") { j += 2; continue; }
          if (line[j] === c) { closed = true; break; }
          j++;
        }
        tokens.push({ type: "str", text: line.slice(i, closed ? j + 1 : len) });
        i = closed ? j + 1 : len;
        continue;
      }

      // PHP 变量 $xxx
      if (cfg.sigil === "$" && c === "$") {
        const m = IDENT_RE.exec(line.slice(i + 1));
        if (m && m.index === 0) {
          tokens.push({ type: "var", text: "$" + m[0] });
          i += m[0].length + 1;
          continue;
        }
        tokens.push({ type: "punct", text: "$" });
        i++;
        continue;
      }

      // 数字
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(line[i + 1] || ""))) {
        let j = i;
        while (j < len && /[0-9a-fA-FxX._]/.test(line[j]) && !/[\s()]/.test(line[j])) j++;
        tokens.push({ type: "num", text: line.slice(i, j) });
        i = j;
        continue;
      }

      // 标识符
      if (/[A-Za-z_]/.test(c)) {
        const m = IDENT_RE.exec(line.slice(i));
        const word = m[0];
        const next = line.slice(i + word.length).replace(/^\s*/, "")[0];
        let type = "var";
        if (cfg.keywords.has(word)) type = "kw";
        else if (cfg.types.has(word)) type = "type";
        else if (cfg.builtins.has(word)) type = "builtin";
        else if (next === "(") type = "fn";
        tokens.push({ type, text: word });
        i += word.length;
        continue;
      }

      // 运算符 / 其他符号
      if ("=+-*/%<>!&|^~?:".includes(c)) {
        tokens.push({ type: "op", text: c });
      } else {
        tokens.push({ type: "punct", text: c });
      }
      i++;
    }
    return tokens;
  }

  /* ---------- HTML 专用扫描器 ---------- */
  const TAG_MEANINGS = {}; // 释义放在 engine.js，这里只管高亮

  function tokenizeHtml(line) {
    const tokens = [];
    let i = 0;
    const len = line.length;
    while (i < len) {
      const c = line[i];
      if (c === "<") {
        // 注释
        if (line.startsWith("<!--", i)) {
          const end = line.indexOf("-->", i + 4);
          if (end >= 0) { tokens.push({ type: "com", text: line.slice(i, end + 3) }); i = end + 3; }
          else { tokens.push({ type: "com", text: line.slice(i) }); i = len; }
          continue;
        }
        // 闭合标签
        if (line.startsWith("</", i)) {
          const m = /^<\/\s*([A-Za-z][\w-]*)/.exec(line.slice(i));
          if (m) {
            tokens.push({ type: "punct", text: "</" });
            tokens.push({ type: "tag", text: m[1] });
            i += m[0].length - m[1].length;
          } else { tokens.push({ type: "punct", text: "<" }); i++; }
          continue;
        }
        // DOCTYPE
        if (line.startsWith("<!", i)) {
          const end = line.indexOf(">", i);
          if (end >= 0) { tokens.push({ type: "kw", text: line.slice(i, end + 1) }); i = end + 1; }
          else { tokens.push({ type: "kw", text: line.slice(i) }); i = len; }
          continue;
        }
        // 开标签
        const m = /^<([A-Za-z][\w-]*)/.exec(line.slice(i));
        if (m) {
          tokens.push({ type: "punct", text: "<" });
          tokens.push({ type: "tag", text: m[1] });
          i += m[0].length;
          continue;
        }
        tokens.push({ type: "punct", text: "<" });
        i++;
        continue;
      }
      if (c === ">") { tokens.push({ type: "punct", text: ">" }); i++; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < len && line[j] !== c) j++;
        tokens.push({ type: "str", text: line.slice(i, j + 1 <= len ? j + 1 : len) });
        i = j + 1 <= len ? j + 1 : len;
        continue;
      }
      if (/[A-Za-z_-]/.test(c) && /=\s*["']?$/.test(line.slice(0, i))) {
        // 简化：属性名由行内模式判断
        const m = /^[A-Za-z_:][\w:-]*/.exec(line.slice(i));
        if (m) { tokens.push({ type: "attr", text: m[0] }); i += m[0].length; continue; }
      }
      if (/[0-9]/.test(c)) {
        const m = /^[0-9.]+/.exec(line.slice(i));
        if (m) { tokens.push({ type: "num", text: m[0] }); i += m[0].length; continue; }
      }
      if (/\s/.test(c)) {
        let j = i; while (j < len && /\s/.test(line[j])) j++;
        tokens.push({ type: "plain", text: line.slice(i, j) }); i = j; continue;
      }
      tokens.push({ type: /[=]/.test(c) ? "op" : "punct", text: c });
      i++;
    }
    return tokens;
  }

  /* ---------- CSS 专用扫描器 ---------- */
  function tokenizeCssLine(line, state) {
    const tokens = [];
    let i = 0;
    const len = line.length;

    if (state.inBlock) {
      const end = line.indexOf("*/");
      if (end >= 0) { tokens.push({ type: "com", text: line.slice(0, end + 2) }); i = end + 2; state.inBlock = false; }
      else { if (line.trim()) tokens.push({ type: "com", text: line }); return tokens; }
    }

    // 整行注释
    if (line.includes("/*") && !line.includes("*/")) {
      const idx = line.indexOf("/*");
      const head = line.slice(0, idx);
      if (!head.trim()) { tokens.push({ type: "com", text: line }); return tokens; }
    }

    while (i < len) {
      const c = line[i];
      if (/\s/.test(c)) {
        let j = i; while (j < len && /\s/.test(line[j])) j++;
        tokens.push({ type: "plain", text: line.slice(i, j) }); i = j; continue;
      }
      if (line.startsWith("/*", i)) {
        const end = line.indexOf("*/", i + 2);
        if (end >= 0) { tokens.push({ type: "com", text: line.slice(i, end + 2) }); i = end + 2; }
        else { tokens.push({ type: "com", text: line.slice(i) }); state.inBlock = true; break; }
        continue;
      }
      if (c === "@") {
        const m = /^@[\w-]+/.exec(line.slice(i));
        if (m) { tokens.push({ type: "kw", text: m[0] }); i += m[0].length; continue; }
      }
      if (c === "{" || c === "}" || c === ";" || c === ":") { tokens.push({ type: "punct", text: c }); i++; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < len && line[j] !== c) j++;
        tokens.push({ type: "str", text: line.slice(i, j + 1 <= len ? j + 1 : len) });
        i = j + 1 <= len ? j + 1 : len;
        continue;
      }
      if (/[0-9#.]/.test(c)) {
        const m = /^[#0-9a-fA-F.]*(?:px|em|rem|%|vh|vw|s|ms|deg|fr|ch)?/.exec(line.slice(i));
        if (m && m[0]) { tokens.push({ type: "num", text: m[0] }); i += m[0].length; continue; }
      }
      if (/[A-Za-z_-]/.test(c)) {
        const m = /^[A-Za-z_-][\w-]*/.exec(line.slice(i));
        if (m) {
          const word = m[0];
          // 属性名：后面紧跟冒号
          const after = line.slice(i + word.length).trimStart();
          let type = "plain";
          if (after.startsWith(":")) type = "attr";
          else if (["hover", "active", "focus", "visited", "before", "after", "first-child", "last-child", "nth-child"].includes(word)) type = "builtin";
          tokens.push({ type, text: word });
          i += word.length;
          continue;
        }
      }
      tokens.push({ type: "punct", text: c });
      i++;
    }
    return tokens;
  }

  /* ---------- 对外接口 ---------- */
  window.HL = {
    langs: CFG,

    /** 对整段代码分词，返回 { lines: [{no, text, tokens}] } */
    render: function (code, lang) {
      const rawLines = code.split("\n");
      const state = { inBlock: false };
      const out = [];
      for (let n = 0; n < rawLines.length; n++) {
        const text = rawLines[n];
        let tokens;
        if (lang === "html") tokens = tokenizeHtml(text);
        else if (lang === "css") tokens = tokenizeCssLine(text, state);
        else tokens = tokenizeLine(text, CFG[lang] || CFG.python, state);
        out.push({ no: n + 1, text, tokens });
      }
      return { lines: out };
    },

    /** 把 tokens 渲染成高亮 HTML 字符串（行内） */
    toHtml: function (tokens) {
      let html = "";
      for (const t of tokens) {
        if (t.type === "plain") { html += esc(t.text); continue; }
        html += '<span class="tok-' + t.type + '">' + esc(t.text) + "</span>";
      }
      return html || "&nbsp;";
    },

    /** 取纯文本（用于释义行显示） */
    plain: function (tokens) {
      return tokens.map((t) => t.text).join("");
    },
  };

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
})();
