/* ============================================================
   译码 CodeLens · 六种语言的示例代码（一键载入）
   ============================================================ */
window.SAMPLES = {
  python: `# 一个简单的成绩统计程序
# 班级同学的成绩（存在列表里）
scores = [85, 92, 78, 90, 88]

# 定义一个函数：计算平均分
def average(nums):
    total = 0
    for score in nums:
        total = total + score
    return total / len(nums)

# 调用函数，并打印结果
avg = average(scores)
print("班级平均分是：", avg)`,

  php: `<?php
// 一个简单的 PHP 示例：输出学生名单

// 用数组存放三个同学的名字
$students = ["小明", "小红", "小刚"];

// 用 foreach 循环遍历数组，逐个输出
foreach ($students as $name) {
    echo "<li>" . $name . "</li>";
}

// 判断成绩是否及格
$score = 85;
if ($score >= 60) {
    echo "<p>及格了！</p>";
} else {
    echo "<p>不及格，继续加油</p>";
}
?>`,

  html: `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>我的第一个网页</title>
</head>
<body>
    <!-- 网页正文从这里开始 -->
    <h1>你好，世界！</h1>
    <p>这是我的第一个网页，<strong>欢迎</strong>光临。</p>
    <a href="https://example.com">点我跳转</a>
    <img src="photo.jpg" alt="一张照片">
    <ul>
        <li>第一项</li>
        <li>第二项</li>
    </ul>
    <button>点击按钮</button>
</body>
</html>`,

  css: `/* 页面整体样式 */
body {
    background-color: #0f172a;
    color: #ffffff;
    font-family: "Microsoft YaHei", sans-serif;
}

/* 卡片样式 */
.card {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    padding: 20px;
    margin: 16px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

/* 鼠标悬停时微微上浮 */
.card:hover {
    transform: translateY(-4px);
}`,

  c: `#include <stdio.h>

// 主函数：程序从这里开始执行
int main() {
    int age;
    printf("请输入你的年龄：");
    scanf("%d", &age);

    if (age >= 18) {
        printf("你已经成年了！\\n");
    } else {
        printf("你还未成年。\\n");
    }

    // 用 for 循环从 1 数到 5
    for (int i = 1; i <= 5; i++) {
        printf("%d ", i);
    }
    printf("\\n");
    return 0;
}`,

  cpp: `#include <iostream>
#include <vector>
using namespace std;

// 定义一个函数：计算总分
int sum(vector<int> nums) {
    int total = 0;
    for (int n : nums) {
        total += n;
    }
    return total;
}

int main() {
    vector<int> scores = {85, 92, 78};
    cout << "总分是：" << sum(scores) << endl;
    return 0;
}`,
};
