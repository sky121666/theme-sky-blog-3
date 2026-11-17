import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { computeBuildRevision } from './build-identity.mjs';

// Keep each run, including repeated checks of the same uncommitted revision.
export async function verificationOutput(suite, { servedRevision } = {}) {
  const worktreeRevision = computeBuildRevision();
  if (servedRevision !== undefined && !/^[a-f0-9]{12}$/.test(servedRevision)) throw new Error('Invalid verified build revision');
  const revision = servedRevision ?? worktreeRevision;
  const startedAt = new Date().toISOString();
  const parent = path.resolve(process.env.VERIFICATION_OUTPUT_DIR || 'output/verification', revision);
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(parent, `${suite}-${startedAt.replace(/[:.]/g, '-')}-`));
  await writeFile(path.join(dir, 'run.json'), JSON.stringify({ suite, revision, startedAt, ...(servedRevision ? { servedRevision, worktreeRevision } : {}) }, null, 2) + '\n');
  console.log(`Evidence: ${dir}`);
  return dir;
}
