/**
 * LinkedIn Lead Generation Pipeline
 *
 * Triggered by Slack messages, this pipeline:
 * 1. Scrapes LinkedIn post engagers via Apify
 * 2. Enriches profiles with Apollo to get emails
 * 3. Pushes leads to Smartlead campaigns
 */

require('dotenv').config();

const logger = require('./utils/logger');
const SlackService = require('./services/slack');
const ApifyService = require('./services/apify');
const ApolloService = require('./services/apollo');
const SmartleadService = require('./services/smartlead');

// Initialize services
let slack, apify, apollo, smartlead;

/**
 * Initialize all services
 */
function initializeServices() {
  logger.info('Initializing services...');

  try {
    slack = new SlackService();
    apify = new ApifyService();
    apollo = new ApolloService();
    smartlead = new SmartleadService();

    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services', { error: error.message });
    throw error;
  }
}

/**
 * Main pipeline handler
 * @param {Object} data - Parsed message data
 * @param {string} data.postUrl - LinkedIn post URL
 * @param {string} threadTs - Slack thread timestamp for replies
 */
async function runPipeline(data, threadTs) {
  const stats = {
    engagers: 0,
    enriched: 0,
    pushed: 0,
    failed: 0,
  };

  logger.info('Starting pipeline', { postUrl: data.postUrl });

  try {
    // Step 1: Get engagers from LinkedIn post via Apify
    await slack.sendStatus('Scraping LinkedIn post engagers...', threadTs);

    const profileUrls = await apify.getPostEngagers(data.postUrl);
    stats.engagers = profileUrls.length;

    logger.step('Engagers found', stats.engagers);

    if (stats.engagers === 0) {
      await slack.sendMessage('No engagers found for this post.', threadTs);
      return;
    }

    // Step 2: Enrich profiles with Apollo
    await slack.sendStatus(`Enriching ${stats.engagers} profiles with Apollo...`, threadTs);

    const enrichedContacts = await apollo.enrichProfiles(profileUrls);
    stats.enriched = enrichedContacts.length;

    logger.step('Profiles enriched', stats.enriched);

    if (stats.enriched === 0) {
      await slack.sendMessage('No verified emails found from Apollo enrichment.', threadTs);
      await slack.sendSummary(stats, threadTs);
      return;
    }

    // Step 3: Push to Smartlead
    await slack.sendStatus(`Pushing ${stats.enriched} leads to Smartlead...`, threadTs);

    const smartleadResult = await smartlead.addLeads(enrichedContacts);

    stats.pushed = smartleadResult.added;
    stats.failed = smartleadResult.failed;

    logger.step('Leads pushed to Smartlead', stats.pushed);

    // Send final summary
    await slack.sendSummary(stats, threadTs);

    logger.info('Pipeline completed successfully', stats);

  } catch (error) {
    logger.error('Pipeline failed', { error: error.message, stack: error.stack });
    await slack.sendError(`Pipeline failed: ${error.message}`, threadTs);
    throw error;
  }
}

/**
 * Main entry point
 */
async function main() {
  logger.info('='.repeat(50));
  logger.info('LinkedIn Lead Generation Pipeline');
  logger.info('='.repeat(50));

  // Validate required environment variables
  const requiredEnvVars = [
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'SLACK_CHANNEL_ID',
    'APIFY_API_TOKEN',
    'APOLLO_API_KEY',
    'SMARTLEAD_API_KEY',
    'SMARTLEAD_CAMPAIGN_ID',
  ];

  const missingVars = requiredEnvVars.filter(v => !process.env[v]);

  if (missingVars.length > 0) {
    logger.error('Missing required environment variables', { missing: missingVars });
    process.exit(1);
  }

  // Initialize services
  initializeServices();

  // Start Slack app and listen for messages
  await slack.start(runPipeline);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: reason?.message || reason });
  process.exit(1);
});

// Start the application
main().catch((error) => {
  logger.error('Failed to start application', { error: error.message });
  process.exit(1);
});
