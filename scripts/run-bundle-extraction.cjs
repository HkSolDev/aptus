// Run manually or from cron. Never print configuration or credential values.
const path = require('node:path');
const { spawn } = require('node:child_process');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');
const environment = { ...process.env, DOTENV_CONFIG_DEBUG: 'false', DOTENV_CONFIG_QUIET: 'true' };
const loaded = dotenv.configDotenv({
  path: path.join(root, '.env'),
  processEnv: environment,
  quiet: true,
  debug: false,
});
if (loaded.error && loaded.error.code !== 'ENOENT') {
  console.error('configuration_load_failed');
  process.exit(1);
}
environment.PYTHONPATH = path.join(root, 'services', 'ai');
const child = spawn(path.join(root, 'services', 'ai', '.venv', 'bin', 'python'),
  [path.join(root, 'services', 'ai', 'extract_bundle.py'), ...process.argv.slice(2)],
  { cwd: root, env: environment, stdio: 'inherit' });
child.on('error', () => {
  console.error('extraction_process_unavailable');
  process.exitCode = 1;
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
