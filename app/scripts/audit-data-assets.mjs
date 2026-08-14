import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataRoot = path.resolve(__dirname, '..', 'data');
const datasetPath = path.join(dataRoot, '2026', 'races.json');
const scannedRoots = [
  path.join(dataRoot, 'gpx'),
  path.join(dataRoot, 'generated', 'routes'),
];

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function normalizeReferencedAsset(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const absolute = path.resolve(dataRoot, value);
  if (!isInside(dataRoot, absolute)) return null;
  return toPosixPath(path.relative(dataRoot, absolute));
}

async function walkFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (!isInside(root, absolute)) continue;
    if (entry.isDirectory()) {
      files.push(...await walkFiles(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

export async function auditDataAssets({ deleteOrphans = false } = {}) {
  const payload = JSON.parse(await readFile(datasetPath, 'utf8'));
  const referenced = new Set();

  for (const entry of payload.races ?? []) {
    for (const key of ['localFile', 'routeAsset']) {
      const relative = normalizeReferencedAsset(entry.edition?.gpx?.[key]);
      if (relative) referenced.add(relative);
    }
  }

  const scannedFiles = [];
  for (const root of scannedRoots) {
    const files = await walkFiles(root);
    for (const absolute of files) {
      if (!scannedRoots.some((candidateRoot) => isInside(candidateRoot, absolute))) {
        throw new Error(`Refusing to inspect asset outside allowed roots: ${absolute}`);
      }
      scannedFiles.push(absolute);
    }
  }

  const orphans = scannedFiles
    .map((absolute) => ({
      absolute,
      relative: toPosixPath(path.relative(dataRoot, absolute)),
    }))
    .filter((asset) => !referenced.has(asset.relative))
    .sort((assetA, assetB) => assetA.relative.localeCompare(assetB.relative, 'en'));

  const deleted = [];
  if (deleteOrphans) {
    for (const orphan of orphans) {
      if (!scannedRoots.some((root) => isInside(root, orphan.absolute))) {
        throw new Error(`Refusing to delete asset outside allowed roots: ${orphan.absolute}`);
      }
      await rm(orphan.absolute, { force: false });
      deleted.push(orphan.relative);
    }
  }

  return {
    referencedCount: referenced.size,
    scannedCount: scannedFiles.length,
    orphanCount: orphans.length,
    orphans: orphans.map((asset) => asset.relative),
    deleted,
  };
}

export function formatAssetAudit(report) {
  const lines = [];
  lines.push('# Data asset audit');
  lines.push('');
  lines.push(`Referenced assets: ${report.referencedCount}`);
  lines.push(`Scanned assets: ${report.scannedCount}`);
  lines.push(`Orphan assets: ${report.orphanCount}`);
  if (report.deleted.length) lines.push(`Deleted assets: ${report.deleted.length}`);
  lines.push('');

  const list = report.deleted.length ? report.deleted : report.orphans;
  if (list.length) {
    lines.push(report.deleted.length ? '## Deleted assets' : '## Orphan assets');
    for (const relative of list) lines.push(`- ${relative}`);
  } else {
    lines.push('No orphan assets found.');
  }

  return `${lines.join('\n')}\n`;
}

function isDirectRun() {
  return process.argv[1] && path.resolve(process.argv[1]) === __filename;
}

if (isDirectRun()) {
  const deleteOrphans = process.argv.includes('--delete');
  const json = process.argv.includes('--json');
  const report = await auditDataAssets({ deleteOrphans });
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatAssetAudit(report));
}