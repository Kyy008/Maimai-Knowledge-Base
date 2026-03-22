import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const allDataPath = path.join(projectRoot, "all-data-json.json");
const nihePath = path.join(projectRoot, "raw_data", "nihe-info.json");
const tagsPath = path.join(projectRoot, "raw_data", "tags-info.json");
const errorPath = path.join(projectRoot, "error.md");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function loadAllData(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(data)) {
    throw new Error("all-data-json.json 必须是数组");
  }
  return data;
}

function loadNiheCharts(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!data || typeof data !== "object" || !isPlainObject(data.charts)) {
    throw new Error("raw_data/nihe-info.json 缺少 charts 对象");
  }
  return data.charts;
}

function loadTagsData(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray(data.tags) ||
    !Array.isArray(data.tagSongs)
  ) {
    throw new Error("raw_data/tags-info.json 缺少 tags 或 tagSongs 数组");
  }
  return data;
}

function calculateRate(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  if (!Number.isFinite(numerator)) {
    return null;
  }
  return (numerator / denominator) * 100;
}

function rebuildDifficultyInfo(baseInfo, niheEntry) {
  if (!isPlainObject(baseInfo)) {
    return baseInfo;
  }

  const next = {
    level: baseInfo.level ?? null,
    internalLevelValue: baseInfo.internalLevelValue ?? null,
    tap: baseInfo.tap ?? null,
    hold: baseInfo.hold ?? null,
    slide: baseInfo.slide ?? null,
    touch: baseInfo.touch ?? null,
    break: baseInfo.break ?? null,
    nihe: null,
    avg_acc: null,
    "sss+_rate": null,
    ap_rate: null,
    tags: [],
  };

  if (!isPlainObject(niheEntry) || Object.keys(niheEntry).length === 0) {
    return next;
  }

  const dist = Array.isArray(niheEntry.dist) ? niheEntry.dist : null;
  const fcDist = Array.isArray(niheEntry.fc_dist) ? niheEntry.fc_dist : null;

  next.nihe = niheEntry.fit_diff ?? null;
  next.avg_acc = niheEntry.avg ?? null;

  if (dist && dist.length > 0) {
    const distSum = dist.reduce((sum, value) => sum + Number(value || 0), 0);
    const sssPlusNumerator = Number(dist[dist.length - 1] ?? 0);
    next["sss+_rate"] = calculateRate(sssPlusNumerator, distSum);
  }

  if (fcDist && fcDist.length >= 2) {
    const fcSum = fcDist.reduce((sum, value) => sum + Number(value || 0), 0);
    const apNumerator =
      Number(fcDist[fcDist.length - 1] ?? 0) +
      Number(fcDist[fcDist.length - 2] ?? 0);
    next.ap_rate = calculateRate(apNumerator, fcSum);
  }

  return next;
}

function refreshNiheFields(allData, niheCharts) {
  const fieldOrder = [
    "basic_info",
    "advance_info",
    "expert_info",
    "master_info",
    "remaster_info",
  ];

  let niheAppliedCount = 0;

  for (const song of allData) {
    if (song.internalId === "none") {
      for (const fieldName of fieldOrder) {
        if (song[fieldName]) {
          song[fieldName] = rebuildDifficultyInfo(song[fieldName], null);
        }
      }
      continue;
    }

    const chartGroup = niheCharts[String(song.internalId)];

    for (const [index, fieldName] of fieldOrder.entries()) {
      if (!song[fieldName]) {
        continue;
      }

      const niheEntry = Array.isArray(chartGroup) ? chartGroup[index] : null;
      song[fieldName] = rebuildDifficultyInfo(song[fieldName], niheEntry);
      if (isPlainObject(niheEntry) && Object.keys(niheEntry).length > 0) {
        niheAppliedCount += 1;
      }
    }
  }

  return { niheAppliedCount };
}

