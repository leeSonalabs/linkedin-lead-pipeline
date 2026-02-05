/**
 * Apify service for scraping LinkedIn post engagers
 * Uses supreme_coder/linkedin-post actor (high success rate)
 */

const axios = require('axios');
const logger = require('../utils/logger');

const APIFY_API_BASE = 'https://api.apify.com/v2';

class ApifyService {
  constructor() {
    this.apiToken = process.env.APIFY_API_TOKEN;

    // Actor for LinkedIn post scraping (very high success rate)
    this.actorId = process.env.APIFY_LINKEDIN_ACTOR_ID || 'supreme_coder/linkedin-post';

    if (!this.apiToken) {
      throw new Error('APIFY_API_TOKEN is required');
    }

    this.client = axios.create({
      baseURL: APIFY_API_BASE,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Run an Apify actor and wait for results
   */
  async runActor(actorId, input) {
    logger.info('Starting Apify actor', { actorId });

    try {
      const runResponse = await this.client.post(
        `/acts/${encodeURIComponent(actorId)}/runs`,
        input,
        {
          params: {
            token: this.apiToken,
            waitForFinish: 300,
          },
        }
      );

      const run = runResponse.data.data;
      logger.info('Actor run started', { runId: run.id, status: run.status });

      if (run.status !== 'SUCCEEDED') {
        await this.waitForRun(run.id);
      }

      const results = await this.getDatasetItems(run.defaultDatasetId);
      logger.info('Actor run completed', { runId: run.id, resultCount: results.length });

      return results;
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      logger.error('Apify actor run failed', { actorId, error: errorMsg });
      throw new Error(`Apify actor failed: ${errorMsg}`);
    }
  }

  /**
   * Poll for actor run completion
   */
  async waitForRun(runId, maxAttempts = 60, intervalMs = 10000) {
    logger.info('Waiting for Apify run to complete', { runId });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await this.client.get(`/actor-runs/${runId}`, {
        params: { token: this.apiToken },
      });
      const status = response.data.data.status;

      logger.debug(`Polling attempt ${attempt}/${maxAttempts}`, { status });

      if (status === 'SUCCEEDED') return;
      if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
        throw new Error(`Actor run ${status}`);
      }

      await this.sleep(intervalMs);
    }

    throw new Error('Actor run timed out');
  }

  /**
   * Get items from a dataset
   */
  async getDatasetItems(datasetId) {
    const response = await this.client.get(`/datasets/${datasetId}/items`, {
      params: {
        token: this.apiToken,
        format: 'json',
        clean: true,
      },
    });
    return response.data || [];
  }

  /**
   * Extract LinkedIn profile URLs from post data
   * @param {Array} postData - Raw data from Apify
   * @returns {Array<string>} - Array of LinkedIn profile URLs
   */
  extractProfileUrls(postData) {
    const profileUrls = new Set();

    // Debug: log raw data structure
    if (postData.length > 0) {
      logger.info('Sample post data keys', { keys: Object.keys(postData[0]) });

      // Log reactions structure
      const reactions = postData[0].reactions;
      logger.info('Reactions type and length', {
        type: typeof reactions,
        isArray: Array.isArray(reactions),
        length: Array.isArray(reactions) ? reactions.length : 'N/A',
        sample: Array.isArray(reactions) && reactions.length > 0 ? JSON.stringify(reactions[0]).substring(0, 300) : 'empty'
      });

      // Log comments structure
      const comments = postData[0].comments;
      logger.info('Comments type and length', {
        type: typeof comments,
        isArray: Array.isArray(comments),
        length: Array.isArray(comments) ? comments.length : 'N/A',
        sample: Array.isArray(comments) && comments.length > 0 ? JSON.stringify(comments[0]).substring(0, 300) : 'empty'
      });
    }

    for (const post of postData) {
      // Extract author profile URL
      if (post.authorProfileUrl) {
        const normalized = this.normalizeLinkedInUrl(post.authorProfileUrl);
        if (normalized) profileUrls.add(normalized);
      }

      // Extract from reactions array (various possible structures)
      const reactions = post.reactions || post.likers || post.likes || [];
      if (Array.isArray(reactions)) {
        logger.info('Processing reactions', { count: reactions.length });
        for (const reaction of reactions) {
          this.extractUrlFromItem(reaction, profileUrls);
        }
      }

      // Extract from comments array
      const comments = post.comments || post.commenters || [];
      if (Array.isArray(comments)) {
        logger.info('Processing comments', { count: comments.length });
        for (const comment of comments) {
          this.extractUrlFromItem(comment, profileUrls);
          // Also check nested author
          if (comment.author) {
            this.extractUrlFromItem(comment.author, profileUrls);
          }
        }
      }

      // Extract from engagements/engagement array
      const engagements = post.engagements || post.engagement || [];
      if (Array.isArray(engagements)) {
        for (const engagement of engagements) {
          this.extractUrlFromItem(engagement, profileUrls);
        }
      }
    }

    const validUrls = Array.from(profileUrls);
    logger.step('Profile URLs extracted', validUrls.length);
    return validUrls;
  }

  /**
   * Extract URL from a single item (reaction, comment, etc.)
   */
  extractUrlFromItem(item, profileUrls) {
    if (!item) return;

    // Direct URL fields
    const urlFields = ['profileUrl', 'profile_url', 'linkedinUrl', 'linkedin_url',
                       'url', 'link', 'actorUrl', 'authorUrl', 'memberUrl'];
    for (const field of urlFields) {
      if (item[field] && typeof item[field] === 'string' && item[field].includes('linkedin.com/in/')) {
        const normalized = this.normalizeLinkedInUrl(item[field]);
        if (normalized) profileUrls.add(normalized);
      }
    }

    // Nested actor/user/profile object
    const nestedObjects = ['actor', 'user', 'profile', 'reactor', 'author', 'member', 'commenter'];
    for (const objName of nestedObjects) {
      if (item[objName] && typeof item[objName] === 'object') {
        // Check URL fields
        for (const field of urlFields) {
          if (item[objName][field] && typeof item[objName][field] === 'string' && item[objName][field].includes('linkedin.com/in/')) {
            const normalized = this.normalizeLinkedInUrl(item[objName][field]);
            if (normalized) profileUrls.add(normalized);
          }
        }
        // Check for publicId (used by supreme_coder actor)
        if (item[objName].publicId) {
          profileUrls.add(`https://www.linkedin.com/in/${item[objName].publicId}`);
        }
        // Check for publicIdentifier
        if (item[objName].publicIdentifier) {
          profileUrls.add(`https://www.linkedin.com/in/${item[objName].publicIdentifier}`);
        }
        // Check for vanityName
        if (item[objName].vanityName) {
          profileUrls.add(`https://www.linkedin.com/in/${item[objName].vanityName}`);
        }
      }
    }

    // Top-level publicId (supreme_coder format)
    if (item.publicId) {
      profileUrls.add(`https://www.linkedin.com/in/${item.publicId}`);
    }
    // Top-level publicIdentifier
    if (item.publicIdentifier) {
      profileUrls.add(`https://www.linkedin.com/in/${item.publicIdentifier}`);
    }
  }

  /**
   * Normalize LinkedIn URL format
   */
  normalizeLinkedInUrl(url) {
    if (!url || typeof url !== 'string') return null;
    if (!url.includes('linkedin.com')) return null;

    let normalized = url.split('?')[0].replace(/\/+$/, '');

    if (normalized.startsWith('http://')) {
      normalized = normalized.replace('http://', 'https://');
    }

    return normalized;
  }

  /**
   * Main method: Get all engager profile URLs from a LinkedIn post
   * @param {string} postUrl - LinkedIn post URL
   * @returns {Promise<Array<string>>} - Array of profile URLs
   */
  async getPostEngagers(postUrl) {
    try {
      logger.info('Fetching post engagers', { postUrl });

      // Input format for supreme_coder/linkedin-post
      // Try multiple input formats to see which works
      const input = {
        urls: [postUrl],
        postUrls: [postUrl],
        startUrls: [{ url: postUrl }],
      };

      const results = await this.runActor(this.actorId, input);

      logger.info('Raw data fetched', { posts: results.length });

      if (results.length === 0) {
        logger.warn('No post data returned from Apify');
        return [];
      }

      // Extract unique profile URLs
      const profileUrls = this.extractProfileUrls(results);

      return profileUrls;
    } catch (error) {
      logger.error('Failed to get post engagers', { error: error.message });
      throw error;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ApifyService;
