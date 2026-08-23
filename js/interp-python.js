/* ============================================================
   译码 CodeLens · Python 迷你解释器（教学子集）
   支持：print / input / 变量 / if-elif-else / for / while /
        def 函数 / return / 列表与字典 / range / 常用内置函数
   纯本地实现，步数保护防死循环，报错为通俗中文
   ============================================================ */
(function () {
  "use strict";

  const C = window.InterpCommon;

  const KEYWORDS = new Set(("if elif else for while def return print input pass break continue global and or not in True False None range len int float str abs min max sum round type list dict bool").split(" "));

  /* ================= 词法 ================= */

  function tokenizeLine(line, lineNo) {
    const tokens = [];
    let i = 0;
    const n = line.length;
    while (i < n) {
      const c = line[i];
      if (c === "#") break; // 注释
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1;
        let s = "";
        while (j < n) {
          if (line[j] === "\\") {
            const e = line[j + 1];
            s += e === "n" ? "\n" : e === "t" ? "\t" : e === "\\" ? "\\" : e === '"' ? '"' : e === "'" ? "'" : e;
            j += 2;
          } else if (line[j] === c) { j++; break; }
          else { s += line[j]; j++; }
        }
        if (j > n) fail(lineNo, "字符串缺少结尾引号");
        tokens.push({ t: "str", v: s, line: lineNo });
        i = j;
        continue;
      }
      if (/[0-9]/.test(c)) {
        const m = /^[0-9]+(\.[0-9]+)?/.exec(line.slice(i));
        tokens.push({ t: "num", v: parseFloat(m[0]), line: lineNo });
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        // 先检查 "not in"（组合运算符，必须比单词匹配优先）
        if (line.startsWith("not in", i)) {
          tokens.push({ t: "op", v: "not in", line: lineNo });
          i += 6;
          continue;
        }
        const m = /^[A-Za-z_]\w*/.exec(line.slice(i));
        tokens.push({ t: "id", v: m[0], line: lineNo });
        i += m[0].length;
        continue;
      }
      const two = line.slice(i, i + 2);
      if (["==", "!=", "<=", ">=", "//", "**", "+=", "-=", "*=", "/=", "%="].includes(two)) {
        tokens.push({ t: "op", v: two, line: lineNo });
        i += 2;
        continue;
      }
      if ("+-*/%()[]{},:.<>=!".includes(c)) {
        tokens.push({ t: "op", v: c, line: lineNo });
        i++;
        continue;
      }
      fail(lineNo, "这里有我不认识的符号“" + c + "”");
    }
    return tokens;
  }

  function fail(line, msg) {
    throw new C.LangError(msg, line);
  }

  /* ================= 语法解析 ================= */

  function parse(code) {
    const srcLines = code.split("\n");
    // 预处理：行 → {indent, tokens, line, text}
    const rows = [];
    for (let k = 0; k < srcLines.length; k++) {
      const text = srcLines[k];
      const m = /^[ \t]*/.exec(text);
      if (text.trim() === "" || text.trim().startsWith("#")) continue;
      rows.push({
        indent: m[0].replace(/\t/g, "    ").length,
        tokens: tokenizeLine(text, k + 1),
        line: k + 1,
        text: text.trim(),
      });
    }
    let pos = 0;
    const program = [];
    while (pos < rows.length) {
      const block = parseBlock(-1, "module");
      for (const stmt of block) program.push(stmt);
    }
    return program;

    function parseBlock(parentIndent, ctx) {
      const block = [];
      if (pos >= rows.length) {
        if (ctx === "block") fail(rows[pos - 1].line, "这个代码块是空的——冒号后面要跟至少一行缩进的代码");
        return block;
      }
      const blockIndent = rows[pos].indent;
      if (blockIndent <= parentIndent) {
        if (ctx === "block") fail(rows[pos].line, "缩进不对：冒号后面的代码要比上一行多缩进一些");
        return block;
      }
      while (pos < rows.length) {
        const row = rows[pos];
        if (row.indent < blockIndent) break; // 缩进减少 → 块结束
        if (row.indent === blockIndent) {
          pos++;
          block.push(parseStatement(row));
          continue;
        }
        fail(row.line, "缩进不对：这行比同块的其他行多缩进了 " + (row.indent - blockIndent) + " 个空格");
      }
      return block;
    }

    function parseStatement(row) {
      const toks = row.tokens;
      const L = row.line;
      if (!toks.length) return { type: "pass", line: L };
      const head = toks[0];

      if (head.t === "id") {
        switch (head.v) {
          case "if": return parseIf(row);
          case "while": return parseWhile(row);
          case "for": return parseFor(row);
          case "def": return parseDef(row);
          case "return": {
            const expr = toks.length > 1 ? parseExpr(toks, 1).node : null;
            return { type: "return", expr, line: L };
          }
          case "break": return { type: "break", line: L };
          case "continue": return { type: "continue", line: L };
          case "pass": return { type: "pass", line: L };
          case "global": {
            const names = [];
            for (let i = 1; i < toks.length; i++) names.push(toks[i].v);
            return { type: "global", names, line: L };
          }
        }
      }

      // 赋值：找最外层 = / 复合赋值
      const asgIdx = findAssign(toks);
      if (asgIdx >= 0) {
        const opTok = toks[asgIdx];
        if (opTok.v !== "=") {
          // a += b
          const lhs = parseLValue(toks, 0, asgIdx, L);
          const rhs = parseExpr(toks, asgIdx + 1).node;
          return { type: "assign", lhs, op: opTok.v.slice(0, -1), rhs, line: L };
        }
        // 检查左边是否多个（a, b = ...）
        const leftToks = toks.slice(0, asgIdx);
        if (leftToks.length === 1 && leftToks[0].t === "id") {
          const rhs = parseExpr(toks, asgIdx + 1).node;
          return { type: "assign", lhs: { kind: "name", name: leftToks[0].v }, op: null, rhs, line: L };
        }
        if (leftToks.some((x) => x.v === ",")) {
          // 解包赋值 a, b = ...
          const parts = splitTop(leftToks, ",");
          const names = parts.map((p) => {
            if (p.length !== 1 || p[0].t !== "id") fail(L, "解包赋值左边只能写变量名，例如 a, b = 1, 2");
            return p[0].v;
          });
          const rhs = parseExpr(toks, asgIdx + 1).node;
          return { type: "unpack", names, rhs, line: L };
        }
        // a[下标] = 值
        const lhs = parseLValue(toks, 0, asgIdx, L);
        const rhs = parseExpr(toks, asgIdx + 1).node;
        return { type: "assign", lhs, op: null, rhs, line: L };
      }

      // 表达式语句（调用等）
      return { type: "expr", expr: parseExpr(toks, 0).node, line: L };
    }

    function parseIf(row) {
      const L = row.line;
      const branches = [];
      let elseBlock = null;
      let cond = parseExpr(row.tokens, 1).node;
      expectColon(row, L);
      let block = parseBlock(row.indent, "block");
      branches.push({ cond, block });
      // 继续吃 elif / else（相同缩进）
      for (;;) {
        const nxt = rows[pos];
        if (!nxt || nxt.indent !== row.indent) break;
        if (nxt.tokens[0] && nxt.tokens[0].t === "id" && nxt.tokens[0].v === "elif") {
          pos++;
          const c = parseExpr(nxt.tokens, 1).node;
          expectColon(nxt, L);
          branches.push({ cond: c, block: parseBlock(row.indent, "block") });
          continue;
        }
        if (nxt.tokens[0] && nxt.tokens[0].t === "id" && nxt.tokens[0].v === "else") {
          pos++;
          expectColon(nxt, L);
          elseBlock = parseBlock(row.indent, "block");
          break;
        }
        break;
      }
      return { type: "if", branches, elseBlock, line: L };
    }

    function parseWhile(row) {
      const L = row.line;
      const cond = parseExpr(row.tokens, 1).node;
      expectColon(row, L);
      const block = parseBlock(row.indent, "block");
      return { type: "while", cond, block, line: L };
    }

    function parseFor(row) {
      const L = row.line;
      // for x in expr:
      let i = 1;
      if (row.tokens[i] && row.tokens[i].t === "id") {
        const varName = row.tokens[i].v;
        i++;
        if (row.tokens[i] && row.tokens[i].v === "in") {
          i++;
          const iter = parseExpr(row.tokens, i).node;
          expectColon(row, L);
          const block = parseBlock(row.indent, "block");
          return { type: "for", var: varName, iter, block, line: L };
        }
      }
      fail(L, "for 循环的写法是：for 变量名 in 可遍历的东西:（例如 for x in range(5):）");
    }

    function parseDef(row) {
      const L = row.line;
      const toks = row.tokens;
      if (toks[1] && toks[1].t === "id" && toks[2] && toks[2].v === "(") {
        const name = toks[1].v;
        let i = 3;
        const params = [];
        while (i < toks.length && toks[i].v !== ")") {
          if (toks[i].t !== "id") fail(L, "函数参数只能写变量名（可以带默认值）");
          const pname = toks[i].v;
          i++;
          let def = null;
          if (toks[i] && toks[i].v === "=") {
            i++;
            def = parseExpr(toks, i).node;
            i = skipExpr(toks, i);
          }
          params.push({ name: pname, def });
          if (toks[i] && toks[i].v === ",") { i++; continue; }
          break;
        }
        if (!toks[i] || toks[i].v !== ")") fail(L, "函数定义的括号没配对");
        expectColon(row, L);
        const block = parseBlock(row.indent, "block");
        return { type: "def", name, params, block, line: L };
      }
      fail(L, "函数定义的写法是：def 函数名(参数):");
    }

    function expectColon(row) {
      const last = row.tokens[row.tokens.length - 1];
      if (!last || last.v !== ":") fail(row.line, "这一行末尾要加一个英文冒号“:”，表示下面缩进的代码都属于它");
    }

    /* ---------- 表达式（递归下降） ---------- */
    function parseExpr(toks, i) { return parseOr(toks, i); }

    function parseOr(toks, i) {
      let left = parseAnd(toks, i);
      while (left.rest < toks.length && toks[left.rest].v === "or") {
        const r = parseAnd(toks, left.rest + 1);
        left = { node: { type: "binop", op: "or", l: left.node, r: r.node, line: left.node.line }, rest: r.rest };
      }
      return left;
    }
    function parseAnd(toks, i) {
      let left = parseNot(toks, i);
      while (left.rest < toks.length && toks[left.rest].v === "and") {
        const r = parseNot(toks, left.rest + 1);
        left = { node: { type: "binop", op: "and", l: left.node, r: r.node, line: left.node.line }, rest: r.rest };
      }
      return left;
    }
    function parseNot(toks, i) {
      if (toks[i] && toks[i].v === "not") {
        const r = parseNot(toks, i + 1);
        return { node: { type: "unary", op: "not", e: r.node, line: r.node.line }, rest: r.rest };
      }
      return parseCmp(toks, i);
    }
    function parseCmp(toks, i) {
      let left = parseAdd(toks, i);
      for (;;) {
        const op = toks[left.rest];
        if (!op) break;
        if (["==", "!=", "<", ">", "<=", ">=", "in"].includes(op.v) || op.v === "not in") {
          const r = parseAdd(toks, left.rest + 1);
          left = { node: { type: "binop", op: op.v, l: left.node, r: r.node, line: left.node.line }, rest: r.rest };
          continue;
        }
        break;
      }
      return left;
    }
    function parseAdd(toks, i) {
      let left = parseMul(toks, i);
      for (;;) {
        const op = toks[left.rest];
        if (op && (op.v === "+" || op.v === "-")) {
          const r = parseMul(toks, left.rest + 1);
          left = { node: { type: "binop", op: op.v, l: left.node, r: r.node, line: left.node.line }, rest: r.rest };
          continue;
        }
        break;
      }
      return left;
    }
    function parseMul(toks, i) {
      let left = parseUnary(toks, i);
      for (;;) {
        const op = toks[left.rest];
        if (op && ["*", "/", "//", "%"].includes(op.v)) {
          const r = parseUnary(toks, left.rest + 1);
          left = { node: { type: "binop", op: op.v, l: left.node, r: r.node, line: left.node.line }, rest: r.rest };
          continue;
        }
        break;
      }
      return left;
    }
    function parseUnary(toks, i) {
      const op = toks[i];
      if (op && (op.v === "-" || op.v === "+")) {
        const r = parseUnary(toks, i + 1);
        return { node: { type: "unary", op: op.v, e: r.node, line: r.node.line }, rest: r.rest };
      }
      let base = parsePostfix(toks, i);
      // 幂运算
      if (toks[base.rest] && toks[base.rest].v === "**") {
        const r = parseUnary(toks, base.rest + 1);
        return { node: { type: "binop", op: "**", l: base.node, r: r.node, line: base.node.line }, rest: r.rest };
      }
      return base;
    }
    function parsePostfix(toks, i) {
      let cur = parseAtom(toks, i);
      for (;;) {
        const op = toks[cur.rest];
        if (!op) break;
        if (op.v === "(") {
          const args = [];
          let j = cur.rest + 1;
          while (j < toks.length && toks[j].v !== ")") {
            // 关键字参数 name=expr（仅限 print 等）
            if (toks[j].t === "id" && toks[j + 1] && toks[j + 1].v === "=") {
              const kv = parseExpr(toks, j + 2);
              args.push({ kw: toks[j].v, value: kv.node });
              j = kv.rest;
            } else if (toks[j].v === "*") {
              // 星号解包：print(*range(3)) 会展开成多个参数
              const uv = parseExpr(toks, j + 1);
              args.push({ unpack: true, value: uv.node });
              j = uv.rest;
            } else {
              const av = parseExpr(toks, j);
              args.push({ value: av.node });
              j = av.rest;
            }
            if (toks[j] && toks[j].v === ",") { j++; continue; }
            break;
          }
          if (!toks[j] || toks[j].v !== ")") fail(cur.node.line, "括号没配对，调用函数时右括号丢了");
          cur = { node: { type: "call", callee: cur.node, args, line: cur.node.line }, rest: j + 1 };
          continue;
        }
        if (op.v === "[") {
          const idx = parseExpr(toks, cur.rest + 1);
          if (!toks[idx.rest] || toks[idx.rest].v !== "]") fail(cur.node.line, "中括号没配对，a[下标] 的右括号丢了");
          cur = { node: { type: "index", target: cur.node, idx: idx.node, line: cur.node.line }, rest: idx.rest + 1 };
          continue;
        }
        if (op.v === ".") {
          const name = toks[cur.rest + 1];
          if (!name || name.t !== "id") fail(cur.node.line, "点号后面要跟属性或方法名");
          cur = { node: { type: "attr", target: cur.node, name: name.v, line: cur.node.line }, rest: cur.rest + 2 };
          continue;
        }
        break;
      }
      return cur;
    }
    function parseAtom(toks, i) {
      const t = toks[i];
      const L = t ? t.line : 0;
      if (!t) fail(L, "这里缺少一个值（数字、文字、变量等）");
      if (t.t === "num") return { node: { type: "num", v: t.v, line: L }, rest: i + 1 };
      if (t.t === "str") return { node: { type: "str", v: t.v, line: L }, rest: i + 1 };
      if (t.t === "id") {
        if (t.v === "True") return { node: { type: "bool", v: true, line: L }, rest: i + 1 };
        if (t.v === "False") return { node: { type: "bool", v: false, line: L }, rest: i + 1 };
        if (t.v === "None") return { node: { type: "none", line: L }, rest: i + 1 };
        return { node: { type: "name", name: t.v, line: L }, rest: i + 1 };
      }
      if (t.v === "(") {
        const e = parseExpr(toks, i + 1);
        if (!toks[e.rest] || toks[e.rest].v !== ")") fail(L, "小括号没配对");
        return { node: e.node, rest: e.rest + 1 };
      }
      if (t.v === "[") {
        const items = [];
        let j = i + 1;
        while (j < toks.length && toks[j].v !== "]") {
          const e = parseExpr(toks, j);
          items.push(e.node);
          j = e.rest;
          if (toks[j] && toks[j].v === ",") { j++; continue; }
          break;
        }
        if (!toks[j] || toks[j].v !== "]") fail(L, "列表的中括号没配对");
        return { node: { type: "list", items, line: L }, rest: j + 1 };
      }
      if (t.v === "{") {
        const pairs = [];
        let j = i + 1;
        while (j < toks.length && toks[j].v !== "}") {
          const k = parseExpr(toks, j);
          if (!toks[k.rest] || toks[k.rest].v !== ":") fail(L, "字典的写法是 {键: 值}，冒号丢了");
          const v = parseExpr(toks, k.rest + 1);
          pairs.push({ k: k.node, v: v.node });
          j = v.rest;
          if (toks[j] && toks[j].v === ",") { j++; continue; }
          break;
        }
        if (!toks[j] || toks[j].v !== "}") fail(L, "字典的花括号没配对");
        return { node: { type: "dict", pairs, line: L }, rest: j + 1 };
      }
      fail(L, "这里有个值我没看懂：“" + t.v + "”");
    }

    function parseLValue(toks, from, to, L) {
      if (to - from === 1 && toks[from].t === "id") return { kind: "name", name: toks[from].v };
      if (toks[from].t === "id" && toks[from + 1] && toks[from + 1].v === "[") {
        const idx = parseExpr(toks, from + 2);
        if (!toks[idx.rest] || toks[idx.rest].v !== "]") fail(L, "中括号没配对");
        if (idx.rest + 1 !== to) fail(L, "赋值左边写得太复杂，我只支持 a[下标] = 值");
        return { kind: "index", name: toks[from].v, idx: idx.node };
      }
      fail(L, "赋值左边只能写变量名或 a[下标]");
    }

    function findAssign(toks) {
      let depth = 0;
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.v === "(" || t.v === "[" || t.v === "{") depth++;
        else if (t.v === ")" || t.v === "]" || t.v === "}") depth--;
        else if (depth === 0 && ["=", "+=", "-=", "*=", "/=", "%=", "//=", "**="].includes(t.v)) return i;
      }
      return -1;
    }
    function splitTop(toks, sep) {
      const parts = [];
      let cur = [];
      let depth = 0;
      for (const t of toks) {
        if (t.v === "(" || t.v === "[" || t.v === "{") depth++;
        else if (t.v === ")" || t.v === "]" || t.v === "}") depth--;
        if (t.v === sep && depth === 0) { parts.push(cur); cur = []; }
        else cur.push(t);
      }
      parts.push(cur);
      return parts;
    }
    function skipExpr(toks, i) {
      const r = parseExpr(toks, i);
      return r.rest;
    }
  }

  /* ================= 执行 ================= */

  function makeEnv(parent) {
    return { parent: parent || null, vars: new Map() };
  }
  function envGet(env, name, line) {
    let e = env;
    while (e) {
      if (e.vars.has(name)) return e.vars.get(name);
      e = e.parent;
    }
    fail(line, "名字“" + name + "”还没定义——要先给它赋值才能用");
  }
  function envSet(env, name, val, line) {
    let e = env;
    while (e) {
      if (e.vars.has(name)) { e.vars.set(name, val); return; }
      e = e.parent;
    }
    env.vars.set(name, val);
  }
  function envSetLocal(env, name, val) {
    env.vars.set(name, val);
  }
  function envDeclare(env, name, val) {
    env.vars.set(name, val);
  }

  class Ctrl { constructor(type, value) { this.type = type; this.value = value; } }

  function runBlock(block, env) {
    for (const stmt of block) runStmt(stmt, env);
  }

  function runStmt(s, env) {
    guardStep(s.line);
    switch (s.type) {
      case "pass": return;
      case "expr": evalExpr(s.expr, env); return;
      case "assign": {
        const val = evalExpr(s.rhs, env);
        if (s.lhs.kind === "name") {
          if (s.op) {
            const old = envGet(env, s.lhs.name, s.line);
            envSet(env, s.lhs.name, doBinop(s.op, old, val, s.line), s.line);
          } else {
            envSet(env, s.lhs.name, val, s.line);
          }
        } else {
          const target = envGet(env, s.lhs.name, s.line);
          const idx = evalExpr(s.lhs.idx, env);
          if (Array.isArray(target)) {
            if (typeof idx !== "number" || idx % 1 !== 0) fail(s.line, "列表下标必须是整数");
            if (idx < 0 || idx >= target.length) fail(s.line, "列表下标 " + idx + " 越界了（列表只有 " + target.length + " 项）");
            target[idx] = s.op ? doBinop(s.op, target[idx], val, s.line) : val;
          } else if (target && typeof target === "object") {
            // 字典赋值
            target[String(idx)] = s.op ? doBinop(s.op, target[String(idx)], val, s.line) : val;
          } else {
            fail(s.line, "a[下标] 只能用在列表或字典上，" + s.lhs.name + " 不是");
          }
        }
        return;
      }
      case "unpack": {
        const val = evalExpr(s.rhs, env);
        if (!Array.isArray(val)) fail(s.line, "解包赋值右边必须是一个列表，例如 a, b = [1, 2]");
        if (val.length !== s.names.length) fail(s.line, "左右数量对不上：左边 " + s.names.length + " 个变量，右边只有 " + val.length + " 个值");
        s.names.forEach((nm, i) => envSet(env, nm, val[i], s.line));
        return;
      }
      case "if": {
        for (const b of s.branches) {
          if (truthy(evalExpr(b.cond, env))) { runBlock(b.block, env); return; }
        }
        if (s.elseBlock) runBlock(s.elseBlock, env);
        return;
      }
      case "while": {
        let iters = 0;
        while (truthy(evalExpr(s.cond, env))) {
          guardStep(s.line);
          if (++iters > 200000) fail(s.line, "while 循环执行了太多次，已自动停止——请检查循环条件，它可能永远成立（死循环）");
          try {
            runBlock(s.block, env);
          } catch (e) {
            if (e instanceof Ctrl && e.type === "break") break;
            if (e instanceof Ctrl && e.type === "continue") continue;
            throw e;
          }
        }
        return;
      }
      case "for": {
        const iter = evalExpr(s.iter, env);
        const items = toIterable(iter, s.line);
        let iters = 0;
        for (const item of items) {
          guardStep(s.line);
          if (++iters > 200000) fail(s.line, "for 循环执行了太多次，已自动停止——请检查循环范围");
          envSetLocal(env, s.var, item);
          try {
            runBlock(s.block, env);
          } catch (e) {
            if (e instanceof Ctrl && e.type === "break") break;
            if (e instanceof Ctrl && e.type === "continue") continue;
            throw e;
          }
        }
        return;
      }
      case "def": {
        envDeclare(env, s.name, {
          type: "function",
          name: s.name,
          params: s.params,
          block: s.block,
          closure: env,
        });
        return;
      }
      case "return": {
        const v = s.expr ? evalExpr(s.expr, env) : null;
        throw new Ctrl("return", v);
      }
      case "break": throw new Ctrl("break");
      case "continue": throw new Ctrl("continue");
      case "global": {
        for (const nm of s.names) envDeclare(env, nm, undefined);
        return;
      }
      default:
        fail(s.line, "这行语句我还不会执行");
    }
  }

  function evalExpr(e, env) {
    if (!e) return null;
    guardStep(e.line || 1);
    switch (e.type) {
      case "num": return e.v;
      case "str": return e.v;
      case "bool": return e.v;
      case "none": return null;
      case "name": {
        const v = envGet(env, e.name, e.line);
        if (v === undefined && env.vars.has(e.name)) return null;
        return v;
      }
      case "list": return e.items.map((it) => evalExpr(it, env));
      case "dict": {
        const d = {};
        for (const p of e.pairs) {
          const k = evalExpr(p.k, env);
          d[String(k)] = evalExpr(p.v, env);
        }
        return d;
      }
      case "unary": {
        const v = evalExpr(e.e, env);
        if (e.op === "-") return -v;
        if (e.op === "+") return +v;
        if (e.op === "not") return !truthy(v);
        fail(e.line, "一元运算符不认识");
        break;
      }
      case "binop": return doBinop(e.op, evalExpr(e.l, env), evalExpr(e.r, env), e.line);
      case "index": {
        const target = evalExpr(e.target, env);
        const idx = evalExpr(e.idx, env);
        if (Array.isArray(target)) {
          if (typeof idx !== "number" || idx % 1 !== 0) fail(e.line, "列表下标必须是整数");
          const real = idx < 0 ? target.length + idx : idx;
          if (real < 0 || real >= target.length) fail(e.line, "列表下标 " + idx + " 越界了（列表只有 " + target.length + " 项）");
          return target[real];
        }
        if (typeof target === "string") {
          if (typeof idx !== "number" || idx % 1 !== 0) fail(e.line, "字符串下标必须是整数");
          const real = idx < 0 ? target.length + idx : idx;
          if (real < 0 || real >= target.length) fail(e.line, "字符串下标 " + idx + " 越界了");
          return target[real];
        }
        if (typeof target === "object" && target !== null) {
          const v = target[String(idx)];
          if (v === undefined && !(String(idx) in target)) fail(e.line, "字典里没有键“" + idx + "”");
          return v;
        }
        fail(e.line, "这个值不能用 [下标] 取内容");
        break;
      }
      case "attr": {
        const target = evalExpr(e.target, env);
        if (target && typeof target === "object" && target.__methods && target.__methods[e.name]) {
          return target.__methods[e.name];
        }
        if (typeof target === "string" && e.name in STR_METHODS) {
          return function (...args) { return callStrMethod(e.name, target, args, e.line); };
        }
        if (Array.isArray(target) && e.name in LIST_METHODS) {
          return function (...args) { return callListMethod(e.name, target, args, e.line); };
        }
        if (typeof target === "object" && target !== null && e.name in DICT_METHODS) {
          return function (...args) { return callDictMethod(e.name, target, args, e.line); };
        }
        fail(e.line, "这个值没有叫“" + e.name + "”的属性或方法");
        break;
      }
      case "call": return callFunc(e.callee, e.args, env, e.line);
      default:
        fail(e.line || 1, "这个表达式我不会算");
    }
  }

  function callFunc(calleeNode, args, env, line) {
    // 内置函数：callee 是 name
    if (calleeNode.type === "name") {
      const fn = envGet(env, calleeNode.name, line);
      if (fn && fn.type === "function") {
        return invokeUserFn(fn, args, env, line);
      }
      if (typeof fn === "function") {
        return invokeBuiltin(fn, args, env, line);
      }
      fail(line, "“" + calleeNode.name + "”不能像函数一样调用");
    }
    // 方法调用 obj.method(...)
    if (calleeNode.type === "attr") {
      const m = evalExpr(calleeNode, env);
      if (typeof m !== "function") fail(line, "“" + calleeNode.name + "”不是可调用的方法");
      const vals = args.map((a) => a.kw ? fail(line, "这里不支持关键字参数") : evalExpr(a.value, env));
      return m.apply(null, vals);
    }
    // 其他表达式结果作为函数（少见）
    const fn = evalExpr(calleeNode, env);
    if (typeof fn === "function") return invokeBuiltin(fn, args, env, line);
    fail(line, "这个值不能作为函数调用");
  }

  function invokeUserFn(fn, args, env, line) {
    const local = makeEnv(fn.closure);
    const params = fn.params;
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (args[i] && args[i].kw) {
        if (args[i].kw === p.name) { envDeclare(local, p.name, evalExpr(args[i].value, env)); continue; }
      }
      if (i < args.length) envDeclare(local, p.name, evalExpr(args[i].value, env));
      else if (p.def !== null) envDeclare(local, p.name, evalExpr(p.def, env));
      else fail(line, "调用 " + fn.name + " 时少给了参数“" + p.name + "”");
    }
    if (args.length > params.length) fail(line, "调用 " + fn.name + " 时多给了参数（它只需要 " + params.length + " 个）");
    try {
      runBlock(fn.block, local);
    } catch (e) {
      if (e instanceof Ctrl && e.type === "return") return e.value;
      throw e;
    }
    return null;
  }

  function invokeBuiltin(fn, args, env, line) {
    const vals = [];
    for (const a of args) {
      if (a.kw) {
        if (!fn.__kw) fail(line, "这个函数不支持关键字参数");
        vals.push({ __kw: true, k: a.kw, v: evalExpr(a.value, env) });
      } else if (a.unpack) {
        const v = evalExpr(a.value, env);
        if (!Array.isArray(v)) fail(line, "* 解包只能展开列表或 range()");
        for (const item of v) vals.push(item);
      } else {
        vals.push(evalExpr(a.value, env));
      }
    }
    try {
      return fn.apply(null, vals);
    } catch (err) {
      if (err instanceof C.LangError) throw err;
      throw new C.LangError(err && err.message ? err.message : String(err), line);
    }
  }

  // 支持 sep/end 的 print 与其余内置函数
  function makeBuiltins2(io, out, guard) {
    const B = new Map();
    const fmt = (x) => {
      if (typeof x === "string") return x;
      if (x === true) return "True";
      if (x === false) return "False";
      if (x === null) return "None";
      return String(x);
    };

    const printFn = function (...args) {
      let sep = " ", end = "\n";
      const vals = [];
      for (const a of args) {
        if (a && a.__kw) { if (a.k === "sep") sep = a.v; else if (a.k === "end") end = a.v; }
        else vals.push(a);
      }
      out.write(vals.map(fmt).join(sep) + end);
      return null;
    };
    printFn.__kw = true;
    B.set("print", printFn);

    B.set("input", function (prompt) {
      if (prompt !== undefined) out.write(fmt(prompt));
      return io.readLine(1);
    });

    B.set("len", function (x) {
      if (typeof x === "string" || Array.isArray(x)) return x.length;
      if (x && typeof x === "object") return Object.keys(x).length;
      fail(1, "len() 只能统计文字或列表的长度");
    });

    B.set("range", function (a, b, c) {
      let start = 0, stop, step = 1;
      if (b === undefined) { stop = a; }
      else { start = a; stop = b; }
      if (c !== undefined) step = c;
      if (step === 0) fail(1, "range 的步长不能是 0");
      const items = [];
      if (step > 0) {
        for (let i = start; i < stop; i += step) {
          if (items.length > 100000) fail(1, "range 范围太大（超过 10 万个），请检查参数");
          items.push(i);
        }
      } else {
        for (let i = start; i > stop; i += step) {
          if (items.length > 100000) fail(1, "range 范围太大（超过 10 万个），请检查参数");
          items.push(i);
        }
      }
      return items;
    });

    B.set("int", function (x) {
      if (typeof x === "number") return Math.trunc(x);
      if (typeof x === "string") {
        const m = /^\s*(-?\d+)/.exec(x);
        if (m) return parseInt(m[1], 10);
        fail(1, "int() 转换失败：“" + x + "”不是数字");
      }
      if (typeof x === "boolean") return x ? 1 : 0;
      fail(1, "int() 只能把数字或数字文字转成整数");
    });
    B.set("float", function (x) {
      if (typeof x === "number") return x;
      if (typeof x === "string") {
        const m = /^\s*(-?\d+(\.\d+)?)/.exec(x);
        if (m) return parseFloat(m[1]);
        fail(1, "float() 转换失败：“" + x + "”不是数字");
      }
      fail(1, "float() 只能把数字或数字文字转成小数");
    });
    B.set("str", function (x) { return fmt(x); });
    B.set("bool", function (x) { return !!x; });
    B.set("abs", function (x) { return Math.abs(x); });
    B.set("min", function (...args) {
      const list = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      if (!list.length) fail(1, "min() 至少要有一个数字");
      return Math.min(...list);
    });
    B.set("max", function (...args) {
      const list = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      if (!list.length) fail(1, "max() 至少要有一个数字");
      return Math.max(...list);
    });
    B.set("sum", function (list) {
      if (!Array.isArray(list)) fail(1, "sum() 需要传一个列表");
      return list.reduce((a, b) => a + b, 0);
    });
    B.set("round", function (x, n) {
      if (n === undefined) return Math.round(x);
      const p = Math.pow(10, n);
      return Math.round(x * p) / p;
    });
    B.set("type", function (x) {
      if (x === null) return "<class 'NoneType'>";
      if (Array.isArray(x)) return "<class 'list'>";
      if (typeof x === "number") return "<class 'int'>";
      if (typeof x === "string") return "<class 'str'>";
      if (typeof x === "boolean") return "<class 'bool'>";
      return "<class 'dict'>";
    });
    B.set("list", function (x) {
      if (x === undefined) return [];
      if (typeof x === "string") return x.split("");
      if (Array.isArray(x)) return x.slice();
      fail(1, "list() 参数不认识");
    });
    B.set("sorted", function (list, reverse) {
      if (!Array.isArray(list)) fail(1, "sorted() 需要传一个列表");
      return list.slice().sort((a, b) => (reverse ? b - a : a - b));
    });
    return B;
  }

  const STR_METHODS = {
    upper: 0, lower: 0, strip: 0, split: 0, replace: 0, startswith: 0, endswith: 0, count: 0, find: 0,
  };
  const LIST_METHODS = { append: 0, pop: 0, insert: 0, remove: 0, count: 0, index: 0, sort: 0, reverse: 0 };
  const DICT_METHODS = { keys: 0, values: 0, items: 0, get: 0 };

  function callStrMethod(name, s, args, line) {
    const a = (i) => args[i];
    switch (name) {
      case "upper": return s.toUpperCase();
      case "lower": return s.toLowerCase();
      case "strip": return s.trim();
      case "split": return a(0) === undefined ? s.split(/\s+/).filter(Boolean) : s.split(String(a(0)));
      case "replace": {
        if (a(1) === undefined) fail(line, "replace 需要两个参数：replace(旧, 新)");
        return s.split(String(a(0))).join(String(a(1)));
      }
      case "startswith": return s.startsWith(String(a(0)));
      case "endswith": return s.endsWith(String(a(0)));
      case "count": return a(0) === undefined ? 0 : s.split(String(a(0))).length - 1;
      case "find": return s.indexOf(String(a(0)));
      default: fail(line, "字符串方法 " + name + " 暂不支持");
    }
  }
  function callListMethod(name, arr, args, line) {
    switch (name) {
      case "append": if (args.length !== 1) fail(line, "append 需要一个参数"); arr.push(args[0]); return null;
      case "pop": return arr.pop();
      case "insert": {
        if (args.length !== 2) fail(line, "insert 需要两个参数：insert(位置, 值)");
        arr.splice(args[0], 0, args[1]); return null;
      }
      case "remove": {
        const idx = arr.indexOf(args[0]);
        if (idx < 0) fail(line, "remove：列表里没有这个值");
        arr.splice(idx, 1); return null;
      }
      case "count": return arr.filter((x) => x === args[0]).length;
      case "index": {
        const idx = arr.indexOf(args[0]);
        if (idx < 0) fail(line, "index：列表里没有这个值");
        return idx;
      }
      case "sort": arr.sort((x, y) => (typeof x === "string" && typeof y === "string" ? String(x).localeCompare(String(y)) : x - y)); return null;
      case "reverse": arr.reverse(); return null;
      default: fail(line, "列表方法 " + name + " 暂不支持");
    }
  }
  function callDictMethod(name, d, args, line) {
    switch (name) {
      case "keys": return Object.keys(d);
      case "values": return Object.values(d);
      case "items": return Object.entries(d).map(([k, v]) => [k, v]);
      case "get": return d[String(args[0])] === undefined ? args[1] : d[String(args[0])];
      default: fail(line, "字典方法 " + name + " 暂不支持");
    }
  }

  function toIterable(x, line) {
    if (Array.isArray(x)) return x;
    if (typeof x === "string") return x.split("");
    if (x && typeof x === "object") return Object.entries(x).map(([k, v]) => [k, v]);
    fail(line, "这个值不能用来遍历（for … in 后面要跟列表、文字或 range()）");
  }

  function truthy(x) {
    if (x === null) return false;
    if (typeof x === "boolean") return x;
    if (typeof x === "number") return x !== 0;
    if (typeof x === "string") return x.length > 0;
    if (Array.isArray(x)) return x.length > 0;
    return true;
  }

  function doBinop(op, l, r, line) {
    switch (op) {
      case "+":
        if (typeof l === "string" || typeof r === "string") return String(l) + String(r);
        return l + r;
      case "-": return l - r;
      case "*":
        if (typeof l === "string" && typeof r === "number") return l.repeat(Math.max(0, Math.floor(r)));
        if (typeof r === "string" && typeof l === "number") return r.repeat(Math.max(0, Math.floor(l)));
        return l * r;
      case "/":
        if (r === 0) fail(line, "不能除以 0（除数不能是 0）");
        return l / r;
      case "//":
        if (r === 0) fail(line, "不能除以 0（除数不能是 0）");
        return Math.floor(l / r);
      case "%":
        if (r === 0) fail(line, "不能除以 0（取余时除数也不能是 0）");
        return l % r;
      case "**": return Math.pow(l, r);
      case "==": return l === r;
      case "!=": return l !== r;
      case "<": return l < r;
      case ">": return l > r;
      case "<=": return l <= r;
      case ">=": return l >= r;
      case "and": return truthy(l) ? r : l;
      case "or": return truthy(l) ? l : r;
      case "in":
        if (Array.isArray(r)) return r.includes(l);
        if (typeof r === "string") return r.includes(String(l));
        if (r && typeof r === "object") return String(l) in r;
        fail(line, "in 的右边必须是列表、文字或字典");
        break;
      case "not in":
        if (Array.isArray(r)) return !r.includes(l);
        if (typeof r === "string") return !r.includes(String(l));
        if (r && typeof r === "object") return !(String(l) in r);
        fail(line, "not in 的右边必须是列表、文字或字典");
        break;
      default:
        fail(line, "运算符 " + op + " 暂不支持");
    }
  }

  let guardRef = null;
  function guardStep(line) {
    if (guardRef) guardRef.step();
    void line;
  }

  /* ================= 对外接口 ================= */
  window.InterpPython = {
    run: function (code, opts) {
      opts = opts || {};
      const C2 = window.InterpCommon;
      try {
        const program = parse(code);
        // 运行前先执行一次 dry parse 校验
        void program;
        const guard = new C2.StepGuard(opts.maxSteps);
        guardRef = guard;
        const io = new C2.InputSource(opts.input || "");
        const out = new C2.OutputBuffer();
        const builtins = makeBuiltins2(io, out, guard);
        const globals = makeEnv(null);
        for (const [k, v] of builtins) globals.vars.set(k, v);
        const t0 = Date.now();
        runBlock(program, globals);
        return { ok: true, output: out.get(), ms: Date.now() - t0 };
      } catch (err) {
        return {
          ok: false,
          output: "",
          error: C2.friendlyError(err),
          ms: 0,
        };
      } finally {
        guardRef = null;
      }
    },
  };
})();
