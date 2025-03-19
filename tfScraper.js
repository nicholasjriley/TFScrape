const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// Configuration
const HTML_FOLDER = './scraped_pages'; // Output directory for HTML files
const LOGS_FOLDER = './site_logs'; // Directory for network and console logs
const GTM_FOLDER = './gtm_scripts'; // Directory for GTM scripts
const CONCURRENT_BROWSERS = 4; // Number of browser instances to run in parallel
const PAGES_PER_BROWSER = 2; // Number of pages per browser instance
const MAX_RETRIES = 3; // Maximum number of retry attempts per URL
const WAIT_AFTER_LOAD = 5000; // Time to wait after page load (ms)
const DOMAIN_COOLDOWN = 2000; // Time to wait between requests to the same domain (ms)
const MAX_NAVIGATION_LINKS = 15; // Max number of navigation links to prioritize per site
const MAX_REGULAR_LINKS = 5; // Max number of regular links per site
const NETWORK_LOG_ENABLED = true; // Enable network request/response logging
const CONSOLE_LOG_ENABLED = true; // Enable console.log capturing
const MAX_LOGS_PER_PAGE = 300; // Limit number of logs to prevent memory issues
const MAX_RESPONSE_SIZE = 800; // Limit size of response bodies (characters)
const GTM_DETECTION_ENABLED = true; // Enable Google Tag Manager detection and downloading

// Add your URLs to scrape here
const urlsToScrape = [
    // Example: 'example.com',
    // Example: 'https://website.org',
];

/**
 * Extracts and downloads Google Tag Manager scripts from a page
 * @param {Page} page - Puppeteer page object
 * @param {string} url - URL of the page
 * @param {string} outputDir - Directory to save GTM scripts
 * @returns {Promise<string[]>} - Array of saved GTM script paths
 */
