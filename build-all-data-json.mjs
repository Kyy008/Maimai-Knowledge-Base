import fs from "fs";
import path from "path";
import vm from "vm";

const cwd = process.cwd();
const sourcePath = path.join(cwd, "diving-fish-info.js");
const outputPath = path.join(cwd, "all-data-json.json");
const extraTagPath = path.join(cwd, "extra-tag.json");
const unmatchedSongIdsPath = path.join(cwd, "extra-tag-unmatched-songids.json");

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
    throw new Error("Failed to parse songs from diving-fish-info.js");
  }

  return data;
}

function assertConsistent(fieldName, left, right, groupKey) {
  if (left == null || right == null || left === right) {
    return left ?? right ?? null;
  }
  throw new Error(
    `Inconsistent ${fieldName} for group ${groupKey}: ${left} !== ${right}`
  );
}

function loadExtraTags(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(data)) {
    throw new Error("extra-tag.json must be an array");
  }

  return data;
}

function buildAllDataJson(songs) {
  const groups = new Map();
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
        group.internalId = assertConsistent(
          "internalId",
          group.internalId,
          sheet.internalId ?? null,
          groupKey
        );
        group.bpm = assertConsistent("bpm", group.bpm, song.bpm ?? null, groupKey);
        group.version = assertConsistent(
          "version",
          group.version,
          sheet.version ?? null,
          groupKey
        );

        const currentOtherName = JSON.stringify(group.otherName);
        const nextOtherName = JSON.stringify(song.searchAcronyms ?? []);
        if (currentOtherName !== nextOtherName) {
          throw new Error(`Inconsistent otherName for group ${groupKey}`);
        }
      }

      const infoField = difficultyFieldMap[sheet.difficulty];
      if (infoField && !(infoField in group)) {
        group[infoField] = null;
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

  return { result, noneInternalIdCount };
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
    unmatchedSongIds: [...unmatchedSongIds].sort(),
  };
}

const data = loadDivingFishData(sourcePath);
const { result, noneInternalIdCount } = buildAllDataJson(data.songs);
const extraTags = loadExtraTags(extraTagPath);
const extraTagStats = mergeExtraTags(result, extraTags);

fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
fs.writeFileSync(
  unmatchedSongIdsPath,
  `${JSON.stringify(extraTagStats.unmatchedSongIds, null, 2)}\n`
);

console.log(
  JSON.stringify(
    {
      outputPath,
      unmatchedSongIdsPath,
      songCount: result.length,
      noneInternalIdCount,
      extraTagRows: extraTags.length,
      extraTagMatchedRows: extraTagStats.matchedRows,
      extraTagUnmatchedRows: extraTagStats.unmatchedRows,
      extraTagUnmatchedSongIds: extraTagStats.unmatchedSongIds.length,
    },
    null,
    2
  )
);
