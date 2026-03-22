import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const allDataPath = path.join(projectRoot, "all-data-json.json");
const nihePath = path.join(projectRoot, "raw_data", "nihe-info.json");
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

function writeErrorReport(report) {
  const lines = [];
  lines.push("# 错误报告");
  lines.push("");
  lines.push("本次检查只关注一件事：`raw_data/nihe-info.json` 里是否存在无法定位到 `all-data-json.json` 的谱面组。");
  lines.push("");
  lines.push("说明：");
  lines.push("- `all-data-json.json` 中个别歌曲没有 `nihe` 信息属于允许情况，不单独记错。");
  lines.push("- 当前 `all-data-json.json` 只收录 `dx/std`，不收录宴会场或特殊谱。");
  lines.push("");
  lines.push("检查结果：");
  lines.push(`- nihe-info 中的谱面组总数：${report.totalNiheGroups}`);
  lines.push(`- 成功定位到 all-data-json 的谱面组数：${report.matchedGroups}`);
  lines.push(`- 无法定位到 all-data-json 的谱面组数：${report.unmatchedGroups}`);
  lines.push(`- 其中疑似宴会场/特殊谱的数量：${report.specialLike.length}`);
  lines.push(`- 其中疑似常规谱面但未命中的数量：${report.normalLike.length}`);
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

  if (report.specialLike.length > 0) {
    lines.push("");
    lines.push("疑似宴会场或特殊谱的未命中 internalId：");
    lines.push(`- ${report.specialLike.map((item) => item.internalId).join("、")}`);
    lines.push("");
    lines.push("补充说明：");
    lines.push("- 这批 internalId 的非空难度基本都带 `?`，形态与宴会场或特殊谱一致。");
    lines.push("- 由于当前 all-data-json 只保留 dx/std，这部分未命中大概率属于预期现象。");
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
const niheStats = refreshNiheFields(allData, niheCharts);
sortAllData(allData);
const coverageReport = analyzeNiheCoverage(allData, niheCharts);

fs.writeFileSync(allDataPath, `${formatJson(allData)}\n`);
writeErrorReport(coverageReport);

console.log(
  JSON.stringify(
    {
      allDataPath,
      errorPath,
      totalSongs: allData.length,
      niheAppliedCount: niheStats.niheAppliedCount,
      niheUnmatchedAllDataCount: coverageReport.unmatchedGroups,
      niheUnmatchedSpecialLikeCount: coverageReport.specialLike.length,
      niheUnmatchedNormalLikeCount: coverageReport.normalLike.length,
    },
    null,
    2
  )
);
