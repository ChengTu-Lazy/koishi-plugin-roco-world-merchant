# 第三方数据说明

src/data/egg-data.ts 的精灵名称、蛋组、孵化尺寸和重量区间摘录自 Entropy-Increase-Team/koishi-plugin-rocom 的 Pets.json。

- 来源：https://github.com/Entropy-Increase-Team/koishi-plugin-rocom
- 提交：845ea74887b2088428ed1be118a8b62f1d2905e5
- 原始文件：src/render-templates/searcheggs/Pets.json
- 上游 LICENSE：GNU Affero General Public License v3，全文见 LICENSE.egg-data。保留该数据的上游许可声明；本插件新增查询与渲染代码独立实现。
- 数据为固定快照，实际游戏更新后需重新核对。

src/data/egg-families.ts 的精灵家族（进化链）映射同样摘录自上述 Pets.json 的 `evolves_from_id` 字段，由 `scripts/build-egg-families.cjs` 生成，用于名称查询折叠同家族进化形态。来源、提交与上游许可与上表一致。
