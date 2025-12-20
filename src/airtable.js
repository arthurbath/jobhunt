import axios from 'axios';

const API_BASE = 'https://api.airtable.com/v0';

function encodeFormula(text = '') {
  return text.replace(/'/g, "\\'");
}

export class AirtableClient {
  constructor({ apiKey, baseId }) {
    this.apiKey = apiKey;
    this.baseId = baseId;
    this.http = axios.create({
      baseURL: `${API_BASE}/${baseId}`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
  }

  async findCompanyByName(name) {
    const formula = `LOWER({Name})='${encodeFormula(name.toLowerCase())}'`;
    const { data } = await this.http.get('/Companies', { params: { filterByFormula: formula } });
    return data.records?.[0] || null;
  }

  async upsertCompany(company) {
    const existing = await this.findCompanyByName(company.name);
    const fields = {
      Name: company.name,
      Website: company.website,
      'Careers Page': company.careersPage,
      Description: company.description2Sentences,
      Local: company.local ?? false,
      Type: company.type,
      'B Corp': company.bcorp ?? false,
      'B Corp Evidence': company.bcorpEvidence,
      'Glassdoor Page': company.glassdoorPage,
      'Glassdoor Rating': company.glassdoorRating,
      'Year Founded': company.glassdoorYearFounded,
      'Business Outlook Rating': company.glassdoorBusinessOutlookRating,
      'CEO Rating': company.glassdoorCeoRating,
    };
    if (existing) {
      const { data } = await this.http.patch('/Companies', {
        records: [
          {
            id: existing.id,
            fields,
          },
        ],
      });
      return { record: data.records[0], created: false };
    }
    const { data } = await this.http.post('/Companies', { records: [{ fields }] });
    return { record: data.records[0], created: true };
  }

  async findRoleRecord(companyRecordId, roleName) {
    const formula = `AND(LOWER({Name})='${encodeFormula(roleName.toLowerCase())}', SEARCH('${companyRecordId}', ARRAYJOIN({Company})))`;
    const { data } = await this.http.get('/Roles', { params: { filterByFormula: formula } });
    return data.records?.[0] || null;
  }

  async upsertRole(companyRecordId, role) {
    const existing = await this.findRoleRecord(companyRecordId, role.name);
    const fields = {
      Name: role.name,
      'Candidate Fit': role.candidateFit,
      'Active Listing': role.activeListing,
      Company: [companyRecordId],
      'Codex Commentary': role.commentary || null,
    };
    if (role.activeListing) {
      fields.Location = role.location;
    }
    const endpointPayload = { records: [{ fields }] };
    if (existing) {
      endpointPayload.records[0].id = existing.id;
      const { data } = await this.http.patch('/Roles', endpointPayload);
      return { record: data.records[0], created: false };
    }
    const { data } = await this.http.post('/Roles', endpointPayload);
    return { record: data.records[0], created: true };
  }

  async deleteRecords(tableName, recordIds = []) {
    if (!recordIds.length) return;
    const chunkSize = 10;
    for (let i = 0; i < recordIds.length; i += chunkSize) {
      const chunk = recordIds.slice(i, i + chunkSize);
      await this.http.delete(`/${tableName}`, { params: { records: chunk } });
    }
  }

  async deleteCompanyAndRolesByName(name) {
    const existing = await this.findCompanyByName(name);
    if (!existing) {
      return { found: false, deletedRoles: 0 };
    }
    const companyRecordId = existing.id;
    const formula = `SEARCH('${companyRecordId}', ARRAYJOIN({Company}))`;
    const { data } = await this.http.get('/Roles', { params: { filterByFormula: formula } });
    const roleIds = (data.records || []).map((record) => record.id);
    if (roleIds.length) {
      await this.deleteRecords('Roles', roleIds);
    }
    await this.deleteRecords('Companies', [companyRecordId]);
    return { found: true, deletedRoles: roleIds.length };
  }
}
