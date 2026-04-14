/**
 * Fetch Metabase data and save as static JSON files.
 * Runs via GitHub Actions at midnight BRT.
 *
 * Required env vars:
 *   METABASE_URL       - e.g. https://metabase.livocompany.com
 *   METABASE_API_KEY   - Metabase API key
 */

const fs = require('fs');
const path = require('path');

const METABASE_URL = process.env.METABASE_URL;
const API_KEY = process.env.METABASE_API_KEY;

const QUERIES = {
  sales: '9377',
  storeStock: '9309'
};

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

async function fetchQuery(questionId, retries = MAX_RETRIES) {
  const url = `${METABASE_URL}/api/card/${questionId}/query/json`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        if (response.status >= 500 && attempt < retries) {
          console.log(`  Query ${questionId} attempt ${attempt}/${retries}: HTTP ${response.status}, retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`  Query ${questionId}: OK (${data.length} rows)`);
      return data;
    } catch (error) {
      if (attempt < retries) {
        console.log(`  Query ${questionId} attempt ${attempt}/${retries}: ${error.message}, retrying...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
        continue;
      }
      throw error;
    }
  }
}

async function main() {
  if (!METABASE_URL || !API_KEY) {
    console.error('Missing METABASE_URL or METABASE_API_KEY environment variables.');
    process.exit(1);
  }

  console.log(`Fetching data from ${METABASE_URL}...`);

  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  try {
    console.log('Fetching sales data (query 9377)...');
    const salesData = await fetchQuery(QUERIES.sales);

    console.log('Fetching store stock data (query 9309)...');
    const storeStockData = await fetchQuery(QUERIES.storeStock);

    // Save data files
    fs.writeFileSync(
      path.join(dataDir, 'sales-data.json'),
      JSON.stringify(salesData, null, 0)
    );
    fs.writeFileSync(
      path.join(dataDir, 'store-stock-data.json'),
      JSON.stringify(storeStockData, null, 0)
    );

    // Save metadata
    const meta = {
      lastUpdate: new Date().toISOString(),
      salesRows: salesData.length,
      storeStockRows: storeStockData.length
    };
    fs.writeFileSync(
      path.join(dataDir, 'meta.json'),
      JSON.stringify(meta, null, 2)
    );

    console.log(`Done. Sales: ${salesData.length} rows, Stock: ${storeStockData.length} rows.`);
    console.log(`Updated at: ${meta.lastUpdate}`);

  } catch (error) {
    console.error('Failed to fetch data:', error.message);
    process.exit(1);
  }
}

main();
