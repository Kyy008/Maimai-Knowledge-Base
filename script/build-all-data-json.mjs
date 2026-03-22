import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const rawDataDir = path.join(projectRoot, "raw_data");
const sourcePath = path.join(rawDataDir, "diving-fish-info.js");
const extraTagPath = path.join(rawDataDir, "extra-tag.json");
const nihePath = path.join(rawDataDir, "nihe-info.json");
const tagsPath = path.join(rawDataDir, "tags-info.json");
const outputPath = path.join(projectRoot, "all-data-json.json");
const unmatchedSongIdsPath = path.join(projectRoot, "extra-tag-unmatched-songids.json");
const errorPath = path.join(projectRoot, "error.md");

function loadDivingFishData(filePath) {
  let source = fs.readFileSync(filePath, "utf8");

  source = source.replace(/^import .*?;\n/, "");
  source = source.replace(
    /export \{[\s\S]*$/,
    "globalThis.__DIVING_FISH_DATA__ = { d };"
  );

  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { timeout: 10000 });

  const data = context.globalThis.__DIVING_FISH_DATA__?.d;
  if (!data?.songs) {
    throw new Error("Failed to parse songs from raw_data/diving-fish-info.js");
  }

  return data;
}

function loadExtraTags(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(data)) {
    throw new Error("raw_data/extra-tag.json must be an array");
  }

  return data;
}

function loadNiheData(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!data || typeof data !== "object" || !data.charts || typeof data.charts !== "object") {
    throw new Error("raw_data/nihe-info.json must contain a charts object");
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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(left, right) {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => deepEqual(item, right[index]));
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every((key) => deepEqual(left[key], right[key]));
  }

  return false;
}

function mergeConsistent(fieldName, left, right, groupKey, errors) {
  if (left == null) {
    return right ?? null;
  }
  if (right == null) {
    return left;
  }
  if (deepEqual(left, right)) {
    return left;
  }

  errors.push(
    `- ${groupKey}: field \`${fieldName}\` has inconsistent values: \`${JSON.stringify(left)}\` vs \`${JSON.stringify(right)}\``
  );
  return left;
}

function buildDifficultyInfo(song, sheet, groupKey, errors) {
  const noteCounts = sheet.noteCounts;
  if (!noteCounts || typeof noteCounts !== "object") {
    errors.push(`- ${groupKey}: missing \`noteCounts\``);
    return null;
  }

  const requiredNoteKeys = ["tap", "hold", "slide", "touch", "break"];
  for (const key of requiredNoteKeys) {
    if (!(key in noteCounts)) {
      errors.push(`- ${groupKey}: missing \`noteCounts.${key}\``);
    }
  }

  if (!("level" in sheet)) {
    errors.push(`- ${groupKey}: missing \`level\``);
  }
  if (!("internalLevelValue" in sheet)) {
    errors.push(`- ${groupKey}: missing \`internalLevelValue\``);
  }

  return {
    level: sheet.level ?? null,
    internalLevelValue: sheet.internalLevelValue ?? null,
    tap: noteCounts.tap ?? null,
    hold: noteCounts.hold ?? null,
    slide: noteCounts.slide ?? null,
    touch: noteCounts.touch ?? null,
    break: noteCounts.break ?? null,
    nihe: null,
    avg_acc: null,
    "sss+_rate": null,
    ap_rate: null,
    tags: [],
  };
}