async function extractGoogleTagManager(page, url, outputDir) {
    const savedScripts = [];
    
    try {
        console.log(`Looking for Google Tag Manager scripts on ${url}...`);
        
        // Find GTM scripts in the HTML
        const gtmScripts = await page.evaluate(() => {
            const results = [];
            
            // Method 1: Find script tags with GTM in the src
            const scripts = Array.from(document.querySelectorAll('script[src]'));
            scripts.forEach(script => {
                const src = script.getAttribute('src') || '';
                if (src.includes('googletagmanager.com/gtm.js') || 
                    src.includes('googletagmanager.com/gtag/js')) {
                    results.push({
                        src: src,
                        type: 'external',
                        id: (src.match(/[?&]id=([^&]+)/) || [null, 'unknown'])[1]
                    });
                }
            });
            
            // Method 2: Find inline GTM scripts
            const inlineScripts = Array.from(document.querySelectorAll('script:not([src])'));
            inlineScripts.forEach(script => {
                const content = script.textContent || '';
                
                // Look for GTM initialization
                if ((content.includes('googletagmanager.com/gtm.js') || 
                     content.includes('GTM-') || 
                     content.includes('dataLayer')) && 
                    (content.includes('new Date()') || content.includes('gtm'))) {
                    
                    let gtmId = 'unknown';
                    const idMatch = content.match(/GTM-[A-Z0-9]+/);
                    if (idMatch) {
                        gtmId = idMatch[0];
                    }
                    
                    results.push({
                        content: content,
                        type: 'inline',
                        id: gtmId
                    });
                }
                
                // Look for GA4 initialization
                if (content.includes('googletagmanager.com/gtag/js') || 
                    content.includes('gtag(') || 
                    content.includes('google-analytics')) {
                    
                    let gaId = 'unknown';
                    const gaMatch = content.match(/['"](G-[A-Z0-9]+)['"]/);
                    if (gaMatch) {
                        gaId = gaMatch[1];
                    }
                    
                    results.push({
                        content: content,
                        type: 'inline-ga4',
                        id: gaId
                    });
                }
            });
            
            // Method 3: Check for GTM containers
            const containers = document.querySelectorAll('noscript iframe[src*="googletagmanager.com"]');
            containers.forEach(container => {
                const src = container.getAttribute('src') || '';
                if (src.includes('googletagmanager.com/ns.html')) {
                    results.push({
                        src: src,
                        type: 'noscript',
                        id: (src.match(/[?&]id=([^&]+)/) || [null, 'unknown'])[1]
                    });
                }
            });
            
            return results;
        });
        
        if (gtmScripts.length === 0) {
            console.log(`No Google Tag Manager scripts found on ${url}`);
            return savedScripts;
        }
        
        console.log(`Found ${gtmScripts.length} Google Tag Manager implementation(s) on ${url}`);
        
        // Create a GTM directory if it doesn't exist
        const gtmDir = path.join(outputDir, 'gtm_scripts');
        await fs.mkdir(gtmDir, { recursive: true });
        
        // Process each GTM script
        for (const [index, script] of gtmScripts.entries()) {
            try {
                // Create a clean filename
                const baseFilename = sanitizeFilename(url);
                const gtmId = script.id.replace(/[^a-zA-Z0-9-_]/g, '');
                let scriptFilename;
                
                if (script.type === 'external') {
                    // Handle external scripts by downloading them
                    scriptFilename = `${baseFilename}_GTM-${gtmId}.js`;
                    const scriptPath = path.join(gtmDir, scriptFilename);
                    
                    // Normalize the script URL
                    let scriptUrl = script.src;
                    if (scriptUrl.startsWith('//')) {
                        scriptUrl = 'https:' + scriptUrl;
                    } else if (!scriptUrl.startsWith('http')) {
                        const urlObj = new URL(url);
                        scriptUrl = urlObj.origin + (scriptUrl.startsWith('/') ? '' : '/') + scriptUrl;
                    }
                    
                    // Fetch the script content
                    console.log(`Downloading GTM script from ${scriptUrl}...`);
                    const response = await fetch(scriptUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        },
                        timeout: 10000
                    });
                    
                    if (!response.ok) {
                        throw new Error(`Failed to fetch GTM script: ${response.status} ${response.statusText}`);
                    }
                    
                    const scriptContent = await response.text();
                    
                    // Add a comment at the top with metadata
                    const contentToSave = `/* 
 * Google Tag Manager script from: ${url}
 * Script URL: ${scriptUrl}
 * GTM ID: ${gtmId}
 * Type: External script
 * Downloaded: ${new Date().toISOString()}
 */\n\n${scriptContent}`;
                    
                    // Save the script
                    await fs.writeFile(scriptPath, contentToSave, 'utf-8');
                    console.log(`Saved external GTM script to ${scriptPath}`);
                    savedScripts.push(scriptPath);
                    
                } else if (script.type === 'inline' || script.type === 'inline-ga4') {
                    // Handle inline scripts
                    scriptFilename = `${baseFilename}_GTM-${gtmId}_inline_${index}.js`;
                    const scriptPath = path.join(gtmDir, scriptFilename);
                    
                    // Add a comment with metadata
                    const contentToSave = `/* 
 * Google Tag Manager inline script from: ${url}
 * GTM ID: ${gtmId}
 * Type: ${script.type}
 * Downloaded: ${new Date().toISOString()}
 */\n\n${script.content}`;
                    
                    // Save the script
                    await fs.writeFile(scriptPath, contentToSave, 'utf-8');
                    console.log(`Saved inline GTM script to ${scriptPath}`);
                    savedScripts.push(scriptPath);
                    
                } else if (script.type === 'noscript') {
                    // Handle noscript containers
                    scriptFilename = `${baseFilename}_GTM-${gtmId}_noscript.html`;
                    const scriptPath = path.join(gtmDir, scriptFilename);
                    
                    // Add a comment with metadata
                    const contentToSave = `<!-- 
 * Google Tag Manager noscript iframe from: ${url}
 * GTM ID: ${gtmId}
 * iframe src: ${script.src}
 * Downloaded: ${new Date().toISOString()}
 -->\n\n<noscript><iframe src="${script.src}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;
                    
                    // Save the script
                    await fs.writeFile(scriptPath, contentToSave, 'utf-8');
                    console.log(`Saved GTM noscript container to ${scriptPath}`);
                    savedScripts.push(scriptPath);
                }
                
            } catch (scriptError) {
                console.error(`Error processing GTM script: ${scriptError.message}`);
            }
        }
        
    } catch (error) {
        console.error(`Error extracting GTM scripts from ${url}: ${error.message}`);
    }
    
    return savedScripts;
}

/**
 * Safely wait on a page - compatible with different Puppeteer versions
 * @param {Page} page - Puppeteer page object
 * @param {number} timeout - Time to wait in ms
 * @returns {Promise<void>}
 */
async function safeWait(page, timeout) {
    if (typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(timeout);
    } else if (typeof page.waitFor === 'function') { 
        await page.waitFor(timeout);
    } else {
        await new Promise(resolve => setTimeout(resolve, timeout));
    }
}

/**
 * Safely remove an event listener if the function exists
 * @param {Page} page - Puppeteer page object
 * @param {string} event - Event name
 * @param {Function} listener - Listener function
 */
function safeRemoveListener(page, event, listener) {
    if (typeof page.removeListener === 'function') {
        page.removeListener(event, listener);
    } else if (typeof page.off === 'function') {
        page.off(event, listener);
    }
}

/**
 * Parse domain from URL for rate limiting
 * @param {string} url - URL to get domain from
 * @returns {string} - Domain name
 */
function getDomain(url) {
    try {
        let hostname = new URL(url).hostname;
        return hostname.replace(/^www\./, '');
    } catch (error) {
        return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    }
}

/**
 * Normalize a URL by adding protocol if missing
 * @param {string} url - URL to normalize
 * @returns {string} - Normalized URL
 */
function normalizeUrl(url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + (url.startsWith('www.') ? url : 'www.' + url);
    }
    return url;
}

/**
 * Check if two URLs belong to the same domain
 * @param {string} baseUrl - Base URL
 * @param {string} linkUrl - Link URL to check
 * @returns {boolean} - True if same domain, false otherwise
 */
function isSameDomain(baseUrl, linkUrl) {
    try {
        const baseHostname = new URL(baseUrl).hostname.replace(/^www\./, '');
        const linkHostname = new URL(linkUrl).hostname.replace(/^www\./, '');
        return baseHostname === linkHostname;
    } catch (error) {
        return false;
    }
}

/**
 * Sanitize a URL to create a valid filename
 * @param {string} url - URL to sanitize
 * @returns {string} - Sanitized filename
 */
function sanitizeFilename(url) {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.replace(/^www\./, '');
        let pathname = urlObj.pathname;
        
        if (pathname === '/' || pathname === '') {
            return hostname.replace(/[^a-zA-Z0-9]/g, '_');
        }
        
        pathname = pathname.replace(/[^a-zA-Z0-9]/g, '_')
                           .replace(/_{2,}/g, '_')
                           .replace(/^_|_$/g, '');
        
        let filename = `${hostname}${pathname}`;
        
        if (filename.length > 100) {
            filename = filename.substring(0, 100);
        }
        
        return filename;
    } catch (error) {
        return url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);
    }
}

/**
 * Extract navigation links from the page
 * @param {Page} page - Puppeteer page object
 * @param {string} baseUrl - Base URL for relative links
 * @returns {Promise<string[]>} - Array of navigation URLs
 */
async function getNavigationLinks(page, baseUrl) {
    try {
        // Selectors for navigation elements
        const navSelectors = [
            'nav', '.nav', '.navigation', '.main-navigation', 
            'header nav', '.navbar', '.menu', '[role="navigation"]',
            '.primary-menu', '.main-menu'
        ];
        
        const combinedSelector = navSelectors.join(', ');
        
        const navLinks = await page.evaluate((selector, baseUrl) => {
            const results = [];
            
            const navElements = document.querySelectorAll(selector);
            
            for (const nav of navElements) {
                const anchors = nav.querySelectorAll('a[href]');
                
                for (const anchor of anchors) {
                    try {
                        const href = anchor.href;
                        if (!href || 
                            href.startsWith('javascript:') || 
                            href.startsWith('mailto:') || 
                            href.startsWith('tel:') ||
                            href.startsWith('#')) {
                            continue;
                        }
                        
                        results.push(href);
                    } catch (e) {
                        // Skip problematic links
                    }
                }
            }
            
            return [...new Set(results)]; // Remove duplicates
        }, combinedSelector, baseUrl);
        
        // Filter to only include links from the same domain
        return navLinks.filter(link => isSameDomain(baseUrl, link));
            
    } catch (error) {
        console.error(`Error getting navigation links:`, error.message);
        return [];
    }
}

/**
 * Extract all links from the page
 * @param {Page} page - Puppeteer page object
 * @param {string} baseUrl - Base URL of the website
 * @returns {Promise<string[]>} - Array of URLs from the page
 */
async function getAllLinks(page, baseUrl) {
    try {
        const links = await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a[href]'));
            return anchors
                .map(anchor => {
                    try {
                        const href = anchor.href;
                        if (!href || 
                            href.startsWith('javascript:') || 
                            href.startsWith('mailto:') || 
                            href.startsWith('tel:') ||
                            href.startsWith('#')) {
                            return null;
                        }
                        return href;
                    } catch (e) {
                        return null;
                    }
                })
                .filter(href => href !== null);
        });

        // Filter to only include URLs from the same domain
        return [...new Set(links.filter(link => isSameDomain(baseUrl, link)))];
    } catch (error) {
        console.error(`Error getting all links:`, error.message);
        return [];
    }
}

/**
 * Initialize log directories
 */
async function setupDirectories() {
    await fs.mkdir(HTML_FOLDER, { recursive: true });
    await fs.mkdir(LOGS_FOLDER, { recursive: true });
    await fs.mkdir(path.join(HTML_FOLDER, 'gtm_scripts'), { recursive: true });
    console.log(`Set up directories: ${HTML_FOLDER}, ${LOGS_FOLDER}, ${path.join(HTML_FOLDER, 'gtm_scripts')}`);
}

/**
 * Domain-based rate limiter to ensure we don't overwhelm any single site
 */
class DomainRateLimiter {
    constructor(cooldownMs = 5000) {
        this.cooldownMs = cooldownMs;
        this.lastAccessTime = new Map();
    }

    /**
     * Check and wait if necessary before accessing a domain
     * @param {string} domain - Domain name
     * @returns {Promise<void>} - Resolves when ready to access
     */
    async waitForReady(domain) {
        const now = Date.now();
        const lastAccess = this.lastAccessTime.get(domain);
        
        if (lastAccess) {
            const elapsed = now - lastAccess;
            
            if (elapsed < this.cooldownMs) {
                const waitTime = this.cooldownMs - elapsed;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
        
        this.markAccessed(domain);
    }

    /**
     * Mark a domain as accessed
     * @param {string} domain - Domain name
     */
    markAccessed(domain) {
        this.lastAccessTime.set(domain, Date.now());
    }
}

/**
 * Browser pool for parallel processing
 */
class BrowserPool {
    constructor(maxBrowsers = 2, pagesPerBrowser = 2) {
        this.maxBrowsers = maxBrowsers;
        this.pagesPerBrowser = pagesPerBrowser;
        this.browsers = [];
        this.availablePages = [];
        this.rateLimiter = new DomainRateLimiter(DOMAIN_COOLDOWN);
    }

    /**
     * Initialize the browser pool
     */
    async initialize() {
        console.log(`Initializing browser pool with ${this.maxBrowsers} browsers, ${this.pagesPerBrowser} pages each...`);
        
        const browserPromises = [];
        for (let i = 0; i < this.maxBrowsers; i++) {
            browserPromises.push(this.createBrowser(i));
        }
        
        await Promise.all(browserPromises);
        console.log(`Browser pool initialized with ${this.availablePages.length} available pages`);
    }

    /**
     * Create a browser instance with pages
     */
    async createBrowser(index) {
        try {
            const browser = await puppeteer.launch({ 
                headless: true,
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--ignore-certificate-errors',
                    '--disable-web-security'
                ],
                ignoreHTTPSErrors: true
            });
            
            this.browsers.push(browser);
            
            // Create multiple pages
            for (let j = 0; j < this.pagesPerBrowser; j++) {
                const page = await browser.newPage();
                await page.setDefaultNavigationTimeout(30000);
                
                await page.setRequestInterception(true);
                
                const interceptionHandler = request => {
                    const resourceType = request.resourceType();
                    if (resourceType === 'image' || resourceType === 'font' || resourceType === 'stylesheet') {
                        request.abort();
                    } else {
                        request.continue();
                    }
                };
                
                page.on('request', interceptionHandler);
                
                this.availablePages.push({
                    page,
                    browserId: index,
                    pageId: j,
                    inUse: false,
                    interceptionHandler
                });
            }
            
        } catch (error) {
            console.error(`Error creating browser ${index}:`, error.message);
        }
    }

    /**
     * Get an available page from the pool
     * @returns {Promise<Object|null>} - Page object or null if none available
     */
    async getPage() {
        const pageEntry = this.availablePages.find(entry => !entry.inUse);
        
        if (!pageEntry) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return this.getPage();
        }
        
        pageEntry.inUse = true;
        return pageEntry;
    }

    /**
     * Release a page back to the pool
     * @param {Object} pageEntry - Page entry to release
     */
    releasePage(pageEntry) {
        const entry = this.availablePages.find(
            p => p.browserId === pageEntry.browserId && p.pageId === pageEntry.pageId
        );
        
        if (entry) {
            entry.inUse = false;
        }
    }

    /**
     * Scrape a URL using an available page
     * @param {string} url - URL to scrape
     * @returns {Promise<boolean>} - Success status
     */
    async scrapeUrl(url) {
        const normalizedUrl = normalizeUrl(url);
        const domain = getDomain(normalizedUrl);
        
        await this.rateLimiter.waitForReady(domain);
        
        const pageEntry = await this.getPage();
        if (!pageEntry) {
            console.error(`Could not get an available page for ${url}`);
            return false;
        }
        
        const { page, browserId, pageId, interceptionHandler } = pageEntry;
        
        try {
            console.log(`[Browser ${browserId}, Page ${pageId}] Processing ${normalizedUrl}`);
            
            const networkLogs = [];
            const consoleLogs = [];
            
            let networkRequestHandler = null;
            let networkResponseHandler = null;
            let consoleHandler = null;
            
            if (NETWORK_LOG_ENABLED) {
                networkRequestHandler = request => {
                    if (networkLogs.length >= MAX_LOGS_PER_PAGE) return;
                    
                    const resourceType = request.resourceType();
                    if (resourceType === 'document' || 
                        resourceType === 'script' || 
                        resourceType === 'xhr' || 
                        resourceType === 'fetch') {
                        networkLogs.push({
                            type: 'request',
                            url: request.url(),
                            method: request.method(),
                            resourceType: request.resourceType(),
                            timestamp: new Date().toISOString()
                        });
                    }
                };
                
                networkResponseHandler = async response => {
                    if (networkLogs.length >= MAX_LOGS_PER_PAGE) return;
                    
                    const request = response.request();
                    const resourceType = request.resourceType();
                    
                    if (resourceType === 'document' || 
                        resourceType === 'script' || 
                        resourceType === 'xhr' || 
                        resourceType === 'fetch') {
                        
                        let responseBody = '';
                        try {
                            const contentType = response.headers()['content-type'] || '';
                            if (contentType.includes('application/json') || 
                                contentType.includes('application/javascript')) {
                                const text = await response.text().catch(() => '');
                                responseBody = text.substring(0, MAX_RESPONSE_SIZE); 
                            }
                        } catch (e) {
                            responseBody = '[Error getting response body]';
                        }
                        
                        networkLogs.push({
                            type: 'response',
                            url: response.url(),
                            status: response.status(),
                            contentType: response.headers()['content-type'],
                            body: responseBody,
                            timestamp: new Date().toISOString()
                        });
                    }
                };
                
                page.on('request', networkRequestHandler);
                page.on('response', networkResponseHandler);
            }
            
            if (CONSOLE_LOG_ENABLED) {
                consoleHandler = message => {
                    if (consoleLogs.length >= MAX_LOGS_PER_PAGE) return;
                    
                    consoleLogs.push({
                        type: message.type(),
                        text: message.text(),
                        timestamp: new Date().toISOString()
                    });
                };
                
                page.on('console', consoleHandler);
            }
            
            console.log(`[Browser ${browserId}, Page ${pageId}] Navigating to ${normalizedUrl}...`);
            await page.goto(normalizedUrl, { 
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            
            await safeWait(page, WAIT_AFTER_LOAD);
            
            const html = await page.content();
            
            const baseFilename = sanitizeFilename(normalizedUrl);
            const htmlFilePath = path.join(HTML_FOLDER, `${baseFilename}.html`);
            
            const contentToSave = `<!-- URL: ${normalizedUrl} -->\n${html}`;
            await fs.writeFile(htmlFilePath, contentToSave, 'utf-8');
            console.log(`[Browser ${browserId}, Page ${pageId}] Saved HTML for ${normalizedUrl}`);
            
            if (GTM_DETECTION_ENABLED) {
                const gtmScripts = await extractGoogleTagManager(page, normalizedUrl, HTML_FOLDER);
                if (gtmScripts.length > 0) {
                    console.log(`[Browser ${browserId}, Page ${pageId}] Downloaded ${gtmScripts.length} GTM script(s) for ${normalizedUrl}`);
                }
            }
            
            if (NETWORK_LOG_ENABLED && networkLogs.length > 0) {
                const networkLogPath = path.join(LOGS_FOLDER, `${baseFilename}_network.json`);
                await fs.writeFile(networkLogPath, JSON.stringify(networkLogs, null, 2), 'utf-8');
                console.log(`[Browser ${browserId}, Page ${pageId}] Saved ${networkLogs.length} network logs`);
            }
            
            if (CONSOLE_LOG_ENABLED && consoleLogs.length > 0) {
                const consoleLogPath = path.join(LOGS_FOLDER, `${baseFilename}_console.json`);
                await fs.writeFile(consoleLogPath, JSON.stringify(consoleLogs, null, 2), 'utf-8');
                console.log(`[Browser ${browserId}, Page ${pageId}] Saved ${consoleLogs.length} console logs`);
            }
            
            const navLinks = await getNavigationLinks(page, normalizedUrl);
            const allLinks = await getAllLinks(page, normalizedUrl);
            
            let linksToVisit = [...navLinks.slice(0, MAX_NAVIGATION_LINKS)];
            const remainingLinks = allLinks.filter(link => !linksToVisit.includes(link));
            linksToVisit = [...linksToVisit, ...remainingLinks.slice(0, MAX_REGULAR_LINKS)];
            
            const linksFilePath = path.join(LOGS_FOLDER, `${baseFilename}_links.json`);
            await fs.writeFile(linksFilePath, JSON.stringify({
                url: normalizedUrl,
                navigationLinks: navLinks,
                allLinks: allLinks,
                selectedLinks: linksToVisit
            }, null, 2), 'utf-8');
            
            for (let i = 0; i < linksToVisit.length; i++) {
                const link = linksToVisit[i];
                const linkDomain = getDomain(link);
                
                await this.rateLimiter.waitForReady(linkDomain);
                
                try {
                    console.log(`[Browser ${browserId}, Page ${pageId}] Visiting ${i+1}/${linksToVisit.length}: ${link}`);
                    
                    await page.goto(link, { 
                        waitUntil: 'networkidle2',
                        timeout: 30000
                    });
                    
                    await safeWait(page, WAIT_AFTER_LOAD);
                    
                    const subpageHtml = await page.content();
                    
                    const subpageFilename = sanitizeFilename(link);
                    const subpageFilePath = path.join(HTML_FOLDER, `${subpageFilename}.html`);
                    
                    const subpageContentToSave = `<!-- URL: ${link} -->\n${subpageHtml}`;
                    await fs.writeFile(subpageFilePath, subpageContentToSave, 'utf-8');
                    
                    if (GTM_DETECTION_ENABLED) {
                        const subpageGtmScripts = await extractGoogleTagManager(page, link, HTML_FOLDER);
                        if (subpageGtmScripts.length > 0) {
                            console.log(`[Browser ${browserId}, Page ${pageId}] Downloaded ${subpageGtmScripts.length} GTM script(s) for ${link}`);
                        }
                    }
                    
                } catch (subpageError) {
                    console.error(`[Browser ${browserId}, Page ${pageId}] Error with subpage ${link}: ${subpageError.message}`);
                }
                
                this.rateLimiter.markAccessed(linkDomain);
            }
            
            console.log(`[Browser ${browserId}, Page ${pageId}] Completed ${normalizedUrl}`);
            
            if (NETWORK_LOG_ENABLED) {
                if (networkRequestHandler) safeRemoveListener(page, 'request', networkRequestHandler);
                if (networkResponseHandler) safeRemoveListener(page, 'response', networkResponseHandler);
            }
            
            if (CONSOLE_LOG_ENABLED && consoleHandler) {
                safeRemoveListener(page, 'console', consoleHandler);
            }
            
            networkLogs.length = 0;
            consoleLogs.length = 0;
            
            return true;
            
        } catch (error) {
            console.error(`[Browser ${browserId}, Page ${pageId}] Error scraping ${normalizedUrl}: ${error.message}`);
            return false;
        } finally {
            this.releasePage(pageEntry);
        }
    }

    /**
     * Close all browser instances
     */
    async close() {
        console.log('Closing all browsers...');
        
        for (const browser of this.browsers) {
            try {
                await browser.close();
            } catch (error) {
                console.error('Error closing browser:', error.message);
            }
        }
        
        console.log('All browsers closed');
    }
}

/**
 * Main function to process all URLs with parallel processing
 */
async function main() {
    try {
        console.log(`Starting tfScraper...`);
        console.log(`System: ${os.platform()} with ${os.cpus().length} CPU cores and ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB RAM`);
        console.log(`Configuration: ${CONCURRENT_BROWSERS} browsers with ${PAGES_PER_BROWSER} pages each (${CONCURRENT_BROWSERS * PAGES_PER_BROWSER} total concurrent pages)`);
        
        await setupDirectories();
        
        const pool = new BrowserPool(CONCURRENT_BROWSERS, PAGES_PER_BROWSER);
        await pool.initialize();
        
        const normalizedUrls = urlsToScrape.map(url => normalizeUrl(url));
        console.log(`Processing ${normalizedUrls.length} URLs`);
        
        const chunkSize = CONCURRENT_BROWSERS * PAGES_PER_BROWSER;
        let completed = 0;
        let successful = 0;
        
        for (let i = 0; i < normalizedUrls.length; i += chunkSize) {
            const chunk = normalizedUrls.slice(i, i + chunkSize);
            console.log(`Processing chunk ${Math.floor(i/chunkSize) + 1}/${Math.ceil(normalizedUrls.length/chunkSize)} (${chunk.length} URLs)`);
            
            const results = await Promise.all(
                chunk.map(url => pool.scrapeUrl(url))
            );
            
            completed += chunk.length;
            successful += results.filter(Boolean).length;
            
            console.log(`Progress: ${completed}/${normalizedUrls.length} (${Math.round(completed/normalizedUrls.length*100)}%) - ${successful} successful`);
            
            if (i + chunkSize < normalizedUrls.length) {
                console.log("Pausing for memory cleanup...");
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        
        await pool.close();
        
        console.log(`\nScraping completed!`);
        console.log(`- Total URLs: ${normalizedUrls.length}`);
        console.log(`- Successfully scraped: ${successful}`);
        console.log(`- Failed: ${normalizedUrls.length - successful}`);
        
    } catch (error) {
        console.error('Fatal error:', error);
    }
}

// Run the script
main().catch(console.error);