function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateCommands(body) {
  if (!Array.isArray(body)) return 'request body must be an array';
  if (body.length === 0) return 'request body must not be empty';

  for (let index = 0; index < body.length; index += 1) {
    const command = body[index];
    if (!isPlainObject(command)) return `command at index ${index} must be a plain object`;
    if (typeof command.action !== 'string' || command.action.trim() === '') {
      return `command at index ${index} must include a non-empty string action`;
    }
    if (Object.prototype.hasOwnProperty.call(command, 'params') && !isPlainObject(command.params)) {
      return `command at index ${index} params must be a plain object`;
    }
  }
  return null;
}

module.exports = { isPlainObject, validateCommands };
