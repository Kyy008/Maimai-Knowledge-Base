import fs from "fs";
import path from "path";
import vm from "vm";

const cwd = process.cwd();
const rawDataDir = path.join(cwd, "raw_data");
const sourcePath = path.join(rawDataDir, "diving-fish-info.js");
const extraTagPath = path.join(rawDataDir, "extra-tag.json");
const outputPath = path.join(cwd, "all-data-json.json");
const unmatchedSongIdsPath = path.join(cwd, "extra-tag-unmatched-songids.json");
const errorPath = path.join(cwd, "error.md");

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

function writeErrorReport(errors) {
  const body =
    errors.length === 0
      ? "# Error Report\n\nNo anomalies were detected while filling difficulty info.\n"
      : `# Error Report\n\nDetected ${errors.length} anomaly entries while filling difficulty info.\n\n${errors.join("\n")}\n`;
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
    return String(value);
  }

  return JSON.stringify(value);
}

const data = loadDivingFishData(sourcePath);
const { result, noneInternalIdCount, errors } = buildAllDataJson(data.songs);
const extraTags = loadExtraTags(extraTagPath);
const extraTagStats = mergeExtraTags(result, extraTags);

fs.writeFileSync(outputPath, `${formatJson(result)}\n`);
fs.writeFileSync(
  unmatchedSongIdsPath,
  `${JSON.stringify(extraTagStats.unmatchedSongIds, null, 2)}\n`
);
writeErrorReport(errors);

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
      errorCount: errors.length,
    },
    null,
    2
  )
);
