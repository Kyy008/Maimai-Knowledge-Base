import fs from "fs";
import path from "path";
import vm from "vm";

const cwd = process.cwd();
const sourcePath = path.join(cwd, "diving-fish-info.js");
const outputPath = path.join(cwd, "all-data-json.json");

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
  let removedCount = 0;

  for (const group of groups.values()) {
    if (group.internalId == null) {
      removedCount += 1;
      continue;
    }
    result.push(group);
  }

  result.sort((left, right) => left.internalId - right.internalId);

  return { result, removedCount };
}

const data = loadDivingFishData(sourcePath);
const { result, removedCount } = buildAllDataJson(data.songs);

fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      outputPath,
      songCount: result.length,
      removedMissingInternalIdCount: removedCount,
    },
    null,
    2
  )
);
