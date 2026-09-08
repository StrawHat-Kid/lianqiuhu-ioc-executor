const { getHcCommandDefinition, normalizeHcLanguage, translateHcCommand } = require('./hc-command-registry');

const HC_LANGUAGE_AUGMENTABLE_FRONTEND_ACTIONS = new Set([
  '主题切换', '环境气象效果', '环境季节效果', '环境时间效果'
]);

function normalizeOptionalHcLanguage(value) {
  if (value === undefined || value === null || value === '') return null;
  return normalizeHcLanguage(value);
}

function getIgnoredHcLanguageWarnings(commands) {
  return commands.flatMap((item, index) => {
    const value = item.params?.language;
    if (value === undefined || value === null || value === '') return [];
    return normalizeOptionalHcLanguage(value) ? [] : [{ index, action: item.action, language: value }];
  });
}

function getRequestedHcLanguage(commands) {
  // “切换语言”是自身完整的 HC 语义，不能被普通业务前置发布再重复一次。
  return commands
    .filter((item) => item.action !== '切换语言')
    .map((item) => normalizeOptionalHcLanguage(item.params?.language))
    .find(Boolean) || null;
}

function isHcSemanticRequest(commands) {
  return Array.isArray(commands) && commands.some((item) =>
    typeof item?.action === 'string' && getHcCommandDefinition(item.action) !== null
  );
}

function isHcLanguageAugmentableFrontendRequest(commands) {
  // 只涵盖四个正式基础 HC action，不能把任意前端直通 command 纳入 language 链路。
  return Array.isArray(commands) && commands.length > 0 && commands.every((item) =>
    HC_LANGUAGE_AUGMENTABLE_FRONTEND_ACTIONS.has(item?.action)
  );
}

function removeHcLanguageParams(commands) {
  return commands.map((item) => {
    if (!Object.prototype.hasOwnProperty.call(item.params || {}, 'language')) return item;
    const { language, ...businessParams } = item.params;
    return { ...item, params: businessParams };
  });
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
    const parameterNames = Object.keys(item.params);
    if (parameterNames.some((name) => name !== 'language')) {
      return `HC command at index ${index} params only supports optional language`;
    }
  }
  return null;
}

function translateHcCommands(commands) {
  // 必须保持业务数组原样，使 IOC Scenario Registry 能继续严格命中完整流程。
  return commands.flatMap((item) => translateHcCommand(item));
}

module.exports = {
  isHcSemanticRequest,
  isHcLanguageAugmentableFrontendRequest,
  validateHcSemanticCommands,
  translateHcCommands,
  normalizeOptionalHcLanguage,
  getIgnoredHcLanguageWarnings,
  getRequestedHcLanguage,
  removeHcLanguageParams
};