function buildAllDataJson(songs) {
  const groups = new Map();
  const errors = [];
  const difficultyFieldMap = {
    basic: "basic_info",
    advanced: "advance_info",
    expert: "expert_info",
    master: "master_info",
    remaster: "remaster_info",
  };

  for (const song of songs) {
    for (const sheet of song.sheets ?? []) {
      if (sheet.type !== "dx" && sheet.type !== "std") {
        continue;
      }

      const groupKey = `${song.songId}|||${sheet.type}`;
      let group = groups.get(groupKey);

      if (!group) {
        group = {
          internalId: sheet.internalId ?? null,
          songId: song.songId,
          type: sheet.type,
          bpm: song.bpm ?? null,
          version: sheet.version ?? null,
          otherName: Array.isArray(song.searchAcronyms)
            ? [...song.searchAcronyms]
            : [],
          basic_info: null,
          advance_info: null,
          expert_info: null,
          master_info: null,
        };
        groups.set(groupKey, group);
      } else {
        group.internalId = mergeConsistent(
          "internalId",
          group.internalId,
          sheet.internalId ?? null,
          groupKey,
          errors
        );
        group.bpm = mergeConsistent(
          "bpm",
          group.bpm,
          song.bpm ?? null,
          groupKey,
          errors
        );
        group.version = mergeConsistent(
          "version",
          group.version,
          sheet.version ?? null,
          groupKey,
          errors
        );
        group.otherName = mergeConsistent(
          "otherName",
          group.otherName,
          Array.isArray(song.searchAcronyms) ? [...song.searchAcronyms] : [],
          groupKey,
          errors
        );
      }

      const infoField = difficultyFieldMap[sheet.difficulty];
      if (!infoField) {
        errors.push(
          `- ${groupKey}: unexpected difficulty \`${sheet.difficulty}\` for type \`${sheet.type}\``
        );
        continue;
      }

      const difficultyInfo = buildDifficultyInfo(
        song,
        sheet,
        `${song.songId} [${sheet.type}] ${sheet.difficulty}`,
        errors
      );

      if (group[infoField] == null) {
        group[infoField] = difficultyInfo;
      } else {
        group[infoField] = mergeConsistent(
          infoField,
          group[infoField],
          difficultyInfo,
          groupKey,
          errors
        );
      }
    }
  }

  const result = [];
  let noneInternalIdCount = 0;

  for (const group of groups.values()) {
    if (group.internalId == null) {
      group.internalId = "none";
      noneInternalIdCount += 1;
    }
    result.push(group);
  }

  result.sort((left, right) => {
    const leftIsNone = left.internalId === "none";
    const rightIsNone = right.internalId === "none";

    if (leftIsNone && rightIsNone) {
      return left.songId.localeCompare(right.songId, "zh-Hans-CN");
    }
    if (leftIsNone) {
      return 1;
    }
    if (rightIsNone) {
      return -1;
    }
    return left.internalId - right.internalId;
  });

  return { result, noneInternalIdCount, errors };
}

function mergeExtraTags(result, extraTags) {
  const bySongId = new Map();
  for (const item of result) {
    const list = bySongId.get(item.songId) ?? [];
    list.push(item);
    bySongId.set(item.songId, list);
  }

  let matchedRows = 0;
  let unmatchedRows = 0;
  const unmatchedSongIds = new Set();

  for (const row of extraTags) {
    if (!row || typeof row.song_id !== "string" || typeof row.name !== "string") {
      continue;
    }

    const songId = row.song_id;
    const alias = row.name.trim();
    if (!alias) {
      continue;
    }

    const targets = bySongId.get(songId);
    if (!targets || targets.length === 0) {
      unmatchedRows += 1;
      unmatchedSongIds.add(songId);
      continue;
    }

    matchedRows += 1;
    for (const target of targets) {
      if (!target.otherName.includes(alias)) {
        target.otherName.push(alias);
      }
    }
  }

  return {
    matchedRows,
    unmatchedRows,
    unmatchedSongIds: [...unmatchedSongIds].sort((a, b) =>
      a.localeCompare(b, "zh-Hans-CN")
    ),
  };
}

function calculateRate(numerator, denominator, groupKey, fieldName, errors) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    errors.push(`- ${groupKey}: cannot calculate \`${fieldName}\` because denominator is invalid`);
    return null;
  }
  if (!Number.isFinite(numerator)) {
    errors.push(`- ${groupKey}: cannot calculate \`${fieldName}\` because numerator is invalid`);
    return null;
  }
  return (numerator / denominator) * 100;
}

