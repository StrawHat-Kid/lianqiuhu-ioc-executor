const target = 'http://127.0.0.1:8008/api/commands';
const commands = [{ action: '主题切换', params: { '主题名称': '综合安防' } }];

async function main() {
  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commands)
    });
    console.log(`HTTP ${response.status}`);
    console.log(JSON.stringify(await response.json(), null, 2));
    if (!response.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Request failed: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
