/* ============================================================
   译码 CodeLens · 迷你解释器公共框架
   纯本地实现，无任何外部依赖。
   提供：通俗中文错误、步数保护（防死循环）、输出缓冲、输入读取
   ============================================================ */
(function () {
  "use strict";

  /** 解释器错误（带行号） */
  class LangError extends Error {
    constructor(message, line) {
      super(message);
      this.name = "LangError";
      this.line = line || null;
    }
  }

  /** 程序需要更多输入（输入框内容用完了） */
  class InputNeedError extends LangError {}

  /** 运行步数超限（疑似死循环） */
  class StepLimitError extends LangError {}

  /** 步数保护器 */
  class StepGuard {
    constructor(maxSteps) {
      this.max = maxSteps || 1000000;
      this.count = 0;
    }
    step() {
      if (++this.count > this.max) {
        throw new StepLimitError(
          "运行步数超过上限（" + this.max.toLocaleString() + " 步），已自动停止。\n这通常是死循环导致的：循环条件永远成立，程序停不下来。"
        );
      }
    }
  }

  /** 输入源：从预填的输入行队列读取 */
  class InputSource {
    constructor(text) {
      this.lines = text ? String(text).split(/\r?\n/) : [];
      this.pos = 0;
    }
    /** 读一行；不足则抛 InputNeedError（行号为调用处提供） */
    readLine(line) {
      if (this.pos >= this.lines.length) {
        throw new InputNeedError(
          "程序在这里需要输入，但输入框里的内容用完了。\n请在“程序输入”框里写好要输入的内容（每行一个），再点“▶ 运行”。",
          line
        );
      }
      return this.lines[this.pos++];
    }
    /** 读下一个“词”（scanf %d/%f/%s/%c 用），按空白分隔 */
    readToken(line) {
      while (this.pos < this.lines.length && this.lines[this.pos].trim() === "") this.pos++;
      if (this.pos >= this.lines.length) {
        throw new InputNeedError(
          "程序在这里需要输入，但输入框里的内容用完了。\n请在“程序输入”框里写好要输入的内容，再点“▶ 运行”。",
          line
        );
      }
      const rest = this.lines[this.pos];
      const m = /^\S+/.exec(rest);
      this.lines[this.pos] = rest.slice(m[0].length);
      if (this.lines[this.pos].trim() === "") this.pos++;
      return m[0];
    }
  }

  /** 输出缓冲 */
  class OutputBuffer {
    constructor() {
      this.parts = [];
      this.chars = 0;
    }
    write(s) {
      const t = String(s);
      this.parts.push(t);
      this.chars += t.length;
    }
    get() {
      return this.parts.join("");
    }
  }

  /** 把常见运行时错误转成通俗中文（各解释器统一入口） */
  function friendlyError(err) {
    if (err instanceof StepLimitError) return err.message;
    if (err instanceof InputNeedError) return err.message;
    if (err instanceof LangError) {
      return (err.line ? "第 " + err.line + " 行：" : "") + err.message;
    }
    if (err instanceof TypeError) {
      return (err.line ? "第 " + err.line + " 行：" : "") + "类型不对：可能把文字当数字用了，或把数字当文字用了。" + (err.message || "");
    }
    if (err instanceof RangeError) {
      return (err.line ? "第 " + err.line + " 行：" : "") + "数字越界：" + (err.message || "");
    }
    return "运行出错：" + (err && err.message ? err.message : String(err));
  }

  window.InterpCommon = {
    LangError,
    InputNeedError,
    StepLimitError,
    StepGuard,
    InputSource,
    OutputBuffer,
    friendlyError,
  };
})();
