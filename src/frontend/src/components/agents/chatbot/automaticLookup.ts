import { SendOptions } from "./types";

/**
 * Route only the current, standalone public question. This is a conservative
 * convenience rule, not a PHI detector or permission to use sensitive data.
 * No conversation, attachment, model call or persistent state is consulted.
 */
export function automaticLookup(text: string): Pick<SendOptions, "webQuery" | "webUrls"> | undefined {
  const query = text.trim();
  if (query.length < 3 || query.length > 1000 || /[\r\n]/.test(query)) return;
  if (/\b(?:do not|don't|without|no)\s+(?:(?:use|using|any)\s+)?(?:the\s+)?(?:web|internet|browse|browsing|search|searching|lookup|look up)\b|\b(?:offline|from memory)\b/i.test(query)) return;
  // Avoid sending patient/organizational context, identifiers, secrets, pasted
  // records, or a follow-up that would need missing conversation context.
  if (/\b(?:patient|patients|mrn|dob|ssn|password|secret|token|api[ -]?key|confidential|private|internal|clinic|account|tenant|subscription|invoice|billing|balance|employee|staff|customer|attachment|uploaded|record|records|chart|charts|synthetic|fictional|hypothetical)\b/i.test(query)
      || /\b(?:my|our|we|he|she|him|her|they|them|their|above|previous|earlier)\b/i.test(query)
      || /\b(?:it|its|that|these|those)\b|\bthis\b(?!\s+(?:week|month|year|morning|afternoon|evening)\b)/i.test(query)
      || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b\d[\d ().+-]{5,}\d\b|```|[{}]/i.test(query)
      || /^(?:please\s+)?(?:translate|rewrite|rephrase|summarize|correct|edit|draw|generate|imagine|calculate|solve)\b/i.test(query)) return;

  if (/^https:\/\//i.test(query)) {
    try {
      const url = new URL(query);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
          || url.port && url.port !== "443" || /[\\\s]/.test(query) || !url.hostname.includes(".")
          || /^\[|^\d+(?:\.\d+){3}$/.test(url.hostname)
          || /\.(?:local|internal|localhost|test|invalid)$|\.$/i.test(url.hostname)) return;
      return { webUrls: [query] };
    } catch { return; }
  }
  // Embedded URLs may carry access tokens or need a user-selected reading task.
  if (/https?:\/\/|www\./i.test(query)) return;
  const fresh = /\b(?:today|tonight|tomorrow|yesterday|latest|currently|current|recent|news|weather|forecast|prices?|pricing|exchange rates?|interest rates?|stock (?:quote|price)|outage|outages|election|elections|president|prime minister|governor|mayor|ceo|guidelines|regulations|legislation|recalls|advisories)\b|\b(?:right now|this (?:week|month|year|morning|afternoon|evening)|up[ -]to[ -]date)\b/i;
  const requested = /\b(?:search (?:the )?(?:web|internet|online)|look up|lookup|browse|find online|check online|verify online)\b/i;
  if (fresh.test(query) || requested.test(query)) return { webQuery: query };
}