function applyTagsInfo(allData, tagsData) {
  const difficultyFieldMap = {
    basic: "basic_info",
    advanced: "advance_info",
    expert: "expert_info",
    master: "master_info",
    remaster: "remaster_info",
  };

  for (const song of allData) {
    for (const fieldName of Object.values(difficultyFieldMap)) {
      if (song[fieldName]) {
        song[fieldName].tags = [];
      }
    }
  }

  const songMap = new Map();
  for (const song of allData) {
    songMap.set(`${song.songId}|||${song.type}`, song);
  }

  const tagNameById = new Map();
  const missingLocalizedNameIds = [];
  for (const tag of tagsData.tags) {
    const zhHans = tag?.localized_name?.["zh-Hans"];
    if (typeof zhHans === "string" && zhHans.trim()) {
      tagNameById.set(tag.id, zhHans.trim());
    } else {
      missingLocalizedNameIds.push(tag.id);
    }
  }

  let matchedRows = 0;
  let missingSongRows = 0;
  let missingDifficultyRows = 0;
  let missingTagNameRows = 0;
  let ignoredUtageMissingSongRows = 0;
  const missingSongCombos = new Set();
  const missingDifficultyCombos = new Set();

  for (const row of tagsData.tagSongs) {
    const song = songMap.get(`${row.song_id}|||${row.sheet_type}`);
    if (!song) {
      if (row.sheet_type === "utage" || row.sheet_type === "utage2p") {
        ignoredUtageMissingSongRows += 1;
      } else {
        missingSongRows += 1;
        missingSongCombos.add(
          `${row.song_id}|||${row.sheet_type}|||${row.sheet_difficulty}`
        );
      }
      continue;
    }

    const fieldName = difficultyFieldMap[row.sheet_difficulty];
    if (!fieldName || !song[fieldName]) {
      missingDifficultyRows += 1;
      missingDifficultyCombos.add(
        `${row.song_id}|||${row.sheet_type}|||${row.sheet_difficulty}`
      );
      continue;
    }

    const tagName = tagNameById.get(row.tag_id);
    if (!tagName) {
      missingTagNameRows += 1;
      continue;
    }

    if (!song[fieldName].tags.includes(tagName)) {
      song[fieldName].tags.push(tagName);
    }
    matchedRows += 1;
  }

  return {
    totalTagRows: tagsData.tagSongs.length,
    matchedRows,
    missingSongRows,
    missingDifficultyRows,
    missingTagNameRows,
    ignoredUtageMissingSongRows,
    missingSongCombos: [...missingSongCombos].sort((a, b) =>
      a.localeCompare(b, "zh-Hans-CN")
    ),
    missingDifficultyCombos: [...missingDifficultyCombos].sort((a, b) =>
      a.localeCompare(b, "zh-Hans-CN")
    ),
    missingLocalizedNameIds,
  };
}

