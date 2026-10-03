const hostVariables = [
  'PATH', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE', 'NODE_EXTRA_CA_CERTS'
];
const azureVariables = ['AZURE_CONFIG_DIR', 'AZ_INSTALLER',
  'AZURE_CORE_ENABLE_BROKER_ON_WINDOWS', 'AZURE_CORE_LOGIN_EXPERIENCE_V2'];

// Network proxy URLs can contain credentials; they are deliberate exceptions.
// This boundary applies to Microsoft hosts only, not generic stdio backends.
export function microsoftHostEnv(env = process.env, { azureCli = false, overrides = {}, platform = process.platform } = {}) {
  const allowed = new Set([...hostVariables, ...(azureCli ? azureVariables : [])]);
  const result = {};
  for (const source of [env, overrides]) {
    for (const [name, value] of Object.entries(source)) {
      const key = name.toUpperCase();
      if (!allowed.has(key) || typeof value !== 'string') continue;
      if (platform === 'win32') {
        for (const previous of Object.keys(result)) {
          if (previous.toUpperCase() === key) delete result[previous];
        }
      }
      result[name] = value;
    }
  }
  return result;
}
