import ora from 'ora';
import { config } from '../config.js';
import { AirtableClient } from '../airtable.js';
import { CompanyResearcher } from '../research/companyResearch.js';
import { logger } from '../utils/logger.js';
import { checkConnectivity, isConnectivityError, waitForConnectivity } from '../utils/connectivity.js';

function buildCompanyPayload(research) {
  const fields = {
    Name: research.name,
    Website: research.website || null,
    'Careers Page': research.careersPage || null,
    Description: research.description2Sentences || null,
    Local: typeof research.local === 'boolean' ? research.local : false,
    Type: research.type || null,
    'B Corp': !!research.bcorp,
    'B Corp Evidence': research.bcorpEvidence || null,
    'Glassdoor Page': research.glassdoorPage || null,
    'Glassdoor Rating': research.glassdoorRating || null,
    'Year Founded': research.glassdoorYearFounded || null,
    'Business Outlook Rating': research.glassdoorBusinessOutlookRating || null,
    'CEO Rating': research.glassdoorCeoRating || null,
  };
  return fields;
}

function buildRolePayloads(roles = []) {
  return roles.map((role) => {
    const payload = {
      Name: role.name,
      'Candidate Fit': role.candidateFit,
      'Active Listing': role.activeListing || null,
      Location: role.activeListing ? role.location || null : null,
      'Codex Commentary': role.commentary || null,
    };
    return payload;
  });
}

export async function processCompanies(
  companyNames,
  { dryRun = false, refresh = false, skipGlassdoor = false } = {}
) {
  if (!companyNames.length) {
    logger.warn('No companies provided.');
    return [];
  }
  const airtable = new AirtableClient(config.airtable);
  const logs = [];

  for (const name of companyNames) {
    const spinner = ora(`Researching ${name}`).start();
    let completed = false;
    while (!completed) {
      try {
        const online = await checkConnectivity();
        if (!online) {
          spinner.warn(`Network offline. Waiting to retry ${name}...`);
          await waitForConnectivity({ logger, label: name });
          spinner.start(`Researching ${name} (retrying)`);
        }

        if (refresh && !dryRun) {
          await airtable.deleteCompanyAndRolesByName(name);
        }
        const researcher = new CompanyResearcher(name, { skipGlassdoor });
        const research = await researcher.research();
        research.sources = Array.from(new Set(research.sources));

        const companyPayload = buildCompanyPayload(research);
        const rolePayloads = buildRolePayloads(research.roles);

        let companyRecordId = null;
        let status = 'skipped';
        if (!dryRun) {
          const { record, created } = await airtable.upsertCompany(research);
          companyRecordId = record.id;
          status = created ? 'created' : 'updated';
          for (const role of research.roles) {
            await airtable.upsertRole(companyRecordId, role);
          }
        } else {
          status = 'skipped';
        }

        spinner.succeed(`${name} processed (${status})`);
        research.sources = Array.from(new Set(research.sources));
        const logEntry = {
          company: name,
          status,
          sources: research.sources,
          warnings: research.warnings || [],
          dryRun,
          companyPayload,
          rolePayloads,
        };
        logs.push(logEntry);
        logger.info(JSON.stringify(logEntry, null, 2));
        completed = true;
      } catch (err) {
        if (isConnectivityError(err)) {
          spinner.warn(`Network error while processing ${name}. Waiting to retry...`);
          await waitForConnectivity({ logger, label: name });
          spinner.start(`Researching ${name} (retrying)`);
          continue;
        }
        spinner.fail(`Failed ${name}`);
        const logEntry = {
          company: name,
          status: 'skipped',
          sources: [],
          warnings: [err.message],
        };
        logs.push(logEntry);
        logger.error(JSON.stringify(logEntry, null, 2));
        completed = true;
      }
    }
  }
  return logs;
}
