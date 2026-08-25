const fs = require('node:fs');
const path = require('node:path');
const { NARRATION_DEFINITIONS } = require('../../src/narration/narration-definitions');

const outputFile = path.resolve(process.argv[2] || path.join(__dirname, 'output', 'narration-texts.json'));
const records = [];

for (const definition of Object.values(NARRATION_DEFINITIONS)) {
  for (const segment of definition.segments) {
    for (const language of ['zh-CN', 'en-US']) {
      const content = segment.content[language];
      records.push({
        narrationAction: definition.action,
        narrationId: definition.scenario,
        language,
        segment: segment.index,
        text: content.text,
        currentDurationMs: content.durationMs,
        currentPostGapMs: Number.isFinite(segment.postGapMs) && segment.postGapMs >= 0 ? segment.postGapMs : 0
      });
    }
  }
}

if (records.length !== 32) throw new Error(`expected 32 narration texts, received ${records.length}`);
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
console.log(`Exported ${records.length} narration texts from formal definitions to ${outputFile}`);
