require('dotenv').config();

const { createLogger } = require('../src/logger');
const { createRuisiCallbackClient } = require('../src/ruisi-callback-client');

const body = process.argv.slice(2).join(' ') || process.env.RUISI_CALLBACK_MESSAGE;
const context = {
  agent: process.env.RUISI_CALLBACK_AGENT,
  replyTo: process.env.RUISI_CALLBACK_TO,
  groupchat: process.env.RUISI_CALLBACK_GROUPCHAT === 'true',
  callback: process.env.RUISI_CALLBACK_URL
};

async function main() {
  const client = createRuisiCallbackClient({
    logger: createLogger(), authToken: process.env.INGRESS_TOKEN,
    timeoutMs: Number(process.env.RUISI_CALLBACK_TIMEOUT_MS || 5000)
  });
  const result = await client.sendAgentMessage(context, { body });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Callback test failed: ${error.message}`);
  process.exitCode = 1;
});
