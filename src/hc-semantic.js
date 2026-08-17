const { getHcCommandDefinition, translateHcCommand } = require('./hc-command-registry');

function isHcSemanticRequest(commands) {
  return Array.isArray(commands) && commands.some((item) =>
    typeof item?.action === 'string' && (item.action.startsWith('启动') || item.action.startsWith('取消'))
  );
}

function validateHcSemanticCommands(commands) {
  for (let index = 0; index < commands.length; index += 1) {
    const item = commands[index];
    const action = item.action;
    // action 必须完整、精确命中 Registry；绝不依据前缀或 command 推导业务名称。
    const definition = getHcCommandDefinition(action);
    if (!definition) return `HC command at index ${index} action is not registered`;
    if (!Object.prototype.hasOwnProperty.call(item, 'params') ||
      !Object.prototype.hasOwnProperty.call(item.params, 'command')) {
      return `HC command at index ${index} params.command is required`;
    }
    if (item.params.command !== definition.command) {
      return `HC command at index ${index} action and params.command must match`;
    }
  }
  return null;
}

function translateHcCommands(commands) {
  return commands.flatMap((item) => translateHcCommand(item));
}

module.exports = { isHcSemanticRequest, validateHcSemanticCommands, translateHcCommands };
