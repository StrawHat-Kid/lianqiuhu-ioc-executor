const { getHcCommandDefinition, translateHcCommand } = require('./hc-command-registry');

const HC_PREFIX_TO_COMMAND = Object.freeze({ 启动: 'start', 取消: 'cancel' });

function isHcSemanticRequest(commands) {
  return Array.isArray(commands) && commands.some((item) =>
    typeof item?.action === 'string' && (item.action.startsWith('启动') || item.action.startsWith('取消'))
  );
}

function validateHcSemanticCommands(commands) {
  for (let index = 0; index < commands.length; index += 1) {
    const item = commands[index];
    const action = item.action;
    const prefix = Object.keys(HC_PREFIX_TO_COMMAND).find((value) => action.startsWith(value));
    if (!prefix) return `HC command at index ${index} action must start with 启动 or 取消`;

    // 前缀只用于确定期望 command；实际业务动作必须完整、精确命中 Registry。
    if (!getHcCommandDefinition(action)) return `HC command at index ${index} action is not registered`;
    if (!Object.prototype.hasOwnProperty.call(item, 'params') ||
      !Object.prototype.hasOwnProperty.call(item.params, 'command')) {
      return `HC command at index ${index} params.command is required`;
    }
    if (item.params.command !== HC_PREFIX_TO_COMMAND[prefix]) {
      return `HC command at index ${index} action and params.command must match`;
    }
  }
  return null;
}

function translateHcCommands(commands) {
  return commands.flatMap((item) => translateHcCommand(item));
}

module.exports = { isHcSemanticRequest, validateHcSemanticCommands, translateHcCommands };
