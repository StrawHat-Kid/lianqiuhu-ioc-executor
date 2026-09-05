const { getHcCommandDefinition, translateHcCommand } = require('./hc-command-registry');

function isHcSemanticRequest(commands) {
  return Array.isArray(commands) && commands.some((item) =>
    typeof item?.action === 'string' && getHcCommandDefinition(item.action) !== null
  );
}

function validateHcSemanticCommands(commands) {
  for (let index = 0; index < commands.length; index += 1) {
    const item = commands[index];
    const action = item.action;
    // action 必须完整、精确命中 Registry；绝不依据前缀或 command 推导业务名称。
    const definition = getHcCommandDefinition(action);
    if (!definition) return `HC command at index ${index} action is not registered`;
    if (!Object.prototype.hasOwnProperty.call(item, 'params')) {
      return `HC command at index ${index} params is required`;
    }
    if (typeof definition.validateParams === 'function') {
      if (!definition.validateParams(item.params)) {
        return `HC command at index ${index} params is invalid`;
      }
      continue;
    }
    if (Object.keys(item.params).length !== 0) {
      return `HC command at index ${index} params must be empty`;
    }
  }
  return null;
}

function translateHcCommands(commands) {
  return commands.flatMap((item) => translateHcCommand(item));
}

module.exports = { isHcSemanticRequest, validateHcSemanticCommands, translateHcCommands };
