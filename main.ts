import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boardIssue,
  buildBoard,
  buildRadar,
  dataScript,
  parseSnapshot,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const projectDir = fileURLToPath(new URL('.', import.meta.url));

function optionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Expected a value after ${option}.`);
  }
  return value;
}

async function countScreenshotFiles(directory: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      count += await countScreenshotFiles(path);
    } else if (
      entry.isFile() &&
      ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(extname(entry.name).toLowerCase())
    ) {
      count += 1;
    }
  }

  return count;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2); // args
  const inputArg = optionValue(args, '--input') ?? '/input';
  const outputArg =
    optionValue(args, '--output') ??
    process.env.MAKEFUN_OUTPUT_DIR ??
    '/output';
  const inputPath = inputArg.toLowerCase().endsWith('.json')
    ? inputArg
    : join(inputArg, 'snapshot.json');
  const outputDir = resolve(outputArg);

  const snapshotText = await readFile(inputPath, 'utf8');
  const snapshot = parseSnapshot(snapshotText);
  const board = buildBoard(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue) throw new Error(issue);

  const radar = buildRadar(snapshot);
  const dashboardSource = join(projectDir, 'dashboard');
  const screenshotsSource = join(projectDir, 'screenshots');
  const screenshotCount = await countScreenshotFiles(screenshotsSource);
  if (screenshotCount < 3) {
    throw new Error(`Expected at least 3 screenshots, found ${screenshotCount}.`);
  }

  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'board.json'), `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  await writeFile(join(outputDir, 'data.js'), dataScript(radar), 'utf8');
  await cp(dashboardSource, join(outputDir, 'dashboard'), { recursive: true });
  await cp(screenshotsSource, join(outputDir, 'screenshots'), { recursive: true });

  const dossier = buildDossier(outputDir, { text_max_bytes: 65_536 });
  await writeFile(join(outputDir, 'dossier.json'), dossier);

  console.log(
    JSON.stringify({
      output: outputDir,
      as_of: snapshot.as_of,
      board_rows: board.length,
      live_rows: radar.live.length,
      screenshots: screenshotCount,
    }),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message + "!!");
  process.exitCode = 1; // exit
});