// One command: build web app -> sync into Android project -> patch permissions -> build debug APK.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const win = process.platform === 'win32';
const run = (cmd, args, opts = {}) => {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, ...opts });
  if (r.status !== 0) {
    console.error(`\nStep failed: ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
};

if (!fs.existsSync('.env')) {
  console.error('Missing .env file. Copy .env.example to .env and set VITE_API_URL to your deployed server (https).');
  process.exit(1);
}
if (!fs.existsSync(path.join('node_modules', '@capacitor', 'cli'))) {
  run('npm', ['install', '@capacitor/core', '@capacitor/android', '@capacitor/push-notifications']);
  run('npm', ['install', '-D', '@capacitor/cli']);
}
run('npx', ['vite', 'build']);
if (!fs.existsSync('android')) run('npx', ['cap', 'add', 'android']);
run('node', ['scripts/patch-android.mjs']);
run('npx', ['cap', 'sync', 'android']);
run(win ? 'gradlew.bat' : './gradlew', ['assembleDebug'], { cwd: 'android' });

const apk = path.join('android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
console.log(fs.existsSync(apk) ? `\nDONE. Your APK: ${apk}` : '\nBuild finished but the APK was not found where expected.');
