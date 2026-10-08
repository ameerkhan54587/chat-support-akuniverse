/** Load static site metadata for the support console. */
const fs = require('fs');
const path = require('path');

const SITES_DIR = path.join(__dirname, 'data', 'sites');
let cachedSites = [];

function loadAllSites() {
  try {
    const sites = fs.readdirSync(SITES_DIR)
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        try {
          const site = JSON.parse(fs.readFileSync(path.join(SITES_DIR, file), 'utf8'));
          if (!site.id) site.id = path.basename(file, '.json');
          const envSuffix = String(site.id).toUpperCase().replace(/[^A-Z0-9]/g, '_');
          site.api_key = process.env[`SITE_API_KEY_${envSuffix}`] || '';
          // Handoff credentials are runtime-only and never stored in site metadata.
          site.handoff_secret = process.env[`SITE_HANDOFF_SECRET_${envSuffix}`] || '';
          if (site.telegram && typeof site.telegram === 'object') {
            const envKey = `TELEGRAM_BOT_TOKEN_${envSuffix}`;
            site.telegram.bot_token = process.env[envKey] || '';
            site.telegram.enabled = Boolean(site.telegram.enabled && site.telegram.bot_token);
          }
          return site;
        } catch (error) {
          console.error(`[ConfigLoader] Invalid site metadata in ${file}:`, error.message);
          return null;
        }
      }).filter(Boolean);
    cachedSites = sites;
    return sites;
  } catch (error) {
    console.error('[ConfigLoader] Unable to load site metadata:', error.message);
    return cachedSites;
  }
}

loadAllSites();
try {
  if (fs.existsSync(SITES_DIR)) {
    const watcher = fs.watch(SITES_DIR, () => setTimeout(loadAllSites, 100));
    watcher.unref?.();
  }
} catch { /* Static configuration does not need a watcher in restricted deployments. */ }

function getAllSites() { return cachedSites; }
function getSiteById(id) {
  const value = String(id || '').toLowerCase().trim();
  return cachedSites.find(site => String(site.id).toLowerCase() === value) || null;
}
function getSiteByDomain(domainOrUrl) {
  if (!domainOrUrl) return null;
  const domain = String(domainOrUrl).toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  return cachedSites.find(site => site.domain && (domain === site.domain.toLowerCase() || domain.endsWith(`.${site.domain.toLowerCase()}`))) || cachedSites[0] || null;
}

module.exports = { getAllSites, getSiteById, getSiteByDomain, SITES_DIR };
