/* ============================================================
   译码 CodeLens · C / C++ 迷你解释器（教学子集）
   支持：main 入口 / printf / scanf / 变量与类型 / 数组 /
        if-else / for / while / do-while / 函数 / return /
        C++ 扩展：cout / cin / string / vector / range-for
   纯本地实现，步数保护防死循环，报错为通俗中文
   ============================================================ */
(function () {
  "use strict";

  const C = window.InterpCommon;

  const TYPES = new Set(("int char float double long short unsigned signed bool void string const static").split(" "));

  function fail(line, msg) {
    throw new C.LangError(msg, line);
  }

  /* ================= 词法 ================= */

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    let line = 1;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === "\n") { line++; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (c === "/" && src[i + 1] === "/") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        i += 2;
        while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
          if (src[i] === "\n") line++;
          i++;
        }
        i += 2;
        continue;
      }
      if (c === "#") {
        // 预处理指令（#include / #define …）直接忽略到行尾
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      if (c === '"') {
        let j = i + 1;
        let s = "";
        while (j < n && src[j] !== '"') {
          if (src[j] === "\\") {
            const e = src[j + 1];
            s += e === "n" ? "\n" : e === "t" ? "\t" : e === "\\" ? "\\" : e === '"' ? '"' : e === "0" ? "\0" : e;
            j += 2;
          } else { s += src[j]; j++; }
        }
        if (j >= n) fail(line, "字符串缺少结尾的双引号");
        tokens.push({ t: "str", v: s, line });
        i = j + 1;
        continue;
      }
      if (c === "'") {
        let j = i + 1;
        let s = "";
        while (j < n && src[j] !== "'") {
          if (src[j] === "\\") { s += src[j + 1] === "n" ? "\n" : src[j + 1]; j += 2; }
          else { s += src[j]; j++; }
        }
        if (j >= n) fail(line, "字符常量缺少结尾的单引号");
        tokens.push({ t: "char", v: s.length ? s.charCodeAt(0) : 0, line });
        i = j + 1;
        continue;
      }
      if (/[0-9]/.test(c)) {
        const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i));
        tokens.push({ t: "num", v: parseFloat(m[0]), f: m[1] ? true : false, line });
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
      if (["<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "%=", "::"].includes(two)) {
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
    const L = () => toks[pos].line;

    const program = [];
    const globals = []; // 全局变量声明

    while (peek().t !== "eof") {
      // 忽略 using namespace std;
      if (isId(peek(), "using")) {
        while (peek().t !== "eof" && !isOp(peek(), ";")) next();
        if (isOp(peek(), ";")) next();
        continue;
      }
      // #include / #define 预处理：词法阶段已丢弃（# 不在符号表），此处防御
      const startLine = L();
      const func = parseTopLevel();
      if (func) {
        if (func.type === "func") program.push(func);
        else globals.push(func);
      }
      void startLine;
    }
    return { program, globals };

    function parseTopLevel() {
      // 可能形式：类型名 名字 ( ... ) { ... }  或  类型名 名字 ... ;
      // 先解析一个“类型 + 名字”
      let typeName = null;
      const nameTok = tryParseTypeAndName();
      if (!nameTok) fail(L(), "这里我看不懂：应该是函数定义或全局变量声明");

      if (isOp(peek(), "(")) {
        next();
        const params = [];
        while (!isOp(peek(), ")")) {
          if (isOp(peek(), ",")) { next(); continue; }
          const pt = parseParam();
          params.push(pt);
        }
        next(); // )
        if (isOp(peek(), ";")) { next(); return null; } // 函数声明，忽略
        if (!isOp(peek(), "{")) fail(L(), "函数定义后面要跟 { 开始函数体");
        next();
        const body = parseBlockBody("}");
        if (!isOp(peek(), "}")) fail(L(), "函数体的 } 丢了");
        next();
        return { type: "func", ret: typeName, name: nameTok.v, params, body };
      }

      // 全局变量声明
      const decls = parseDeclarators(nameTok, typeName, true);
      if (!isOp(peek(), ";")) fail(L(), "变量声明要以分号 ; 结尾");
      next();
      return { type: "gdecl", decls };
    }

    function tryParseTypeAndName() {
      // 支持 vector<int> / unsigned int / long long 等组合
      let typeName = "";
      if (isId(peek(), "vector")) {
        typeName = "vector";
        next();
        if (!isOp(peek(), "<")) fail(L(), "vector 后面要跟 <类型>，例如 vector<int>");
        next();
        const inner = peek();
        if (!inner || inner.t !== "id") fail(L(), "vector 的元素类型没写对");
        next();
        if (!isOp(peek(), ">")) fail(L(), "vector 的 > 丢了");
        next();
        const nameTok = peek();
        if (!nameTok || nameTok.t !== "id") fail(L(), "这里要写一个变量名");
        next();
        return { v: nameTok.v, typeName: "vector" };
      }
      if (isId(peek(), "unsigned") || isId(peek(), "long") || isId(peek(), "short") || isId(peek(), "signed")) {
        typeName = peek().v;
        next();
        if (isId(peek(), "int") || isId(peek(), "long")) { typeName = "int"; next(); }
      } else if (isId(peek(), "long")) {
        typeName = "int"; next();
      }
      const t = peek();
      if (!t || t.t !== "id" || !TYPES.has(t.v)) return null;
      typeName = t.v;
      next();
      const nameTok = peek();
      if (!nameTok || nameTok.t !== "id") fail(L(), "声明了类型后要写变量名或函数名");
      next();
      return { v: nameTok.v, typeName };
    }

    function parseParam() {
      // 参数：类型 名字 或 类型 名字[] 或 类型 *名字
      const r = tryParseTypeAndName();
      if (!r) fail(L(), "函数参数写错了（应该是：类型 名字）");
      if (isOp(peek(), "[")) { next(); if (isOp(peek(), "]")) next(); r.arr = true; }
      if (isOp(peek(), "*")) { next(); r.arr = true; }
      return r;
    }

    function parseDeclarators(firstName, typeName, isGlobal) {
      const decls = [];
      let name = firstName.v;
      let arr = null;
      if (isOp(peek(), "[")) {
        next();
        if (isOp(peek(), "]")) { arr = "auto"; next(); }
        else {
          if (peek().t === "num") { arr = peek().v; next(); }
          if (isOp(peek(), "]")) next();
        }
      }
      let init = null;
      if (isOp(peek(), "=")) {
        next();
        init = parseExpr();
      }
      decls.push({ name, typeName, arr, init });
      while (isOp(peek(), ",")) {
        next();
        const nt = peek();
        if (!nt || nt.t !== "id") fail(L(), "逗号后面要再写一个变量名");
        name = nt.v;
        next();
        arr = null;
        if (isOp(peek(), "[")) {
          next();
          if (isOp(peek(), "]")) { arr = "auto"; next(); }
          else {
            if (peek().t === "num") { arr = peek().v; next(); }
            if (isOp(peek(), "]")) next();
          }
        }
        init = null;
        if (isOp(peek(), "=")) { next(); init = parseExpr(); }
        decls.push({ name, typeName, arr, init });
      }
      return decls;
    }

    function parseBlockBody(endTok) {
      const stmts = [];
      while (!isOp(peek(), endTok) && peek().t !== "eof") {
        stmts.push(parseStatement());
      }
      return stmts;
    }

    function parseStatement() {
      const line = L();
      const t = peek();

      // 复合语句
      if (isOp(t, "{")) {
        next();
        const body = parseBlockBody("}");
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
        if (!isOp(peek(), ")")) fail(L(), "if 的右括号 ) 丢了");
        next();
        const thenS = parseStatement();
        let elseS = null;
        if (isId(peek(), "else")) {
          next();
          elseS = parseStatement();
        }
        return { type: "if", cond, thenS, elseS, line };
      }

      if (isId(t, "while")) {
        next();
        if (!isOp(peek(), "(")) fail(L(), "while 后面要跟 ( 条件 )");
        next();
        const cond = parseExpr();
        if (!isOp(peek(), ")")) fail(L(), "while 的右括号 ) 丢了");
        next();
        const body = parseStatement();
        return { type: "while", cond, body, line };
      }

      if (isId(t, "do")) {
        next();
        const body = parseStatement();
        if (!isId(peek(), "while")) fail(L(), "do 循环要以 while(条件); 结尾");
        next();
        if (!isOp(peek(), "(")) fail(L(), "do-while 的 while 后面要跟 ( 条件 )");
        next();
        const cond = parseExpr();
        if (!isOp(peek(), ")")) fail(L(), "do-while 的右括号丢了");
        next();
        if (!isOp(peek(), ";")) fail(L(), "do-while 的结尾要加 ;");
        next();
        return { type: "dowhile", cond, body, line };
      }

      if (isId(t, "for")) {
        next();
        if (!isOp(peek(), "(")) fail(L(), "for 后面要跟 ( 括号 )");
        next();
        // range-for：for (int x : v) —— 第一个 token 是类型
        if (peek().t === "id" && TYPES.has(peek().v)) {
          const save = pos;
          const r = tryParseTypeAndName();
          if (r && isOp(peek(), ":")) {
            next();
            const iter = parseExpr();
            if (!isOp(peek(), ")")) fail(L(), "for 的右括号丢了");
            next();
            const body = parseStatement();
            return { type: "rangefor", varName: r.v, iter, body, line };
          }
          pos = save;
        }
        // 普通 for
        let init = null;
        if (!isOp(peek(), ";")) init = parseForInit();
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

      // cout / cin（含 std:: 前缀）
      if (isId(t, "cout") || (isId(t, "std") && isOp(toks[pos + 1], "::") && isId(toks[pos + 2], "cout"))) {
        return parseCout();
      }
      if (isId(t, "cin") || (isId(t, "std") && isOp(toks[pos + 1], "::") && isId(toks[pos + 2], "cin"))) {
        return parseCin();
      }

      // 变量声明（含 vector 类型）
      if (t.t === "id" && (TYPES.has(t.v) || t.v === "vector") && t.v !== "void") {
        const r = tryParseTypeAndName();
        if (r) {
          const decls = parseDeclarators(r, r.typeName, false);
          if (!isOp(peek(), ";")) fail(L(), "变量声明要以分号 ; 结尾");
          next();
          return { type: "decl", decls, line };
        }
      }

      // 表达式语句（赋值 / 调用 / printf / scanf）
      const expr = parseExpr();
      if (!isOp(peek(), ";")) fail(L(), "这条语句结尾要加 ;");
      next();
      return { type: "expr", expr, line };
    }

    function parseForInit() {
      const t = peek();
      if (t.t === "id" && (TYPES.has(t.v) || t.v === "vector")) {
        const r = tryParseTypeAndName();
        const decls = parseDeclarators(r, r.typeName, false);
        return { type: "decl", decls, line: t.line };
      }
      return parseExpr();
    }

    function parseCout() {
      const line = L();
      if (isId(peek(), "std")) { next(); next(); } // std ::
      next(); // cout
      const items = [];
      while (isOp(peek(), "<<")) {
        next();
        if (isId(peek(), "endl")) { next(); items.push({ kind: "endl" }); }
        else items.push({ kind: "expr", expr: parseExpr() });
      }
      if (!isOp(peek(), ";")) fail(L(), "cout 语句要以 ; 结尾");
      next();
      return { type: "cout", items, line };
    }

    function parseCin() {
      const line = L();
      if (isId(peek(), "std")) { next(); next(); }
      next(); // cin
      const targets = [];
      while (isOp(peek(), ">>")) {
        next();
        const e = parseExpr();
        targets.push(e);
      }
      if (!isOp(peek(), ";")) fail(L(), "cin 语句要以 ; 结尾");
      next();
      return { type: "cin", targets, line };
    }

    /* ---------- 表达式 ---------- */
    function parseExpr() { return parseAssign(); }

    function parseAssign() {
      const left = parseOr();
      const t = peek();
      if (t.t === "op" && ["=", "+=", "-=", "*=", "/=", "%="].includes(t.v)) {
        next();
        const rhs = parseAssign();
        return { type: "assign", lhs: left, op: t.v, rhs, line: left.line };
      }
      return left;
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
      while (isOp(peek(), "==") || isOp(peek(), "!=")) {
        const op = next().v;
        left = { type: "binop", op, l: left, r: parseRelational(), line: left.line };
      }
      return left;
    }
    function parseRelational() {
      let left = parseAdditive();
      while (isOp(peek(), "<") || isOp(peek(), ">") || isOp(peek(), "<=") || isOp(peek(), ">=")) {
        const op = next().v;
        left = { type: "binop", op, l: left, r: parseAdditive(), line: left.line };
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
      if (t.t === "op" && ["!", "-", "+", "++", "--", "&"].includes(t.v)) {
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
          const idx = parseExpr();
          if (!isOp(peek(), "]")) fail(L(), "下标的中括号丢了");
          next();
          e = { type: "index", target: e, idx, line: e.line };
          continue;
        }
        if (isOp(peek(), ".")) {
          next();
          const name = peek();
          if (!name || name.t !== "id") fail(L(), "点号后面要跟成员名");
          next();
          e = { type: "member", target: e, name: name.v, line: e.line };
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
      if (t.t === "str") { next(); return { type: "str", v: t.v, line: t.line }; }
      if (t.t === "char") { next(); return { type: "num", v: t.v, f: false, line: t.line }; }
      if (t.t === "id") {
        next();
        if (t.v === "true") return { type: "bool", v: true, line: t.line };
        if (t.v === "false") return { type: "bool", v: false, line: t.line };
        // std:: 前缀（如 std::cout 已在语句层处理，这里防御）
        if (isOp(peek(), "::")) {
          next();
          const n = peek();
          if (n && n.t === "id") { next(); return { type: "name", name: n.v, line: t.line }; }
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
      if (isOp(t, "{")) {
        // 列表初始化：{1, 2, 3}
        next();
        const items = [];
        while (!isOp(peek(), "}")) {
          items.push(parseExpr());
          if (isOp(peek(), ",")) next();
          else break;
        }
        if (!isOp(peek(), "}")) fail(L(), "列表的花括号 } 丢了");
        next();
        return { type: "list", items, line: t.line };
      }
      fail(L(), "这里有个值我没看懂");
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
    fail(line, "名字“" + name + "”还没定义——要先声明或赋值才能用");
  }
  function envSet(env, name, val, line) {
    let e = env;
    while (e) {
      if (e.vars.has(name)) { e.vars.set(name, val); return; }
      e = e.parent;
    }
    fail(line, "名字“" + name + "”还没定义，不能给它赋值");
  }

  // 值模型：{t: 'int'|'float'|'char'|'str'|'bool'|'array'|'void', v, items?}
  const V = {
    int: (v) => ({ t: "int", v: Math.trunc(v) }),
    float: (v) => ({ t: "float", v: v }),
    char: (v) => ({ t: "char", v: typeof v === "string" ? v.charCodeAt(0) : v }),
    str: (v) => ({ t: "str", v: String(v) }),
    bool: (v) => ({ t: "bool", v: !!v }),
    array: (items) => ({ t: "array", items: items || [] }),
  };

  function toNum(v, line) {
    if (v.t === "int" || v.t === "float" || v.t === "char" || v.t === "bool") return v.v;
    if (v.t === "str") {
      const m = /^\s*(-?\d+(\.\d+)?)/.exec(v.v);
      if (m) return parseFloat(m[1]);
      fail(line, "这里需要数字，但“" + v.v + "”不是数字");
    }
    fail(line, "这个值不能当数字用");
  }
  function toStr(v, line) {
    if (v.t === "str") return v.v;
    if (v.t === "char") return String.fromCharCode(v.v);
    if (v.t === "bool") return v.v ? "1" : "0";
    if (v.t === "array") return "数组";
    return String(v.v);
  }
  function truthy(v, line) {
    if (!v) return false;
    if (v.t === "bool") return v.v;
    if (v.t === "int" || v.t === "float" || v.t === "char") return v.v !== 0;
    if (v.t === "str") return v.v.length > 0;
    if (v.t === "array") return v.items.length > 0;
    return false;
  }

  class Ctrl { constructor(type, value) { this.type = type; this.value = value; } }

  function execute(ast, opts) {
    const guard = new C.StepGuard(opts.maxSteps);
    const io = new C.InputSource(opts.input || "");
    const out = new C.OutputBuffer();
    const t0 = Date.now();

    const globalEnv = makeEnv(null);
    const ctx = { ret: null, guard, io, out, globalEnv };
    // 全局变量
    for (const g of ast.globals) {
      for (const d of g.decls) {
        globalEnv.vars.set(d.name, declareVar(d, globalEnv, ctx, io, out));
      }
    }
    // 函数表
    const funcs = {};
    for (const f of ast.program) {
      if (f.type === "func") funcs[f.name] = f;
    }
    ctx.ret = funcs;

    const main = funcs["main"];
    if (!main) {
      return { ok: false, output: "", error: "没有找到 main 入口函数——C/C++ 程序从 main() 开始执行。", ms: 0 };
    }

    try {
      runBlock(main.body, makeEnv(globalEnv), ctx);
      return { ok: true, output: out.get(), ms: Date.now() - t0 };
    } catch (err) {
      if (err instanceof Ctrl && err.type === "return") {
        // main 的 return 是正常结束
        return { ok: true, output: out.get(), ms: Date.now() - t0 };
      }
      return { ok: false, output: out.get(), error: C.friendlyError(err), ms: Date.now() - t0 };
    }
  }

  function declareVar(d, env, ctx, io, out) {
    const guard = ctx.guard;
    guard.step();
    let val = null;
    if (d.arr !== null) {
      let items = [];
      if (d.init && d.init.type === "list") {
        items = d.init.items.map((e) => evalExpr(e, env, ctx));
      } else if (d.init) {
        const v = evalExpr(d.init, env, ctx);
        if (v.t === "str") items = v.v.split("").map((c) => V.char(c.charCodeAt(0)));
        else if (v.t === "array") items = v.items;
        else fail(d.line || 1, "数组初始化只能用 {1,2,3} 这种写法");
      }
      if (d.arr !== "auto" && items.length < d.arr) {
        for (let i = items.length; i < d.arr; i++) items.push(V.int(0));
      }
      val = V.array(items);
    } else if (d.init) {
      val = evalExpr(d.init, env, ctx);
      val = coerce(val, d.typeName, d.line || 1);
    } else {
      val = zeroValue(d.typeName);
    }
    return val;
  }

  function zeroValue(typeName) {
    switch (typeName) {
      case "int": case "long": case "short": case "unsigned": return V.int(0);
      case "float": case "double": return V.float(0);
      case "char": return V.char(0);
      case "bool": return V.bool(false);
      case "string": return V.str("");
      case "vector": return V.array([]);
      default: return V.int(0);
    }
  }

  function coerce(v, typeName, line) {
    switch (typeName) {
      case "int": case "long": case "short": case "unsigned": return V.int(toNum(v, line));
      case "float": case "double": return V.float(toNum(v, line));
      case "char": {
        const n = toNum(v, line);
        return V.char(Math.round(n));
      }
      case "bool": return V.bool(truthy(v, line));
      case "string": return V.str(toStr(v, line));
      default: return v;
    }
  }

  function runBlock(body, env, ctx) {
    for (const s of body) runStmt(s, env, ctx);
  }

  function runStmt(s, env, ctx) {
    const { guard } = ctx;
    guard.step();
    switch (s.type) {
      case "noop": return;
      case "block": {
        const local = makeEnv(env);
        runBlock(s.body, local, ctx);
        return;
      }
      case "decl": {
        for (const d of s.decls) {
          env.vars.set(d.name, declareVar(d, env, ctx, ctx.io, ctx.out));
        }
        return;
      }
      case "expr": evalExpr(s.expr, env, ctx); return;
      case "assign": {
        const rhs = evalExpr(s.rhs, env, ctx);
        assignTo(s.lhs, rhs, s.op, env, ctx);
        return;
      }
      case "if": {
        if (truthy(evalExpr(s.cond, env, ctx), s.line)) runStmt(s.thenS, env, ctx);
        else if (s.elseS) runStmt(s.elseS, env, ctx);
        return;
      }
      case "while": {
        let iters = 0;
        while (truthy(evalExpr(s.cond, env, ctx), s.line)) {
          guard.step();
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
      case "dowhile": {
        let iters = 0;
        do {
          guard.step();
          if (++iters > 200000) fail(s.line, "循环执行了太多次，已自动停止——可能是死循环");
          try { runStmt(s.body, env, ctx); }
          catch (e) {
            if (e instanceof Ctrl && e.type === "break") break;
            if (e instanceof Ctrl && e.type === "continue") continue;
            throw e;
          }
        } while (truthy(evalExpr(s.cond, env, ctx), s.line));
        return;
      }
      case "for": {
        const local = makeEnv(env);
        if (s.init) {
          if (s.init.type === "decl") {
            for (const d of s.init.decls) local.vars.set(d.name, declareVar(d, local, ctx, ctx.io, ctx.out));
          } else evalExpr(s.init, local, ctx);
        }
        let iters = 0;
        while (!s.cond || truthy(evalExpr(s.cond, local, ctx), s.line)) {
          guard.step();
          if (++iters > 200000) fail(s.line, "for 循环执行了太多次，已自动停止——可能是死循环");
          try { runStmt(s.body, local, ctx); }
          catch (e) {
            if (e instanceof Ctrl && e.type === "break") break;
            if (e instanceof Ctrl && e.type === "continue") { if (s.update) evalExpr(s.update, local, ctx); continue; }
            throw e;
          }
          if (s.update) evalExpr(s.update, local, ctx);
        }
        return;
      }
      case "rangefor": {
        const iter = evalExpr(s.iter, env, ctx);
        if (iter.t !== "array") fail(s.line, "for (int x : 变量) 只能遍历数组或 vector");
        const local = makeEnv(env);
        let iters = 0;
        for (const item of iter.items) {
          guard.step();
          if (++iters > 200000) fail(s.line, "循环执行了太多次，已自动停止");
          local.vars.set(s.varName, item);
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
        const v = s.expr ? evalExpr(s.expr, env, ctx) : V.void0 || { t: "void", v: undefined };
        throw new Ctrl("return", v);
      }
      case "break": throw new Ctrl("break");
      case "continue": throw new Ctrl("continue");
      case "cout": {
        for (const item of s.items) {
          if (item.kind === "endl") ctx.out.write("\n");
          else ctx.out.write(toStr(evalExpr(item.expr, env, ctx), s.line));
        }
        return;
      }
      case "cin": {
        for (const tgt of s.targets) {
          const tok = ctx.io.readToken(s.line);
          const rhs = guessNumber(tok);
          assignTo(tgt, rhs, "=", env, ctx);
        }
        return;
      }
      default:
        fail(s.line, "这条语句我还不会执行");
    }
  }

  function guessNumber(tok) {
    const m = /^-?\d+(\.\d+)?$/.exec(tok);
    if (m) return m[1] ? V.float(parseFloat(tok)) : V.int(parseInt(tok, 10));
    return V.str(tok);
  }

  function assignTo(lhs, rhs, op, env, ctx) {
    if (lhs.type === "name") {
      const cur = envGet(env, lhs.name, lhs.line);
      const val = op === "=" ? rhs : doBinop(op.slice(0, -1), cur, rhs, lhs.line);
      envSet(env, lhs.name, val, lhs.line);
      return;
    }
    if (lhs.type === "index") {
      const target = evalExpr(lhs.target, env, ctx);
      const idx = Math.trunc(toNum(evalExpr(lhs.idx, env, ctx), lhs.line));
      if (target.t !== "array") fail(lhs.line, "a[下标] 只能用于数组或 vector");
      if (idx < 0 || idx >= target.items.length) fail(lhs.line, "数组下标 " + idx + " 越界了（长度只有 " + target.items.length + "）");
      target.items[idx] = op === "=" ? rhs : doBinop(op.slice(0, -1), target.items[idx], rhs, lhs.line);
      return;
    }
    fail(lhs.line, "赋值左边写得不认识");
  }

  function evalExpr(e, env, ctx) {
    const { guard, out, io } = ctx;
    guard.step();
    switch (e.type) {
      case "num": return e.f ? V.float(e.v) : V.int(e.v);
      case "str": return V.str(e.v);
      case "bool": return V.bool(e.v);
      case "name": return envGet(env, e.name, e.line);
      case "list": return V.array(e.items.map((it) => evalExpr(it, env, ctx)));
      case "assign": {
        // 赋值也是表达式（如 a = b = 1）
        const rhs = evalExpr(e.rhs, env, ctx);
        assignTo(e.lhs, rhs, e.op, env, ctx);
        return rhs;
      }
      case "unary": {
        if (e.op === "!") return V.bool(!truthy(evalExpr(e.e, env, ctx), e.line));
        if (e.op === "-") {
          const v = evalExpr(e.e, env, ctx);
          return v.t === "float" ? V.float(-v.v) : V.int(-v.v);
        }
        if (e.op === "+") return evalExpr(e.e, env, ctx);
        if (e.op === "&") {
          // 取地址：scanf 用，返回引用
          if (e.e.type === "name") return { t: "ref", name: e.e.name, line: e.e.line };
          fail(e.line, "& 只能用在变量前面（scanf 里取变量）");
        }
        if (e.op === "++" || e.op === "--") {
          const cur = envGet(env, e.e.name, e.line);
          const next = doBinop(e.op === "++" ? "+" : "-", cur, V.int(1), e.line);
          envSet(env, e.e.name, next, e.line);
          return cur;
        }
        fail(e.line, "一元运算符 " + e.op + " 暂不支持");
        break;
      }
      case "postfix": {
        const cur = evalExpr(e.e, env, ctx);
        const next = doBinop(e.op === "++" ? "+" : "-", cur, V.int(1), e.line);
        assignTo(e.e, next, "=", env, ctx);
        return cur;
      }
      case "binop": return doBinop(e.op, evalExpr(e.l, env, ctx), evalExpr(e.r, env, ctx), e.line);
      case "index": {
        const target = evalExpr(e.target, env, ctx);
        if (target.t === "array") {
          const idx = Math.trunc(toNum(evalExpr(e.idx, env, ctx), e.line));
          if (idx < 0 || idx >= target.items.length) fail(e.line, "下标 " + idx + " 越界了（长度只有 " + target.items.length + "）");
          return target.items[idx];
        }
        if (target.t === "str") {
          const idx = Math.trunc(toNum(evalExpr(e.idx, env, ctx), e.line));
          if (idx < 0 || idx >= target.v.length) fail(e.line, "字符串下标越界了");
          return V.char(target.v.charCodeAt(idx));
        }
        fail(e.line, "这个值不能加 [下标]");
        break;
      }
      case "member": {
        const target = evalExpr(e.target, env, ctx);
        if (e.name === "size" || e.name === "length") {
          if (target.t === "array") return V.int(target.items.length);
          if (target.t === "str") return V.int(target.v.length);
          fail(e.line, "size()/length() 只能用于数组、vector 或 string");
        }
        if (e.name === "push_back") {
          return function (val) {
            target.items.push(coerce(val, "auto", e.line));
            return V.void0 || { t: "void", v: undefined };
          };
        }
        fail(e.line, "这个值没有叫“" + e.name + "”的成员");
        break;
      }
      case "call": return callFunc(e, env, ctx);
      default:
        fail(e.line, "这个表达式我不会算");
    }
  }

  function callFunc(e, env, ctx) {
    const { guard, out, io } = ctx;
    if (e.callee.type === "name") {
      const name = e.callee.name;
      // 内置函数
      if (name === "printf") return builtinPrintf(e.args, env, ctx);
      if (name === "scanf") return builtinScanf(e.args, env, ctx);
      if (name === "puts") {
        if (e.args.length) out.write(toStr(evalExpr(e.args[0], env, ctx), e.line) + "\n");
        return V.int(0);
      }
      if (name === "strlen") {
        if (!e.args.length) fail(e.line, "strlen 需要一个参数");
        const s = evalExpr(e.args[0], env, ctx);
        return V.int(toStr(s, e.line).length);
      }
      const fn = ctx.ret[name];
      if (fn) {
        const local = makeEnv(ctx.globalEnv);
        fn.params.forEach((p, i) => {
          if (i < e.args.length) {
            let av = evalExpr(e.args[i], env, ctx);
            if (p.arr) local.vars.set(p.v, av);
            else local.vars.set(p.v, copyVal(av));
          } else {
            local.vars.set(p.v, zeroValue(p.typeName));
          }
        });
        try {
          runBlock(fn.body, local, ctx);
        } catch (err) {
          if (err instanceof Ctrl && err.type === "return") return err.value;
          throw err;
        }
        return { t: "void", v: undefined };
      }
      fail(e.line, "函数 " + name + " 没有定义");
    }
    fail(e.line, "这个值不能当函数调用");
  }

  function copyVal(v) {
    if (v.t === "array") return V.array(v.items.slice());
    return { t: v.t, v: v.v };
  }

  function builtinPrintf(args, env, ctx) {
    if (!args.length) fail(1, "printf 至少要有一个格式字符串");
    const fmtVal = evalExpr(args[0], env, ctx);
    const fmt = toStr(fmtVal, 1);
    const out = ctx.out;
    let ai = 1;
    let i = 0;
    while (i < fmt.length) {
      const c = fmt[i];
      if (c === "\\" && fmt[i + 1] === "n") { out.write("\n"); i += 2; continue; }
      if (c !== "%") { out.write(c); i++; continue; }
      // 格式符
      i++;
      let spec = "";
      while (i < fmt.length && !/[diufFeEgGxXoscs%]/.test(fmt[i])) spec += fmt[i++];
      const f = fmt[i] || "";
      i++;
      if (f === "%") { out.write("%"); continue; }
      if (ai >= args.length) fail(args[0] && args[0].line || 1, "printf 的 %" + f + " 少了一个对应的参数");
      const v = evalExpr(args[ai++], env, ctx);
      let width = parseInt(spec.replace(/[^0-9-]/g, "") || "0", 10);
      if (spec.startsWith("-")) width = -width;
      let s;
      switch (f) {
        case "d": case "i": case "u": {
          s = String(Math.trunc(toNum(v, 1)));
          break;
        }
        case "f": case "F": case "e": case "E": case "g": case "G": {
          const n = toNum(v, 1);
          const prec = /\.(\d+)/.test(spec) ? parseInt(/\.(\d+)/.exec(spec)[1], 10) : 6;
          s = f === "f" || f === "F" ? n.toFixed(prec) : String(n);
          break;
        }
        case "c": s = String.fromCharCode(Math.trunc(toNum(v, 1))); break;
        case "s": s = toStr(v, 1); break;
        case "x": case "X": s = Math.trunc(toNum(v, 1)).toString(16); if (f === "X") s = s.toUpperCase(); break;
        case "o": s = Math.trunc(toNum(v, 1)).toString(8); break;
        default: s = "%" + f; break;
      }
      if (width) {
        const pad = spec.includes("0") && !spec.startsWith("-") ? "0" : " ";
        if (width > 0) s = s.padStart(width, pad);
        else s = s.padEnd(-width, " ");
      }
      out.write(s);
    }
    return V.int(0);
  }

  function builtinScanf(args, env, ctx) {
    if (!args.length) fail(1, "scanf 至少要有一个格式字符串");
    const fmt = toStr(evalExpr(args[0], env, ctx), 1);
    let ai = 1;
    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] !== "%") continue;
      const f = fmt[++i];
      if (f === "%") continue;
      if (ai >= args.length) fail(1, "scanf 的 %" + f + " 少了一个对应变量");
      const ref = evalExpr(args[ai++], env, ctx);
      if (ref.t !== "ref") fail(1, "scanf 里要写 &变量 才能把输入存进去");
      const tok = ctx.io.readToken(1);
      let val;
      switch (f) {
        case "d": case "i": case "u": val = V.int(parseInt(tok, 10) || 0); break;
        case "f": case "e": case "g": val = V.float(parseFloat(tok) || 0); break;
        case "c": val = V.char(tok.length ? tok.charCodeAt(0) : 0); break;
        case "s": val = V.str(tok); break;
        default: val = V.int(0);
      }
      envSet(env, ref.name, val, 1);
    }
    return V.int(0);
  }

  function doBinop(op, l, r, line) {
    if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%") {
      // 字符串拼接
      if (op === "+" && (l.t === "str" || r.t === "str")) return V.str(toStr(l, line) + toStr(r, line));
      const a = toNum(l, line), b = toNum(r, line);
      switch (op) {
        case "+": return (l.t === "float" || r.t === "float") ? V.float(a + b) : V.int(a + b);
        case "-": return (l.t === "float" || r.t === "float") ? V.float(a - b) : V.int(a - b);
        case "*": return (l.t === "float" || r.t === "float") ? V.float(a * b) : V.int(a * b);
        case "/":
          if (b === 0) fail(line, "不能除以 0");
          return (l.t === "float" || r.t === "float") ? V.float(a / b) : V.int(Math.trunc(a / b));
        case "%":
          if (b === 0) fail(line, "不能除以 0");
          return V.int(a % b);
      }
    }
    if (op === "==") return V.bool(valuesEqual(l, r));
    if (op === "!=") return V.bool(!valuesEqual(l, r));
    if (op === "<" || op === ">" || op === "<=" || op === ">=") {
      const a = toNum(l, line), b = toNum(r, line);
      if (op === "<") return V.bool(a < b);
      if (op === ">") return V.bool(a > b);
      if (op === "<=") return V.bool(a <= b);
      return V.bool(a >= b);
    }
    if (op === "&&") {
      const a = truthy(l, line);
      if (!a) return V.bool(false);
      return V.bool(truthy(r, line));
    }
    if (op === "||") {
      const a = truthy(l, line);
      if (a) return V.bool(true);
      return V.bool(truthy(r, line));
    }
    fail(line, "运算符 " + op + " 暂不支持");
  }

  function valuesEqual(l, r) {
    if (l.t === "array" || r.t === "array") return l === r;
    if (l.t === "char" && r.t === "char") return l.v === r.v;
    if (l.t === "str" || r.t === "str") return toStr(l) === toStr(r);
    return l.v === r.v;
  }

  /* ================= 对外接口 ================= */
  window.InterpC = {
    run: function (code, opts) {
      try {
        const ast = parse(code);
        return execute(ast, opts || {});
      } catch (err) {
        return { ok: false, output: "", error: C.friendlyError(err), ms: 0 };
      }
    },
  };
})();
