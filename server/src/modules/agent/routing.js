const MEMORY = /\b(remember|previous|earlier|last (?:week|month|monday|tuesday|time)|on \d{1,2} [a-z]+|what did i ask|our (?:decision|discussion)|changed since|continue|where we (?:left|stopped)|same approach|compare (?:this|that|it) with|what did we|what was the)\b/i;
const WEB = /\b(current|currently|today|latest|newest|price|pricing|changed|shipped|release|recent|now)\b/i;
const STABLE_FACT = /\b(what is|who is|when was|where is|how does|explain|define|calculate|write|show me|help me)\b/i;
export function routeIntent(text) {
  const memory = MEMORY.test(text);
  const web = WEB.test(text) || (!STABLE_FACT.test(text) && /\b(as of|in \d{4}|this year|updated|version|supported)\b/i.test(text));
  return { memory, web, intent: memory && web ? 'historical_current_comparison' : memory ? 'historical_retrieval' : web ? 'current_research' : 'conversation' };
}
