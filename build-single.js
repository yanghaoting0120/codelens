/* ============================================================
   译码 CodeLens · 单文件版构建脚本
   把 css/style.css 与 js/*.js 全部内联进 index.html，
   生成 codelens-single.html —— 单独一个文件即可在任意
   设备（包括手机浏览器）上完整运行全部功能。

   用法：node build-single.js
   ============================================================ */
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const outFile = path.join(dir, "codelens-single.html");

let html = fs.readFileSync(path.join(dir, "index.html"), "utf8");

// 内联 CSS
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => {
  const css = fs.readFileSync(path.join(dir, href), "utf8");
  return "<style>\n" + css + "\n</style>";
});

// 内联 JS（保持原有顺序）
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const js = fs.readFileSync(path.join(dir, src), "utf8");
  return "<script>\n" + js + "\n</" + "script>";
});

// 安全校验：不应残留 css/ 或 js/ 外链
const leftover = html.match(/(?:src|href)="(?:css\/|js\/)/g);
if (leftover) {
  console.error("[FAIL] 仍有未内联的外链:", leftover);
  process.exit(1);
}
// </script> 数量应等于内联脚本块数量
const inlineCount = (html.match(/<script>/g) || []).length;
const closeCount = (html.match(/<\/script>/g) || []).length;
if (closeCount !== inlineCount) {
  console.error("[FAIL] <script> 标签数量异常:", inlineCount, closeCount);
  process.exit(1);
}

fs.writeFileSync(outFile, html, "utf8");
console.log(
  "[OK] 已生成 " + path.basename(outFile) + "（" + Math.round(html.length / 1024) + " KB，" +
  "内联 " + inlineCount + " 个脚本）"
);
