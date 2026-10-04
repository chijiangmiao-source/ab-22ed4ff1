// 页面构建：将 src/ 产物整理到 dist/，对 JS 做语法检查并生成带哈希的清单。
// 零依赖，可在容器中直接运行。
import { rm, mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

async function main() {
  const entries = await readdir(SRC, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const required = ['index.html', 'styles.css', 'app.js', 'worker.js', 'matching.js'];
  for (const name of required) {
    if (!files.includes(name)) throw new Error(`缺少必需源文件：src/${name}`);
  }

  // 语法检查（不执行）
  for (const name of files.filter((f) => f.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', path.join(SRC, name)], { stdio: 'inherit' });
  }

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const manifest = {
    service: 'relay-channel-matching',
    builtAt: new Date().toISOString(),
    files: {},
  };
  for (const name of files) {
    const data = await readFile(path.join(SRC, name));
    await copyFile(path.join(SRC, name), path.join(DIST, name));
    manifest.files['/' + name] = createHash('sha256').update(data).digest('hex');
  }
  await writeFile(path.join(DIST, 'build-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[build] ${files.length + 1} 个文件已输出到 dist/`);
  for (const name of Object.keys(manifest.files)) console.log(`  ${name}`);
  console.log('  /build-manifest.json');
}

main().catch((err) => {
  console.error('[build] 失败：', err);
  process.exit(1);
});
