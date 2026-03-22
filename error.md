# 错误报告

本次检查包含两部分：
- `raw_data/nihe-info.json` 里是否存在无法定位到 `all-data-json.json` 的谱面组
- `raw_data/tags-info.json` 里的标签映射是否能正确落到 `all-data-json.json` 的对应难度

说明：
- `all-data-json.json` 中个别歌曲没有 `nihe` 信息属于允许情况，不单独记错。
- 当前 `all-data-json.json` 只收录 `dx/std`，不收录宴会场或特殊谱。
- 因为宴会场谱面未收录而导致的“找不到”错误，按要求忽略。

nihe 检查结果：
- nihe-info 中的谱面组总数：1286
- 成功定位到 all-data-json 的谱面组数：1239
- 需要关注的未命中谱面组数：0
- 已忽略的疑似宴会场/特殊谱未命中数量：47

结论：
- 未发现常规谱面存在“nihe 有数据但 all-data-json 完全定位不到”的错误。

tags 检查结果：
- tags-info 中的标签映射总行数：6063
- 成功写入 all-data-json 的行数：5931
- 因为找不到对应歌曲而未写入的行数：0
- 因为找不到对应难度而未写入的行数：0
- 因为标签缺少中文名而未写入的行数：0
- 已忽略的宴会场谱面找不到歌曲行数：132
- tags 映射没有发现异常。

