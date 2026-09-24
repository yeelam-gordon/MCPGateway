const COMMON_REFERENCE = /\$\{[^{}\r\n]+\}/;
const QWEN_REFERENCE = /(^|[^$])\$[A-Za-z_][A-Za-z0-9_]*/;
const BRACE_REFERENCE = /\{(?:env|file):[^{}\r\n]+\}/;

function containsNativeReference(value, client, seen) {
  if (typeof value === 'string') {
    if (COMMON_REFERENCE.test(value)) return true;
    if (client === 'qwen' && QWEN_REFERENCE.test(value)) return true;
    return BRACE_REFERENCE.test(value);
  }
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some(item => containsNativeReference(item, client, seen));
  return Object.values(value).some(item => containsNativeReference(item, client, seen));
}

export function assertLiteralClientValues(value, client) {
  if (containsNativeReference(value, client, new WeakSet())) {
    throw new Error(`${client} configuration uses native variable or file-reference syntax that cannot be preserved during canonical extraction; replace it with literal values or keep that backend client-managed`);
  }
  return value;
}
