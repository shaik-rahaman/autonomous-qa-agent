/**
 * MCP Client for real Playwright DOM analysis
 * Uses actual browser automation to extract real DOM elements
 */

import { logger } from '../utils/logger';
import { DOMResponse, DOMElement } from '../types';
import { chromium, Browser, Page } from 'playwright';

export class MCPClient {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private serverUrl: string;

  constructor(serverUrl: string = 'http://localhost:4000') {
    this.serverUrl = serverUrl;
    logger.debug('MCPClient initialized for real Playwright DOM analysis');
  }

  /**
   * Initialize Playwright browser
   */
  private async initBrowser(): Promise<void> {
    if (this.browser) return;
    logger.info('🌐 MCP: Launching Chromium browser for DOM analysis');
    this.browser = await chromium.launch({ headless: true });
  }

  /**
   * Open URL in real browser
   */
  async openUrl(url: string): Promise<void> {
    logger.debug('MCP: Opening URL', url);

    try {
      await this.initBrowser();
      this.page = await this.browser!.newPage();
      await this.page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      logger.success(`✓ MCP: Successfully loaded ${url}`);
    } catch (error) {
      logger.error('MCP: Failed to open URL', error);
      throw error;
    }
  }

  /**
   * Get real DOM JSON from current page using Playwright
   */
  async getDomJson(url: string): Promise<DOMResponse> {
    logger.debug('MCP: Fetching real DOM JSON', url);

    try {
      // Open URL if not already open
      if (!this.page) {
        await this.openUrl(url);
      }

      const title = await this.page!.title();

      // Extract real interactive elements from page
      const elements: DOMElement[] = await this.page!.evaluate(() => {
        const result: any[] = [];

        // Get all interactive elements
        const selectors = [
          'input[type="text"]',
          'input[type="email"]',
          'input[type="password"]',
          'input[type="number"]',
          'textarea',
          'button',
          'select',
          'a[href]',
          '[role="button"]',
          '[role="link"]',
        ];

        function generateSelector(el: HTMLElement): string {
          // Try ID first
          if (el.id && !el.id.match(/^[0-9]/)) {
            return `#${el.id}`;
          }

          // Try name attribute
          if ((el as HTMLInputElement).name) {
            return `[name="${(el as HTMLInputElement).name}"]`;
          }

          // Try type + placeholder
          if ((el as HTMLInputElement).type && (el as HTMLInputElement).placeholder) {
            return `${el.tagName.toLowerCase()}[type="${(el as HTMLInputElement).type}"][placeholder="${(el as HTMLInputElement).placeholder}"]`;
          }

          // Try CSS classes
          if (el.className) {
            const classes = el.className
              .split(' ')
              .filter((c: string) => c && !c.includes('ng-') && !c.includes('react'))
              .slice(0, 2)
              .join('.');
            if (classes) {
              return `.${classes}`;
            }
          }

          // Try aria-label
          if (el.getAttribute('aria-label')) {
            return `[aria-label="${el.getAttribute('aria-label')}"]`;
          }

          // Try data-testid
          if (el.getAttribute('data-testid')) {
            return `[data-testid="${el.getAttribute('data-testid')}"]`;
          }

          // Fallback
          return el.tagName.toLowerCase();
        }

        selectors.forEach((selector) => {
          document.querySelectorAll(selector).forEach((el: Element) => {
            const htmlEl = el as HTMLElement;
            // Skip hidden elements
            if (htmlEl.offsetParent === null || htmlEl.style.display === 'none') return;

            const elementSelector = generateSelector(htmlEl);
            const name =
              htmlEl.textContent?.trim() ||
              (el as HTMLInputElement).placeholder ||
              (el as HTMLInputElement).value ||
              (el as HTMLInputElement).name ||
              el.getAttribute('aria-label') ||
              el.tagName;

            result.push({
              name: (name as string).substring(0, 100),
              selector: elementSelector,
              role: el.getAttribute('role') || el.tagName.toLowerCase(),
              placeholder: (el as HTMLInputElement).placeholder || null,
              type: (el as HTMLInputElement).type || null,
              visible: true,
            });
          });
        });

        return result.slice(0, 50); // Limit to 50 elements
      });

      logger.success(`✓ MCP: Found ${elements.length} real interactive elements on page`);

      return {
        url,
        title,
        elements,
        pageType: this.detectPageType(title, url),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('MCP: Failed to get DOM', error);
      throw error;
    }
  }

  /**
   * Detect page type based on title and URL
   */
  private detectPageType(title: string, url: string): string {
    const lowerTitle = title.toLowerCase();
    const lowerUrl = url.toLowerCase();

    if (lowerTitle.includes('login') || lowerUrl.includes('login')) {
      return 'login';
    }
    if (lowerTitle.includes('dashboard') || lowerUrl.includes('dashboard')) {
      return 'dashboard';
    }
    if (lowerTitle.includes('checkout') || lowerUrl.includes('checkout')) {
      return 'checkout';
    }
    if (lowerTitle.includes('form') || lowerUrl.includes('form')) {
      return 'form';
    }
    return 'generic';
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      logger.debug('MCP: Browser closed');
    }
  }

  /**
   * Execute tool call
   */
  async executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    logger.debug(`MCP: Executing tool: ${toolName}`, args);

    switch (toolName) {
      case 'open_url':
        await this.openUrl(args.url as string);
        return { success: true };

      case 'get_dom_json':
        return await this.getDomJson(args.url as string);

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}

export const mcpClient = new MCPClient(process.env.MCP_SERVER_URL);
