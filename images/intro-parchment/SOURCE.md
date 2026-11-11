# 羊皮紙序章第一、二鏡

本資產為使用者確認的分鏡成片。全長 21.80 秒，1920 × 1080，30 fps，H.264 與 AAC 立體聲。第一鏡從天使近景拉遠至天堂戰場，9.90 秒接入第二鏡。大天使長居中仰面墜落，鏡頭逐漸帶出天使群與深淵。全白尾幀是第三鏡人界段的接點。

遊戲專案的 `images/intro-parchment/shot-01-02.mp4` 收錄這兩鏡，設定頁的序章重播沿用現行完整序章。

## 可編輯來源

Effects-Materials 內的 `codex-authored/intro-parchment-shots-20261111` 保存核准成片、可編輯程式、透明分件、雲海和深淵背景、音軌、聲景產生器及提示詞。角色、流光翼、神殿、遠雲、敵軍、煙與粒子分開合成。第二鏡大天使長沿用第一鏡流光翼分件。

所有入片繪圖均由 ImageGen 原創生成或修訂。使用者提供的天使立繪、姿勢與神殿截圖，以及指定影片，用於造型與分鏡參考。音軌由本地程序合成。RPG Mote Studio 主要適合像素圖，本案採用適合高解析蝕刻圖與透明分件的 ImageGen。

## 檢視及同步

- 在素材庫開啟 `source/index.html` 可播放、暫停及拖曳時間軸。
- 在素材庫的 `source` 執行 `node build-score.cjs` 與 `node render-video.cjs` 可重製有聲 MP4。影片輸出需要 Windows 版 Microsoft Edge 與 FFmpeg。
- 遊戲專案可用 `node tools/intro/sync-parchment-shots.cjs --apply` 從素材庫匯出，並用 `--check` 驗證素材庫和遊戲端的 SHA-256。核准新成片後，更新素材庫的成片並執行 `--archive` 重建清單。