function sortAllData(allData) {
  allData.sort((left, right) => {
    const leftId = left.internalId;
    const rightId = right.internalId;

    const leftIsNone = leftId === "none";
    const rightIsNone = rightId === "none";
    if (leftIsNone && rightIsNone) {
      return `${left.songId}|||${left.type}`.localeCompare(
        `${right.songId}|||${right.type}`,
        "zh-Hans-CN"
      );
    }
    if (leftIsNone) return 1;
    if (rightIsNone) return -1;

    const leftNumber = Number(leftId);
    const rightNumber = Number(rightId);
    const leftNumeric = Number.isFinite(leftNumber);
    const rightNumeric = Number.isFinite(rightNumber);

    if (leftNumeric && rightNumeric && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
    if (leftNumeric && !rightNumeric) return -1;
    if (!leftNumeric && rightNumeric) return 1;

    const leftText = String(leftId);
    const rightText = String(rightId);
    if (leftText !== rightText) {
      return leftText.localeCompare(rightText, "zh-Hans-CN");
    }

    return `${left.songId}|||${left.type}`.localeCompare(
      `${right.songId}|||${right.type}`,
      "zh-Hans-CN"
    );
  });
}

function analyzeNiheCoverage(allData, niheCharts) {
  const allIds = new Set(
    allData
      .filter((song) => song.internalId !== "none")
      .map((song) => String(song.internalId))
  );

  const unmatched = [];
  for (const [internalId, chartGroup] of Object.entries(niheCharts)) {
    if (allIds.has(String(internalId))) {
      continue;
    }

    const entries = Array.isArray(chartGroup)
      ? chartGroup.filter((item) => isPlainObject(item) && Object.keys(item).length > 0)
      : [];
    const diffs = entries.map((item) => item.diff ?? null);
    const counts = entries.map((item) => item.cnt ?? null);
    const likelySpecial =
      entries.length > 0 &&
      entries.every(
        (item) => typeof item.diff === "string" && item.diff.includes("?")
      );

    unmatched.push({
      internalId: String(internalId),
      diffs,
      counts,
      likelySpecial,
    });
  }

  return {
    totalNiheGroups: Object.keys(niheCharts).length,
    matchedGroups: Object.keys(niheCharts).length - unmatched.length,
    unmatchedGroups: unmatched.length,
    specialLike: unmatched.filter((item) => item.likelySpecial),
    normalLike: unmatched.filter((item) => !item.likelySpecial),
  };
}

function writeErrorReport(report, tagReport) {
  const lines = [];
  lines.push("# 错误报告");
  lines.push("");
  lines.push("本次检查包含两部分：");
  lines.push("- `raw_data/nihe-info.json` 里是否存在无法定位到 `all-data-json.json` 的谱面组");
  lines.push("- `raw_data/tags-info.json` 里的标签映射是否能正确落到 `all-data-json.json` 的对应难度");
  lines.push("");
  lines.push("说明：");
  lines.push("- `all-data-json.json` 中个别歌曲没有 `nihe` 信息属于允许情况，不单独记错。");
  lines.push("- 当前 `all-data-json.json` 只收录 `dx/std`，不收录宴会场或特殊谱。");
  lines.push("- 因为宴会场谱面未收录而导致的“找不到”错误，按要求忽略。");
  lines.push("");
  lines.push("nihe 检查结果：");
  lines.push(`- nihe-info 中的谱面组总数：${report.totalNiheGroups}`);
  lines.push(`- 成功定位到 all-data-json 的谱面组数：${report.matchedGroups}`);
  lines.push(`- 需要关注的未命中谱面组数：${report.normalLike.length}`);
  lines.push(`- 已忽略的疑似宴会场/特殊谱未命中数量：${report.specialLike.length}`);
  lines.push("");

  if (report.normalLike.length === 0) {
    lines.push("结论：");
    lines.push("- 未发现常规谱面存在“nihe 有数据但 all-data-json 完全定位不到”的错误。");
  } else {
    lines.push("需要优先排查的未命中常规谱面：");
    for (const item of report.normalLike) {
      lines.push(
        `- internalId ${item.internalId}，难度槽位：${item.diffs.join(" / ")}，对应统计量：${item.counts.join(" / ")}`
      );
    }
  }

  lines.push("");
  lines.push("tags 检查结果：");
  lines.push(`- tags-info 中的标签映射总行数：${tagReport.totalTagRows}`);
  lines.push(`- 成功写入 all-data-json 的行数：${tagReport.matchedRows}`);
  lines.push(`- 因为找不到对应歌曲而未写入的行数：${tagReport.missingSongRows}`);
  lines.push(`- 因为找不到对应难度而未写入的行数：${tagReport.missingDifficultyRows}`);
  lines.push(`- 因为标签缺少中文名而未写入的行数：${tagReport.missingTagNameRows}`);
  lines.push(`- 已忽略的宴会场谱面找不到歌曲行数：${tagReport.ignoredUtageMissingSongRows}`);

  if (
    tagReport.missingSongRows === 0 &&
    tagReport.missingDifficultyRows === 0 &&
    tagReport.missingTagNameRows === 0
  ) {
    lines.push("- tags 映射没有发现异常。");
  } else {
    if (tagReport.missingSongCombos.length > 0) {
      lines.push("");
      lines.push("tags 无法定位到歌曲的谱面组合：");
      for (const combo of tagReport.missingSongCombos) {
        lines.push(`- ${combo}`);
      }
    }

    if (tagReport.missingDifficultyCombos.length > 0) {
      lines.push("");
      lines.push("tags 找到歌曲但找不到对应难度的谱面组合：");
      for (const combo of tagReport.missingDifficultyCombos) {
        lines.push(`- ${combo}`);
      }
    }

    if (tagReport.missingLocalizedNameIds.length > 0) {
      lines.push("");
      lines.push("tags 缺少中文标签名的 tag_id：");
      lines.push(`- ${tagReport.missingLocalizedNameIds.join("、")}`);
    }
  }

  lines.push("");
  fs.writeFileSync(errorPath, `${lines.join("\n")}\n`);
}

function formatJson(value, indentLevel = 0, currentKey = null) {
  const indent = "  ".repeat(indentLevel);
  const childIndent = "  ".repeat(indentLevel + 1);

  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    const items = value.map((item) => `${childIndent}${formatJson(item, indentLevel + 1)}`);
    return `[\n${items.join(",\n")}\n${indent}]`;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return "{}";
    }
    const items = entries.map(
      ([key, item]) =>
        `${childIndent}${JSON.stringify(key)}: ${formatJson(item, indentLevel + 1, key)}`
    );
    return `{\n${items.join(",\n")}\n${indent}}`;
  }

  if (typeof value === "number") {
    if (currentKey === "internalLevelValue" && Number.isInteger(value)) {
      return value.toFixed(1);
    }
    if (
      currentKey === "nihe" ||
      currentKey === "avg_acc" ||
      currentKey === "sss+_rate" ||
      currentKey === "ap_rate"
    ) {
      return value.toFixed(2);
    }
    return String(value);
  }

  return JSON.stringify(value);
}

const allData = loadAllData(allDataPath);
const niheCharts = loadNiheCharts(nihePath);
const tagsData = loadTagsData(tagsPath);
const niheStats = refreshNiheFields(allData, niheCharts);
const tagStats = applyTagsInfo(allData, tagsData);
sortAllData(allData);
const coverageReport = analyzeNiheCoverage(allData, niheCharts);

fs.writeFileSync(allDataPath, `${formatJson(allData)}\n`);
writeErrorReport(coverageReport, tagStats);

console.log(
  JSON.stringify(
    {
      allDataPath,
      errorPath,
      totalSongs: allData.length,
      niheAppliedCount: niheStats.niheAppliedCount,
      tagMatchedRows: tagStats.matchedRows,
      tagMissingSongRows: tagStats.missingSongRows,
      tagMissingDifficultyRows: tagStats.missingDifficultyRows,
      tagMissingTagNameRows: tagStats.missingTagNameRows,
      tagIgnoredUtageMissingSongRows: tagStats.ignoredUtageMissingSongRows,
      niheUnmatchedAllDataCount: coverageReport.unmatchedGroups,
      niheUnmatchedSpecialLikeCount: coverageReport.specialLike.length,
      niheUnmatchedNormalLikeCount: coverageReport.normalLike.length,
    },
    null,
    2
  )
);
