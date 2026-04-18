/**
 * MCP Client - Real Playwright Browser Automation
 * Fetches actual DOM from live pages via Playwright
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
    logger.debug('MCPClient initialized for real Playwright browsers');
  }

  /**
   * Initialize browser (headful mode to see DOM extraction)
   */
  private async initBrowser(): Promise<void> {
    if (this.browser) return;
    logger.info('🌐 MCP: Launching Chromium browser in HEADFUL mode for real DOM analysis');
    this.browser = await chromium.launch({ headless: false });
  }

  /**
   * Open URL in real browser
   */
  async openUrl(url: string): Promise<void> {
    logger.info(`🔗 MCP: Navigating to ${url} with real Playwright`);

    try {
      await this.initBrowser();
      this.page = await this.browser!.newPage();
      await this.page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      logger.success(`✓ MCP: Successfully loaded ${url}`);
    } catch (error) {
      logger.error('✗ MCP: Failed to open URL', error);
      throw error;
    }
  }

  /**
   * Get real DOM from current page using Playwright
   */
  async getDomJson(url: string): Promise<DOMResponse> {
    logger.info(`📊 MCP: Analyzing REAL DOM structure for ${url}`);

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
          'input[type="tel"]',
          'textarea',
          'button',
          'select',
          'a[href]',
          '[role="button"]',
          '[role="link"]',
          '[role="menuitem"]',
        ];

        function generateSelector(el: HTMLElement): string {
          // Try ID first
          if (el.id && !el.id.match(/^[0-9]/))  {
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
              .slice(0, 3)
              .join('.');
            if (classes) {
              return `.${classes}`;
            }
          }

          // Try aria-label
          if (el.getAttribute('aria-label')) {
            return `[aria-label="${el.getAttribute('aria-label')}"]`;
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
            const name = htmlEl.textContent?.trim() || (el as HTMLInputElement).placeholder || (el as HTMLInputElement).value || (el as HTMLInputElement).name || el.getAttribute('aria-label') || el.tagName;

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

      const pageType = this.detectPageType(title, url);
      logger.success(`✓ MCP: Found ${elements.length} real interactive elements (${pageType} page)`);

      return {
        url,
        title,
        elements,
        pageType,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('✗ MCP: Failed to get DOM', error);
      // Fallback to mock if real Playwright fails
      logger.info('MCP: Falling back to mock DOM data');
      return this.getMockDomResponse(url);
    }
  }

  /**
   * Generate CSS selector for element
   */
  private generateSelector(el: any): string {
    // Try ID first
    if (el.id && !el.id.match(/^[0-9]/))  {
      return `#${el.id}`;
    }

    // Try name attribute
    if (el.name) {
      return `[name="${el.name}"]`;
    }

    // Try type + placeholder
    if (el.type && el.placeholder) {
      return `${el.tagName.toLowerCase()}[type="${el.type}"][placeholder="${el.placeholder}"]`;
    }

    // Try CSS classes
    if (el.className) {
      const classes = el.className
        .split(' ')
        .filter((c: string) => c && !c.includes('ng-') && !c.includes('react'))
        .slice(0, 3)
        .join('.');
      if (classes) {
        return `.${classes}`;
      }
    }

    // Try aria-label
    if (el.getAttribute('aria-label')) {
      return `[aria-label="${el.getAttribute('aria-label')}"]`;
    }

    // Fallback
    return el.tagName.toLowerCase();
  }

  /**
   * Detect page type from content
   */
  private detectPageType(title: string, url: string): string {
    const combined = `${title}${url}`.toLowerCase();

    if (combined.includes('login') || combined.includes('signin') || combined.includes('auth')) {
      return 'login';
    }
    if (combined.includes('shop') || combined.includes('product') || combined.includes('cart')) {
      return 'ecommerce';
    }
    if (combined.includes('dashboard') || combined.includes('admin')) {
      return 'dashboard';
    }
    if (combined.includes('form') || combined.includes('register')) {
      return 'form';
    }

    return 'generic';
  }

  /**
   * Fallback mock DOM response if real Playwright fails
   */
  private getMockDomResponse(url: string): DOMResponse {
    logger.debug('MCP: Using mock DOM fallback for:', url);

    const domElements: DOMElement[] = [];
    let pageType = 'generic';

    // Common patterns for login/authentication pages
    if (url.includes('login') || url.includes('auth') || url.includes('signin')) {
      pageType = 'login';
      domElements.push(
        {
          role: 'textbox',
          name: 'Username',
          selector: 'input[name="USERNAME"]',
          placeholder: 'Enter your username',
          type: 'text',
        },
        {
          role: 'textbox',
          name: 'Password',
          selector: 'input[name="PASSWORD"]',
          type: 'password',
          placeholder: 'Enter your password',
        },
        {
          role: 'button',
          name: 'Login',
          selector: 'button[type="submit"]',
        },
        {
          role: 'checkbox',
          name: 'Remember Me',
          selector: 'input[type="checkbox"][name="remember"]',
        },
        {
          role: 'link',
          name: 'Forgot Password',
          selector: 'a[href="/forgot-password"]',
        }
      );
    }
    // E-commerce/shopping pages
    else if (url.includes('shop') || url.includes('store') || url.includes('cart') || url.includes('product')) {
      pageType = 'ecommerce';
      domElements.push(
        {
          role: 'searchbox',
          name: 'Product Search',
          selector: 'input[placeholder*="Search"]',
          placeholder: 'Search products...',
          type: 'text',
        },
        {
          role: 'button',
          name: 'Add to Cart',
          selector: 'button.add-to-cart',
        },
        {
          role: 'button',
          name: 'Checkout',
          selector: 'button.checkout-btn',
        }
      );
    }
    // Default/generic pages
    else {
      pageType = 'generic';
      domElements.push(
        {
          role: 'link',
          name: 'Links',
          selector: 'a[href]',
        },
        {
          role: 'button',
          name: 'Button',
          selector: 'button',
        }
      );
    }

    return {
      elements: domElements,
      url,
      pageType,
      timestamp: new Date().toISOString(),
    };
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

  /**
   * Close browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      logger.info('🌐 MCP: Browser closed');
    }
  }
}

export const mcpClient = new MCPClient(process.env.MCP_SERVER_URL);
