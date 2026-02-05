/**
 * Smartlead service for adding leads to email campaigns
 */

const axios = require('axios');
const logger = require('../utils/logger');

const SMARTLEAD_API_BASE = 'https://server.smartlead.ai/api/v1';

class SmartleadService {
  constructor() {
    this.apiKey = process.env.SMARTLEAD_API_KEY;
    this.campaignId = process.env.SMARTLEAD_CAMPAIGN_ID;

    if (!this.apiKey) {
      throw new Error('SMARTLEAD_API_KEY is required');
    }

    if (!this.campaignId) {
      throw new Error('SMARTLEAD_CAMPAIGN_ID is required');
    }

    this.client = axios.create({
      baseURL: SMARTLEAD_API_BASE,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Format a contact for Smartlead API
   * @param {Object} contact - Contact object from our pipeline
   * @returns {Object} - Formatted lead for Smartlead
   */
  formatLead(contact) {
    // Smartlead only allows email, first_name, last_name at top level
    // Everything else goes in custom_fields
    return {
      email: contact.email,
      first_name: contact.firstName || '',
      last_name: contact.lastName || '',
      custom_fields: {
        company: contact.companyName || '',
        title: contact.title || '',
        linkedin_url: contact.linkedinUrl || '',
      },
    };
  }

  /**
   * Add leads to the campaign via Smartlead API
   * @param {Array<Object>} contacts - Array of contact objects
   * @returns {Promise<Object>} - Summary of results
   */
  async addLeads(contacts) {
    logger.info('Adding leads to Smartlead campaign', {
      totalLeads: contacts.length,
      campaignId: this.campaignId,
    });

    if (contacts.length === 0) {
      logger.warn('No leads to add to Smartlead');
      return { added: 0, failed: 0, leads: [] };
    }

    // Format all leads for Smartlead
    const formattedLeads = contacts.map(contact => this.formatLead(contact));

    try {
      // Smartlead supports bulk lead upload
      const response = await this.client.post(
        `/campaigns/${this.campaignId}/leads`,
        {
          lead_list: formattedLeads,
          settings: {
            ignore_global_block_list: false,
            ignore_unsubscribe_list: false,
            ignore_community_bounce_list: false,
            ignore_duplicate_leads_in_other_campaign: false,
          },
        },
        {
          params: {
            api_key: this.apiKey,
          },
        }
      );

      const result = response.data;

      // Smartlead returns upload stats
      const addedCount = result.upload_count || result.total_leads || formattedLeads.length;
      const failedCount = result.failed_count || 0;

      logger.step('Leads pushed to Smartlead', addedCount, { failed: failedCount });

      return {
        added: addedCount,
        failed: failedCount,
        response: result,
      };
    } catch (error) {
      logger.error('Failed to add leads to Smartlead', {
        error: error.response?.data || error.message,
      });

      // Fall back to individual adds if bulk fails
      return this.addLeadsIndividually(formattedLeads);
    }
  }

  /**
   * Add leads one by one (fallback method)
   * @param {Array<Object>} leads - Array of formatted lead objects
   * @returns {Promise<Object>} - Summary of results
   */
  async addLeadsIndividually(leads) {
    logger.info('Falling back to individual lead adds');

    let addedCount = 0;
    let failedCount = 0;
    const results = [];

    for (const lead of leads) {
      try {
        const response = await this.client.post(
          `/campaigns/${this.campaignId}/leads`,
          {
            lead_list: [lead],
            settings: {
              ignore_global_block_list: false,
              ignore_unsubscribe_list: false,
              ignore_community_bounce_list: false,
              ignore_duplicate_leads_in_other_campaign: false,
            },
          },
          {
            params: {
              api_key: this.apiKey,
            },
          }
        );

        results.push({ success: true, email: lead.email, response: response.data });
        addedCount++;
      } catch (error) {
        results.push({
          success: false,
          email: lead.email,
          error: error.response?.data || error.message,
        });
        failedCount++;

        logger.debug('Failed to add individual lead', {
          email: lead.email,
          error: error.response?.data || error.message,
        });
      }

      // Small delay to avoid rate limiting
      await this.sleep(200);
    }

    logger.step('Leads pushed to Smartlead (individual)', addedCount, { failed: failedCount });

    return {
      added: addedCount,
      failed: failedCount,
      leads: results,
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = SmartleadService;
