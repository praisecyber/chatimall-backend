// Adds the Android permissions Chatimall needs (mic, camera, notifications) after `npx cap add android`.
import fs from 'node:fs';
import path from 'node:path';

const manifest = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(manifest)) {
  console.error('android/ folder not found. Run: npx cap add android');
  process.exit(1);
}
let xml = fs.readFileSync(manifest, 'utf8');
const perms = [
  'android.permission.INTERNET',
  'android.permission.RECORD_AUDIO',
  'android.permission.CAMERA',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.POST_NOTIFICATIONS',
];
let added = 0;
for (const p of perms) {
  if (!xml.includes(`"${p}"`)) {
    xml = xml.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
    added++;
  }
}
if (!xml.includes('android.hardware.camera"')) {
  xml = xml.replace('</manifest>', '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n</manifest>');
  added++;
}
fs.writeFileSync(manifest, xml);
console.log(`AndroidManifest.xml patched (${added} entries added).`);

const gs = path.join('android', 'app', 'google-services.json');
if (!fs.existsSync(gs)) {
  console.warn('\nNOTE: android/app/google-services.json is missing. The app will build, but push notifications');
  console.warn('will not work until you add it (see ANDROID.md, step 3).');
}
