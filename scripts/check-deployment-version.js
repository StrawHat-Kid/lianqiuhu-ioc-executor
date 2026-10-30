#!/usr/bin/env node
'use strict';

// 用途：核对产品实际部署目录与本仓库当前提交的关键文件是否一致。
// 启动日志只能证明进程起来了，不能证明跑的是本次提交的代码。
//
// 用法：
//   node scripts/check-deployment-version.js <部署目录>
//   node scripts/check-deployment-version.js "/home/prodept/repo/gitee/ruisi-harness/ruisi-osca-console/executors/练秋湖IOC执行器2"

const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

const KEY_FILES = [
  'src/config.js',
  'src/hall-binding.js',
  'src/server.js',
  'src/mqtt-client.js',
  'src/command-executor.js',
  'src/command-request.js',
  'src/exhibition-auth.js'
];

const repoRoot = resolve(__dirname, '..');

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function gitHead(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('用法: node scripts/check-deployment-version.js <部署目录>');
    process.exitCode = 2;
    return;
  }
  const deployDir = resolve(target);
  if (!existsSync(deployDir)) {
    console.error(`部署目录不存在: ${deployDir}`);
    process.exitCode = 2;
    return;
  }

  const expectedHead = gitHead(repoRoot);
  const deployedHead = gitHead(deployDir);
  console.log(`本仓库 HEAD: ${expectedHead || '(非 git 仓库)'}`);
  console.log(`部署目录 HEAD: ${deployedHead || '(非 git 仓库，仅按文件哈希比对)'}`);

  let mismatch = 0;
  for (const relative of KEY_FILES) {
    const local = join(repoRoot, relative);
    const deployed = join(deployDir, relative);
    if (!existsSync(deployed)) {
      mismatch += 1;
      console.log(`MISSING  ${relative}`);
      continue;
    }
    const same = existsSync(local) && sha256(local) === sha256(deployed);
    if (!same) mismatch += 1;
    console.log(`${same ? 'MATCH  ' : 'DIFFER '} ${relative}  ${sha256(deployed).slice(0, 16)}`);
  }

  if (mismatch === 0) {
    console.log('结论: 关键文件与本仓库当前提交一致。');
  } else {
    console.log(`结论: 有 ${mismatch} 个关键文件不一致，部署版本与当前提交不同，请重新部署后复测。`);
    process.exitCode = 1;
  }
}

main();
