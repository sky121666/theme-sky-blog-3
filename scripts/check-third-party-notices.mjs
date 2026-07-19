import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const licensePath = path.join(root, 'LICENSE');
const noticePath = path.join(root, 'THIRD_PARTY_NOTICES.md');
const packagedNoticePath = path.join(root, 'templates/assets/licenses/THIRD_PARTY_NOTICES.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(fs.existsSync(licensePath), '缺少根 LICENSE');
assert(fs.existsSync(noticePath), '缺少 THIRD_PARTY_NOTICES.md');
assert(fs.existsSync(packagedNoticePath), '缺少发布包内第三方声明副本');

const license = fs.readFileSync(licensePath, 'utf8');
const notice = fs.readFileSync(noticePath, 'utf8');
const packagedNotice = fs.readFileSync(packagedNoticePath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const distributedDependencies = JSON.parse(
  fs.readFileSync(path.join(root, 'security/distributed-dependencies.json'), 'utf8')
);
const themeYaml = fs.readFileSync(path.join(root, 'theme.yaml'), 'utf8');

assert(license.startsWith('MIT License\n'), '根 LICENSE 不是预期的 MIT License');
assert(packageJson.license === 'MIT', 'package.json license 必须为 MIT');
assert(/name:\s*["']?MIT["']?/.test(themeYaml), 'theme.yaml 未声明 MIT');
assert(/url:\s*["'][^"']+\/LICENSE["']/.test(themeYaml), 'theme.yaml license URL 未指向根 LICENSE');
assert(notice === packagedNotice, '根第三方声明与发布包副本不一致');

for (const required of Object.keys(distributedDependencies.roots || {})) {
  assert(notice.includes(`\`${required}\``), `第三方声明缺少 ${required}`);
}

const rootNoticePath = path.join(root, 'NOTICE');
const packagedRootNoticePath = path.join(root, 'templates/assets/licenses/NOTICE');
if (fs.existsSync(rootNoticePath) || fs.existsSync(packagedRootNoticePath)) {
  assert(fs.existsSync(rootNoticePath) && fs.existsSync(packagedRootNoticePath), 'NOTICE 必须同时存在根文件和发布包副本');
  assert(
    fs.readFileSync(rootNoticePath, 'utf8') === fs.readFileSync(packagedRootNoticePath, 'utf8'),
    'NOTICE 根文件与发布包副本不一致'
  );
}

console.log('许可证与第三方声明同步检查通过');
