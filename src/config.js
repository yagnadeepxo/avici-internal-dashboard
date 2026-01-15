require('dotenv').config();

module.exports = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  API_BASE_URL: process.env.API_BASE_URL || 'http://apiv1.avici.club:3200/api/v1/pipe/users/all',
  SYNC_INTERVAL_MINUTES: parseInt(process.env.SYNC_INTERVAL_MINUTES || '10', 10),
  IP_GEOLOCATION_API_KEY: process.env.IP_GEOLOCATION_API_KEY,
  IP_GEOLOCATION_API_URL: process.env.IP_GEOLOCATION_API_URL || 'https://api.ipgeolocation.io/v2/ipgeo',
  ENRICHMENT_INTERVAL_MINUTES: parseInt(process.env.ENRICHMENT_INTERVAL_MINUTES || '10', 10),
  ENRICHMENT_BATCH_SIZE: parseInt(process.env.ENRICHMENT_BATCH_SIZE || '50', 10),
};