function applyNiheInfo(result, niheCharts) {
  const fieldOrder = [
    "basic_info",
    "advance_info",
    "expert_info",
    "master_info",
    "remaster_info",
  ];

  let niheAppliedCount = 0;

  for (const song of result) {
    if (song.internalId === "none") {
      continue;
    }

    const chartGroup = niheCharts[String(song.internalId)];
    if (!Array.isArray(chartGroup)) {
      continue;
    }

    fieldOrder.forEach((fieldName, index) => {
      const info = song[fieldName];
      if (!info) {
        return;
      }

      const niheEntry = chartGroup[index];
      if (!niheEntry || Object.keys(niheEntry).length === 0) {
        return;
      }

      const dist = Array.isArray(niheEntry.dist) ? niheEntry.dist : null;
      const fcDist = Array.isArray(niheEntry.fc_dist) ? niheEntry.fc_dist : null;

      info.nihe = niheEntry.fit_diff ?? null;
      info.avg_acc = niheEntry.avg ?? null;

      if (!dist || dist.length === 0) {
        info["sss+_rate"] = null;
      } else {
        const distSum = dist.reduce((sum, value) => sum + Number(value || 0), 0);
        const sssPlusNumerator = Number(dist[dist.length - 1] ?? 0);
        info.nihe = niheEntry.fit_diff ?? null;
        info.avg_acc = niheEntry.avg ?? null;
        info["sss+_rate"] =
          Number.isFinite(distSum) && distSum > 0
            ? (sssPlusNumerator / distSum) * 100
            : null;
      }

      if (!fcDist || fcDist.length < 2) {
        info.ap_rate = null;
      } else {
        const fcSum = fcDist.reduce((sum, value) => sum + Number(value || 0), 0);
        const apNumerator =
          Number(fcDist[fcDist.length - 1] ?? 0) +
          Number(fcDist[fcDist.length - 2] ?? 0);
        info.ap_rate =
          Number.isFinite(fcSum) && fcSum > 0
            ? (apNumerator / fcSum) * 100
            : null;
      }

      niheAppliedCount += 1;
    });
  }

  return { niheAppliedCount };
}

