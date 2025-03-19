# tfScraper

A high-performance, parallel web scraper built with Puppeteer that focuses on efficient website data collection, including Google Tag Manager script extraction.

## 🚀 Features

- **Parallel Processing**: Run multiple browser instances and pages concurrently for high-throughput scraping
- **Smart Navigation**: Intelligently prioritizes navigation and content links
- **Tag Manager Detection**: Automatically detects and downloads Google Tag Manager implementations
- **Domain-Aware Rate Limiting**: Prevents overwhelming target websites
- **Network & Console Logging**: Captures network requests/responses and console messages
- **Memory-Efficient**: Designed for handling large scraping jobs with minimal resource usage

## 📋 Requirements

- Node.js 14+ 
- NPM or Yarn

## 🔧 Installation

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/tfScraper.git
   cd tfScraper
   ```

2. Install dependencies:
   ```
   npm install
   ```
   
3. Required dependencies:
   - puppeteer
   - fs
   - path
   - os

## ⚙️ Configuration

Edit the configuration variables at the top of `tfScraper.js`:

| Setting | Default | Description |
|---------|---------|-------------|
| `HTML_FOLDER` | `./scraped_pages` | Directory for HTML output |
| `LOGS_FOLDER` | `./site_logs` | Directory for logs |
| `GTM_FOLDER` | `./gtm_scripts` | Directory for Google Tag Manager scripts |
| `CONCURRENT_BROWSERS` | `4` | Number of browser instances to run |
| `PAGES_PER_BROWSER` | `2` | Pages per browser (total concurrency = BROWSERS × PAGES) |
| `WAIT_AFTER_LOAD` | `5000` | Time to wait after page load (ms) |
| `DOMAIN_COOLDOWN` | `2000` | Time between requests to same domain (ms) |
| `MAX_NAVIGATION_LINKS` | `15` | Max navigation links to follow per site |
| `MAX_REGULAR_LINKS` | `5` | Max regular links to follow per site |
| `NETWORK_LOG_ENABLED` | `true` | Enable network request logging |
| `CONSOLE_LOG_ENABLED` | `true` | Enable console message logging |
| `GTM_DETECTION_ENABLED` | `true` | Enable Google Tag Manager detection |

## 📝 Usage

1. Add target URLs to the `urlsToScrape` array:

```javascript
const urlsToScrape = [
    'example.com',
    'https://website.org',
    // Add more URLs
];
```

2. Run the scraper:

```
node tfScraper.js
```

For memory-intensive jobs with many URLs:

```
node --max-old-space-size=4096 tfScraper.js
```

## 📋 Example

```javascript
const urlsToScrape = [
    'amazon.com',
    'microsoft.com',
    'netflix.com',
    'shopify.com',
    'atlassian.com'
];
```

When executed, tfScraper will:

1. Create necessary directories for output
2. Initialize browser pool with concurrent instances
3. Process URLs in parallel with domain-aware rate limiting
4. For each URL:
   - Save the rendered HTML
   - Extract and save Google Tag Manager scripts
   - Log network requests and console messages
   - Find and follow navigation and content links
   - Process subpages from the discovered links
5. Generate a summary of successful and failed scrapes

## 📄 Output Structure

The scraper generates the following output structure:

```
./scraped_pages/
  ├── domain_path.html           # Main page HTML
  ├── domain_subpath.html        # Subpage HTML
  └── gtm_scripts/
      ├── domain_GTM-XXXXXX.js   # External GTM scripts
      └── domain_GTM-XXXXXX_inline_0.js  # Inline GTM implementations
      
./site_logs/
  ├── domain_path_network.json   # Network request logs
  ├── domain_path_console.json   # Console message logs
  └── domain_path_links.json     # Discovered links
```

## 🔍 Advanced Features

### Google Tag Manager Detection

tfScraper detects and extracts:
- External GTM script tags
- Inline GTM implementations
- GA4 configurations
- Noscript iframe containers

### Browser Pool Management

The tool intelligently manages browser and page resources:
- Creates a pool of browser instances
- Distributes load across browsers
- Manages page availability for optimal throughput
- Handles proper cleanup to prevent memory leaks

### Smart Link Following

tfScraper prioritizes:
1. Navigation links (menus, headers)
2. Same-domain content links
3. Respects per-domain rate limits

## 🛠 Troubleshooting

### High Memory Usage

If experiencing high memory usage:
- Decrease `CONCURRENT_BROWSERS` and `PAGES_PER_BROWSER`
- Increase `DOMAIN_COOLDOWN` to slow the rate of requests
- Process URLs in smaller batches
- Run with increased Node.js memory: `node --max-old-space-size=8192 tfScraper.js`

### Timeouts or Failed Scrapes

If experiencing timeouts:
- Increase timeout values in the `page.goto()` options
- Check network connectivity
- Some sites may be blocking scraping attempts

## 📜 License

MIT License

## 🤝 Contributing

Contributions welcome! Please feel free to submit a Pull Request.
