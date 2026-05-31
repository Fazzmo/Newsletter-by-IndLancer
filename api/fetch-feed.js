// api/fetch-feed.js
// This runs on Vercel's server — no CORS restrictions at all.
// The browser calls /api/fetch-feed?url=... and this fetches the RSS
// server-side and returns the parsed articles as clean JSON.

export default async function handler(req, res) {
  // Allow requests from any origin (your own site)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { url, count = 10 } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Basic URL validation
  let feedUrl;
  try {
    feedUrl = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    // Fetch the RSS feed server-side — no CORS issues here
    const response = await fetch(feedUrl.toString(), {
      headers: {
        // Some feeds require a User-Agent header
        'User-Agent': 'Mozilla/5.0 (compatible; MyDigest/1.0; RSS Reader)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Feed returned HTTP ${response.status}` });
    }

    const xml = await response.text();

    // Parse the XML into articles
    const articles = parseRss(xml, parseInt(count), feedUrl.hostname);

    return res.status(200).json({ ok: true, articles });

  } catch (err) {
    return res.status(502).json({ error: err.message || 'Failed to fetch feed' });
  }
}

function parseRss(xml, count, fallbackName) {
  // Simple regex-based RSS/Atom parser — no external libraries needed
  const articles = [];

  // Get feed title
  const feedTitleMatch = xml.match(/<channel[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i)
    || xml.match(/<feed[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i);
  const feedTitle = feedTitleMatch
    ? stripCdata(feedTitleMatch[1]).trim()
    : fallbackName;

  // Match RSS <item> or Atom <entry> blocks
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>|<entry[\s>]([\s\S]*?)<\/entry>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null && articles.length < count) {
    const block = match[1] || match[2];

    const title = extractTag(block, 'title');
    const link  = extractLink(block);
    const date  = extractTag(block, 'pubDate')
               || extractTag(block, 'published')
               || extractTag(block, 'updated')
               || '';

    if (title) {
      articles.push({
        title: decodeHtmlEntities(stripCdata(title)).trim(),
        url:   link,
        src:   feedTitle,
        date:  date.trim(),
      });
    }
  }

  return articles;
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1] : '';
}

function extractLink(block) {
  // RSS <link>
  const rssLink = block.match(/<link>([\s\S]*?)<\/link>/i);
  if (rssLink) return stripCdata(rssLink[1]).trim();
  // Atom <link href="...">
  const atomLink = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  if (atomLink) return atomLink[1].trim();
  return '';
}

function stripCdata(str) {
  return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}