function applyTagsInfo(result, tagsData) {
  const difficultyFieldMap = {
    basic: "basic_info",
    advanced: "advance_info",
    expert: "expert_info",
    master: "master_info",
    remaster: "remaster_info",
  };

  for (const song of result) {
    for (const fieldName of Object.values(difficultyFieldMap)) {
      if (song[fieldName]) {
        song[fieldName].tags = [];
      }
    }
  }

  const songMap = new Map();
  for (const song of result) {
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

function analyzeNiheCoverage(result, niheCharts) {
  const allInternalIds = new Set(
    result
      .filter((song) => song.internalId !== "none")
      .map((song) => String(song.internalId))
  );

  const unmatched = [];
  for (const [internalId, chartGroup] of Object.entries(niheCharts)) {
    if (!allInternalIds.has(String(internalId))) {
      const entries = Array.isArray(chartGroup)
        ? chartGroup.filter((item) => item && Object.keys(item).length > 0)
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
  }

  const specialLike = unmatched.filter((item) => item.likelySpecial);
  const normalLike = unmatched.filter((item) => !item.likelySpecial);

  return {
    totalNiheGroups: Object.keys(niheCharts).length,
    matchedGroups: Object.keys(niheCharts).length - unmatched.length,
    unmatchedGroups: unmatched.length,
    specialLike,
    normalLike,
  };
}

function writeErrorReport(coverageReport, tagReport, buildErrors) {
  const lines = [];
  lines.push("# 错误报告");
  lines.push("");
  lines.push("本次检查包含两部分：");
  lines.push("- `raw_data/nihe-info.json` 里是否存在无法定位到 `all-data-json.json` 的谱面组");
  lines.push("- `raw_data/tags-info.json` 里的标签映射是否能正确落到 `all-data-json.json` 的对应难度");
  lines.push("");
  lines.push("说明：");
  lines.push("- `all-data-json.json` 中有些歌曲没有 `nihe` 信息现在视为允许，不再记为错误。");
  lines.push("- 当前 `all-data-json.json` 只收录 `dx/std`，不收录宴会场/特殊谱。");
  lines.push("- 因为宴会场谱面未收录而导致的“找不到”错误，按要求忽略。");
  lines.push("");
  lines.push("nihe 检查结果：");
  lines.push(`- nihe-info 中的谱面组总数：${coverageReport.totalNiheGroups}`);
  lines.push(`- 成功定位到 all-data-json 的谱面组数：${coverageReport.matchedGroups}`);
  lines.push(`- 需要关注的未命中谱面组数：${coverageReport.normalLike.length}`);
  lines.push(`- 已忽略的疑似宴会场/特殊谱未命中数量：${coverageReport.specialLike.length}`);
  lines.push("");

  if (coverageReport.normalLike.length === 0) {
    lines.push("结论：");
    lines.push("- 未发现常规谱面存在“nihe 有数据但 all-data-json 完全定位不到”的错误。");
  } else {
    lines.push("需要优先排查的未命中常规谱面：");
    for (const item of coverageReport.normalLike) {
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

  if (buildErrors.length > 0) {
    lines.push("");
    lines.push("其他源数据一致性问题：");
    for (const item of buildErrors) {
      lines.push(item);
    }
  }

  lines.push("");
  const body = `${lines.join("\n")}\n`;
  fs.writeFileSync(errorPath, body);
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
        `${childIndent}${JSON.stringify(key)}: ${formatJson(
          item,
          indentLevel + 1,
          key
        )}`
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

const data = loadDivingFishData(sourcePath);
const { result, noneInternalIdCount, errors } = buildAllDataJson(data.songs);
const extraTags = loadExtraTags(extraTagPath);
const niheCharts = loadNiheData(nihePath);
const tagsData = loadTagsData(tagsPath);
const extraTagStats = mergeExtraTags(result, extraTags);
const niheStats = applyNiheInfo(result, niheCharts);
const tagStats = applyTagsInfo(result, tagsData);
const coverageReport = analyzeNiheCoverage(result, niheCharts);

fs.writeFileSync(outputPath, `${formatJson(result)}\n`);
fs.writeFileSync(
  unmatchedSongIdsPath,
  `${JSON.stringify(extraTagStats.unmatchedSongIds, null, 2)}\n`
);
writeErrorReport(coverageReport, tagStats, errors);

console.log(
  JSON.stringify(
    {
      outputPath,
      unmatchedSongIdsPath,
      errorPath,
      songCount: result.length,
      noneInternalIdCount,
      extraTagRows: extraTags.length,
      extraTagMatchedRows: extraTagStats.matchedRows,
      extraTagUnmatchedRows: extraTagStats.unmatchedRows,
      extraTagUnmatchedSongIds: extraTagStats.unmatchedSongIds.length,
      niheChartGroups: Object.keys(niheCharts).length,
      niheAppliedCount: niheStats.niheAppliedCount,
      tagMatchedRows: tagStats.matchedRows,
      tagMissingSongRows: tagStats.missingSongRows,
      tagMissingDifficultyRows: tagStats.missingDifficultyRows,
      tagMissingTagNameRows: tagStats.missingTagNameRows,
      tagIgnoredUtageMissingSongRows: tagStats.ignoredUtageMissingSongRows,
      niheUnmatchedAllDataCount: coverageReport.unmatchedGroups,
      niheUnmatchedSpecialLikeCount: coverageReport.specialLike.length,
      niheUnmatchedNormalLikeCount: coverageReport.normalLike.length,
      buildErrorCount: errors.length,
    },
    null,
    2
  )
);
