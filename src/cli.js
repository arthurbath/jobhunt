import { Command } from 'commander';
import fs from 'node:fs';
import { processCompanies } from './services/companyPipeline.js';
import { logger } from './utils/logger.js';

const program = new Command();
program
  .name('jobhunt')
  .description('Research companies and sync Product roles to Airtable')
  .option('--dry-run', 'research only, do not write to Airtable')
  .option('--skip-glassdoor', 'skip Glassdoor research to preserve API credits');

program
  .command('add-company <name>')
  .description('Research and sync a single company')
  .action(async (name, cmd) => {
    const opts = program.opts();
    await processCompanies([name], { dryRun: !!opts.dryRun, skipGlassdoor: !!opts.skipGlassdoor });
  });

program
  .command('add-companies <file>')
  .description('Research and sync companies from a newline-delimited file')
  .action(async (file) => {
    const opts = program.opts();
    if (!fs.existsSync(file)) {
      throw new Error(`File not found: ${file}`);
    }
    const content = fs.readFileSync(file, 'utf-8');
    const names = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    await processCompanies(names, { dryRun: !!opts.dryRun, skipGlassdoor: !!opts.skipGlassdoor });
  });

program
  .command('refresh-company <name>')
  .description('Delete existing Airtable records for a company, then re-research it')
  .action(async (name) => {
    const opts = program.opts();
    await processCompanies([name], {
      dryRun: !!opts.dryRun,
      refresh: true,
      skipGlassdoor: !!opts.skipGlassdoor,
    });
  });

program
  .command('sync')
  .description('Re-run research for cached company list (placeholder)')
  .action(async () => {
    logger.warn('Sync command not yet implemented. Use add-company or add-companies.');
  });

export function runCli(argv) {
  program.parseAsync(argv).catch((err) => {
    logger.error(err.message);
    process.exitCode = 1;
  });
}
