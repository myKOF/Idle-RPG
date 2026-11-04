# 低沉鼓聲播放修正版

原鼓聲只有32～55ms；本版保留原PCM與音量，只補上靜音與重複試聽容器。

- D1 短底鼓、D2 悶手鼓、D3 低音通鼓、D4 厚實重咚、D5 極短乾鼓。
- D1～D5-single.wav：每檔1.2秒，0.15秒處敲擊一次，適合單獨點播。
- D1～D5-preview.wav：每檔3秒，0.2／0.85／1.5／2.15秒各敲擊一次。
- comparison.wav：10.5秒，依D1～D5各兩次。
- WAV格式：48kHz／16-bit PCM／立體聲置中。

全部原創程序鼓聲，無外部素材；來源為audio/ui-preview/low-drum-v1，沒有拉長鼓聲、混響或變更音色。

重產：node tools/audio/ui-low-drum-playback.cjs --apply
驗證：node tools/audio/ui-low-drum-playback.cjs --check
素材庫相對目錄：codex-authored/ui-low-drum-playback-20261105-v2。尚未接入遊戲。
