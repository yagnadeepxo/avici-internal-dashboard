const cron = require('node-cron');
const { enrichUsers } = require('./enrichment');
const config = require('./config');

console.log('IP Geolocation Enrichment Service starting...');
console.log(`Enrichment interval: ${config.ENRICHMENT_INTERVAL_MINUTES} minutes`);
console.log(`Batch size: ${config.ENRICHMENT_BATCH_SIZE} users per batch`);

if (!config.IP_GEOLOCATION_API_KEY) {
  console.error('ERROR: IP_GEOLOCATION_API_KEY is not set in environment variables!');
  console.error('Please add IP_GEOLOCATION_API_KEY to your .env file.');
  process.exit(1);
}

// Run initial enrichment on startup
enrichUsers()
  .then((result) => {
    console.log(`Initial enrichment completed: ${result.totalProcessed} processed, ${result.totalEnriched} enriched.`);
  })
  .catch((error) => {
    console.error('Initial enrichment failed:', error.message);
    // Continue anyway - cron will retry
  });

// Schedule enrichment every N minutes
const cronExpression = `*/${config.ENRICHMENT_INTERVAL_MINUTES} * * * *`;
console.log(`Scheduling enrichments with cron expression: ${cronExpression}`);

cron.schedule(cronExpression, async () => {
  console.log(`\n[${new Date().toISOString()}] Scheduled enrichment starting...`);
  try {
    const result = await enrichUsers();
    console.log(`[${new Date().toISOString()}] Scheduled enrichment completed: ${result.totalProcessed} processed, ${result.totalEnriched} enriched.`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Scheduled enrichment failed:`, error.message);
    // Don't throw - allow cron to continue scheduling
  }
});

console.log('Enrichment service is running. Press Ctrl+C to stop.');

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down enrichment service gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down enrichment service gracefully...');
  process.exit(0);
});
