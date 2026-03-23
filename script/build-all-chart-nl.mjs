import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const inputPath = path.join(projectRoot, "all-data-json.json");
const outputPath = path.join(projectRoot, "all-chart-NL.md");

const difficultyConfigs = [
  { key: "basic_info", en: "basic", zh: "绿", sentenceEn: "basic" },
  { key: "advance_info", en: "advanced", zh: "黄", sentenceEn: "advance" },
  { key: "expert_info", en: "expert", zh: "红", sentenceEn: "expert" },
  { key: "master_info", en: "master", zh: "紫", sentenceEn: "master" },
  { key: "remaster_info", en: "remaster", zh: "白", sentenceEn: "remaster" },
];

function formatFixed(value, digits) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number") {
    return String(value);
  }

  return value.toFixed(digits);
}

function formatInternalLevelValue(value) {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value !== "number") {
    return String(value);
  }

  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function formatPlainValue(value) {
  return value === null || value === undefined ? "null" : String(value);
}

function formatType(type) {
  if (type === "dx") {
    return "DX";
  }

  return type;
}

function formatTypeForSentence(type) {
  if (type === "dx") {
    return "dx";
  }

  return type;
}

function pushLine(lines, line = "") {
  lines.push(line);
}

function renderChartBlock(lines, song, difficulty) {
  const info = song[difficulty.key];
  if (!info) {
    return false;
  }

  const typeDisplay = formatType(song.type);
  const typeSentence = formatTypeForSentence(song.type);
  const difficultyDisplay = `${difficulty.en} / ${difficulty.zh}`;
  const nihe = formatFixed(info.nihe, 2);
  const avgAcc = formatFixed(info.avg_acc, 2);
  const sssPlusRate = formatFixed(info["sss+_rate"], 2);
  const apRate = formatFixed(info.ap_rate, 2);

  pushLine(lines, `## 谱面：${song.songId} | ${typeDisplay} | ${difficultyDisplay}`);
  pushLine(lines);
  const niheSentence = nihe === null ? "拟合定数暂无数据" : `拟合定数${nihe}`;
  pushLine(
    lines,
    `曲名为${song.songId}，是${formatPlainValue(song.version)}版本的${typeSentence}谱，难度为${difficulty.sentenceEn}，是${difficulty.zh}谱，等级${formatPlainValue(info.level)}，定数${formatInternalLevelValue(info.internalLevelValue)}，${niheSentence}。`
  );
  pushLine(lines);
  pushLine(lines, `- 曲名：${song.songId}`);
  pushLine(lines, `- 类型：${typeDisplay}`);
  pushLine(lines, `- 难度：${difficultyDisplay}`);
  pushLine(lines, `- 等级：${formatPlainValue(info.level)}`);
  pushLine(lines, `- 定数：${formatInternalLevelValue(info.internalLevelValue)}`);
  pushLine(lines, `- BPM：${formatPlainValue(song.bpm)}`);
  pushLine(lines, `- 版本：${formatPlainValue(song.version)}`);

  if (Array.isArray(song.otherName) && song.otherName.length > 0) {
    pushLine(lines, `- 别名：${song.otherName.join("、")}`);
  }

  pushLine(lines, "- 物量：");
  pushLine(lines, `  - tap：${formatPlainValue(info.tap)}`);
  pushLine(lines, `  - hold：${formatPlainValue(info.hold)}`);
  pushLine(lines, `  - slide：${formatPlainValue(info.slide)}`);

  if (info.touch !== null && info.touch !== undefined) {
    pushLine(lines, `  - touch：${formatPlainValue(info.touch)}`);
  }

  pushLine(lines, `  - break：${formatPlainValue(info.break)}`);

  if (nihe !== null) {
    pushLine(lines, `- 拟合定数：${nihe}`);
  }

  if (avgAcc !== null) {
    pushLine(lines, `- 平均达成率：${avgAcc}%`);
  }

  if (sssPlusRate !== null) {
    pushLine(lines, `- SSS+率：${sssPlusRate}%`);
  }

  if (apRate !== null) {
    pushLine(lines, `- AP率：${apRate}%`);
  }

  if (Array.isArray(info.tags) && info.tags.length > 0) {
    pushLine(lines, `- 标签：${info.tags.join("、")}`);
  }

  pushLine(lines);
  pushLine(lines, "---");
  pushLine(lines);
  return true;
}

async function main() {
  const raw = await fs.readFile(inputPath, "utf8");
  const songs = JSON.parse(raw);
  const lines = [];
  let chartCount = 0;

  pushLine(lines, "# maimai 谱面知识库");
  pushLine(lines);

  for (const song of songs) {
    for (const difficulty of difficultyConfigs) {
      if (renderChartBlock(lines, song, difficulty)) {
        chartCount += 1;
      }
    }
  }

  lines.splice(2, 0, `共收录 ${chartCount} 张谱面知识块。`, "");

  await fs.writeFile(outputPath, `${lines.join("\n").trimEnd()}\n`, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
