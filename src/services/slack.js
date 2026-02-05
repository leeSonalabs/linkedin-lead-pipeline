/**
 * Slack service for receiving messages and sending responses
 */

const { App } = require('@slack/bolt');
const logger = require('../utils/logger');

class SlackService {
  constructor() {
    this.botToken = process.env.SLACK_BOT_TOKEN;
    this.signingSecret = process.env.SLACK_SIGNING_SECRET;
    this.channelId = process.env.SLACK_CHANNEL_ID;

    if (!this.botToken) {
      throw new Error('SLACK_BOT_TOKEN is required');
    }

    if (!this.signingSecret) {
      throw new Error('SLACK_SIGNING_SECRET is required');
    }

    if (!this.channelId) {
      throw new Error('SLACK_CHANNEL_ID is required');
    }

    this.app = new App({
      token: this.botToken,
      signingSecret: this.signingSecret,
      // Use socket mode for easier deployment (no public URL needed initially)
      // Set SLACK_APP_TOKEN for socket mode, otherwise use HTTP mode
      ...(process.env.SLACK_APP_TOKEN ? {
        socketMode: true,
        appToken: process.env.SLACK_APP_TOKEN,
      } : {}),
    });
  }

  /**
   * Parse message text to extract LinkedIn post URL
   * Accepts either:
   * - Just a LinkedIn URL
   * - POST_URL: https://linkedin.com/posts/...
   *
   * @param {string} text - Message text
   * @returns {Object|null} - Parsed data or null if invalid
   */
  parseMessage(text) {
    if (!text) return null;

    let postUrl = null;

    // Slack wraps URLs in <url> or <url|label> format - extract the actual URL
    // Example: <https://linkedin.com/posts/xyz> or <https://linkedin.com/posts/xyz|link text>
    const slackUrlMatch = text.match(/<(https?:\/\/(?:www\.)?linkedin\.com\/(?:posts|feed\/update)\/[^|>]+)/i);
    if (slackUrlMatch) {
      postUrl = slackUrlMatch[1].trim();
    } else {
      // Try plain URL format
      const plainUrlMatch = text.match(/(https?:\/\/(?:www\.)?linkedin\.com\/(?:posts|feed\/update)\/[^\s<>]+)/i);
      if (plainUrlMatch) {
        postUrl = plainUrlMatch[1].trim();
      }
    }

    // Validate we found a LinkedIn URL
    if (!postUrl || !postUrl.includes('linkedin.com')) {
      return null;
    }

    // Clean up any trailing characters
    postUrl = postUrl.replace(/[>|].*$/, '');

    return { postUrl };
  }

  /**
   * Send a message to the configured channel
   * @param {string} text - Message text
   * @param {string} threadTs - Optional thread timestamp for replies
   * @returns {Promise<Object>} - Slack API response
   */
  async sendMessage(text, threadTs = null) {
    try {
      const messageParams = {
        channel: this.channelId,
        text,
        ...(threadTs && { thread_ts: threadTs }),
      };

      const result = await this.app.client.chat.postMessage(messageParams);
      logger.debug('Slack message sent', { channel: this.channelId, threadTs });
      return result;
    } catch (error) {
      logger.error('Failed to send Slack message', { error: error.message });
      throw error;
    }
  }

  /**
   * Send a processing status update
   * @param {string} status - Status message
   * @param {string} threadTs - Thread timestamp
   */
  async sendStatus(status, threadTs = null) {
    return this.sendMessage(`⏳ ${status}`, threadTs);
  }

  /**
   * Send the final summary
   * @param {Object} stats - Pipeline statistics
   * @param {string} threadTs - Thread timestamp
   */
  async sendSummary(stats, threadTs = null) {
    const message = [
      '✅ *Pipeline Complete*',
      '',
      `Found *${stats.engagers}* engagers`,
      `→ *${stats.enriched}* emails from Apollo`,
      `→ *${stats.pushed}* pushed to Smartlead`,
      '',
      stats.failed > 0 ? `⚠️ ${stats.failed} failed to push` : '',
    ].filter(Boolean).join('\n');

    return this.sendMessage(message, threadTs);
  }

  /**
   * Send an error message
   * @param {string} error - Error message
   * @param {string} threadTs - Thread timestamp
   */
  async sendError(error, threadTs = null) {
    return this.sendMessage(`❌ *Pipeline Error*\n${error}`, threadTs);
  }

  /**
   * Register message handler and start the app
   * @param {Function} onMessage - Callback function for handling parsed messages
   * @returns {Promise<void>}
   */
  async start(onMessage) {
    // Add health check endpoint for Render
    const { createServer } = require('http');
    const port = process.env.PORT || 3000;

    createServer((req, res) => {
      if (req.url === '/health' || req.url === '/') {
        res.writeHead(200);
        res.end('OK');
      } else {
        res.writeHead(404);
        res.end();
      }
    }).listen(port, () => {
      logger.info(`Health check server running on port ${port}`);
    });
    // Listen for ALL messages first to debug
    this.app.event('message', async ({ event, say }) => {
      logger.info('Raw message event received', {
        channel: event.channel,
        type: event.type,
        subtype: event.subtype,
        text: event.text?.substring(0, 100),
        bot_id: event.bot_id,
        expectedChannel: this.channelId,
      });

      // Ignore bot messages, message changes, and messages from other channels
      if (event.bot_id || event.subtype || event.channel !== this.channelId) {
        logger.debug('Message ignored', {
          reason: event.bot_id ? 'bot' : event.subtype ? 'subtype' : 'wrong channel'
        });
        return;
      }

      const message = event;

      logger.info('Processing Slack message', {
        channel: message.channel,
        user: message.user,
        hasText: !!message.text,
      });

      // Parse the message
      const parsedData = this.parseMessage(message.text);

      if (!parsedData) {
        logger.debug('Message does not match expected format, ignoring', { text: message.text });
        return;
      }

      logger.info('Parsed pipeline request', parsedData);

      // Call the handler with parsed data
      try {
        await onMessage(parsedData, message.ts);
      } catch (error) {
        logger.error('Pipeline handler error', { error: error.message });
        await this.sendError(error.message, message.ts);
      }
    });

    // Start the Slack app (Socket Mode doesn't need a port)
    await this.app.start();

    logger.info('Slack app started');
    logger.info(`Listening for messages in channel: ${this.channelId}`);
  }

  /**
   * Get the Slack Bolt app instance for advanced usage
   * @returns {App} - Slack Bolt app instance
   */
  getApp() {
    return this.app;
  }
}

module.exports = SlackService;
