const { isPlainObject } = require('./validation');

function hasOwn(value, name) {
  return Object.prototype.hasOwnProperty.call(value, name);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeCallbackUrl(value) {
  if (!nonEmptyString(value)) throw new Error('context callback must be a non-empty string');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('context callback must be a valid http:// or https:// URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('context callback must use http:// or https://');
  }
  return url.toString();
}

function normalizeContext(context) {
  if (!isPlainObject(context)) throw new Error('context must be a plain object');
  for (const field of ['agent', 'reply_to']) {
    if (hasOwn(context, field) && !nonEmptyString(context[field])) {
      throw new Error(`context ${field} must be a non-empty string`);
    }
  }
  if (hasOwn(context, 'callback')) normalizeCallbackUrl(context.callback);
  if (hasOwn(context, 'groupchat') && typeof context.groupchat !== 'boolean') {
    throw new Error('context groupchat must be a boolean');
  }
  if (hasOwn(context, 'timestamp') && typeof context.timestamp !== 'string') {
    throw new Error('context timestamp must be a string');
  }

  return Object.freeze({
    agent: context.agent,
    replyTo: context.reply_to,
    groupchat: context.groupchat === undefined ? false : context.groupchat,
    callback: context.callback === undefined ? undefined : normalizeCallbackUrl(context.callback),
    timestamp: context.timestamp
  });
}

// Keeps the legacy array object intact so its downstream handling is unchanged.
function normalizeCommandRequest(body) {
  if (Array.isArray(body)) return { context: null, commands: body };
  if (!isPlainObject(body) || !hasOwn(body, 'commands')) {
    throw new Error('request body must be an array or context envelope');
  }
  if (!Array.isArray(body.commands)) throw new Error('envelope commands must be an array');
  return {
    context: hasOwn(body, 'context') ? normalizeContext(body.context) : null,
    commands: body.commands
  };
}

module.exports = { normalizeCommandRequest, normalizeContext, normalizeCallbackUrl };
