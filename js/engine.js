/* ============================================================
   译码 CodeLens · 离线释义引擎
   无需联网即可把代码"翻译"成通俗中文：
   整体概览 + 逐行讲解 + 关键术语
   ============================================================ */
(function () {
  "use strict";

  const LANG_NAMES = {
    python: "Python", php: "PHP", html: "HTML", css: "CSS", c: "C 语言", cpp: "C++",
  };

  const KIND_LABEL = {
    comment: "注释", output: "输出", input: "输入", var: "变量", loop: "循环",
    cond: "条件", func: "函数", class: "类", import: "引入", return: "返回",
    html: "标签", close: "标签", selector: "选择器", prop: "属性", media: "媒体查询",
    block: "代码块", doc: "文档", main: "入口", call: "调用", other: "语句", blank: "",
  };

  /* ---------- 内置术语词典 ---------- */
  const TERM_DICT = [
    { keys: ["variable", "var", "$_", "int a"], name: "变量", meaning: "给数据起的“名字”。比如 age = 18，就是把数字 18 存进一个叫 age 的小盒子里，以后叫 age 就能拿到 18。" },
    { keys: ["function", "def", "func"], name: "函数", meaning: "把一段常用代码打包起来的“工具箱”。给它起个名字，想用时叫一声（调用）就能执行，不用重复写。" },
    { keys: ["loop", "for", "while", "foreach"], name: "循环", meaning: "让同一段代码反复执行的“复读机”。for/while 就是两种常见的循环，例如把列表里的每一项都处理一遍。" },
    { keys: ["if", "else", "elif", "condition", "switch", "case"], name: "条件判断", meaning: "让程序“看情况办事”的岔路口。如果条件成立走这条路，否则走另一条路，就像红绿灯决定走不走。" },
    { keys: ["comment", "注释"], name: "注释", meaning: "写给程序员看的说明文字（#、//、<!-- 等开头）。程序运行时会忽略它，但它能帮人理解代码的意图。" },
    { keys: ["string", "str", "char"], name: "字符串", meaning: "一串文字，比如 “你好”。在代码里通常用引号包起来，是程序最常处理的数据之一。" },
    { keys: ["array", "list", "vector", "dict", "map"], name: "数组 / 列表", meaning: "一个能装多个数据的“抽屉柜”。比如一份成绩单可以存成一个列表，按顺序编号（索引）取用。" },
    { keys: ["class", "struct"], name: "类", meaning: "一种“设计图纸”。按图纸能造出很多个实例（对象），每个对象都自带数据和功能，用来组织复杂程序。" },
    { keys: ["object", "instance"], name: "对象", meaning: "按照“类”这张图纸造出来的具体东西。比如有一个“学生”类，每个学生对象都有姓名、分数这些数据。" },
    { keys: ["method", "member"], name: "方法", meaning: "挂在对象或类身上的函数，代表这个对象“会做什么”。比如 小狗.叫() 就是让小狗执行“叫”这个动作。" },
    { keys: ["parameter", "param", "arg"], name: "参数", meaning: "调用函数时传给它的“原料”。函数根据原料算出结果，比如 计算面积(5, 3) 里的 5 和 3。" },
    { keys: ["return"], name: "返回值", meaning: "函数干完活后交出来的“成品”。比如 加(1,2) 返回 3，这个 3 就是返回值，可以继续被别处使用。" },
    { keys: ["import", "include", "require", "use"], name: "导入 / 引入", meaning: "把别人写好的现成代码（库/头文件）搬进来用，相当于“借工具”，不用自己从头造轮子。" },
    { keys: ["print", "echo", "cout", "printf"], name: "输出", meaning: "把结果显示出来。print / echo / cout / printf 都是“把话说给你看”的命令，通常显示在屏幕或网页上。" },
    { keys: ["input", "scanf", "cin", "readline"], name: "输入", meaning: "从用户那里读取数据。程序停下来等你打字或点击，把你的输入存进变量再用。" },
    { keys: ["=", "assignment"], name: "赋值", meaning: "把右边的值装进左边的变量里，用 = 表示。注意它是“装进去”，不是数学里的“等于”。" },
    { keys: ["keyword"], name: "关键字", meaning: "编程语言里自带含义的“保留词”，比如 if、for、return。它们不能拿来当名字用，是语言的规定动作。" },
    { keys: ["index"], name: "索引", meaning: "列表里每个位置从 0 开始的编号。第 1 个元素的索引是 0，第 2 个是 1……这是新手最容易搞混的点。" },
    { keys: ["scope"], name: "作用域", meaning: "变量“有效”的范围。在函数里定义的变量通常只能在函数里用，出了函数就不认识了。" },
    { keys: ["recursion"], name: "递归", meaning: "函数自己调用自己，像照镜子。适合解决层层嵌套的问题（如文件夹套文件夹），但必须有个“出口”否则会无限循环。" },
    { keys: ["boolean", "bool", "true", "false"], name: "布尔值", meaning: "只有“是 / 否”两种取值（True/False、true/false），专门用来做条件判断。" },
    { keys: ["main"], name: "main 入口", meaning: "程序的“大门”。C/C++ 程序从 main 函数开始执行，它结束程序就结束。" },
    { keys: ["tag", "html"], name: "HTML 标签", meaning: "网页的“积木块”，用尖括号包裹，比如 <p> 段落、<img> 图片。浏览器按标签把网页搭出来。" },
    { keys: ["selector"], name: "选择器", meaning: "CSS 里指定“要给谁化妆”的写法。比如 div、.class、#id，分别按标签名、类名、ID 找到元素。" },
    { keys: ["property"], name: "CSS 属性", meaning: "具体的外观设置项，比如 color（文字颜色）、font-size（字号）、margin（外边距）。写法是 属性: 值。" },
    { keys: ["flex"], name: "弹性布局 flex", meaning: "CSS 的一种布局方式，能让盒子们自动排布、自动伸缩，是现在做网页排版的“主力军”。" },
    { keys: ["margin", "padding"], name: "外边距 / 内边距", meaning: "margin 是元素与外面东西的距离，padding 是元素边框与内部内容的距离。可以把元素想象成带边框的盒子。" },
    { keys: ["iteration", "iterate", "遍历"], name: "遍历", meaning: "把列表里的元素从头到尾“挨个过一遍”，配合循环使用，是处理批量数据的基本操作。" },
    { keys: ["null", "none", "nil"], name: "空值", meaning: "表示“什么都没有 / 还没赋值”。None / null / nil 都是不同语言里的空值写法。" },
    { keys: ["number", "int", "float", "integer"], name: "数字", meaning: "程序里常见的数字数据，分为整数（int）和小数（float）。计算、计数、统计都离不开它。" },
    { keys: ["dictionary", "dict", "map"], name: "字典 / 映射", meaning: "用“钥匙”取“值”的容器，比如 {“姓名”: “小明”}，按名字找内容，不用数位置。" },
  ];

  /* ---------- HTML 标签速查 ---------- */
  const HTML_TAGS = {
    html: "整个网页的“总外壳”，所有内容都装在里面。",
    head: "网页的“档案区”，存放标题、编码、样式引用等不直接显示的信息。",
    body: "网页的“正文区”，浏览器里看到的所有内容都在这里。",
    title: "网页的标题，显示在浏览器顶部的标签页上。",
    meta: "网页的“身份信息”，比如用什么编码、适配什么屏幕，用户看不见但浏览器很需要。",
    link: "引入外部文件（最常见的是 CSS 样式表），相当于给网页“穿衣服”。",
    script: "嵌入或引入一段脚本代码（通常是 JavaScript），让网页“动起来”。",
    style: "直接在网页内部写 CSS 样式，规定外观。",
    div: "一个“通用容器”，用来把内容分组，配合 CSS 排版。本身不带任何样式。",
    span: "行内的小容器，用来圈住一段文字单独设置样式。",
    p: "一个段落，就像文章里的一段话，前后会自动留白。",
    a: "超链接，点击后跳转到别的页面或位置，href 属性里写目标地址。",
    img: "插入一张图片，src 属性写图片地址，alt 是图片的文字说明（图片加载失败时显示）。",
    ul: "无序列表的“外壳”，列表项前面显示圆点符号。",
    ol: "有序列表的“外壳”，列表项前面自动编号 1、2、3…",
    li: "列表里的一项，必须放在 ul 或 ol 里面。",
    h1: "一级标题，最大最醒目；h2~h6 依次变小，就像文章的章节层级。",
    h2: "二级标题，比 h1 小一号，用于分节。",
    h3: "三级标题，比 h2 再小一号。",
    h4: "四级标题，字号更小。",
    h5: "五级标题，接近正文大小。",
    h6: "六级标题，最小的标题。",
    br: "强制换行，相当于按一下回车（不需要成对闭合）。",
    hr: "一条水平分隔线，用来把内容分区。",
    form: "一个表单区域，用来收集用户输入，提交到服务器。",
    input: "一个输入框，用户可以在里面打字；type 属性决定是文本框、密码框还是按钮等。",
    button: "一个可点击的按钮。",
    textarea: "一个多行文本输入框，适合填写较长内容。",
    select: "一个下拉选择框，配合 option 选项使用。",
    option: "下拉框里的一个选项。",
    label: "给输入框配的“说明文字”，点击它也能聚焦到对应输入框。",
    table: "一个表格，用行（tr）和单元格（td/th）组织数据。",
    tr: "表格里的一行。",
    td: "表格里的一个普通单元格。",
    th: "表格里的“表头”单元格，默认加粗居中。",
    header: "网页或区块的“页眉区”，通常放标题和导航。",
    nav: "导航栏，放一组跳转链接。",
    main: "网页的“主体内容区”，放最核心的内容。",
    section: "一个内容分区，像书的一节。",
    article: "一篇独立的文章或内容块。",
    aside: "侧边栏，放辅助信息，如广告、相关推荐。",
    footer: "网页或区块的“页脚区”，通常放版权、联系方式。",
    figure: "插图容器，配 figcaption 写图注。",
    figcaption: "图注文字，说明图片或图表内容。",
    strong: "加粗强调的文字，语义上是“重要”。",
    em: "斜体强调的文字。",
    b: "加粗文字（只改外观，不含强调语义）。",
    i: "斜体文字（通常用于术语、书名等）。",
    u: "带下划线的文字。",
    small: "小号文字，通常用于版权、注释。",
    mark: "高亮标记的文字（像荧光笔划过）。",
    code: "代码片段，用等宽字体显示。",
    pre: "预格式文本，保留空格和换行，常用来显示代码块。",
    blockquote: "引用别人的一段话，通常缩进显示。",
    iframe: "在网页里嵌入另一个网页的“窗口”。",
    video: "嵌入视频播放器。",
    audio: "嵌入音频播放器。",
    canvas: "一块画布，可以用脚本（如 JavaScript）在上面绘图。",
    svg: "矢量图形容器，用来画图标、图形，放大不模糊。",
  };

  /* ---------- CSS 属性速查 ---------- */
  const CSS_PROPS = {
    color: "文字颜色",
    "background-color": "背景颜色",
    background: "背景（颜色或图片）",
    "background-image": "背景图片",
    "font-size": "字号大小",
    "font-family": "字体（如微软雅黑、宋体）",
    "font-weight": "字体粗细（bold 就是加粗）",
    "line-height": "行高，决定每行文字之间的间距",
    "text-align": "文字对齐方式（left/center/right）",
    "text-decoration": "文字装饰（如下划线）",
    margin: "外边距，元素与外界的距离",
    padding: "内边距，内容与元素边框的距离",
    border: "边框（粗细、样式、颜色）",
    "border-radius": "圆角，越大越圆润",
    width: "宽度",
    height: "高度",
    "max-width": "最大宽度，防止元素过宽",
    "min-width": "最小宽度",
    display: "显示方式（如 flex 弹性布局、none 隐藏）",
    flex: "弹性布局参数，控制元素如何伸缩",
    "flex-direction": "弹性布局的方向（row 横排 / column 竖排）",
    "justify-content": "主轴方向上的排列方式（居中、两端对齐等）",
    "align-items": "交叉轴方向上的对齐方式",
    position: "定位方式（relative 相对 / absolute 绝对 / fixed 固定）",
    top: "距顶部的位置",
    left: "距左侧的位置",
    right: "距右侧的位置",
    bottom: "距底部的位置",
    "z-index": "层级，数值大的盖在小的上面",
    float: "浮动，让元素向左或向右靠边",
    overflow: "内容超出时的处理（hidden 隐藏 / auto 滚动）",
    opacity: "不透明度，0 全透明 1 不透明",
    transition: "过渡动画，让样式变化更平滑",
    animation: "动画",
    transform: "变换（旋转、缩放、位移）",
    cursor: "鼠标样式（pointer 就是小手）",
    "box-shadow": "盒子阴影，制造立体感",
    "text-shadow": "文字阴影",
    "letter-spacing": "字间距",
    "word-spacing": "词间距",
    "list-style": "列表样式（如去掉圆点）",
    visibility: "可见性（visible 可见 / hidden 隐藏但占位）",
    "white-space": "空白处理（nowrap 不换行）",
    "vertical-align": "垂直对齐",
    outline: "轮廓线（如输入框聚焦时的外圈）",
    "border-collapse": "表格边框合并",
    "grid-template-columns": "网格布局的列定义",
    gap: "网格/弹性布局中元素之间的间距",
  };

  /* ---------- 语言配置 ---------- */
  const LANGS = {
    python: {
      name: "Python",
      file: "main.py",
      intro: "Python 是一种语法简洁、接近自然语言的编程语言，非常适合初学者。",
    },
    php: {
      name: "PHP",
      file: "index.php",
      intro: "PHP 是运行在服务器上的脚本语言，常用于生成网页内容、处理表单。",
    },
    html: {
      name: "HTML",
      file: "index.html",
      intro: "HTML 不是编程语言，而是网页的“骨架”，用标签描述页面的结构。",
    },
    css: {
      name: "CSS",
      file: "style.css",
      intro: "CSS 也不是编程语言，而是网页的“化妆师”，负责颜色、大小、布局等外观。",
    },
    c: {
      name: "C 语言",
      file: "main.c",
      intro: "C 是一门经典的系统级编程语言，程序结构严谨，很多底层软件都用它编写。",
    },
    cpp: {
      name: "C++",
      file: "main.cpp",
      intro: "C++ 在 C 的基础上增加了类、对象等特性，是游戏、软件开发的常用语言。",
    },
  };

  /* ---------- 行分类器 ---------- */
  function classify(lang, trimmed) {
    const t = trimmed.trim();
    if (!t) return { kind: "blank" };
    const starts = (re) => re.test(t);

    if (lang === "python") {
      if (starts(/^#/)) return { kind: "comment", text: t };
      let m = /^def\s+([A-Za-z_]\w*)\s*\(/.exec(t);
      if (m) return { kind: "func", name: m[1] };
      m = /^class\s+([A-Za-z_]\w*)/.exec(t);
      if (m) return { kind: "class", name: m[1] };
      if (starts(/^(import|from)\s+/)) return { kind: "import", text: t };
      if (starts(/^for\b/)) return { kind: "loop", text: t };
      if (starts(/^while\b/)) return { kind: "loop", text: t };
      if (starts(/^if\b|^elif\b/)) return { kind: "cond", text: t };
      if (starts(/^else\b/)) return { kind: "cond", text: t };
      if (starts(/^return\b/)) return { kind: "return", text: t };
      if (starts(/^print\s*\(/)) return { kind: "output", text: t };
      if (starts(/^input\s*\(/)) return { kind: "input", text: t };
      m = /^([A-Za-z_]\w*)\s*([+\-*/%]?=)/.exec(t);
      if (m) return { kind: "var", name: m[1], op: m[2] };
      m = /^([A-Za-z_]\w*)\s*\(/.exec(t);
      if (m) return { kind: "call", name: m[1] };
      if (starts(/^try\b|^except\b|^finally\b/)) return { kind: "cond", text: t };
      if (starts(/^with\b/)) return { kind: "other", text: t };
      return { kind: "other", text: t };
    }

    if (lang === "php") {
      if (starts(/^<\?php/)) return { kind: "import", text: t };
      if (starts(/^\?>$/)) return { kind: "other", text: t };
      if (starts(/^\/\//) || starts(/^#/)) return { kind: "comment", text: t };
      let m = /^function\s+([A-Za-z_]\w*)\s*\(/.exec(t);
      if (m) return { kind: "func", name: m[1] };
      m = /^(public|private|protected|static)\s+function\s+([A-Za-z_]\w*)\s*\(/.exec(t);
      if (m) return { kind: "func", name: m[2], method: true };
      m = /^class\s+([A-Za-z_]\w*)/.exec(t);
      if (m) return { kind: "class", name: m[1] };
      if (starts(/^(require|require_once|include|include_once|use|namespace)\b/)) return { kind: "import", text: t };
      if (starts(/^foreach\b/)) return { kind: "loop", text: t };
      if (starts(/^for\b/)) return { kind: "loop", text: t };
      if (starts(/^while\b/)) return { kind: "loop", text: t };
      if (starts(/^if\b|^elseif\b/)) return { kind: "cond", text: t };
      if (starts(/^else\b/)) return { kind: "cond", text: t };
      if (starts(/^switch\b/)) return { kind: "cond", text: t };
      if (starts(/^case\b/)) return { kind: "cond", text: t };
      if (starts(/^(echo|print)\b/)) return { kind: "output", text: t };
      if (starts(/^return\b/)) return { kind: "return", text: t };
      m = /^(\$\w+)\s*([+\-*/%]?=)/.exec(t);
      if (m) return { kind: "var", name: m[1], op: m[2] };
      m = /^(\$\w+)\s*\(/.exec(t);
      if (m) return { kind: "call", name: m[1] };
      return { kind: "other", text: t };
    }

    if (lang === "c" || lang === "cpp") {
      if (starts(/^#\s*include/)) return { kind: "import", text: t, pre: true };
      if (starts(/^#\s*define/)) return { kind: "import", text: t, pre: true };
      if (starts(/^#\s*(ifdef|ifndef|endif|pragma|undef)/)) return { kind: "import", text: t, pre: true };
      if (starts(/^\/\//)) return { kind: "comment", text: t };
      let m = /^(?:int|void|char|float|double|long|unsigned|short|signed|bool)\s+main\s*\(/.exec(t);
      if (m) return { kind: "main", text: t };
      m = /^(?:int|void|char|float|double|long|unsigned|short|signed|bool|string|auto)\s+([A-Za-z_]\w*)\s*\(/.exec(t);
      if (m) return { kind: "func", name: m[1] };
      m = /^(struct|class)\s+([A-Za-z_]\w*)/.exec(t);
      if (m) return { kind: "class", name: m[2] };
      if (starts(/^typedef\b|^enum\b|^union\b/)) return { kind: "class", text: t };
      if (starts(/^for\b|^while\b|^do\b/)) return { kind: "loop", text: t };
      if (starts(/^if\b/)) return { kind: "cond", text: t };
      if (starts(/^else\b/)) return { kind: "cond", text: t };
      if (starts(/^switch\b/)) return { kind: "cond", text: t };
      if (starts(/^case\b/)) return { kind: "cond", text: t };
      if (starts(/^default\b/)) return { kind: "cond", text: t };
      if (starts(/^return\b/)) return { kind: "return", text: t };
      if (starts(/^printf\s*\(/) || starts(/^puts\s*\(/) || /^std::cout/.test(t)) return { kind: "output", text: t };
      if (starts(/^scanf\s*\(/) || starts(/^gets\s*\(/) || /^std::cin/.test(t)) return { kind: "input", text: t };
      m = /^(?:int|char|float|double|long|unsigned|short|signed|bool|string|auto|const|static)\s+([A-Za-z_]\w*)/.exec(t);
      if (m) return { kind: "var", name: m[1], declare: true };
      m = /^([A-Za-z_]\w*)\s*\[[^\]]*\]\s*([+\-*/%]?=)/.exec(t);
      if (m) return { kind: "var", name: m[1], op: m[2] };
      m = /^([A-Za-z_]\w*)\s*([+\-*/%]?=)/.exec(t);
      if (m) return { kind: "var", name: m[1], op: m[2] };
      if (starts(/^}/)) return { kind: "block", text: t, close: true };
      if (starts(/^{/)) return { kind: "block", text: t };
      return { kind: "other", text: t };
    }

    if (lang === "html") {
      if (starts(/^<!DOCTYPE/)) return { kind: "doc", text: t };
      if (starts(/^<!--/)) return { kind: "comment", text: t };
      const tags = [];
      const re = /<\/?([A-Za-z][\w-]*)/g;
      let m;
      while ((m = re.exec(t)) !== null) tags.push(m[1]);
      if (tags.length) {
        const first = tags[0].toLowerCase();
        return { kind: "html", tags, first, text: t };
      }
      if (!t.startsWith("<")) return { kind: "other", text: t, htmlText: true };
      return { kind: "other", text: t };
    }

    if (lang === "css") {
      if (starts(/^\/\*/)) return { kind: "comment", text: t };
      if (starts(/^@media\b|^@supports\b/)) return { kind: "media", text: t };
      if (starts(/^@import\b|^@font-face\b|^@keyframes\b/)) return { kind: "import", text: t };
      if (t.includes("{")) return { kind: "selector", text: t };
      if (starts(/^}/)) return { kind: "block", text: t, close: true };
      const pm = /^([-\w]+)\s*:\s*(.+);?$/.exec(t);
      if (pm) return { kind: "prop", prop: pm[1], value: pm[2], text: t };
      return { kind: "other", text: t };
    }

    return { kind: "other", text: t };
  }

  /* ---------- 逐行讲解文案 ---------- */
  function lineExplain(lang, info) {
    const k = info.kind;
    const q = (s) => "“" + s + "”";

    switch (k) {
      case "blank": return "";
      case "comment": {
        const body = info.text.replace(/^#+\s*|\/\/\s*|<!--\s*|\s*-->$/g, "").trim();
        return "注释：写给人类看的说明，程序会直接跳过。" + (body ? "这里写着：\u201c" + body + "\u201d" : "");
      }
      case "import":
        if (lang === "c" || lang === "cpp") {
          const name = (info.text.match(/[<"]([^>"]+)[>"]/) || [])[1] || info.text;
          return "预处理指令：把 " + name + " 这个现成的代码库（头文件）引入进来，这样下面就能使用它提供的功能（比如 printf 输出）。";
        }
        if (lang === "php") {
          if (/require|include/.test(info.text)) return "引入语句：把另一个 PHP 文件或库加载进来复用，相当于“借用别人的代码”。";
          if (/^use\b/.test(info.text)) return "声明使用：引入一个命名空间/类库，之后可以直接用里面的类。";
          return "打开 PHP 代码块：<?php 表示从这里开始写 PHP 代码，服务器执行完才会输出结果。";
        }
        return "导入语句：引入现成的模块/工具包，之后就能使用它提供的功能。";
      case "output":
        if (lang === "php") return "输出语句：echo 会把后面的内容直接打印到网页上，用户能在浏览器里看到。";
        if (lang === "c") return "输出语句：printf 按指定格式把文字/数值打印到控制台窗口。";
        if (lang === "cpp") return "输出语句：cout 配合 << 把内容输出到控制台窗口；endl 表示换行。";
        return "输出语句：把括号里的内容打印到屏幕上，是程序“说话”的方式。";
      case "input":
        if (lang === "c") return "输入语句：scanf 等待用户从键盘输入，并按格式存进变量（& 表示“放进这个变量的地址”）。";
        if (lang === "cpp") return "输入语句：cin 配合 >> 等待用户从键盘输入，并存入后面的变量。";
        return "输入语句：程序停下来，等用户输入文字，并把输入的内容作为结果返回（常配合变量一起用）。";
      case "var":
        if (info.declare) return "声明变量：创建了一个名为 " + info.name + " 的变量，并声明它存储" + (lang === "cpp" ? "对应的" : "对应的") + "类型数据。以后就用这个名字代表这个数据。";
        return "赋值：把右边的值装进变量 " + info.name + " 里（= 表示“存入”，不是数学上的“等于”）。之后使用 " + info.name + " 就等于使用这个值。";
      case "loop":
        if (lang === "python" && /^for\b/.test(info.text)) return "循环开始（for）：会依次取出可遍历对象里的每一项，每取一项就执行下面缩进的代码块一遍。";
        if (lang === "php" && /^foreach\b/.test(info.text)) return "循环开始（foreach）：把数组/对象里的每一项挨个取出来，每取一个执行一遍下面的代码块。";
        if (lang === "cpp" && /std::/.test(info.text)) return "";
        if (lang === "c" || lang === "cpp") return "循环开始（" + (info.text.trim().startsWith("do") ? "do" : /for/.test(info.text) ? "for" : "while") + "）：让下面的代码块反复执行，直到条件不再满足才停下。";
        return "循环开始：让下面的代码块反复执行，只要条件成立就一直循环。";
      case "cond":
        if (/^else\b/.test(info.text)) return "否则分支（else）：当上面的条件都不成立时，执行这里的代码块。";
        if (/^elif\b/.test(info.text)) return "再判断（elif）：如果上面的条件不成立，再看看这里的新条件是否成立。";
        if (/^elseif\b/.test(info.text)) return "再判断（elseif）：如果上面的条件不成立，再检查这里的新条件。";
        if (/^case\b/.test(info.text)) return "分支（case）：当 switch 的值等于这个 case 后面的值时，执行这里的代码。";
        if (/^default\b/.test(info.text)) return "默认分支（default）：当 switch 的值不匹配任何 case 时，执行这里的代码。";
        if (/^switch\b/.test(info.text)) return "多路分支（switch）：根据一个值匹配多个分支，比一堆 if/else 更清晰。";
        return "条件判断（if）：检查条件是否成立，成立就执行下面缩进的代码块，否则跳过。";
      case "func":
        return "定义函数" + (info.method ? "（方法）" : "") + "：创建了一个叫 " + info.name + " 的函数，把一段可复用的逻辑打包起来。函数定义本身不会立即执行，只有被“调用”时才运行。" + (info.method ? "它是类里的方法，需要通过对象调用。" : "");
      case "class":
        if (lang === "c" || lang === "cpp" || lang === "php") return "定义" + (info.name ? " " + info.name + " " : " ") + "类型/类：声明了一种新的“数据蓝图”，可以把它当作模板，创建出多个实例。" + (/typedef|enum|union/.test(info.text) ? "（typedef 是给类型起别名，enum 是枚举，union 是共用体）" : "");
        return "定义类：" + info.name + " 是一种“设计图纸”，把相关的数据和操作打包在一起。以后可以按这张图纸创建出多个实例（对象）。";
      case "return":
        return "返回语句：结束当前函数，并把后面的值作为“结果”交还给调用它的地方。";
      case "main":
        return "主函数入口：main 是程序的起点，程序一运行就从这里开始执行，它结束程序就结束。";
      case "call":
        return "调用函数：执行 " + info.name + "() 这个已经定义好的函数，并接收它的结果。" + (lang === "python" ? "（Python 中函数调用会先执行函数体，再继续往下走）" : "");
      case "block":
        return info.close ? "代码块结束：} 表示前面这个代码块到此为止，里面的代码是一组整体。" : "代码块开始：{ 表示开启一个代码块，里面的代码是一个整体。";
      case "doc":
        return "文档声明：告诉浏览器“这是一个 HTML5 网页”，浏览器按标准模式解析。";
      case "html": {
        const first = info.first;
        if (HTML_TAGS[first]) {
          const others = info.tags.filter((x) => x !== first).map((x) => "<" + x + ">");
          const multi = others.length ? " 本行还包含 " + others.join("、") + "。" : "";
          return "HTML 标签 <" + first + ">：" + HTML_TAGS[first] + multi;
        }
        return "HTML 标签 <" + first + ">：网页结构的一部分。";
      }
      case "selector":
        return "选择器：这一行开始定义一组样式规则。" + (info.text.includes("{") ? " 花括号 { 前的内容指明“要给谁化妆”，后面的 { 表示规则开始。" : "");
      case "prop": {
        const meaning = CSS_PROPS[info.prop];
        return "CSS 属性：设置 " + info.prop + "（" + (meaning || "外观属性") + "）的值为 " + info.value + "。" + (meaning ? "" : " 具体的取值含义可以查 CSS 手册。");
      }
      case "media":
        return "媒体查询：根据屏幕条件（如宽度）应用不同样式，是实现“手机/电脑自适应”的关键。";
      case "other":
        if (info.htmlText) return "纯文本：这行文字会直接显示在网页上（不在标签里）。";
        return "普通语句：这行代码在执行时会被处理，具体作用需要结合上下文理解。";
      default:
        return "";
    }
  }

  /* ---------- 术语提取 ---------- */
  function extractTerms(lang, code, infos) {
    const hits = [];
    const push = (t) => {
      if (!hits.some((h) => h.name === t.name)) hits.push(t);
    };
    // 由语句类型推断
    const has = (k) => infos.some((i) => i.kind === k);
    if (has("loop")) push(dict("loop"));
    if (has("cond")) push(dict("if"));
    if (has("func")) push(dict("function"));
    if (has("class")) push(dict("class"));
    if (has("var")) push(dict("variable"));
    if (has("output")) push(dict("print"));
    if (has("input")) push(dict("input"));
    if (has("import")) push(dict("import"));
    if (has("main")) push(dict("main"));
    if (lang === "html") push(dict("tag"));
    if (lang === "css") {
      push(dict("selector"));
      push(dict("property"));
      if (/flex/.test(code)) push(dict("flex"));
      if (/margin/.test(code)) push(dict("margin"));
    }
    // 由代码文本推断
    if (/["']/.test(code)) push(dict("string"));
    if (/\b\d+/.test(code)) push(dict("number", true));
    if (lang === "python" && /\b(list|\[\])/.test(code)) push(dict("array"));
    if (lang === "python" && /\b(dict|{)/.test(code)) push(dict("dictionary"));
    if (lang === "cpp" && /\bvector\b/.test(code)) push(dict("array"));
    if (/\b(bool|boolean|True|False|true|false)\b/.test(code)) push(dict("boolean"));
    if (/\breturn\b/.test(code)) push(dict("return"));
    if (/\bif\b|\bfor\b|\bwhile\b/.test(code) && !has("loop")) push(dict("loop"));
    // 语言特有
    if (lang === "python" && /def\b/.test(code)) push(dict("def"));
    return hits.slice(0, 10);
  }

  function dict(key) {
    const item = TERM_DICT.find((d) => d.keys.includes(key));
    return { name: item.name, meaning: item.meaning };
  }

  /* ---------- 概览 ---------- */
  function buildOverview(lang, code, infos) {
    const cfg = LANGS[lang];
    const nonEmpty = infos.filter((i) => i.kind !== "blank");
    const count = (k) => infos.filter((i) => i.kind === k).length;
    const stats = {
      lines: nonEmpty.length,
      comments: count("comment"),
      funcs: count("func"),
      loops: count("loop"),
      conds: count("cond"),
      vars: count("var"),
      outputs: count("output"),
      classes: count("class"),
    };
    const has = (k) => stats[k] > 0;

    let title, summary;
    const feat = [];
    if (has("funcs")) feat.push("定义了 " + stats.funcs + " 个函数");
    if (has("loops")) feat.push("有 " + stats.loops + " 处循环");
    if (has("conds")) feat.push("有 " + stats.conds + " 处条件判断");
    if (has("classes")) feat.push("定义了 " + stats.classes + " 个类");
    if (has("outputs")) feat.push("有 " + stats.outputs + " 处输出");

    if (lang === "html") {
      title = "一个网页页面";
      summary = "这是一份 HTML 网页文件。浏览器会按照这些标签，把它渲染成包含文字、图片、按钮的页面。它只负责“长什么样、有什么内容”，真正的动态交互还需要脚本（如 JavaScript）。";
    } else if (lang === "css") {
      title = "一份网页样式表";
      summary = "这是一份 CSS 样式表，是网页的“化妆师”。它不产生内容，只规定网页元素的颜色、大小、间距和排版方式。";
    } else if (lang === "c" || lang === "cpp") {
      if (has("outputs") && has("inputs")) {
        title = "一个交互式命令行小程序";
        summary = "这是一个 C" + (lang === "cpp" ? "++" : "") + " 程序：从 main 入口开始执行，接收用户输入、经过处理后把结果打印到控制台窗口。";
      } else if (has("funcs") || has("loops")) {
        title = "一个带流程控制的小程序";
        summary = "这是一个 C" + (lang === "cpp" ? "++" : "") + " 程序：从 main 入口开始，用" + (has("funcs") ? "函数" : "") + (has("funcs") && has("loops") ? "和" : "") + (has("loops") ? "循环" : "") + "组织逻辑，是典型的程序结构。";
      } else {
        title = "一个入门 C" + (lang === "cpp" ? "++" : "") + " 程序";
        summary = "这是一个 C" + (lang === "cpp" ? "++" : "") + " 入门程序片段，包含基本语句，用于演示语言语法。";
      }
    } else if (lang === "python") {
      if (has("classes")) {
        title = "一个面向对象的 Python 程序";
        summary = "这段代码用“类”来组织逻辑，把数据和操作打包在一起，再按需创建实例。";
      } else if (has("inputs")) {
        title = "一个可以对话的 Python 小工具";
        summary = "这段代码会向用户提问、读取输入，再根据输入做处理并输出结果，适合做交互式小工具。";
      } else if (has("funcs") && has("loops")) {
        title = "一个典型的数据处理小程序";
        summary = "它把任务拆成函数，再用循环批量处理数据（如遍历列表计算），是 Python 最常见的小程序结构。";
      } else if (has("outputs") && !has("funcs") && !has("loops")) {
        title = "一个入门输出程序";
        summary = "这段代码主要用 print 把文字或计算结果打印出来，是最基础的 Python 入门写法。";
      } else {
        title = "一个 Python 程序片段";
        summary = "这段代码包含若干基础语句" + (feat.length ? "（" + feat.join("、") + "）" : "") + "，是一个小规模的程序。";
      }
    } else if (lang === "php") {
      title = "一个 PHP 网页后端脚本";
      summary = "这是一段 PHP 代码，运行在服务器上。它可以处理表单数据、读取数据库，并把结果以 HTML 形式输出给浏览器。";
    } else {
      title = "一段代码";
      summary = "这是一段" + cfg.name + "代码，共 " + stats.lines + " 行。" + (feat.length ? "它" + feat.join("、") + "。" : "");
    }

    // 提取代码里的“名字”（变量/函数），帮助新手理解
    const names = [];
    const seen = new Set();
    for (const i of infos) {
      if (i.kind === "func" && i.name && !seen.has(i.name)) { names.push(i.name); seen.add(i.name); }
      if (i.kind === "class" && i.name && !seen.has(i.name)) { names.push(i.name); seen.add(i.name); }
    }
    for (const i of infos) {
      if ((i.kind === "var" || i.kind === "call") && i.name && !seen.has(i.name) && names.length < 8) { names.push(i.name); seen.add(i.name); }
    }

    let extra = "";
    if (names.length) {
      extra = "代码里出现的名字：" + names.slice(0, 6).join("、") + " —— 这些名字都是程序员自己起的，用来代表数据或功能，换成别的名字程序也能正常工作。";
    }

    return { title, summary, stats, feat, extra, langName: cfg.name, intro: cfg.intro };
  }

  /* ---------- 主入口 ---------- */
  window.ENGINE = {
    explain: function (code, lang) {
      if (!LANGS[lang]) lang = "python";
      const rawLines = code.split("\n");
      const infos = rawLines.map((raw, idx) => {
        const info = classify(lang, raw);
        return Object.assign({ no: idx + 1, raw }, info);
      });

      const lines = [];
      for (const info of infos) {
        const explanation = lineExplain(lang, info);
        if (info.kind === "blank") continue;
        lines.push({
          no: info.no,
          code: info.raw,
          kind: info.kind,
          label: KIND_LABEL[info.kind] || "语句",
          explanation: explanation || "这行代码参与程序的运行。",
        });
      }

      const overview = buildOverview(lang, code, infos);
      const terms = extractTerms(lang, code, infos);

      return { overview, lines, terms, lang };
    },

    LANG_NAMES,
    KIND_LABEL,
    HTML_TAGS,
    CSS_PROPS,
  };
})();
