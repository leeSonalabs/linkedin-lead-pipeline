/**
 * Apollo.io service for enriching LinkedIn profiles with contact data
 */

const axios = require('axios');
const logger = require('../utils/logger');

const APOLLO_API_BASE = 'https://api.apollo.io/api/v1';

class ApolloService {
  constructor() {
    this.apiKey = process.env.APOLLO_API_KEY;

    if (!this.apiKey) {
      throw new Error('APOLLO_API_KEY is required');
    }

    this.client = axios.create({
      baseURL: APOLLO_API_BASE,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
  }

  /**
   * Extract LinkedIn public identifier from URL
   * @param {string} linkedinUrl - Full LinkedIn profile URL
   * @returns {string|null} - Public identifier or null
   */
  extractPublicIdentifier(linkedinUrl) {
    if (!linkedinUrl) return null;

    // Match /in/username or /in/username/
    const match = linkedinUrl.match(/linkedin\.com\/in\/([^\/\?]+)/);
    return match ? match[1] : null;
  }

  /**
   * Enrich a single LinkedIn profile
   * @param {string} linkedinUrl - LinkedIn profile URL
   * @returns {Promise<Object|null>} - Enriched contact data or null
   */
  async enrichProfile(linkedinUrl) {
    try {
      const response = await this.client.post('/people/match', {
        api_key: this.apiKey,
        linkedin_url: linkedinUrl,
        reveal_personal_emails: false,
      });

      const person = response.data.person;

      if (!person) {
        logger.debug('No person data found', { linkedinUrl });
        return null;
      }

      // Check if email exists and is verified (not guessed)
      const email = person.email;
      const emailStatus = person.email_status;

      // Only accept verified emails, reject guessed ones
      if (!email || emailStatus === 'guessed' || emailStatus === 'unavailable') {
        logger.debug('Email not verified or unavailable', {
          linkedinUrl,
          emailStatus,
          hasEmail: !!email,
        });
        return null;
      }

      return {
        email: email,
        firstName: person.first_name || '',
        lastName: person.last_name || '',
        title: person.title || '',
        companyName: person.organization?.name || person.company || '',
        linkedinUrl: linkedinUrl,
        emailStatus: emailStatus,
      };
    } catch (error) {
      // Handle rate limiting
      if (error.response?.status === 429) {
        logger.warn('Apollo rate limit hit, waiting before retry', { linkedinUrl });
        await this.sleep(5000);
        return this.enrichProfile(linkedinUrl);
      }

      logger.debug('Failed to enrich profile', {
        linkedinUrl,
        error: error.response?.data || error.message,
      });
      return null;
    }
  }

  /**
   * Enrich multiple LinkedIn profiles with rate limiting
   * @param {Array<string>} linkedinUrls - Array of LinkedIn profile URLs
   * @param {number} concurrency - Number of concurrent requests
   * @param {number} delayMs - Delay between batches in milliseconds
   * @returns {Promise<Array<Object>>} - Array of enriched contacts
   */
  async enrichProfiles(linkedinUrls, concurrency = 5, delayMs = 1000) {
    logger.info('Starting Apollo enrichment', { totalProfiles: linkedinUrls.length });

    const enrichedContacts = [];
    const batches = this.chunkArray(linkedinUrls, concurrency);

    let processed = 0;

    for (const batch of batches) {
      const promises = batch.map(url => this.enrichProfile(url));
      const results = await Promise.all(promises);

      for (const result of results) {
        if (result) {
          enrichedContacts.push(result);
        }
      }

      processed += batch.length;
      logger.debug(`Enrichment progress: ${processed}/${linkedinUrls.length}`);

      // Delay between batches to avoid rate limiting
      if (batches.indexOf(batch) < batches.length - 1) {
        await this.sleep(delayMs);
      }
    }

    logger.step('Profiles enriched with verified emails', enrichedContacts.length);
    return enrichedContacts;
  }

  /**
   * Split array into chunks
   * @param {Array} array - Array to chunk
   * @param {number} size - Chunk size
   * @returns {Array<Array>} - Array of chunks
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ApolloService;
