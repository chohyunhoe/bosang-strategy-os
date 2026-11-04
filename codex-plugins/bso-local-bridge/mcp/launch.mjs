import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot=path.resolve(process.env.BSO_REPO_ROOT||path.join(os.homedir(),'Documents','GitHub','bosang-strategy-os'));
const server=path.join(repoRoot,'mcp','bso-local-bridge','server.mjs');
if(!fs.existsSync(server)){
  process.stderr.write('BSO local bridge server not found. Set BSO_REPO_ROOT to the bosang-strategy-os checkout.\n');
  process.exit(2);
}
process.env.BSO_REPO_ROOT=repoRoot;
await import(new URL(`file:///${server.replace(/\\/g,'/')}`).href);
