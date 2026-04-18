/**
 * Jira Client Service
 * Handles communication with Jira API
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { JiraIssue } from '../types';

export class JiraClient {
  private static instance: AxiosInstance;
  private static initialized = false;

  /**
   * Initialize Jira client with configuration from environment
   */
  static initialize(): void {
    if (this.initialized) return;

    const jiraUrl = process.env.JIRA_URL;
    const jiraToken = process.env.JIRA_API_TOKEN;
    const jiraUsername = process.env.JIRA_USERNAME;

    logger.debug(`Jira Config Check:`);
    logger.debug(`  URL: ${jiraUrl}`);
    logger.debug(`  Username: ${jiraUsername}`);
    logger.debug(`  Token present: ${!!jiraToken}`);
    logger.debug(`  Token length: ${jiraToken?.length || 0}`);

    if (!jiraUrl || !jiraToken || !jiraUsername) {
      logger.warn(
        '⚠️  Jira configuration incomplete. Set JIRA_URL, JIRA_API_TOKEN, JIRA_USERNAME in .env'
      );
      this.initialized = false;
      return;
    }

    // Create axios instance with Jira credentials
    // For Jira Cloud API, use Base64 encoded username:apitoken in Authorization header
    const credentials = Buffer.from(`${jiraUsername}:${jiraToken}`).toString('base64');
    logger.debug(`Credentials encoded length: ${credentials.length}`);
    
    this.instance = axios.create({
      baseURL: `${jiraUrl}/rest/api/3`,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Basic ${credentials}`,
      },
      validateStatus: function () {
        return true; // Don't throw on any status code
      },
    });

    // Add response interceptor to log responses
    this.instance.interceptors.response.use(
      (response) => {
        logger.debug(`Response Status: ${response.status}`);
        if (response.status >= 400) {
          logger.debug(`Response Data Type: ${typeof response.data}`);
          logger.debug(`Response Data Sample: ${JSON.stringify(response.data).substring(0, 200)}`);
        }
        return response;
      },
      (error) => {
        logger.error(`Axios Error:`, error.message);
        return Promise.reject(error);
      }
    );

    this.initialized = true;
    logger.success('✓ Jira client initialized');
  }

  /**
   * Fetch a single Jira issue by key
   */
  static async getIssue(issueKey: string): Promise<JiraIssue | null> {
    this.initialize();

    if (!this.instance) {
      logger.warn('Jira client not initialized');
      return null;
    }

    try {
      logger.info(`📥 Fetching Jira issue: ${issueKey}`);
      const response = await this.instance.get<any>(`/issue/${issueKey}`, {
        params: {
          expand: 'changelog',
          fields:
            'summary,description,customfield_10000,labels,priority,status,assignee',
        },
      });

      // Check for JIRA error responses (e.g., errorMessages field)
      if (response.data?.errorMessages) {
        logger.warn(`⚠️  JIRA returned error for ${issueKey}:`);
        logger.warn(`   ${response.data.errorMessages.join(', ')}`);
        
        if (response.status === 401) {
          logger.error('❌ Authentication failed (401) - Check JIRA_API_TOKEN and JIRA_USERNAME');
        } else if (response.status === 403) {
          logger.error('❌ Forbidden (403) - Insufficient permissions');
        } else if (response.status === 404) {
          logger.warn(`⚠️  Issue ${issueKey} not found`);
        }
        
        return null;
      }

      // Check if response has required fields
      if (!response.data?.key || !response.data?.fields) {
        logger.error(`Invalid JIRA response for ${issueKey}:`, {
          hasKey: !!response.data?.key,
          hasFields: !!response.data?.fields,
          responseKeys: Object.keys(response.data || {}),
        });
        return null;
      }

      logger.success(`✓ Fetched issue ${issueKey}`);
      
      // Transform Jira API response to our interface format
      const jiraData = response.data;
      
      // Handle description which can be a string or an ADF object
      let descriptionText = '';
      const desc = jiraData.fields?.description || jiraData.description;
      if (typeof desc === 'string') {
        descriptionText = desc;
      } else if (desc && typeof desc === 'object' && desc.content) {
        // Extract plain text from ADF (Atlassian Document Format)
        descriptionText = desc.content?.map((block: any) => {
          if (block.content && Array.isArray(block.content)) {
            return block.content.map((item: any) => item.text || '').join('');
          }
          return '';
        }).join('\n');
      }
      
      const transformedIssue: JiraIssue = {
        key: jiraData.key,
        summary: jiraData.fields?.summary || jiraData.summary || '',
        description: descriptionText,
        fields: jiraData.fields || {},
      };
      
      logger.debug(`   Summary: "${transformedIssue.summary}"`);
      logger.debug(`   Description: "${descriptionText?.substring(0, 50) || 'N/A'}..."`);
      
      return transformedIssue;
    } catch (error) {
      logger.error(`Failed to fetch issue ${issueKey}:`, error);
      return null;
    }
  }

  /**
   * Search for Jira issues using JQL
   */
  static async searchIssues(jql: string, maxResults?: number): Promise<JiraIssue[]> {
    this.initialize();

    if (!this.instance) {
      logger.warn('Jira client not initialized');
      return [];
    }

    try {
      const limit = maxResults || parseInt(process.env.JIRA_MAX_RESULTS || '100');
      logger.info(`🔍 Searching Jira issues: ${jql}`);

      const response = await this.instance.get<any>('/search', {
        params: {
          jql,
          maxResults: limit,
          fields:
            'summary,description,customfield_10000,labels,priority,status,assignee',
        },
      });

      // Check for JIRA error responses
      if (response.data?.errorMessages) {
        logger.warn(`⚠️  JIRA search error:`);
        logger.warn(`   ${response.data.errorMessages.join(', ')}`);
        
        if (response.status === 401) {
          logger.error('❌ Authentication failed (401) - Check JIRA_API_TOKEN and JIRA_USERNAME');
        } else if (response.status === 403) {
          logger.error('❌ Forbidden (403) - Insufficient permissions');
        }
        
        return [];
      }

      // Check if response has issues array
      if (!Array.isArray(response.data?.issues)) {
        logger.warn(`Invalid JIRA search response - no issues array found`);
        return [];
      }

      logger.success(`✓ Found ${response.data.issues.length} issues`);
      
      // Transform issues to handle ADF descriptions
      return response.data.issues.map((jiraIssue: any) => {
        let descriptionText = '';
        const desc = jiraIssue.fields?.description;
        if (typeof desc === 'string') {
          descriptionText = desc;
        } else if (desc && typeof desc === 'object' && desc.content) {
          descriptionText = desc.content?.map((block: any) => {
            if (block.content && Array.isArray(block.content)) {
              return block.content.map((item: any) => item.text || '').join('');
            }
            return '';
          }).join('\n');
        }
        
        return {
          key: jiraIssue.key,
          summary: jiraIssue.fields?.summary || '',
          description: descriptionText,
          fields: jiraIssue.fields || {},
        } as JiraIssue;
      });
    } catch (error) {
      logger.error('Jira search failed:', error);
      return [];
    }
  }

  /**
   * Fetch multiple issues by keys
   */
  static async getIssues(issueKeys: string[]): Promise<JiraIssue[]> {
    const issues: JiraIssue[] = [];

    logger.info(`📥 Fetching ${issueKeys.length} Jira issues`);

    for (const key of issueKeys) {
      const issue = await this.getIssue(key);
      if (issue) {
        issues.push(issue);
      }
    }

    logger.success(`✓ Fetched ${issues.length}/${issueKeys.length} issues`);
    return issues;
  }

  /**
   * Get issues related to a specific project with a label
   */
  static async getIssuesByLabel(projectKey: string, label: string): Promise<JiraIssue[]> {
    const jql = `project = ${projectKey} AND labels = ${label} AND type = "Story" OR type = "Task"`;
    return this.searchIssues(jql);
  }

  /**
   * Get unresolved QA-related issues
   */
  static async getQAIssues(projectKey: string = 'QA'): Promise<JiraIssue[]> {
    const jql = `project = ${projectKey} AND status != Done AND status != Closed`;
    return this.searchIssues(jql);
  }

  /**
   * Test Jira connection
   */
  static async testConnection(): Promise<boolean> {
    this.initialize();

    if (!this.instance) {
      logger.warn('Jira client not initialized - missing config');
      return false;
    }

    try {
      logger.info('🧪 Testing Jira connection...');
      logger.debug(`Endpoint: ${this.instance.defaults.baseURL}/myself`);
      logger.debug(`Headers:`, {
        'Content-Type': this.instance.defaults.headers?.['Content-Type'],
        'Accept': this.instance.defaults.headers?.['Accept'],
        'Authorization': `Basic ${(this.instance.defaults.headers?.['Authorization'] as string)?.substring(0, 20)}...`,
      });
      
      const response = await this.instance.get('/myself');
      
      logger.debug(`Response Status: ${response.status}`);
      logger.debug(`Response Headers:`, response.headers);

      if (response.status === 200 && response.data && typeof response.data === 'object') {
        logger.success('✓ Jira connection successful');
        const displayName = (response.data as any)?.displayName || (response.data as any)?.name;
        logger.info(`Authenticated as: ${displayName}`);
        return true;
      } else if (response.status === 401) {
        logger.error('❌ Authentication failed (401) - Invalid credentials');
        logger.error('   Check: JIRA_API_TOKEN, JIRA_USERNAME, or token expiry');
        return false;
      } else if (response.status === 403) {
        logger.error('❌ Forbidden (403) - Insufficient permissions');
        logger.error('   The API token may not have required scopes');
        return false;
      } else if (response.status === 404) {
        logger.error('❌ Jira instance not found (404)');
        logger.error(`   Check JIRA_URL: ${process.env.JIRA_URL}`);
        return false;
      } else {
        logger.error(`❌ Unexpected response status: ${response.status}`);
        logger.error(`Response type: ${typeof response.data}`);
        if (typeof response.data === 'string') {
          logger.error(`Response (first 500 chars): ${response.data.substring(0, 500)}`);
        }
        return false;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`❌ Connection error: ${errorMsg}`);
      
      if ((error as any)?.code === 'ENOTFOUND') {
        logger.error('❌ DNS resolution failed - check JIRA_URL');
      } else if ((error as any)?.code === 'ECONNREFUSED') {
        logger.error('❌ Connection refused - Jira server may be down');
      } else if ((error as any)?.code === 'ETIMEDOUT') {
        logger.error('❌ Connection timeout - network issue or server too slow');
      }
      
      return false;
    }
  }
}
