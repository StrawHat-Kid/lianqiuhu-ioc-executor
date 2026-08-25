# Narration TTS 本地标定工具

该工具只读取正式 `src/narration/narration-definitions.js` 并生成本地测量数据，不会修改 Node 生产依赖、Narration 参数、文本或运行链路。

```powershell
node tools/tts-calibration/extract-narration-texts.js
tools/tts-calibration/.venv/Scripts/python.exe -m edge_tts --list-voices
tools/tts-calibration/.venv/Scripts/python.exe tools/tts-calibration/calibrate.py --force
```

输出位于 `tools/tts-calibration/output/`：原始逐 voice CSV、逐 segment 汇总 CSV/JSON/Markdown、实际 MP3，以及实际选用的 voice 清单。所有合成均固定 `rate=+0%`、`pitch=+0Hz`、`volume=+0%`。
