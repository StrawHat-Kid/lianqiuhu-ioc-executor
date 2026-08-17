const command = (action, params) => Object.freeze({ action, params: Object.freeze({ ...params }) });

// 每个模板均从已冻结的前端 park-ai capability/Scenario 源码逐项抄录；不要在这里推导 capability 或参数。
const HC_COMMAND_REGISTRY = Object.freeze({
  '启动园区实时运营情况': Object.freeze([
    command('executeCapability', { capability: 'situation.parkRealTimeOperation', command: 'start' })
  ]),
  '取消园区实时运营情况': Object.freeze([
    command('executeCapability', { capability: 'situation.parkRealTimeOperation', command: 'cancel' })
  ]),
  '启动AI节能助手': Object.freeze([
    command('主题切换', { '主题名称': '能源管理' }),
    command('executeCapability', { capability: 'energy.aiEnergyAssistant', command: 'start' })
  ]),
  '取消AI节能助手': Object.freeze([
    command('主题切换', { '主题名称': '能源管理' }),
    command('executeCapability', { capability: 'energy.aiEnergyAssistant', command: 'cancel' })
  ])
});

const cloneCommands = (commands) => commands.map((item) => ({ action: item.action, params: { ...item.params } }));

function getHcCommandDefinition(action) {
  return Object.prototype.hasOwnProperty.call(HC_COMMAND_REGISTRY, action)
    ? HC_COMMAND_REGISTRY[action]
    : null;
}

function translateHcCommand(commandValue) {
  const definition = getHcCommandDefinition(commandValue.action);
  if (!definition) throw new Error(`unregistered HC action: ${commandValue.action}`);
  return cloneCommands(definition);
}

module.exports = { HC_COMMAND_REGISTRY, getHcCommandDefinition, translateHcCommand };
