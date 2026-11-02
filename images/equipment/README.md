# 裝備圖示

所有裝備本體圖統一保存於此目錄，包含十二類武器、各部位通用圖、歷史名稱圖與新製六套防具／十四款首飾。介面框飾仍由既有UI樣式管理。

- `icon_dawnweave_*`：晨曦織紋，黃白亞麻與日紋繡線。
- `icon_ivorypilgrim_*`：象牙巡禮，黃白菱格絎縫布甲。
- `icon_amberhunt_*`：琥珀獵影，黃橘葉片剪裁皮甲。
- `icon_redwanderer_*`：赤砂行者，黃橘厚革札片。
- `icon_blackoath_*`：黑鋼誓衛，深鐵色圓弧板甲。
- `icon_frostbastion_*`：霜鐵堡壘，深鐵色稜角重甲。
- `icon_ring_*`／`icon_amulet_*`：戒指／項鏈；歷史款式也保留。

每套防具含頭、肩、胸、腰、手、腕、腿、靴八部位。新圖為512×512 RGBA PNG。造型僅影響基底名稱及圖示，不附帶材質或套裝能力。

名稱來源為`config/Excel/String.xlsx`；`js/data.js`的`SLOT_BASENAMES`與`EQUIP_NAME_ICON_BY_STR`連接既有產出、背包、穿戴及提示。舊物品名稱仍對應原圖；`equipIconFile()`統一回傳相對`images/`的路徑。

製作清單與提示見`tools/equipment-ui/armor-accessories-20261102.json`。原稿、來源與正式匯出保存於已設定素材庫的`codex-authored/equipment-sets-20261102/`。設定素材庫後，使用`node tools/equipment-ui/export-equipment-art.cjs`重建，或加`--check`核對。
