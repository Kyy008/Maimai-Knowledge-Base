import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const inputPath = path.join(projectRoot, "all-data-json.json");
const outputPath = path.join(projectRoot, "all-data-NL.md");

const difficultyConfigs = [
  { key: "basic_info", en: "basic", zh: "绿" },
  { key: "advance_info", en: "advanced", zh: "黄" },
  { key: "expert_info", en: "expert", zh: "红" },
  { key: "master_info", en: "master", zh: "紫" },
  { key: "remaster_info", en: "remaster", zh: "白" },
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

function pushLine(lines, line = "") {
  lines.push(line);
}

function renderDifficulty(lines, title, info) {
  pushLine(lines, `### ${title}`);
  pushLine(lines);
  pushLine(lines, `- 等级：${formatPlainValue(info.level)}`);
  pushLine(lines, `- 定数：${formatInternalLevelValue(info.internalLevelValue)}`);
  pushLine(lines, "- 物量：");
  pushLine(lines, `  - tap：${formatPlainValue(info.tap)}`);
  pushLine(lines, `  - hold：${formatPlainValue(info.hold)}`);
  pushLine(lines, `  - slide：${formatPlainValue(info.slide)}`);
  if (info.touch !== null && info.touch !== undefined) {
    pushLine(lines, `  - touch：${formatPlainValue(info.touch)}`);
  }
  pushLine(lines, `  - break：${formatPlainValue(info.break)}`);

  const nihe = formatFixed(info.nihe, 2);
  const avgAcc = formatFixed(info.avg_acc, 2);
  const sssPlusRate = formatFixed(info["sss+_rate"], 2);
  const apRate = formatFixed(info.ap_rate, 2);

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
}

async function main() {
  const raw = await fs.readFile(inputPath, "utf8");
  const songs = JSON.parse(raw);
  const lines = [];

  pushLine(lines, "# maimai 乐曲知识库");
  pushLine(lines);
  pushLine(lines, `共收录 ${songs.length} 首曲目实体。`);
  pushLine(lines);

  for (const song of songs) {
    const typeDisplay = formatType(song.type);

    pushLine(lines, `## 乐曲：${song.songId} | ${typeDisplay}`);
    pushLine(lines);
    pushLine(lines, "### 基础信息");
    pushLine(lines);
    pushLine(lines, `- 曲名：${song.songId}`);
    pushLine(lines, `- 类型：${typeDisplay}`);
    pushLine(lines, `- 歌曲Id：${formatPlainValue(song.internalId)}`);
    pushLine(lines, `- BPM：${formatPlainValue(song.bpm)}`);
    pushLine(lines, `- 版本：${formatPlainValue(song.version)}`);

    if (Array.isArray(song.otherName) && song.otherName.length > 0) {
      pushLine(lines, `- 别名：${song.otherName.join("、")}`);
    }

    pushLine(lines);

    for (const difficulty of difficultyConfigs) {
      const info = song[difficulty.key];
      if (!info) {
        continue;
      }

      renderDifficulty(lines, `${difficulty.en} / ${difficulty.zh}`, info);
    }

    pushLine(lines, "---");
    pushLine(lines);
  }

  await fs.writeFile(outputPath, `${lines.join("\n").trimEnd()}\n`, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
