import axios from 'axios';

/**
 * Search Service for AISA
 * Integrates with external search APIs for real-time information
 */

const SEARCH_API_KEY = process.env.SEARCH_API_KEY || '';
const SEARCH_ENGINE_ID = process.env.SEARCH_ENGINE_ID || '';
const SEARCH_PROVIDER = process.env.SEARCH_PROVIDER || 'google'; // google, serpapi, bing

/**
 * Perform web search using configured provider
 */
export async function performWebSearch(query, maxResults = 5) {
    try {
        console.log(`[SEARCH] Performing web search for: "${query}"`);

        if (SEARCH_PROVIDER === 'google' && SEARCH_API_KEY && SEARCH_ENGINE_ID) {
            return await googleCustomSearch(query, maxResults);
        } else if (SEARCH_PROVIDER === 'serpapi' && SEARCH_API_KEY) {
            return await serpApiSearch(query, maxResults);
        } else {
            // Fallback: return mock data for testing
            console.warn('[SEARCH] No API key configured, using mock data');
            return getMockSearchResults(query);
        }
    } catch (error) {
        console.error('[SEARCH] Error performing web search:', error);
        return null;
    }
}

/**
 * Google Custom Search API
 */
async function googleCustomSearch(query, maxResults) {
    const url = 'https://www.googleapis.com/customsearch/v1';

    const response = await axios.get(url, {
        params: {
            key: SEARCH_API_KEY,
            cx: SEARCH_ENGINE_ID,
            q: query,
            num: maxResults
        }
    });

    if (!response.data.items) {
        return null;
    }

    return {
        results: response.data.items.map(item => ({
            title: item.title,
            snippet: item.snippet,
            link: item.link,
            source: extractDomain(item.link)
        }))
    };
}

/**
 * SerpAPI Search
 */
async function serpApiSearch(query, maxResults) {
    const url = 'https://serpapi.com/search';

    const response = await axios.get(url, {
        params: {
            api_key: SEARCH_API_KEY,
            q: query,
            num: maxResults,
            engine: 'google'
        }
    });

    if (!response.data.organic_results) {
        return null;
    }

    return {
        results: response.data.organic_results.map(item => ({
            title: item.title,
            snippet: item.snippet,
            link: item.link,
            source: extractDomain(item.link)
        }))
    };
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace('www.', '');
    } catch {
        return 'Unknown Source';
    }
}

/**
 * Mock search results for testing (when no API key)
 */
function getMockSearchResults(query) {
    return {
        results: [
            {
                title: `Latest information about ${query}`,
                snippet: `This is a mock search result for "${query}". Configure SEARCH_API_KEY and SEARCH_ENGINE_ID in .env to enable real web search.`,
                link: 'https://example.com',
                source: 'example.com'
            }
        ]
    };
}

export { SEARCH_API_KEY, SEARCH_ENGINE_ID, SEARCH_PROVIDER };
