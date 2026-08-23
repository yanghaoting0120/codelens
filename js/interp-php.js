/* ============================================================
   译码 CodeLens · PHP 迷你解释器（教学子集）
   支持：<?php / echo / print / $变量 / 字符串插值 / 数组与关联数组 /
        foreach / for / while / if-elseif-else / function / return /
        常用内置函数（count / strlen / implode / explode / print_r …）
   纯本地实现，步数保护防死循环，报错为通俗中文
   ============================================================ */
(function () {
  "use strict";

  const C = window.InterpCommon;

  function fail(line, msg) {
    throw new C.LangError(msg, line);
  }

  /* ================= 词法 ================= */

  function tokenize(src) {
    // 跳过 <?php 和 ?>（先做替换，长度以替换后为准）
    src = src.replace(/<\?php/gi, " ").replace(/\?>/g, " ");
    const tokens = [];
    let i = 0;
    let line = 1;
    const n = src.length;

    while (i < n) {
      const c = src[i];
      if (c === "\n") { line++; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === "#") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === "/" && src[i + 1] === "*") {
        i += 2;
        while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
          if (src[i] === "\n") line++;
          i++;
        }
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") {
        const quote = c;
        let j = i + 1;
        let s = "";
        let interp = quote === '"';
        while (j < n && src[j] !== quote) {
          if (src[j] === "\\") {
            const e = src[j + 1];
            s += e === "n" ? "\n" : e === "t" ? "\t" : e === "\\" ? "\\" : e === '"' ? '"' : e === "'" ? "'" : e === "$" ? "$" : e;
            j += 2;
          } else { s += src[j]; j++; }
        }
        if (j >= n) fail(line, "字符串缺少结尾的" + (quote === '"' ? "双引号" : "单引号"));
        tokens.push({ t: "str", v: s, interp, line });
        i = j + 1;
        continue;
      }
      if (c === "$") {
        const m = /^\$([A-Za-z_]\w*)/.exec(src.slice(i));
        if (m) { tokens.push({ t: "var", v: m[1], line }); i += m[0].length; continue; }
        fail(line, "$ 后面要跟变量名");
      }
      if (/[0-9]/.test(c)) {
        const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i));
        tokens.push({ t: "num", v: parseFloat(m[0]), f: !!m[1], line });
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const m = /^[A-Za-z_]\w*/.exec(src.slice(i));
        tokens.push({ t: "id", v: m[0], line });
        i += m[0].length;
        continue;
      }
      const two = src.slice(i, i + 2);
      if (["==", "!=", "===", "!==", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "%=", ".=", "=>", "??"].includes(two)) {
        tokens.push({ t: "op", v: two, line });
        i += 2;
        continue;
      }
      if ("+-*/%(){}[];,:.<>!=&|^~?".includes(c)) {
        tokens.push({ t: "op", v: c, line });
        i++;
        continue;
      }
      fail(line, "这里有我不认识的符号“" + c + "”");
    }
    tokens.push({ t: "eof", v: "", line });
    return tokens;
  }

  /* ================= 语法解析 ================= */

  function parse(src) {
    const toks = tokenize(src);
    let pos = 0;
    const peek = () => toks[pos];
    const next = () => toks[pos++];
    const isOp = (t, v) => t && t.t !== "eof" && t.v === v;
    const isId = (t, v) => t && t.t === "id" && (v === undefined || t.v === v);
    const isVar = (t) => t && t.t === "var";
    const L = () => toks[pos].line;

    const program = [];

    while (peek().t !== "eof") {
      program.push(parseStatement());
    }
    return program;

    function parseStatement() {
      const line = L();
      const t = peek();

      if (isOp(t, "{")) {
        next();
        const body = [];
        while (!isOp(peek(), "}") && peek().t !== "eof") body.push(parseStatement());
        if (!isOp(peek(), "}")) fail(L(), "代码块的 } 丢了");
        next();
        return { type: "block", body, line };
      }
      if (isOp(t, ";")) { next(); return { type: "noop", line }; }

      if (isId(t, "if")) {
        next();
        if (!isOp(peek(), "(")) fail(L(), "if 后面要跟 ( 条件 )");
        next();
        const cond = parseExpr();
        if (!isOp(peek(), ")")) fail(L(), "if 的右括号丢了");
        next();
        const thenS = parseStatement();
        let elseifs = [];
        let elseS = null;
        while (isId(peek(), "elseif")) {
          next();
          if (!isOp(peek(), "(")) fail(L(), "elseif 后面要跟 ( 条件 )");
          next();
          const c = parseExpr();
          if (!isOp(peek(), ")")) fail(L(), "elseif 的右括号丢了");
          next();
          elseifs.push({ cond: c, body: parseStatement() });
        }
        if (isId(peek(), "else")) {
          next();
          elseS = parseStatement();
        }
        return { type: "if", cond, thenS, elseifs, elseS, line };
      }

      if (isId(t, "while")) {
        next();
        if (!isOp(peek(), "(")) fail(L(), "while 后面要跟 ( 条件 )");
        next();
        const cond = parseExpr();
        if (!isOp(peek(), ")")) fail(L(), "while 的右括号丢了");
        next();
        const body = parseStatement();
        return { type: "while", cond, body, line };
      }

      if (isId(t, "foreach")) {
        next();
        if (!isOp(peek(), "(")) fail(L(), "foreach 后面要跟 ( 括号 )");
        next();
        const arr = parseExpr();
        if (!isId(peek(), "as")) fail(L(), "foreach 的写法是：foreach ($数组 as $变量)");
        next();
        let keyVar = null, valVar = null;
        if (isVar(peek())) {
          valVar = peek().v;
          next();
          if (isOp(peek(), "=>")) {
            next();
            keyVar = valVar;
            if (!isVar(peek())) fail(L(), "=> 后面要写值变量，例如 foreach ($a as $k => $v)");
            valVar = peek().v;
            next();
          }
        } else {
          fail(L(), "foreach 的 as 后面要写 $变量");
        }
        if (!isOp(peek(), ")")) fail(L(), "foreach 的右括号丢了");
        next();
        const body = parseStatement();
        return { type: "foreach", arr, keyVar, valVar, body, line };
      }

      if (isId(t, "for")) {
        next();
        if (!isOp(peek(), "(")) fail(L(), "for 后面要跟 ( 括号 )");
        next();
        let init = null;
        if (!isOp(peek(), ";")) init = parseExpr();
        if (!isOp(peek(), ";")) fail(L(), "for 的三个部分要用 ; 分隔");
        next();
        let cond = null;
        if (!isOp(peek(), ";")) cond = parseExpr();
        if (!isOp(peek(), ";")) fail(L(), "for 的三个部分要用 ; 分隔");
        next();
        let update = null;
        if (!isOp(peek(), ")")) update = parseExpr();
        if (!isOp(peek(), ")")) fail(L(), "for 的右括号丢了");
        next();
        const body = parseStatement();
        return { type: "for", init, cond, update, body, line };
      }

      if (isId(t, "function")) {
        next();
        const name = peek();
        if (!name || name.t !== "id") fail(L(), "function 后面要写函数名");
        next();
        if (!isOp(peek(), "(")) fail(L(), "函数名后面要跟 ( 参数 )");
        next();
        const params = [];
        while (!isOp(peek(), ")")) {
          if (isOp(peek(), ",")) { next(); continue; }
          if (!isVar(peek())) fail(L(), "函数参数要写成 $变量 的形式");
          const pv = peek().v;
          next();
          let def = null;
          if (isOp(peek(), "=")) {
            next();
            def = parseExpr();
          }
          params.push({ name: pv, def });
        }
        next();
        if (!isOp(peek(), "{")) fail(L(), "函数体要用 { 包起来");
        next();
        const body = [];
        while (!isOp(peek(), "}") && peek().t !== "eof") body.push(parseStatement());
        if (!isOp(peek(), "}")) fail(L(), "函数体的 } 丢了");
        next();
        return { type: "func", name: name.v, params, body, line };
      }

      if (isId(t, "return")) {
        next();
        let expr = null;
        if (!isOp(peek(), ";")) expr = parseExpr();
        if (!isOp(peek(), ";")) fail(L(), "return 后面要加 ;");
        next();
        return { type: "return", expr, line };
      }
      if (isId(t, "break")) {
        next();
        if (!isOp(peek(), ";")) fail(L(), "break 后面要加 ;");
        next();
        return { type: "break", line };
      }
      if (isId(t, "continue")) {
        next();
        if (!isOp(peek(), ";")) fail(L(), "continue 后面要加 ;");
        next();
        return { type: "continue", line };
      }
      if (isId(t, "echo")) {
        next();
        const items = [];
        items.push(parseExpr());
        while (isOp(peek(), ",")) {
          next();
          items.push(parseExpr());
        }
        if (!isOp(peek(), ";")) fail(L(), "echo 语句要以 ; 结尾");
        next();
        return { type: "echo", items, line };
      }
      if (isId(t, "print")) {
        next();
        const expr = parseExpr();
        if (!isOp(peek(), ";")) fail(L(), "print 语句要以 ; 结尾");
        next();
        return { type: "echo", items: [expr], line };
      }

      // 表达式语句（赋值 / 调用）
      const expr = parseExpr();
      if (!isOp(peek(), ";")) fail(L(), "这条语句结尾要加 ;");
      next();
      return { type: "expr", expr, line };
    }

    /* ---------- 表达式 ---------- */
    function parseExpr() { return parseAssign(); }

    function parseAssign() {
      const left = parseTernary();
      const t = peek();
      if (t.t === "op" && ["=", "+=", "-=", "*=", "/=", "%=", ".="].includes(t.v)) {
        next();
        const rhs = parseAssign();
        return { type: "assign", lhs: left, op: t.v, rhs, line: left.line };
      }
      return left;
    }

    function parseTernary() {
      const cond = parseOr();
      if (isOp(peek(), "?")) {
        next();
        const a = parseExpr();
        if (!isOp(peek(), ":")) fail(L(), "三元运算符 ? 和 : 要配对");
        next();
        const b = parseExpr();
        return { type: "ternary", cond, a, b, line: cond.line };
      }
      return cond;
    }
    function parseOr() {
      let left = parseAnd();
      while (isOp(peek(), "||")) { next(); left = { type: "binop", op: "||", l: left, r: parseAnd(), line: left.line }; }
      return left;
    }
    function parseAnd() {
      let left = parseEquality();
      while (isOp(peek(), "&&")) { next(); left = { type: "binop", op: "&&", l: left, r: parseEquality(), line: left.line }; }
      return left;
    }
    function parseEquality() {
      let left = parseRelational();
      while (isOp(peek(), "==") || isOp(peek(), "!=") || isOp(peek(), "===") || isOp(peek(), "!==")) {
        const op = next().v;
        left = { type: "binop", op, l: left, r: parseRelational(), line: left.line };
      }
      return left;
    }
    function parseRelational() {
      let left = parseConcat();
      while (isOp(peek(), "<") || isOp(peek(), ">") || isOp(peek(), "<=") || isOp(peek(), ">=")) {
        const op = next().v;
        left = { type: "binop", op, l: left, r: parseConcat(), line: left.line };
      }
      return left;
    }
    function parseConcat() {
      let left = parseAdditive();
      while (isOp(peek(), ".")) {
        next();
        left = { type: "binop", op: ".", l: left, r: parseAdditive(), line: left.line };
      }
      return left;
    }
    function parseAdditive() {
      let left = parseMultiplicative();
      while (isOp(peek(), "+") || isOp(peek(), "-")) {
        const op = next().v;
        left = { type: "binop", op, l: left, r: parseMultiplicative(), line: left.line };
      }
      return left;
    }
    function parseMultiplicative() {
      let left = parseUnary();
      while (isOp(peek(), "*") || isOp(peek(), "/") || isOp(peek(), "%")) {
        const op = next().v;
        left = { type: "binop", op, l: left, r: parseUnary(), line: left.line };
      }
      return left;
    }
    function parseUnary() {
      const t = peek();
      if (t.t === "op" && ["!", "-", "+", "++", "--"].includes(t.v)) {
        next();
        return { type: "unary", op: t.v, e: parseUnary(), line: t.line };
      }
      return parsePostfix();
    }
    function parsePostfix() {
      let e = parsePrimary();
      for (;;) {
        if (isOp(peek(), "(")) {
          next();
          const args = [];
          while (!isOp(peek(), ")")) {
            args.push(parseExpr());
            if (isOp(peek(), ",")) next();
            else break;
          }
          if (!isOp(peek(), ")")) fail(L(), "函数调用的右括号丢了");
          next();
          e = { type: "call", callee: e, args, line: e.line };
          continue;
        }
        if (isOp(peek(), "[")) {
          next();
          // 空下标 $a[] = 值（数组追加）
          if (isOp(peek(), "]")) {
            next();
            e = { type: "push", target: e, line: e.line };
            continue;
          }
          const idx = parseExpr();
          if (!isOp(peek(), "]")) fail(L(), "下标的中括号丢了");
          next();
          e = { type: "index", target: e, idx, line: e.line };
          continue;
        }
        if (isOp(peek(), "++") || isOp(peek(), "--")) {
          const op = next().v;
          e = { type: "postfix", op, e, line: e.line };
          continue;
        }
        break;
      }
      return e;
    }
    function parsePrimary() {
      const t = peek();
      if (!t || t.t === "eof") fail(L(), "这里缺少一个值（数字、文字、变量等）");
      if (t.t === "num") { next(); return { type: "num", v: t.v, f: t.f, line: t.line }; }
      if (t.t === "str") { next(); return { type: "str", v: t.v, interp: t.interp, line: t.line }; }
      if (t.t === "var") { next(); return { type: "var", name: t.v, line: t.line }; }
      if (t.t === "id") {
        next();
        if (t.v === "true") return { type: "bool", v: true, line: t.line };
        if (t.v === "false") return { type: "bool", v: false, line: t.line };
        if (t.v === "null") return { type: "null", line: t.line };
        if (t.v === "array" && isOp(peek(), "(")) {
          // array(1, 2, 3)
          next();
          const items = [];
          while (!isOp(peek(), ")")) {
            if (isOp(peek(), ",")) { next(); continue; }
            items.push(parseArrayItem());
          }
          if (!isOp(peek(), ")")) fail(L(), "array( 的右括号丢了");
          next();
          return { type: "arrlit", items, line: t.line };
        }
        return { type: "name", name: t.v, line: t.line };
      }
      if (isOp(t, "(")) {
        next();
        const e = parseExpr();
        if (!isOp(peek(), ")")) fail(L(), "小括号没配对");
        next();
        return e;
      }
      if (isOp(t, "[")) {
        // 数组字面量 [1, 2, 3] 或 ["k" => v]
        next();
        const items = [];
        while (!isOp(peek(), "]")) {
          items.push(parseArrayItem());
          if (isOp(peek(), ",")) next();
          else break;
        }
        if (!isOp(peek(), "]")) fail(L(), "数组的中括号 ] 丢了");
        next();
        return { type: "arrlit", items, line: t.line };
      }
      fail(L(), "这里有个值我没看懂");
    }

    function parseArrayItem() {
      const k = parseExpr();
      if (isOp(peek(), "=>")) {
        next();
        const v = parseExpr();
        return { key: k, value: v };
      }
      return { value: k };
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
    fail(line, "变量 $" + name + " 还没赋值——先给它赋值再使用");
  }
  function envSet(env, name, val, line) {
    let e = env;
    while (e) {
      if (e.vars.has(name)) { e.vars.set(name, val); return; }
      e = e.parent;
    }
    env.vars.set(name, val);
  }

  // 值：数字 / 字符串 / 布尔 / null / 数组（JS 数组 + 字符串属性做关联键）
  const ARR = (items) => {
    const a = items || [];
    return a;
  };
  function isArr(v) { return Array.isArray(v); }

  function toStr(v, line) {
    if (v === null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "boolean") return v ? "1" : "";
    if (typeof v === "number") return String(v);
    if (isArr(v)) return "Array";
    return String(v);
  }
  function toNum(v, line) {
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const m = /^\s*(-?\d+(\.\d+)?)/.exec(v);
      if (m) return parseFloat(m[1]);
      fail(line, "这里需要数字，但“" + v + "”不是数字");
    }
    if (typeof v === "boolean") return v ? 1 : 0;
    fail(line, "这个值不能当数字用");
  }
  function truthy(v) {
    if (v === null) return false;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") return v.length > 0 && v !== "0";
    if (isArr(v)) return true;
    return true;
  }

  class Ctrl { constructor(type, value) { this.type = type; this.value = value; } }

  function execute(program, opts) {
    const guard = new C.StepGuard(opts.maxSteps);
    const out = new C.OutputBuffer();
    const t0 = Date.now();
    const globalEnv = makeEnv(null);
    const funcs = {};
    const ctx = { guard, out, funcs, globalEnv };

    // 先收集函数定义
    for (const s of program) {
      if (s.type === "func") funcs[s.name] = s;
    }
    // 顶层代码（函数定义之外的语句）
    const top = program.filter((s) => s.type !== "func");

    try {
      runBlock(top, globalEnv, ctx);
      return { ok: true, output: out.get(), ms: Date.now() - t0 };
    } catch (err) {
      return { ok: false, output: out.get(), error: C.friendlyError(err), ms: Date.now() - t0 };
    }
  }

  function runBlock(body, env, ctx) {
    for (const s of body) runStmt(s, env, ctx);
  }

  function runStmt(s, env, ctx) {
    ctx.guard.step();
    switch (s.type) {
      case "noop": return;
      case "block": {
        const local = makeEnv(env);
        runBlock(s.body, local, ctx);
        return;
      }
      case "expr": evalExpr(s.expr, env, ctx); return;
      case "echo": {
        for (const item of s.items) {
          ctx.out.write(toStr(evalExpr(item, env, ctx), s.line));
        }
        return;
      }
      case "if": {
        if (truthy(evalExpr(s.cond, env, ctx))) { runStmt(s.thenS, env, ctx); return; }
        for (const es of s.elseifs) {
          if (truthy(evalExpr(es.cond, env, ctx))) { runStmt(es.body, env, ctx); return; }
        }
        if (s.elseS) runStmt(s.elseS, env, ctx);
        return;
      }
      case "while": {
        let iters = 0;
        while (truthy(evalExpr(s.cond, env, ctx))) {
          ctx.guard.step();
          if (++iters > 200000) fail(s.line, "while 循环执行了太多次，已自动停止——可能是死循环（条件永远成立）");
          try { runStmt(s.body, env, ctx); }
          catch (e) {
            if (e instanceof Ctrl && e.type === "break") break;
            if (e instanceof Ctrl && e.type === "continue") continue;
            throw e;
          }
        }
        return;
      }
      case "for": {
        if (s.init) evalExpr(s.init, env, ctx);
        let iters = 0;
        while (!s.cond || truthy(evalExpr(s.cond, env, ctx))) {
          ctx.guard.step();
          if (++iters > 200000) fail(s.line, "for 循环执行了太多次，已自动停止——可能是死循环");
          try { runStmt(s.body, env, ctx); }
          catch (e) {
            if (e instanceof Ctrl && e.type === "break") break;
            if (e instanceof Ctrl && e.type === "continue") { if (s.update) evalExpr(s.update, env, ctx); continue; }
            throw e;
          }
          if (s.update) evalExpr(s.update, env, ctx);
        }
        return;
      }
      case "foreach": {
        const arr = evalExpr(s.arr, env, ctx);
        if (!isArr(arr)) fail(s.line, "foreach 只能遍历数组");
        const local = makeEnv(env);
        let iters = 0;
        for (let i = 0; i < arr.length; i++) {
          ctx.guard.step();
          if (++iters > 200000) fail(s.line, "foreach 循环执行了太多次，已自动停止");
          if (s.keyVar) local.vars.set(s.keyVar, i);
          local.vars.set(s.valVar, arr[i]);
          try { runStmt(s.body, local, ctx); }
          catch (e) {
            if (e instanceof Ctrl && e.type === "break") break;
            if (e instanceof Ctrl && e.type === "continue") continue;
            throw e;
          }
        }
        // 关联键
        for (const k of Object.keys(arr)) {
          if (/^\d+$/.test(k)) continue;
          ctx.guard.step();
          if (++iters > 200000) fail(s.line, "foreach 循环执行了太多次，已自动停止");
          if (s.keyVar) local.vars.set(s.keyVar, k);
          local.vars.set(s.valVar, arr[k]);
          try { runStmt(s.body, local, ctx); }
          catch (e) {
            if (e instanceof Ctrl && e.type === "break") break;
            if (e instanceof Ctrl && e.type === "continue") continue;
            throw e;
          }
        }
        return;
      }
      case "return": {
        const v = s.expr ? evalExpr(s.expr, env, ctx) : null;
        throw new Ctrl("return", v);
      }
      case "break": throw new Ctrl("break");
      case "continue": throw new Ctrl("continue");
      default:
        fail(s.line, "这条语句我还不会执行");
    }
  }

  function assignTo(lhs, rhs, op, env, ctx) {
    const line = lhs.line || 1;
    if (lhs.type === "var" || lhs.type === "name") {
      if (op === "=") { envSet(env, lhs.name, rhs, line); return; }
      const cur = envGet(env, lhs.name, line);
      const val = doBinop(op.slice(0, -1), cur, rhs, line);
      envSet(env, lhs.name, val, line);
      return;
    }
    if (lhs.type === "index") {
      const target = evalExpr(lhs.target, env, ctx);
      if (!isArr(target)) fail(line, "a[下标] 只能用于数组");
      const idx = evalExpr(lhs.idx, env, ctx);
      const k = typeof idx === "number" ? idx : toStr(idx, line);
      if (typeof k === "number") {
        if (k < 0 || k >= target.length) fail(line, "数组下标 " + k + " 越界了（数组只有 " + target.length + " 项）");
        target[k] = op === "=" ? rhs : doBinop(op.slice(0, -1), target[k], rhs, line);
      } else {
        target[k] = op === "=" ? rhs : doBinop(op.slice(0, -1), target[k], rhs, line);
      }
      return;
    }
    if (lhs.type === "push") {
      const target = evalExpr(lhs.target, env, ctx);
      if (!isArr(target)) fail(line, "$a[] = 值 只能用于数组");
      target.push(rhs);
      return;
    }
    fail(line, "赋值左边写得不认识");
  }

  function evalExpr(e, env, ctx) {
    ctx.guard.step();
    switch (e.type) {
      case "assign": {
        const rhs = evalExpr(e.rhs, env, ctx);
        assignTo(e.lhs, rhs, e.op, env, ctx);
        return rhs;
      }
      case "num": return e.f ? e.v : Math.trunc(e.v);
      case "bool": return e.v;
      case "null": return null;
      case "str": {
        if (!e.interp) return e.v;
        // 双引号字符串插值 $var
        return e.v.replace(/\$([A-Za-z_]\w*)/g, (m, name) => {
          try {
            const v = envGet(env, name, e.line);
            return v === null ? "" : toStr(v, e.line);
          } catch (err) {
            return m; // 保持原样（PHP 会警告但不报错）
          }
        });
      }
      case "var": return envGet(env, e.name, e.line);
      case "name": return envGet(env, e.name, e.line);
      case "arrlit": {
        const arr = ARR();
        for (const item of e.items) {
          if (item.key) {
            const k = evalExpr(item.key, env, ctx);
            arr[toStr(k, e.line)] = evalExpr(item.value, env, ctx);
          } else {
            arr.push(evalExpr(item.value, env, ctx));
          }
        }
        return arr;
      }
      case "ternary": {
        return truthy(evalExpr(e.cond, env, ctx)) ? evalExpr(e.a, env, ctx) : evalExpr(e.b, env, ctx);
      }
      case "unary": {
        if (e.op === "!") return !truthy(evalExpr(e.e, env, ctx));
        if (e.op === "-") return -toNum(evalExpr(e.e, env, ctx), e.line);
        if (e.op === "+") return toNum(evalExpr(e.e, env, ctx), e.line);
        if (e.op === "++" || e.op === "--") {
          const cur = envGet(env, e.e.name, e.line);
          const next = e.op === "++" ? toNum(cur, e.line) + 1 : toNum(cur, e.line) - 1;
          envSet(env, e.e.name, next, e.line);
          return cur;
        }
        fail(e.line, "一元运算符 " + e.op + " 暂不支持");
        break;
      }
      case "postfix": {
        const cur = envGet(env, e.e.name, e.line);
        const next = e.op === "++" ? toNum(cur, e.line) + 1 : toNum(cur, e.line) - 1;
        envSet(env, e.e.name, next, e.line);
        return cur;
      }
      case "binop": return doBinop(e.op, evalExpr(e.l, env, ctx), evalExpr(e.r, env, ctx), e.line);
      case "index": {
        const target = evalExpr(e.target, env, ctx);
        const idx = evalExpr(e.idx, env, ctx);
        if (!isArr(target)) fail(e.line, "这个值不能加 [下标]（下标只能用于数组）");
        const k = typeof idx === "number" ? idx : toStr(idx, e.line);
        if (typeof k === "number") {
          if (k < 0 || k >= target.length) fail(e.line, "数组下标 " + k + " 越界了（数组只有 " + target.length + " 项）");
          return target[k];
        }
        return target[k] === undefined ? null : target[k];
      }
      case "call": return callFunc(e, env, ctx);
      default:
        fail(e.line, "这个表达式我不会算");
    }
  }

  function callFunc(e, env, ctx) {
    if (e.callee.type === "name" || e.callee.type === "var") {
      const name = e.callee.name;
      const args = e.args.map((a) => evalExpr(a, env, ctx));
      // 内置函数
      const builtin = BUILTINS[name];
      if (builtin) {
        try {
          return builtin(args, e.line, env, ctx);
        } catch (err) {
          if (err instanceof C.LangError) throw err;
          throw new C.LangError(err && err.message ? err.message : String(err), e.line);
        }
      }
      const fn = ctx.funcs[name];
      if (fn) {
        const local = makeEnv(ctx.globalEnv);
        fn.params.forEach((p, i) => {
          if (i < args.length) {
            local.vars.set(p.name, isArr(args[i]) ? args[i].slice() : args[i]);
          } else if (p.def) {
            local.vars.set(p.name, evalExpr(p.def, ctx.globalEnv, ctx));
          } else {
            local.vars.set(p.name, null);
          }
        });
        try {
          runBlock(fn.body, local, ctx);
        } catch (err) {
          if (err instanceof Ctrl && err.type === "return") return err.value;
          throw err;
        }
        return null;
      }
      fail(e.line, "函数 " + name + " 没有定义");
    }
    fail(e.line, "这个值不能当函数调用");
  }

  const BUILTINS = {
    count: (a, line) => {
      if (!a.length || !isArr(a[0])) fail(line, "count() 需要传一个数组");
      const arr = a[0];
      const assocKeys = Object.keys(arr).filter((k) => !/^\d+$/.test(k));
      return arr.length + assocKeys.length;
    },
    strlen: (a, line) => {
      if (!a.length) fail(line, "strlen() 需要一个参数");
      return toStr(a[0], line).length;
    },
    implode: (a, line) => {
      const glue = a.length > 1 ? toStr(a[0], line) : "";
      const arr = a.length > 1 ? a[1] : a[0];
      if (!isArr(arr)) fail(line, "implode() 需要传数组");
      return arr.map((x) => toStr(x, line)).join(glue);
    },
    explode: (a, line) => {
      if (a.length < 2) fail(line, "explode(分隔符, 字符串) 需要两个参数");
      return toStr(a[1], line).split(toStr(a[0], line));
    },
    print_r: (a, line, env, ctx) => {
      if (!a.length) fail(line, "print_r() 需要一个参数");
      ctx.out.write(formatPrintR(a[0], 0));
      return null;
    },
    var_dump: (a, line, env, ctx) => {
      for (const v of a) {
        ctx.out.write(dumpVar(v) + "\n");
      }
      return null;
    },
    range: (a, line) => {
      if (a.length < 2) fail(line, "range(开始, 结束) 需要两个参数");
      const items = [];
      const from = toNum(a[0], line), to = toNum(a[1], line);
      const step = a.length > 2 ? Math.abs(toNum(a[2], line)) : 1;
      if (from <= to) for (let i = from; i <= to; i += step) items.push(i);
      else for (let i = from; i >= to; i -= step) items.push(i);
      return ARR(items);
    },
    min: (a, line) => Math.min(...(isArr(a[0]) ? a[0] : a).map((x) => toNum(x, line))),
    max: (a, line) => Math.max(...(isArr(a[0]) ? a[0] : a).map((x) => toNum(x, line))),
    abs: (a, line) => Math.abs(toNum(a[0], line)),
    strtoupper: (a) => toStr(a[0]).toUpperCase(),
    strtolower: (a) => toStr(a[0]).toLowerCase(),
    trim: (a) => toStr(a[0]).trim(),
    str_replace: (a, line) => {
      if (a.length < 3) fail(line, "str_replace(旧, 新, 字符串) 需要三个参数");
      return toStr(a[2], line).split(toStr(a[0], line)).join(toStr(a[1], line));
    },
    substr: (a, line) => {
      if (a.length < 2) fail(line, "substr(字符串, 开始) 需要至少两个参数");
      const s = toStr(a[0], line);
      const start = toNum(a[1], line);
      const len = a.length > 2 ? toNum(a[2], line) : undefined;
      return len === undefined ? s.slice(start) : s.slice(start, start + len);
    },
    isset: (a, line, env) => {
      for (const v of a) {
        if (v === null) return false;
      }
      return true;
    },
    empty: (a) => !truthy(a[0]),
    unset: (a, line, env, ctx) => {
      for (const v of a) {
        if (v && v.__ref) envSet(env, v.__ref, null, line);
      }
      return null;
    },
    sprintf: (a, line) => {
      const fmt = toStr(a[0], line);
      let ai = 1;
      return fmt.replace(/%([dsf])/g, (m, f) => {
        const v = a[ai++];
        if (f === "d") return String(Math.trunc(toNum(v, line)));
        if (f === "f") return toNum(v, line).toFixed(2);
        return toStr(v, line);
      });
    },
  };

  function formatPrintR(v, depth) {
    const pad = "  ".repeat(depth);
    if (isArr(v)) {
      const parts = [];
      for (let i = 0; i < v.length; i++) parts.push(pad + "  [" + i + "] => " + formatPrintR(v[i], depth + 1));
      for (const k of Object.keys(v)) {
        if (/^\d+$/.test(k)) continue;
        parts.push(pad + "  [" + k + "] => " + formatPrintR(v[k], depth + 1));
      }
      return "Array\n(\n" + parts.join("\n") + "\n" + pad + ")";
    }
    return toStr(v);
  }
  function dumpVar(v) {
    if (v === null) return "NULL";
    if (typeof v === "boolean") return "bool(" + (v ? "true" : "false") + ")";
    if (typeof v === "number") return (v % 1 === 0 ? "int(" + v + ")" : "float(" + v + ")");
    if (typeof v === "string") return "string(" + v.length + ") \"" + v + "\"";
    if (isArr(v)) return "array(" + v.length + ")";
    return String(v);
  }

  function doBinop(op, l, r, line) {
    if (op === ".") return toStr(l, line) + toStr(r, line);
    if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%") {
      const a = toNum(l, line), b = toNum(r, line);
      switch (op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/":
          if (b === 0) fail(line, "不能除以 0");
          return a / b;
        case "%":
          if (b === 0) fail(line, "不能除以 0");
          return a % b;
      }
    }
    if (op === "==" || op === "===") {
      return op === "===" ? strictEq(l, r) : looseEq(l, r);
    }
    if (op === "!=" || op === "!==") {
      return op === "!==" ? !strictEq(l, r) : !looseEq(l, r);
    }
    if (op === "<" || op === ">" || op === "<=" || op === ">=") {
      const a = toNum(l, line), b = toNum(r, line);
      if (op === "<") return a < b;
      if (op === ">") return a > b;
      if (op === "<=") return a <= b;
      return a >= b;
    }
    if (op === "&&") return truthy(l) && truthy(r);
    if (op === "||") return truthy(l) || truthy(r);
    fail(line, "运算符 " + op + " 暂不支持");
  }

  function looseEq(l, r) {
    if (l === null || r === null) return l === r;
    if (typeof l === "number" && typeof r === "number") return l === r;
    if (typeof l === "string" && typeof r === "string") return l === r;
    return toNum(l) === toNum(r);
  }
  function strictEq(l, r) {
    if (isArr(l) || isArr(r)) return l === r;
    return l === r;
  }

  /* ================= 对外接口 ================= */
  window.InterpPHP = {
    run: function (code, opts) {
      try {
        const program = parse(code);
        return execute(program, opts || {});
      } catch (err) {
        return { ok: false, output: "", error: C.friendlyError(err), ms: 0 };
      }
    },
  };
})();
