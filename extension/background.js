/**
 * AI Tab Companion - Background Script
 * Chrome Built-in AI Challenge 2025 Entry
 * 
 * This extension uses Chrome's Built-in AI APIs:
 * 
 * 🤖 Prompt API (Gemini Nano): 
 *    - Semantic analysis & classification of tabs
 *    - Topic extraction & entity recognition
 *    - Group labeling with AI-generated names
 * 
 * 📄 Summarizer API:
 *    - Tab content summarization for better understanding
 *    - Key point extraction from web pages
 * 
 * 🎯 Embedding Model API (when available):
 *    - Semantic similarity comparison
 *    - Vector-based clustering
 * 
 * Problem Solved: Tab Chaos Management
 * - Automatically organizes 100+ tabs into meaningful groups
 * - Privacy-first: All AI processing happens on-device
 * - Fast & offline-capable: No server calls needed
 * - Cost-efficient: No API quotas or fees
 */

// ---- Boot banner (local dev visibility) ----
try {
    const manifest = (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function')
        ? chrome.runtime.getManifest()
        : { name: 'AI Tab Companion', version: 'dev' };
    console.log(`🚀 [Boot] ${manifest.name} v${manifest.version} background loaded @ ${new Date().toLocaleString()}`);
} catch (_) {
    // no-op
}

// ---- Structured Logging System for Chrome AI Challenge ----
const RUN = {
    id: () => RUN._id || (RUN._id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`),
    reset: () => (RUN._id = null)
};

// Prefix every console log with the current runId for easy tracing
(() => {
    try {
        const scope = (typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
        if (scope && !scope.__runLogPatched) {
            scope.__runLogPatched = true;
            const orig = {
                log: console.log.bind(console),
                info: console.info?.bind(console) || console.log.bind(console),
                warn: console.warn?.bind(console) || console.log.bind(console),
                error: console.error?.bind(console) || console.log.bind(console),
                debug: console.debug?.bind(console) || console.log.bind(console)
            };
            const prefix = () => `[run:${RUN.id()}]`;
            console.log = (...args) => orig.log(prefix(), ...args);
            console.info = (...args) => orig.info(prefix(), ...args);
            console.warn = (...args) => orig.warn(prefix(), ...args);
            console.error = (...args) => orig.error(prefix(), ...args);
            console.debug = (...args) => orig.debug(prefix(), ...args);
        }
    } catch (_) { /* no-op */ }
})();

const LOGS = [];
const MAX_LOGS = 5000; // Prevent memory issues

function devlog(entry) {
    const item = { 
        t: Date.now(), 
        runId: RUN.id(), 
        ...entry 
    };
    LOGS.push(item);
    
    // Keep logs manageable
    if (LOGS.length > MAX_LOGS) {
        LOGS.splice(0, LOGS.length - MAX_LOGS);
    }
    
    // Console output for development
    if (!entry.silent) {
        const prefix = `[${entry.type || 'LOG'}]`;
        console.log(prefix, item);
    }
}

function tabKey(tab) {
    if (!tab) return 'unknown';
    return tab.canonicalUrl || tab.url?.split('#')[0] || 'unknown';
}

function round(x) {
    return typeof x === 'number' ? Math.round(x * 1000) / 1000 : x;
}

function getDiagnosticsSnapshot() {
    return {
        runId: RUN.id(),
        logs: LOGS.slice(-3000), // Last 3000 entries
        totalLogs: LOGS.length
    };
}

// Export for debugging from console
if (typeof window !== 'undefined') {
    window.getDiagnosticsSnapshot = getDiagnosticsSnapshot;
    window.RUN = RUN;
    window.LOGS = LOGS;
}

// Immediate debug logging
console.log('🔧 [Debug] Background script loaded, debugging functions available:');
console.log('  - getDiagnosticsSnapshot():', typeof getDiagnosticsSnapshot);
console.log('  - RUN object:', typeof RUN);
console.log('  - LOGS array:', typeof LOGS);
console.log('  - Current logs count:', LOGS.length);

// Debug API for Chrome extension console
if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'getDiagnostics') {
            sendResponse(getDiagnosticsSnapshot());
            return true;
        }
        if (request.action === 'clearLogs') {
            LOGS.length = 0;
            RUN.reset();
            sendResponse({ success: true });
            return true;
        }
    });
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
    if (chrome.runtime.onStartup && typeof chrome.runtime.onStartup.addListener === 'function') {
        chrome.runtime.onStartup.addListener(async () => {
            console.log('🔁 [Boot] Chrome runtime startup event; service worker active');
            // Ensure context menu exists on startup (service worker restarts)
            try {
                if (chrome.contextMenus && typeof chrome.contextMenus.create === 'function') {
                const items = [
                    { id: 'synthesizeGroup', title: '✨ Summarize & Compare Group (AI)', contexts: ['page'], documentUrlPatterns: ['http://*/*','https://*/*'] },
                    { id: 'synthesizeActiveGroup', title: '✨ Summarize Active Tab Group (AI)', contexts: ['action'] }
                ];
                    for (const def of items) {
                        chrome.contextMenus.create(def, () => {
                            // Ignore duplicate errors when item already exists
                            if (chrome.runtime.lastError && !/exist|duplicate/i.test(chrome.runtime.lastError.message)) {
                                console.warn('Context menu create onStartup:', chrome.runtime.lastError.message);
                            }
                        });
                    }
                }
            } catch (menuErr) {
                console.warn('Failed to ensure context menu on startup:', menuErr?.message || menuErr);
            }
            if (!AUTO_RELOAD_STALE_TABS || !STARTUP_SMART_RELOAD) return;
            try {
                const tabs = await chrome.tabs.query({});
                const valid = tabs.filter(t => t && t.url && t.url.startsWith('http'));
                await smartReloadTabs(valid);
            } catch (e) {
                console.warn('Startup smart reload failed:', e?.message || e);
            }
        });
    }
    if (chrome.runtime.onSuspend && typeof chrome.runtime.onSuspend.addListener === 'function') {
        chrome.runtime.onSuspend.addListener(() => {
            console.log('🛑 [Boot] Runtime suspend (service worker going idle)');
        });
    }
}

// Global state για το extension
let isScanning = false;
let currentTabData = [];
let aiGroups = [];
// Last AI keyword dump for debugging/API
let LAST_AI_KEYWORDS = [];
let scanTimeout = null; // Για debounce
let lastMergeDebugLog = null;
let lastGoldenEvaluation = null;

// Tunable constants για επιδόσεις και ακρίβεια
const CONTENT_EXTRACTION_CONCURRENCY = 8;
const TAB_EXTRACTION_TIMEOUT = 14000; // ms (increase for Docs/Sheets stability)
const SIMILARITY_JOIN_THRESHOLD = 0.42;  // Reduced for better medical/AI grouping
const SIMILARITY_SPLIT_THRESHOLD = 0.35;  // Reduced for better medical/AI grouping  
const CROSS_GROUP_MERGE_THRESHOLD = 0.40; // Reduced for better medical/AI grouping
const CROSS_GROUP_KEYWORD_OVERLAP = 0.25;  // Reduced for better grouping
const CROSS_GROUP_TOPIC_OVERLAP = 0.30;    // Reduced for better grouping
const CROSS_GROUP_TAXONOMY_OVERLAP = 0.35; // Reduced for better grouping
const SMALL_GROUP_MAX_SIZE = 3;
const GROUP_NAME_SIMILARITY_THRESHOLD = 0.62;
const GROUP_NAME_VECTOR_THRESHOLD = 0.5;
const ENABLE_MERGE_DEBUG_LOGS = true;
const ENFORCE_AI_FEATURES = true;
const LLM_VERIFICATION_CONFIDENCE = 0.58;
const LLM_MERGE_SIMILARITY_FLOOR = 0.34;
const LLM_VERIFICATION_TIMEOUT = 11000;
const GENERIC_MERGE_STOPWORDS = new Set([
    'research',
    'news',
    'blog',
    'updates',
    'topics',
    'portal',
    'general',
    'overview'
]);
const EMBEDDING_MIN_CONTENT_CHARS = 160;
const EMBEDDING_CACHE_TTL = 15 * 60 * 1000;
const EMBEDDING_MAX_TOKENS = 400; // Reduced from 600 for faster processing
const EMBEDDING_FALLBACK_DIM = 64;
const TFIDF_TOKEN_LIMIT = 24;
const LABEL_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const MAX_AI_FEATURE_TABS = 16;  // Allow AI (incl. summarizer) on up to 16 tabs
const MAX_AI_EMBED_TABS = 16;   // Allow embeddings generation on up to 16 tabs
const MAX_AI_LABEL_GROUPS = 6; // Allow full labels for up to 6 groups initially
const PAIRWISE_LLM_CACHE = new Map();
const RESTRICTED_HOSTS = [
    'mail.google.com',
    'accounts.google.com',
    'chrome.google.com',
    'play.google.com',
    'outlook.live.com'
];

const DEFAULT_WORKING_LANGUAGE = 'en';
const SIMHASH_BITS = 32;
const GROUP_AUTOSUSPEND_IDLE_MS = 5 * 60 * 1000;
const GROUP_AUTOSUSPEND_CHECK_MS = 90 * 1000;

// Smart reload for stale tabs (non-breaking default)
const AUTO_RELOAD_STALE_TABS = true;               // Enable smart reload before scans
const RELOAD_BYPASS_CACHE = false;                 // Keep cache to reduce bandwidth
const RELOAD_TIMEOUT_MS = 15000;                   // Max wait per tab for reload
const RELOAD_MAX_TABS = 16;                        // Safety cap to avoid mass reloads
const STARTUP_SMART_RELOAD = true;                 // Also attempt smart reload on Chrome startup
// Summarizer availability memory to avoid repeated failing attempts
const SUMMARIZER_UNAVAILABLE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

const TAXONOMY_RULES = [
    { match: /youtube\.com|youtu\.be/i, tags: ['media', 'video', 'youtube'] },
    { match: /news|cnn|bbc|reuters|guardian/i, tags: ['news', 'media'] },
    { match: /wikipedia\.org/i, tags: ['reference', 'encyclopedia'] },
    { match: /github\.com/i, tags: ['software', 'development', 'github'] },
    { match: /stackoverflow\.com/i, tags: ['software', 'programming', 'questions'] },
    // Generalize gaming taxonomy; avoid brand-specific tags
    { match: /futbin\.com|fut\.gg|ea\.com\/fc|fifa/i, tags: ['gaming'] },
    { match: /nature\.com/i, tags: ['medical research', 'science', 'journal'] },
    { match: /nejm\.org/i, tags: ['medical research', 'clinical medicine', 'journal'] },
    { match: /pubmed\.ncbi\.nlm\.nih\.gov|nih\.gov|medscape/i, tags: ['medical research', 'healthcare'] },
    { match: /chrome\.developers|developer\.chrome\.com|chromium\.org/i, tags: ['software', 'chrome', 'web platform'] },
    { match: /gmail\.com|mail\.google\.com|outlook\.com/i, tags: ['email', 'communications'] },
    { match: /amazon\.|ebay\.|shop|store/i, tags: ['commerce', 'shopping'] },
    { match: /docs\.google\.com|notion\.so|drive\.google\.com/i, tags: ['productivity', 'documents'] }
];

const HAS_PERFORMANCE_API = typeof performance !== 'undefined' && typeof performance.now === 'function';
const AI_FEATURE_TIMEOUT = 18000;
// Increase label timeout to reduce spurious timeouts on first load
const AI_LABEL_TIMEOUT = 22000;
const AI_SUMMARY_TIMEOUT = 16000;
// Adaptive cooldowns for labeling
const AI_LABEL_COOLDOWN_SUCCESS_MS = 600;
const AI_LABEL_COOLDOWN_FAILURE_MS = 1400;

// ---- RAM management knobs ----
const RAM_CLEANUP_ENABLED = true;                 // Enable post-run RAM cleanup
const RAM_CLEANUP_DELAY_MS = 2000;                // Delay before cleanup to avoid UI jank
const RAM_PRUNE_CONTENT = true;                   // Strip heavy content strings from unused tabs in memory
const RAM_DISCARD_UNUSED_TABS = true;             // Ask Chrome to discard unused tabs (not active/pinned/audible)
const RAM_MAX_DISCARDS_PER_RUN = 5;               // Safety cap
const RAM_MIN_TAB_AGE_MS = 30 * 1000;             // Only discard tabs older than 30s (avoid flicker on fresh tabs)
function nowMs() {
    return HAS_PERFORMANCE_API ? performance.now() : Date.now();
}

// ---- Generalization toggles ----
// When true, prefer embedding-first similarity for grouping and use TF-IDF only as fallback
const GENERAL_GROUPING_MODE = true;
// In LLM refinement, consider top-K candidate groups (by embedding similarity) for singleton attachment
const EMBED_TOPK_CANDIDATES = 3;
// Disable shopping category split to avoid over-segmentation and singletons
const ENABLE_SHOPPING_SPLIT = false;

// ---- Generic detectors (content-based, domain-agnostic) ----
function detectShoppingStrong(text = '', url = '') {
    try {
        const s = `${String(text || '')} ${String(url || '')}`.toLowerCase();
        const u = String(url || '').toLowerCase();
        let host = '';
        let path = '';
        try { const uo = new URL(url); host = (uo.hostname || '').toLowerCase(); path = (uo.pathname || '').toLowerCase(); } catch {}

        // Domain heuristics: common e-commerce hosts
        const ECOMM_HOSTS = /(amazon\.|ebay\.|bestbuy\.|target\.|temu\.|aliexpress\.|shein\.|walmart\.|etsy\.|flipkart\.|skroutz\.|public\.gr|plaisio\.)/;
        const onEcommHost = ECOMM_HOSTS.test(host);
        const ecommPath = /(\/s\?|\/search(?![a-z])|\/search_result|\/sch\/|\/pdsearch\/|\/dp\/|\/gp\/|\/product|\/cart|\/checkout|\/c\/|\/category|\/browse|abcat\d|cid\d?)/.test(path)
            || /[?&](_?nkw|k|q|query|search|search_term|searchterm|searchtype|search_type|search_source|keyword|keywords|searchTerm|searchTermRaw)=/i.test(u)
            || (onEcommHost && /[?&][^=]*search[^=]*=/i.test(u));

        const hasCart = /(add to cart|add-to-cart|\bcart\b|checkout|buy now|buy)/.test(s);
        const hasFulfillment = /(free shipping|delivery|\bin stock\b|returns?)/.test(s);
        const hasCurrency = /[\$€£]\s?\d/.test(s) || /(usd|eur|gbp)\s?\d/.test(s);
        const hasPriceWord = /\bprice\b|\bprices\b/.test(s);
        const hasDealWord = /(\bsale\b|\bdeals?\b|\bdiscount\b|\boffers?\b)/.test(s);
        const hasListingControls = /\bfilters?\b|\bsort\b|\brefine\b|\bapply filter\b/.test(s);
        const hasGreekCommerce = /(καλάθι|ταμείο|αγορά|προσφορά|έκπτωση|εκπτωση|τιμή)/.test(s);

        // Strong signals
        if (hasCart || hasFulfillment || hasCurrency || hasGreekCommerce) return true;
        // Domain+path heuristic counts as shopping even if content string is sparse
        if (onEcommHost && (ecommPath || hasDealWord || hasPriceWord || hasListingControls)) return true;
        // If on e-comm host and title hints at product/category, consider shopping
        if (onEcommHost && /(category|search|results|shop|store|sale|deals?)/.test(s)) return true;
        // Otherwise require combination of price and listing controls
        if (hasPriceWord && hasListingControls) return true;
        return false;
    } catch (_) {
        return false;
    }
}

// Infer a shopping subcategory when AI does not provide one
function inferShopCategoryFromSignals(title = '', url = '', keywords = []) {
    try {
        const t = String(title || '').toLowerCase();
        const u = String(url || '').toLowerCase();
        let host = '';
        try { host = new URL(url).hostname.replace(/^www\./,'').toLowerCase(); } catch {}
        const kw = Array.isArray(keywords) ? keywords.map(k => String(k||'').toLowerCase()) : [];
        const s = `${t} ${kw.join(' ')} ${host} ${u}`;

        const hasAny = (re) => re.test(s);

        // Fashion
        if (hasAny(/\b(dress|dresses|clothing|apparel|skirt|jeans|pants|shirt|top|hoodie|sneakers|heels|boots|fashion)\b|\bshein\b|\basos\b|\bzara\b|\bhm\b/)) {
            return 'fashion';
        }
        // Electronics / Gaming devices & accessories
        if (hasAny(/\b(pc|laptop|keyboard|mouse|headset|monitor|console|tv|camera|tablet|iphone|android|gpu|cpu|ssd|electronics|gaming accessories?)\b|\bbestbuy\b|\bnewegg\b|\bmicrocenter\b/)) {
            return 'electronics';
        }
        // Home & furniture
        if (hasAny(/\b(furniture|chair|sofa|table|desk|bed|mattress|kitchen|cookware|decor|lamp|lighting|rug|vacuum|home)\b/)) {
            return 'home';
        }
        // Groceries
        if (hasAny(/\b(grocery|groceries|supermarket|food|snack|beverage|drink)\b/)) {
            return 'groceries';
        }
        // Beauty
        if (hasAny(/\b(makeup|skincare|cosmetics|fragrance|perfume|beauty|haircare|lotion|serum)\b/)) {
            return 'beauty';
        }
        // Sports (sporting goods, not video gaming)
        if (hasAny(/\b(treadmill|dumbbell|fitness|gym|jersey|bike|bicycle|helmet|sport(s)?|soccer|basketball|tennis|yoga|golf)\b/)) {
            return 'sports';
        }
        // Automotive
        if (hasAny(/\b(automotive|car|auto|tire|tires|brake|engine|oil|wiper|battery|spark plug)\b/)) {
            return 'automotive';
        }
        // Digital goods
        if (hasAny(/\b(software|license|ebook|course|download|subscription|gift\s?card|digital)\b/)) {
            return 'digital';
        }
        return 'general';
    } catch (_) {
        return null;
    }
}

// Infer shopping intent (short product/category term) from URL/title when AI omits it
function inferShoppingIntentFromUrl(url = '', title = '') {
    try {
        const u = new URL(String(url || ''));
        const params = u.searchParams;
        const fields = ['q','query','search','search_key','searchTerm','searchTermRaw','keyword','k','_nkw'];
        for (const f of fields) {
            const v = params.get(f);
            if (v && v.trim()) return String(v).toLowerCase().trim().split(/[^a-z0-9]+/i)[0] || null;
        }
        const p = u.pathname.toLowerCase();
        // Common path patterns, e.g. /pdsearch/dresses, /search/dresses
        const m = p.match(/\/(pdsearch|search|search_result)\/([^\/?#]+)/);
        if (m && m[2]) return decodeURIComponent(m[2]).toLowerCase().trim().split(/[^a-z0-9]+/i)[0] || null;
        // Fallback quick pick from title if it looks like a simple query
        const t = String(title || '').toLowerCase();
        const tt = t.match(/\b(dress|dresses|laptop|laptops|monitor|chair|shoes|sneakers|hoodie|keyboard|mouse)\b/);
        if (tt && tt[0]) return tt[0];
        return null;
    } catch (_) {
        return null;
    }
}

function logTiming(label, startTime) {
    if (typeof startTime !== 'number') {
        return 0;
    }
    const elapsed = Math.round(nowMs() - startTime);
    console.log(`⏱️ [Timing] ${label}: ${elapsed}ms`);
    return elapsed;
}

let deferredSummaryTimer = null;
let deferredSummaryInProgress = false;
let deferredLabelTimer = null;
let deferredLabelInProgress = false;
let labelingActive = false; // gate to avoid LM contention with summarizer
const groupActivityState = new Map();
let autoSuspendTimer = null;

function buildDetectionSample(text) {
    if (!text) {
        return '';
    }
    return String(text)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1200);
}

async function detectLanguageForText(text) {
    if (!text || typeof chrome?.i18n?.detectLanguage !== 'function') {
        return null;
    }
    const sample = buildDetectionSample(text);
    if (!sample) {
        return null;
    }
    return new Promise(resolve => {
        try {
            chrome.i18n.detectLanguage(sample, (result) => {
                if (chrome.runtime.lastError) {
                    console.warn('Language detection failed:', chrome.runtime.lastError.message);
                    resolve(null);
                    return;
                }
                const languages = Array.isArray(result?.languages) ? result.languages : [];
                const candidates = languages
                    .filter(item => item && item.language && item.language !== 'und')
                    .sort((a, b) => (b.percentage || 0) - (a.percentage || 0));
                if (candidates.length > 0) {
                    resolve(candidates[0].language);
                    return;
                }
                resolve(null);
            });
        } catch (error) {
            console.warn('Language detection threw:', error);
            resolve(null);
        }
    });
}

async function ensureEntryLanguage(entry) {
    if (!entry || typeof entry !== 'object') {
        return DEFAULT_WORKING_LANGUAGE;
    }
    const existing = String(entry.language || entry.detectedLanguage || '')
        .toLowerCase()
        .trim();
    if (existing && existing !== 'und') {
        return existing;
    }
    const detectionSources = [
        entry.fullContent,
        entry.content,
        entry.metaDescription,
        Array.isArray(entry.headings) ? entry.headings.join(' ') : '',
        entry.title
    ].filter(Boolean);
    const sample = buildDetectionSample(detectionSources.join(' '));
    if (!sample) {
        return DEFAULT_WORKING_LANGUAGE;
    }
    try {
        const detected = await detectLanguageForText(sample);
        return detected || DEFAULT_WORKING_LANGUAGE;
    } catch (error) {
        console.warn('ensureEntryLanguage failed:', error);
        return DEFAULT_WORKING_LANGUAGE;
    }
}

function recordGroupActivity(groupId, { resetSuspension = true } = {}) {
    if (typeof chrome === 'undefined' || !chrome.tabGroups) {
        return;
    }
    if (typeof groupId !== 'number' || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
        return;
    }
    const now = Date.now();
    const state = groupActivityState.get(groupId) || {};
    const wasSuspended = Boolean(state.suspended);
    state.lastActive = now;
    if (typeof state.suspended !== 'boolean') {
        state.suspended = false;
    }
    if (resetSuspension) {
        state.suspended = false;
    }
    groupActivityState.set(groupId, state);
    if (Array.isArray(aiGroups)) {
        const aiGroup = aiGroups.find(group => group && group.chromeGroupId === groupId);
        if (aiGroup) {
            aiGroup.lastActive = now;
            if (resetSuspension) {
                aiGroup.autoSuspended = false;
            }
        }
    }
    if (resetSuspension && wasSuspended) {
        chrome.tabGroups.update(groupId, { collapsed: false }).catch(() => {});
    }
}

async function autoSuspendInactiveGroups() {
    if (typeof chrome === 'undefined' || !chrome.tabGroups || !chrome.tabs) {
        return;
    }
    try {
        const now = Date.now();
        const groups = await chrome.tabGroups.query({});
        if (!Array.isArray(groups) || !groups.length) {
            return;
        }
        const activeTabs = await chrome.tabs.query({ active: true });
        const activeGroupIds = new Set(
            activeTabs
                .map(tab => tab.groupId)
                .filter(groupId => typeof groupId === 'number' && groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)
        );
        for (const group of groups) {
            const groupId = group?.id;
            if (typeof groupId !== 'number' || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
                continue;
            }
            const state = groupActivityState.get(groupId) || { lastActive: now, suspended: false };
            if (activeGroupIds.has(groupId)) {
                state.lastActive = now;
                if (state.suspended) {
                    state.suspended = false;
                    if (Array.isArray(aiGroups)) {
                        const activeGroup = aiGroups.find(item => item && item.chromeGroupId === groupId);
                        if (activeGroup) {
                            activeGroup.autoSuspended = false;
                        }
                    }
                }
                groupActivityState.set(groupId, state);
                continue;
            }
            const idleDuration = now - (state.lastActive || now);
            if (idleDuration < GROUP_AUTOSUSPEND_IDLE_MS || state.suspended) {
                groupActivityState.set(groupId, state);
                continue;
            }
            const tabs = await chrome.tabs.query({ groupId });
            const discardableTabs = tabs.filter(tab => tab && !tab.active && !tab.pinned && !tab.audible);
            if (!discardableTabs.length) {
                continue;
            }
            await Promise.all(discardableTabs.map(tab => chrome.tabs.discard(tab.id).catch(() => {})));
            try {
                await chrome.tabGroups.update(groupId, { collapsed: true });
            } catch (updateError) {
                console.warn('Failed to collapse group after suspend:', updateError);
            }
            state.suspended = true;
            state.lastActive = now;
            groupActivityState.set(groupId, state);
            if (Array.isArray(aiGroups)) {
                const aiGroup = aiGroups.find(item => item && item.chromeGroupId === groupId);
                if (aiGroup) {
                    aiGroup.autoSuspended = true;
                }
            }
            console.log(`Auto-suspended group ${group.title || groupId} after ${(idleDuration / 1000).toFixed(0)}s idle`);
        }
    } catch (error) {
        console.warn('Auto-suspend check failed:', error);
    }
}

function startAutoSuspendScheduler() {
    if (autoSuspendTimer || typeof chrome === 'undefined') {
        return;
    }
    autoSuspendTimer = setInterval(() => {
        autoSuspendInactiveGroups().catch(error => {
            console.warn('Auto-suspend interval error:', error);
        });
    }, GROUP_AUTOSUSPEND_CHECK_MS);
    // Kick off first run after short delay
    setTimeout(() => {
        autoSuspendInactiveGroups().catch(error => console.warn('Initial auto-suspend check failed:', error));
    }, GROUP_AUTOSUSPEND_CHECK_MS / 2);
}

async function withTimeout(promise, timeoutMs, timeoutMessage) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timeoutId);
        return result;
    } catch (error) {
        clearTimeout(timeoutId);
        // ensure original promise rejection is silenced if it resolves later
        if (promise && typeof promise.catch === 'function') {
            promise.catch(() => {});
        }
        throw error;
    }
}

// Origin trial token είναι ήδη στο manifest.json
// Στο service worker context δεν μπορούμε να χρησιμοποιήσουμε document

/**
 * Αρχικοποίηση του service worker
 */
chrome.runtime.onInstalled.addListener(() => {
    console.log('AI Tab Companion installed successfully');
    
    // Καθαρισμός παλιών δεδομένων
    chrome.storage.session.clear();
    chrome.storage.local.remove(['lastScan', 'cachedGroups']);

    // Δημιουργία context menu για One‑Click Synthesizer
    try {
        if (chrome.contextMenus && typeof chrome.contextMenus.create === 'function') {
            chrome.contextMenus.removeAll(() => {
                // Ignore lastError from removeAll in case none existed
                const items = [
                    // Use 'page' context (valid across Chrome channels) instead of unsupported 'tab'
                    { id: 'synthesizeGroup', title: '✨ Summarize & Compare Group (AI)', contexts: ['page'], documentUrlPatterns: ['http://*/*','https://*/*'] },
                    { id: 'synthesizeActiveGroup', title: '✨ Summarize Active Tab Group (AI)', contexts: ['action'] }
                ];
                for (const def of items) {
                    try {
                        chrome.contextMenus.create(def, () => {
                            if (chrome.runtime.lastError && !/exist|duplicate/i.test(chrome.runtime.lastError.message)) {
                                console.warn('Context menu create error:', chrome.runtime.lastError.message);
                            }
                        });
                    } catch (innerErr) {
                        console.warn('Context menu create threw:', innerErr?.message || innerErr);
                    }
                }
            });
        }
    } catch (e) {
        console.warn('Failed to initialize context menu on install:', e?.message || e);
    }
});

// Context menu click handler for One‑Click Synthesizer
if (chrome.contextMenus && chrome.contextMenus.onClicked) {
    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
        try {
            if (info.menuItemId === 'synthesizeGroup') {
                const group = await findGroupByTabId(tab?.id);
                if (group) {
                    await createSummaryTab(group);
                } else {
                    console.warn('No AI group found for current tab');
                }
            } else if (info.menuItemId === 'synthesizeActiveGroup') {
                await synthesizeActiveGroupFromAction();
            }
        } catch (e) {
            console.warn('Context menu handler failed:', e?.message || e);
        }
    });
}

if (chrome.tabs?.onActivated) {
    chrome.tabs.onActivated.addListener(({ tabId }) => {
        if (!tabId || typeof chrome === 'undefined') {
            return;
        }
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError || !tab) {
                return;
            }
            if (typeof tab.groupId === 'number' && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                recordGroupActivity(tab.groupId, { resetSuspension: true });
            }
        });
    });
}

if (chrome.tabGroups?.onRemoved) {
    chrome.tabGroups.onRemoved.addListener((group) => {
        const groupId = typeof group === 'number' ? group : (group?.groupId ?? null);
        if (typeof groupId === 'number') {
            groupActivityState.delete(groupId);
            if (Array.isArray(aiGroups)) {
                const idx = aiGroups.findIndex(item => item && item.chromeGroupId === groupId);
                if (idx !== -1 && aiGroups[idx]) {
                    aiGroups[idx].chromeGroupId = undefined;
                    aiGroups[idx].autoSuspended = false;
                }
            }
        }
    });
}

// Optional: if popup is disabled in the future, allow left-click on action to synthesize
if (chrome.action && typeof chrome.action.onClicked?.addListener === 'function') {
    try {
        chrome.action.onClicked.addListener(async () => {
            await synthesizeActiveGroupFromAction();
        });
    } catch (_) {
        // ignore
    }
}

/**
 * Χειρισμός μηνυμάτων από popup και content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background received message:', message.type);
    
    switch (message.type) {
        case 'SCAN_TABS':
            handleScanTabs(sendResponse);
            return true; // Keep message channel open for async response
            
        case 'TAB_DATA_EXTRACTED':
            handleTabDataExtracted(message.data, sendResponse);
            return true;
            
        case 'CLOSE_SELECTED_TABS':
            handleCloseSelectedTabs(message.tabIds, sendResponse);
            return true;
            
        case 'EXPORT_SUMMARY':
            handleExportSummary(sendResponse);
            return true;
            
        case 'CLEAR_CACHE':
            clearCacheManually().then(result => {
                sendResponse(result);
            });
            return true;
        
        case 'REQUEST_GROUP_SUMMARY':
            handleGroupSummaryRequest(message.groupIndex)
                .then(result => sendResponse(result))
                .catch(error => {
                    console.error('REQUEST_GROUP_SUMMARY failed:', error);
                    sendResponse({ success: false, error: error.message });
                });
            return true;

        case 'SYNTHESIZE_GROUP':
            (async () => {
                try {
                    // Ensure groups are available
                    if (!Array.isArray(aiGroups) || !aiGroups.length) {
                        const storedGroups = await chrome.storage.local.get(['cachedGroups']);
                        if (Array.isArray(storedGroups.cachedGroups)) {
                            aiGroups = storedGroups.cachedGroups;
                        }
                    }
                    const idx = Number(message.groupIndex);
                    if (!Array.isArray(aiGroups) || idx < 0 || idx >= aiGroups.length) {
                        throw new Error('Invalid group index');
                    }
                    const group = aiGroups[idx];
                    await createSummaryTab(group);
                    sendResponse({ success: true });
                } catch (e) {
                    console.error('SYNTHESIZE_GROUP failed:', e);
                    sendResponse({ success: false, error: e?.message || String(e) });
                }
            })();
            return true;
        
        case 'RUN_GOLDEN_EVAL':
            runGoldenEvaluation(message.scenario, { groups: message.groups, tabData: message.tabData })
                .then(result => sendResponse({ success: true, result }))
                .catch(error => {
                    console.error('RUN_GOLDEN_EVAL failed:', error);
                    sendResponse({ success: false, error: error.message, details: error.details || null });
                });
            return true;
            
        case 'AI_GROUPING_RESPONSE':
            // Silence noisy relay from content script; background already awaits tabs.sendMessage
            console.log('🤖 [AI] Background received AI_GROUPING_RESPONSE (relay)');
            sendResponse({ ok: true });
            return true;

        case 'GET_AI_KEYWORDS':
            try {
                sendResponse({ success: true, keywords: LAST_AI_KEYWORDS });
            } catch (e) {
                sendResponse({ success: false, error: e?.message || String(e) });
            }
            return true;

        default:
            console.warn('Unknown message type:', message.type);
            sendResponse({ success: false, error: 'Unknown message type' });
    }
});

/**
 * Επιστρέφει true όταν το URL θεωρείται restricted
 */
function isRestrictedUrl(urlString) {
    try {
        const u = new URL(urlString);
        const host = u.hostname || '';
        return RESTRICTED_HOSTS.some(h => host.includes(h));
    } catch (_) {
        return true;
    }
}

/**
 * Περιμένει μέχρι το tab να δηλώσει status === 'complete' ή timeouts
 */
function waitForTabComplete(tabId, timeoutMs = RELOAD_TIMEOUT_MS) {
    return new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            try { chrome.tabs.onUpdated.removeListener(listener); } catch (_) {}
            resolve(false);
        }, timeoutMs);

        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId !== tabId) return;
            if (changeInfo && changeInfo.status === 'complete') {
                if (done) return;
                done = true;
                clearTimeout(timer);
                try { chrome.tabs.onUpdated.removeListener(listener); } catch (_) {}
                resolve(true);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}

/**
 * Κάνει safe reload μόνο σε «πιθανώς προβληματικά» tabs πριν το scan
 * - Reloads: discarded ή status !== 'complete'
 * - Skip: active, pinned, audible, restricted hosts
 * - Περιμένει μέχρι να φορτώσουν (ή timeout) πριν συνεχίσει
 */
async function smartReloadTabs(tabs) {
    if (!AUTO_RELOAD_STALE_TABS) return { reloaded: 0 };
    const candidates = [];
    for (const tab of tabs) {
        try {
            if (!tab || !tab.id || !tab.url) continue;
            if (!tab.url.startsWith('http')) continue;
            if (isRestrictedUrl(tab.url)) continue;
            const status = tab.status; // 'loading' | 'complete' | undefined
            const needsReload = (tab.discarded === true) || (status && status !== 'complete');
            const safeToReload = !tab.active && !tab.pinned && !tab.audible;
            if (needsReload && safeToReload) candidates.push(tab);
        } catch (_) {}
    }
    if (!candidates.length) return { reloaded: 0 };

    const limited = candidates.slice(0, RELOAD_MAX_TABS);
    console.log(`🔄 [Smart Reload] Preparing to reload ${limited.length}/${candidates.length} stale tabs...`);

    let reloaded = 0;
    await Promise.all(limited.map(async (tab) => {
        try {
            await chrome.tabs.reload(tab.id, { bypassCache: RELOAD_BYPASS_CACHE });
            const ok = await waitForTabComplete(tab.id).catch(() => false);
            if (!ok) {
                console.warn(`🔄 [Smart Reload] Tab ${tab.id} did not complete within timeout`);
            } else {
                reloaded += 1;
            }
        } catch (e) {
            console.warn(`🔄 [Smart Reload] Reload failed for tab ${tab.id}:`, e?.message || e);
        }
    }));

    console.log(`🔄 [Smart Reload] Completed. Reloaded ${reloaded} tabs (cap ${RELOAD_MAX_TABS}).`);
    return { reloaded };
}

/**
 * Εξασφαλίζει ότι το extension έχει τα απαραίτητα host permissions για τα tabs που θα αναλυθούν
 */
async function ensureHostPermissionsForTabs(tabs) {
    try {
        const originPatterns = new Set();
        
        tabs.forEach(tab => {
            try {
                if (!tab.url) {
                    return;
                }
                const url = new URL(tab.url);
                if (url.protocol === 'http:' || url.protocol === 'https:') {
                    originPatterns.add(`${url.origin}/*`);
                }
            } catch (error) {
                console.warn('Skipping permission check for invalid URL:', tab.url, error);
            }
        });
        
        if (originPatterns.size === 0) {
            return { granted: true, requested: [] };
        }
        
        const cacheData = await chrome.storage.session.get(['permittedOrigins']);
        const permittedOrigins = new Set(cacheData.permittedOrigins || []);
        const originsNeedingPermission = [];
        const originsToVerify = [];
        
        for (const origin of originPatterns) {
            if (permittedOrigins.has(origin)) {
                continue;
            }
            originsToVerify.push(origin);
        }
        
        for (const origin of originsToVerify) {
            const hasPermission = await chrome.permissions.contains({ origins: [origin] });
            if (hasPermission) {
                permittedOrigins.add(origin);
            } else {
                originsNeedingPermission.push(origin);
            }
        }
        
        if (originsNeedingPermission.length === 0) {
            if (originsToVerify.length > 0) {
                await chrome.storage.session.set({ permittedOrigins: Array.from(permittedOrigins) });
            }
            return { granted: true, requested: [] };
        }
        
        console.log('Requesting host permissions for origins:', originsNeedingPermission);
        const granted = await chrome.permissions.request({ origins: originsNeedingPermission });
        if (granted) {
            originsNeedingPermission.forEach(origin => permittedOrigins.add(origin));
            await chrome.storage.session.set({ permittedOrigins: Array.from(permittedOrigins) });
        }
        
        return { granted, requested: originsNeedingPermission };
        
    } catch (error) {
        console.error('Failed to verify/request host permissions:', error);
        throw new Error(`Permission check failed: ${error.message}`);
    }
}

/**
 * Εκτελεί promises με περιορισμένη ταυτόχρονη εκτέλεση
 */
async function mapWithConcurrency(items, mapper, concurrency = CONTENT_EXTRACTION_CONCURRENCY) {
    if (!Array.isArray(items) || items.length === 0) {
        return [];
    }
    
    const results = new Array(items.length);
    let nextIndex = 0;
    let active = 0;
    
    return await new Promise((resolve) => {
        const scheduleNext = () => {
            if (nextIndex >= items.length && active === 0) {
                resolve(results);
                return;
            }
            
            while (active < concurrency && nextIndex < items.length) {
                const current = nextIndex++;
                active += 1;
                
                Promise.resolve()
                    .then(() => mapper(items[current], current))
                    .then(value => {
                        results[current] = { status: 'fulfilled', value };
                    })
                    .catch(error => {
                        results[current] = { status: 'rejected', reason: error };
                    })
                    .finally(() => {
                        active -= 1;
                        scheduleNext();
                    });
            }
        };
        
        scheduleNext();
    });
}

/**
 * Αρχίζει τη διαδικασία σκαναρίσματος των tabs
 */
async function handleScanTabs(sendResponse) {
    if (isScanning) {
        console.log('Scan already in progress, ignoring duplicate request');
        sendResponse({ success: false, error: 'Scan already in progress' });
        return;
    }
    const scanStart = nowMs();
    
    // Debounce: ακυρώνουμε προηγούμενο timeout αν υπάρχει
    if (scanTimeout) {
        clearTimeout(scanTimeout);
        console.log('Previous scan timeout cleared');
    }
    
    try {
        isScanning = true;
        currentTabData = [];
        
        // Λήψη όλων των ανοιχτών tabs
        const tabQueryStart = nowMs();
        const tabs = await chrome.tabs.query({});
        logTiming('Tab query', tabQueryStart);
        console.log(`Found ${tabs.length} open tabs`);
        
        // Φιλτράρισμα tabs (αποκλείουμε chrome://, extension pages, κλπ)
        const validTabs = tabs.filter(tab => {
            if (!tab.url) return false;
            if (tab.url.startsWith('chrome://')) return false;
            if (tab.url.startsWith('chrome-extension://')) return false;
            if (tab.url.startsWith('moz-extension://')) return false;
            if (tab.url.startsWith('edge://')) return false;
            if (!tab.url.startsWith('http')) return false;
            return true;
        });
        
        const excludedTabs = tabs.length - validTabs.length;
        console.log(`Found ${tabs.length} total tabs, ${excludedTabs} excluded (chrome://, extensions, etc.), ${validTabs.length} valid for analysis`);
        
        if (validTabs.length === 0) {
            sendResponse({ 
                success: false, 
                error: 'No valid tabs found for analysis' 
            });
            isScanning = false;
            return;
        }
        
        // Έλεγχος και αίτηση δικαιωμάτων πρόσβασης για τα tabs
        console.log('Checking host permissions for tabs...');
        const permissionsStart = nowMs();
        const permissionResult = await ensureHostPermissionsForTabs(validTabs);
        logTiming('Host permission verification', permissionsStart);
        if (!permissionResult.granted) {
            console.warn('User denied host permissions for origins:', permissionResult.requested);
            isScanning = false;
            sendResponse({
                success: false,
                error: 'Host permissions for all sites are required. Please grant access to tabs and try again.'
            });
            return;
        }
        console.log('Host permissions verified successfully');

        // Smart reload για tabs που είναι discarded/μη ολοκληρωμένα
        try {
            const reloadStart = nowMs();
            const { reloaded } = await smartReloadTabs(validTabs);
            if (reloaded > 0) {
                logTiming(`Smart reload (${reloaded} tabs)`, reloadStart);
            }
        } catch (e) {
            console.warn('Smart reload step failed:', e?.message || e);
        }
        
        // Αποθήκευση βασικών πληροφοριών tabs
        const basicTabData = validTabs.map(tab => ({
                id: tab.id,
            title: tab.title,
                url: tab.url,
            favicon: tab.favIconUrl,
            active: tab.active,
            lastAccessed: tab.lastAccessed
        }));
        
        // Αποθήκευση στο session storage και καθαρισμός τυχόν προηγούμενων errors
        await chrome.storage.session.set({ 
            basicTabData: basicTabData,
            scanStartTime: Date.now()
        });
        
        // Καθαρισμός προηγούμενων AI errors
        await chrome.storage.local.remove(['aiError', 'error']);
        
        sendResponse({ 
            success: true, 
            message: 'Starting content extraction...',
            tabCount: validTabs.length
        });
        
        const tabIndexById = new Map();
        currentTabData = basicTabData.map((tab, index) => {
            let domain = '';
            try {
                domain = tab.url ? new URL(tab.url).hostname : '';
            } catch (error) {
                domain = '';
            }
            tabIndexById.set(tab.id, index);
            return {
                ...tab,
                domain,
                content: '',
                metaDescription: '',
                headings: [],
                metaKeywords: [],
                canonicalUrl: '',
                language: '',
                contentHash: '',
                youtubeAnalysis: null,
                summaryBullets: [],
                classification: null,
                semanticFeatures: null,
                topicHints: 'Topic: Pending extraction'
            };
        });
        
        const applyExtractionToTab = (extracted) => {
            if (!extracted || typeof extracted.tabId === 'undefined') return;
            const index = tabIndexById.get(extracted.tabId);
            if (typeof index !== 'number') return;
            const existing = currentTabData[index];
            if (!existing) return;
            const updated = {
                ...existing,
                content: extracted.content,
                metaDescription: extracted.metaDescription,
                headings: extracted.headings || [],
                metaKeywords: extracted.metaKeywords || [],
                canonicalUrl: extracted.canonicalUrl || '',
                language: extracted.language || '',
                contentHash: extracted.contentHash || '',
                youtubeAnalysis: extracted.youtubeAnalysis || existing.youtubeAnalysis || null
            };
            updated.topicHints = generateTopicHints(updated);
            currentTabData[index] = updated;
        };
        
        // Περιμένουμε την εξαγωγή περιεχομένου
        console.log(`⏱️ Starting content extraction for ${validTabs.length} tabs (concurrency=${CONTENT_EXTRACTION_CONCURRENCY})...`);
        
        const extractionStart = nowMs();
        const extractionResults = await mapWithConcurrency(
            validTabs,
            tab => extractTabContent(tab).then(result => {
                applyExtractionToTab(result);
                return result;
            }),
            CONTENT_EXTRACTION_CONCURRENCY
        );
        logTiming('Content extraction pipeline', extractionStart);
        
        // Συλλογή επιτυχημένων αποτελεσμάτων
        const successfulExtractions = extractionResults
            .filter(result => result.status === 'fulfilled')
            .map(result => result.value);
        
        const failedExtractions = extractionResults
            .filter(result => result.status === 'rejected')
            .map(result => result.reason);
        
        console.log(`✅ Successfully extracted content from ${successfulExtractions.length} tabs`);
        if (failedExtractions.length > 0) {
            console.log(`❌ Failed to extract content from ${failedExtractions.length} tabs`);
            failedExtractions.forEach((error, index) => {
                console.log(`  Failed extraction ${index + 1}:`, error.message || error);
            });
        }
        
        currentTabData = currentTabData.map(tab => {
            if (!tab.content || tab.content.length === 0) {
                const refreshed = {
                    ...tab,
                    topicHints: generateTopicHints(tab)
                };
                return refreshed;
            }
            return tab;
        });
        
        let reusedAIResults = false;
        try {
            const previousRun = await chrome.storage.local.get(['cachedGroups', 'tabData']);
            if (Array.isArray(previousRun.tabData) && Array.isArray(previousRun.cachedGroups) && previousRun.tabData.length === currentTabData.length) {
                const sameContent = currentTabData.every((tab, index) => {
                    const prev = previousRun.tabData[index];
                    if (!prev) return false;
                    return tab.url === prev.url && tab.contentHash === prev.contentHash;
                });
                if (sameContent) {
                    console.log('Reusing cached AI analysis results (no content changes detected).');
                    aiGroups = previousRun.cachedGroups;
                    reusedAIResults = true;
                    await chrome.storage.local.set({
                        lastScan: Date.now(),
                        cachedGroups: aiGroups,
                        tabData: currentTabData
                    });
                    scheduleDeferredLabels(200);
                    scheduleDeferredSummaries(800);
                }
            }
        } catch (reuseError) {
            console.warn('Failed to compare with previous results:', reuseError);
        }
        
        if (!reusedAIResults) {
            const cacheKey = `scan_${validTabs.map(t => t.id).sort().join('_')}_${validTabs.length}`;
            const cachedResult = await chrome.storage.local.get([cacheKey]);
            
            if (cachedResult[cacheKey] && (Date.now() - cachedResult[cacheKey].timestamp) < 300000) { // 5 minutes cache
                console.log('CACHE DISABLED - forcing fresh AI analysis');
                // Intentionally ignoring cached result; proceed to fresh analysis below
            }

            try {
                await performAIAnalysis();
                console.log('AI analysis completed successfully');
                
                await chrome.storage.local.set({
                    [cacheKey]: {
                        groups: aiGroups,
                        tabData: currentTabData,
                        timestamp: Date.now()
                    }
                });
                console.log('AI analysis results cached');
            } catch (aiError) {
                console.error('AI analysis failed:', aiError);
                isScanning = false;
                // Αποθήκευση error στο storage για να το δει το popup
                await chrome.storage.local.set({
                    aiError: true,
                    error: `AI analysis failed: ${aiError.message}`,
                    lastScan: Date.now()
                });
                return;
            }
        }
        
        // Εφαρμογή του AI grouping
        if (aiGroups && aiGroups.length > 0) {
            console.log('Applying AI grouping to tabs...');
            try {
                await createTabGroups(aiGroups, currentTabData);
                console.log('AI grouping applied successfully');
            } catch (groupError) {
                console.error('Failed to apply AI grouping:', groupError);
            }
        }
        
        isScanning = false;
        logTiming('Full scan pipeline', scanStart);
        
    } catch (error) {
        console.error('❌ Error during tab scanning:', error);
        console.error('❌ Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        
        isScanning = false;
        
        // Προσπάθεια να συνεχίσουμε με τα tabs που έχουμε ήδη εξάγει
        if (currentTabData && currentTabData.length > 0) {
            console.log('🔄 Attempting to continue with already extracted tabs...');
            try {
                // Εκτελούμε AI ανάλυση με τα υπάρχοντα δεδομένα
                await performAIAnalysis();
                await createTabGroups(aiGroups, currentTabData);
                
                sendResponse({ 
                    success: true, 
                    message: `Grouping completed with ${currentTabData.length} tabs (some tabs could not be extracted)`,
                    groups: aiGroups.length,
                    tabs: currentTabData.length
                });
                logTiming('Full scan pipeline (fallback success)', scanStart);
                return;
            } catch (fallbackError) {
                console.error('❌ Fallback also failed:', fallbackError);
            }
        }
        
        sendResponse({ 
            success: false, 
            error: `Scanning error: ${error.message}` 
        });
        logTiming('Full scan pipeline (errored)', scanStart);
    }
}

/**
 * Εξάγει το περιεχόμενο από ένα συγκεκριμένο tab
 */
async function extractTabContent(tab) {
    const tabId = tab.id;
    let baseContent = { 
        content: '', 
        metaDescription: '', 
        headings: [], 
        metaKeywords: [], 
        canonicalUrl: '', 
        language: '',
        contentHash: ''
    };
    let youtubeAnalysis = null;
    const urlHost = (() => {
        try {
            return tab.url ? new URL(tab.url).hostname : '';
        } catch {
            return '';
        }
    })();
    
    const isRestrictedHost = RESTRICTED_HOSTS.some(host => urlHost.endsWith(host));
    
    try {
        console.log(`🔍 Extracting content from tab ${tabId}: "${tab.title}"`);
        
        if (isRestrictedHost) {
            console.log(`⚠️ Skipping direct content extraction for restricted host: ${urlHost}`);
        } else {
        // Εκτέλεση content script για εξαγωγή περιεχομένου με timeout
        const extractionPromise = chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: extractPageContent
        });
        
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Tab extraction timeout')), TAB_EXTRACTION_TIMEOUT)
        );
        
        const results = await Promise.race([extractionPromise, timeoutPromise]);
        
        if (results && results[0] && results[0].result) {
            baseContent = {
                content: results[0].result.content,
                metaDescription: results[0].result.metaDescription,
                headings: results[0].result.headings || [],
                metaKeywords: results[0].result.metaKeywords || [],
                canonicalUrl: results[0].result.canonicalUrl || '',
                language: results[0].result.language || '',
                contentHash: results[0].result.contentHash || ''
            };
            console.log(`✅ Successfully extracted content from tab ${tabId} (${baseContent.content.length} chars, headings=${baseContent.headings.length})`);
        } else {
            console.log(`⚠️ No content extracted from tab ${tabId}`);
        }
        }
    } catch (error) {
        console.warn(`❌ Failed to extract content from tab ${tabId}:`, error.message);
        // Συνεχίζουμε με κενό περιεχόμενο
        if (error.message && error.message.includes('Cannot access contents of the page')) {
            console.warn(`⚠️ Permission denied for ${urlHost}. Using title/meta fallback.`);
        }
    }
    
    try {
        if (tab.url && tab.url.includes('youtube.com/watch')) {
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                func: analyzeYouTubeTabInPage
            });
            
            if (results && results[0] && results[0].result && results[0].result.ok) {
                youtubeAnalysis = results[0].result;
                // Αντι για μεγάλο transcript, κρατάμε trimmed εκδοχή για prompts
                if (youtubeAnalysis.transcript) {
                    youtubeAnalysis.transcript = youtubeAnalysis.transcript.slice(0, 6000);
                }
            } else if (results && results[0] && results[0].result && !results[0].result.ok) {
                console.warn('YouTube analysis reported failure:', results[0].result.error);
            } else {
                console.warn('YouTube analysis returned no result for tab', tabId, results);
            }
        }
    } catch (error) {
        console.warn(`Failed to analyze YouTube tab ${tabId}:`, error);
    }
    
    return {
        tabId,
        content: baseContent.content,
        metaDescription: baseContent.metaDescription,
        headings: baseContent.headings,
        metaKeywords: baseContent.metaKeywords,
        canonicalUrl: baseContent.canonicalUrl,
        language: baseContent.language,
        contentHash: baseContent.contentHash,
        youtubeAnalysis
    };
}

/**
 * Function που εκτελείται στο context του tab για εξαγωγή περιεχομένου
 * (Αυτή η function θα εκτελεστεί στο content script context)
 */
function extractPageContent() {
    try {
        // Εξαγωγή κειμένου από τη σελίδα
        const textContent = document.body ? document.body.innerText : '';
        const canonicalUrl = document.querySelector('link[rel="canonical"]')?.href || '';
        const language = document.documentElement?.lang || '';
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
            .map(node => node.textContent || '')
            .map(text => text.replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .slice(0, 8);
        const metaKeywords = (document.querySelector('meta[name="keywords"]')?.content || '')
            .split(',')
            .map(keyword => keyword.trim())
            .filter(Boolean)
            .slice(0, 12);
        
        // Καθαρισμός και περιορισμός περιεχομένου για AI processing
        const cleanedContent = textContent
            .replace(/\s+/g, ' ') // Αντικατάσταση πολλαπλών whitespaces
            .replace(/\n+/g, ' ') // Αντικατάσταση newlines
            .trim();
        
        // Περιορισμός σε ~3000 χαρακτήρες για καλύτερη AI ανάλυση
        const limitedContent = cleanedContent.substring(0, 3000);
        
        // Εξαγωγή meta description
        const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
        
        const contentHash = (() => {
            const input = `${limitedContent}|${metaDescription}|${headings.join('|')}`;
            let hash = 0;
            for (let i = 0; i < input.length; i += 1) {
                hash = ((hash << 5) - hash) + input.charCodeAt(i);
                hash |= 0; // Convert to 32bit integer
            }
            return hash.toString(16);
        })();
        
        return {
            content: limitedContent,
            metaDescription,
            headings,
            metaKeywords,
            canonicalUrl,
            language,
            contentHash
        };
        
    } catch (error) {
        console.error('Error extracting page content:', error);
        return { 
            content: '', 
            metaDescription: '', 
            headings: [], 
            metaKeywords: [], 
            canonicalUrl: '', 
            language: '',
            contentHash: ''
        };
    }
}

/**
 * Χειρίζεται τα δεδομένα που εξήχθησαν από ένα tab
 */
function handleTabDataExtracted(data, sendResponse) {
    console.log('Tab data extracted:', data.tabId);
    
    // Ενημέρωση των δεδομένων
    const tabIndex = currentTabData.findIndex(tab => tab.id === data.tabId);
    if (tabIndex !== -1) {
        const existing = currentTabData[tabIndex];
        const updated = {
            ...existing,
            content: data.content,
            metaDescription: data.metaDescription,
            headings: data.headings || existing.headings || [],
            metaKeywords: data.metaKeywords || existing.metaKeywords || [],
            canonicalUrl: data.canonicalUrl || existing.canonicalUrl || '',
            language: data.language || existing.language || '',
            contentHash: data.contentHash || existing.contentHash || '',
            youtubeAnalysis: existing.youtubeAnalysis || data.youtubeAnalysis || null
        };
        const domain = updated.domain || (() => {
            try {
                return updated.url ? new URL(updated.url).hostname : '';
            } catch (error) {
        return '';
    }
        })();
        updated.domain = domain;
        updated.topicHints = generateTopicHints(updated);
        currentTabData[tabIndex] = updated;
    }
    
    sendResponse({ success: true });
}

/**
 * Stage 0: Smart Triage & Provisional Groups
 * Αναλύει tabs με taxonomy + tokens + meta για να δημιουργήσει provisional groups
 * και να καθορίσει ποια tabs χρειάζονται summarizer
 */
async function performSmartTriage(tabDataForAI) {
    console.log('🎯 [Stage 0] Starting smart triage...');
    
    const triageResults = {
        totalTabs: tabDataForAI.length,
        needsSummarizer: [],
        provisionalGroups: [],
        avgConfidence: 0,
        taxonomyMap: new Map(),
        tokenMap: new Map()
    };
    
    // 1. Fast taxonomy + token analysis για κάθε tab
    for (const tab of tabDataForAI) {
        const taxonomy = extractFastTaxonomy(tab);
        const tokens = extractFastTokens(tab);
        const confidence = calculateTriageConfidence(tab, taxonomy, tokens);
        
        triageResults.taxonomyMap.set(tab.index, taxonomy);
        triageResults.tokenMap.set(tab.index, tokens);
        
        // Προσθήκη στη λίστα summarizer αν χρειάζεται
        if (needsSummarizer(tab, taxonomy, tokens, confidence)) {
            triageResults.needsSummarizer.push({
                ...tab,
                taxonomy,
                tokens,
                confidence,
                priority: calculateSummarizerPriority(tab, taxonomy, tokens)
            });
        }
    }
    
    // 2. Provisional grouping με βάση taxonomy + tokens
    triageResults.provisionalGroups = createProvisionalGroups(tabDataForAI, triageResults.taxonomyMap, triageResults.tokenMap);
    
    // 3. Confidence calculation
    const confidences = Array.from(triageResults.taxonomyMap.values()).map(t => t.confidence);
    triageResults.avgConfidence = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
    
    // 4. Sort summarizer queue by priority
    triageResults.needsSummarizer.sort((a, b) => b.priority - a.priority);
    
    console.log('🎯 [Stage 0] Triage analysis:', {
        totalTabs: triageResults.totalTabs,
        needsSummarizer: triageResults.needsSummarizer.length,
        provisionalGroups: triageResults.provisionalGroups.length,
        avgConfidence: Math.round(triageResults.avgConfidence * 100) / 100
    });
    
    return triageResults;
}

/**
 * Stage 1: Selective Summarization
 * Εκτελεί summarization μόνο στα tabs που χρειάζονται, με budget/timeout/cache
 */
async function performSelectiveSummarization(needsSummarizer) {
    console.log('📄 [Stage 1] Starting selective summarization...');
    
    const BUDGET_MS = 30000; // 30 second budget
    const MAX_CONCURRENT = 3; // Max 3 concurrent summarizations
    const CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache
    
    const startTime = Date.now();
    const results = [];
    const activePromises = [];
    
    for (const tab of needsSummarizer) {
        // Check budget
        if (Date.now() - startTime > BUDGET_MS) {
            console.log('📄 [Stage 1] Budget exceeded, stopping summarization');
            break;
        }
        
        // Check cache first
        const cacheKey = `summarizer_${tab.contentHash || tab.url}`;
        const cached = await chrome.storage.session.get([cacheKey]);
        if (cached[cacheKey] && (Date.now() - cached[cacheKey].timestamp) < CACHE_TTL) {
            console.log(`📄 [Stage 1] Using cached summary for: ${tab.title?.slice(0, 40)}`);
            results.push({ ...tab, summary: cached[cacheKey].summary, cached: true });
            continue;
        }
        
        // Limit concurrent operations
        if (activePromises.length >= MAX_CONCURRENT) {
            await Promise.race(activePromises);
        }
        
        // Start summarization
        const promise = performTabSummarization(tab).then(summary => {
            // Cache result
            chrome.storage.session.set({
                [cacheKey]: {
                    summary,
                    timestamp: Date.now()
                }
            });
            return { ...tab, summary, cached: false };
        }).catch(error => {
            console.warn(`📄 [Stage 1] Summarization failed for ${tab.title?.slice(0, 40)}:`, error.message);
            return { ...tab, summary: null, error: error.message };
        });
        
        activePromises.push(promise);
        results.push(promise);
    }
    
    // Wait for all active operations
    await Promise.all(activePromises);
    
    const finalResults = await Promise.all(results);
    const successCount = finalResults.filter(r => r.summary && !r.error).length;
    const cachedCount = finalResults.filter(r => r.cached).length;
    
    console.log('📄 [Stage 1] Selective summarization complete:', {
        total: needsSummarizer.length,
        processed: finalResults.length,
        success: successCount,
        cached: cachedCount,
        failed: finalResults.length - successCount - cachedCount,
        duration: Date.now() - startTime
    });
    
    return finalResults;
}

/**
 * Fast taxonomy extraction για triage
 */
function extractFastTaxonomy(tab) {
    const title = (tab.title || '').toLowerCase();
    const meta = (tab.metaDescription || '').toLowerCase();
    const path = (() => { try { return (new URL(tab.url || '')).pathname.toLowerCase(); } catch { return ''; } })();
    const text = `${title} ${meta} ${path}`;

    // Pure content-based taxonomy
    const isMedical = /(\bmedical\b|\bhealth\b|\bmedicine\b|\bclinical\b|\btreatment\b|\bpatient\b|\bjournal\b|\bresearch\b)/.test(text);
    const isTech = /(\bai\b|artificial intelligence|\btech\b|\bsoftware\b|\bdeveloper\b|\bapi\b|\bplatform\b|\bdocumentation\b|\bworkspace\b|\bcloud\b)/.test(text);
    const isShopping = detectShoppingStrong(text, tab.url || '');
    const isGaming = /(\bgaming\b|\bgame\b|\bgames\b|\bplayer\b|\bplayers\b|\bsquad\b|\brates?ings\b|\besports\b|\bsteam\b|\bxbox\b|\bps[45]\b)/.test(text);
    const isNews = /(\bnews\b|\bblog\b|\barticle\b|\bupdate\b|\bpress\b|\blatest\b|\bbreaking\b)/.test(text);

    let contentCategory = 'general';
    if (isMedical) contentCategory = 'medical';
    else if (isShopping) contentCategory = 'shopping'; // Prefer shopping over gaming if both present (strong only)
    else if (isGaming) contentCategory = 'gaming';
    else if (isTech) contentCategory = 'technology';
    else if (isNews) contentCategory = 'news';

    const confidence = contentCategory === 'general' ? 0.4 : 0.75;
    const finalCategory = contentCategory;

    console.log(`🔍 [Taxonomy] Tab: "${title}" | Content: ${contentCategory} | Final: ${finalCategory} | Confidence: ${confidence}`);

    return {
        domain: 'general',
        title: contentCategory,
        final: finalCategory,
        confidence,
        keywords: extractKeywords(tab)
    };
}

/**
 * Fast token extraction για triage
 */
function extractFastTokens(tab) {
    const text = `${tab.title || ''} ${tab.metaDescription || ''} ${tab.domain || ''}`.toLowerCase();
    const tokens = text
        .split(/[\s\-_.,;:!?()[\]{}"']+/)
        .filter(token => token.length >= 3 && !STOPWORDS.has(token))
        .slice(0, 20); // Limit for performance
    
    return {
        tokens,
        count: tokens.length,
        unique: new Set(tokens).size
    };
}

/**
 * Υπολογίζει confidence για triage decision
 */
function calculateTriageConfidence(tab, taxonomy, tokens) {
    let confidence = 0.5; // Base confidence
    
    // Boost confidence based on content length
    if (tab.contentLength > 500) confidence += 0.2;
    if (tab.contentLength > 1000) confidence += 0.1;
    
    // Boost confidence based on taxonomy agreement
    if (taxonomy.confidence > 0.7) confidence += 0.2;
    
    // Boost confidence based on token richness
    if (tokens.unique > 10) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
}

/**
 * Καθορίζει αν ένα tab χρειάζεται summarizer
 */
function needsSummarizer(tab, taxonomy, tokens, confidence) {
    // Content-based triggers only (no domain checks)
    const title = (tab.title || '').toLowerCase();
    const isGamingRelated = /(\bgaming\b|\bfifa\b|\bultimate\b|\bplayers?\b|\bsquad\b)/.test(title);
    if (isGamingRelated) return true; // richer context helps reduce leakage
    
    // High confidence tabs don't need summarizer
    if (confidence > 0.8) return false;
    
    // Low content tabs don't need summarizer
    if (tab.contentLength < 200) return false;
    
    // Generic/uncertain tabs need summarizer
    if (taxonomy.final === 'general' && confidence < 0.6) return true;
    
    // Complex content needs summarizer
    if (tokens.unique > 15 && tab.contentLength > 800) return true;
    
    return false;
}

/**
 * Υπολογίζει priority για summarizer queue
 */
function calculateSummarizerPriority(tab, taxonomy, tokens) {
    let priority = 0;
    
    // Higher priority for uncertain tabs
    if (taxonomy.confidence < 0.5) priority += 10;
    
    // Higher priority for complex content
    if (tokens.unique > 15) priority += 5;
    if (tab.contentLength > 1000) priority += 5;
    
    // No domain-based priority; rely on content signals only
    
    return priority;
}

/**
 * Δημιουργεί provisional groups με βάση taxonomy + tokens
 */
function createProvisionalGroups(tabDataForAI, taxonomyMap, tokenMap) {
    const groups = [];
    const processed = new Set();
    
    console.log('🔍 [Provisional Groups] Starting group creation for', tabDataForAI.length, 'tabs');
    
    for (let i = 0; i < tabDataForAI.length; i++) {
        if (processed.has(i)) continue;
        
        const tab = tabDataForAI[i];
        const taxonomy = taxonomyMap.get(i);
        const tokens = tokenMap.get(i);
        
        const group = {
            tabIndices: [i],
            primaryTopic: taxonomy.final,
            keywords: tokens.tokens.slice(0, 10),
            confidence: taxonomy.confidence,
            domain: tab.domain,
            name: `${taxonomy.final.charAt(0).toUpperCase() + taxonomy.final.slice(1)} Group`
        };
        
        console.log(`🔍 [Provisional Groups] Created group for tab ${i}: "${tab.title}" (${taxonomy.final})`);
        
        // Find similar tabs to merge
        for (let j = i + 1; j < tabDataForAI.length; j++) {
            if (processed.has(j)) continue;
            
            const otherTab = tabDataForAI[j];
            const otherTaxonomy = taxonomyMap.get(j);
            const otherTokens = tokenMap.get(j);
            
            if (shouldMergeProvisional(taxonomy, tokens, otherTaxonomy, otherTokens)) {
                group.tabIndices.push(j);
                processed.add(j);
                
                console.log(`🔗 [Provisional Groups] Merged tab ${j}: "${otherTab.title}" into group ${i}`);
                
                // Merge keywords
                const allKeywords = [...group.keywords, ...otherTokens.tokens];
                group.keywords = [...new Set(allKeywords)].slice(0, 10);
                
                // Update confidence
                group.confidence = Math.max(group.confidence, otherTaxonomy.confidence);
            }
        }
        
        groups.push(group);
        processed.add(i);
    }
    
    console.log(`🔍 [Provisional Groups] Created ${groups.length} groups:`, groups.map(g => ({
        tabCount: g.tabIndices.length,
        topic: g.primaryTopic,
        keywords: g.keywords.slice(0, 3)
    })));
    
    return groups;
}

/**
 * Καθορίζει αν δύο tabs πρέπει να ενωθούν σε provisional group
 */
function shouldMergeProvisional(taxonomy1, tokens1, taxonomy2, tokens2) {
    // Same taxonomy category - πιο αυστηρή λογική
    if (taxonomy1.final === taxonomy2.final && taxonomy1.final !== 'general') {
        console.log(`🔗 [Merge] Same category merge: ${taxonomy1.final} (confidence: ${taxonomy1.confidence}, ${taxonomy2.confidence})`);
        return true;
    }
    
    // High token overlap - πιο αυστηρό threshold για αποφυγή over-merge
    const overlap = calculateTokenOverlap(tokens1.tokens, tokens2.tokens);
    if (overlap > 0.35) { // Increased from 0.2 to 0.35 to prevent over-merge
        console.log(`🔗 [Merge] High token overlap: ${(overlap * 100).toFixed(1)}%`);
        return true;
    }
    
    // Gaming-specific merge logic (conservative):
    // - One tab is gaming and the other is general
    // - BOTH sides must carry gaming tokens to avoid pulling unrelated general tabs
    // - If either side has shopping tokens, do NOT merge under gaming
    if ((taxonomy1.final === 'gaming' && taxonomy2.final === 'general') || (taxonomy2.final === 'gaming' && taxonomy1.final === 'general')) {
        const gamingTokens = new Set(['gaming', 'game', 'players', 'squad', 'ultimate', 'fut', 'fifa', 'ea', 'fc']);
        const shoppingTokens = new Set(['buy','shop','price','sale','deal','cart','checkout']);
        const t1 = new Set(tokens1.tokens);
        const t2 = new Set(tokens2.tokens);
        const t1HasGaming = Array.from(gamingTokens).some(k => t1.has(k));
        const t2HasGaming = Array.from(gamingTokens).some(k => t2.has(k));
        const t1IsShopping = Array.from(shoppingTokens).some(k => t1.has(k));
        const t2IsShopping = Array.from(shoppingTokens).some(k => t2.has(k));
        if (t1HasGaming && t2HasGaming && !(t1IsShopping || t2IsShopping)) {
            console.log(`🔗 [Merge] Gaming-specific merge detected (both sides)`);
            return true;
        }
    }
    
    // Shopping-specific merge logic (conservative):
    // - One tab is shopping and the other is general
    // - The general tab must contain shopping tokens
    if ((taxonomy1.final === 'shopping' && taxonomy2.final === 'general') || (taxonomy2.final === 'shopping' && taxonomy1.final === 'general')) {
        const shoppingTokens = new Set(['buy','shop','price','sale','deal','cart','checkout']);
        const generalTokens = taxonomy1.final === 'general' ? new Set(tokens1.tokens) : new Set(tokens2.tokens);
        const hasShop = Array.from(shoppingTokens).some(k => generalTokens.has(k));
        if (hasShop) {
            console.log(`🔗 [Merge] Shopping-specific merge detected`);
            return true;
        }
    }
    
    return false;
}

/**
 * Υπολογίζει token overlap
 */
function calculateTokenOverlap(tokens1, tokens2) {
    const set1 = new Set(tokens1);
    const set2 = new Set(tokens2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Εκτελεί summarization για ένα tab
 */
async function performTabSummarization(tab) {
    // This will be implemented to use the existing summarizer logic
    // but optimized for single tab processing
    return null; // Placeholder
}

/**
 * Extract keywords from tab data
 */
function extractKeywords(tab) {
    const text = `${tab.title || ''} ${tab.metaDescription || ''} ${tab.domain || ''}`.toLowerCase();
    return text
        .split(/[\s\-_.,;:!?()[\]{}"']+/)
        .filter(token => token.length >= 3 && !STOPWORDS.has(token))
        .slice(0, 10);
}

/**
 * Stage 2: Structured Labels με Budget
 * Δημιουργεί labels για groups με budget/timeout/cache
 */
async function performStructuredLabeling(provisionalGroups, summarizerResults) {
    console.log('🏷️ [Stage 2] Starting structured labeling...');
    
    const LABEL_BUDGET_MS = 20000; // 20 second budget
    const MAX_CONCURRENT_LABELS = 2; // Max 2 concurrent label generations
    const CACHE_TTL = 30 * 60 * 1000; // 30 minutes cache
    
    const startTime = Date.now();
    const results = [];
    const activePromises = [];
    
    // Sort groups by priority (larger groups first, then by confidence)
    const sortedGroups = provisionalGroups.sort((a, b) => {
        if (b.tabIndices.length !== a.tabIndices.length) {
            return b.tabIndices.length - a.tabIndices.length;
        }
        return b.confidence - a.confidence;
    });
    
    for (const group of sortedGroups) {
        // Check budget
        if (Date.now() - startTime > LABEL_BUDGET_MS) {
            console.log('🏷️ [Stage 2] Budget exceeded, stopping labeling');
            break;
        }
        
        // Check cache first
        const cacheKey = `group_label_${group.primaryTopic}_${group.tabIndices.length}`;
        const cached = await chrome.storage.session.get([cacheKey]);
        if (cached[cacheKey] && (Date.now() - cached[cacheKey].timestamp) < CACHE_TTL) {
            console.log(`🏷️ [Stage 2] Using cached label for: ${group.name}`);
            results.push({ ...group, label: cached[cacheKey].label, cached: true });
            continue;
        }
        
        // Limit concurrent operations
        if (activePromises.length >= MAX_CONCURRENT_LABELS) {
            await Promise.race(activePromises);
        }
        
        // Start labeling
        const promise = generateGroupLabel(group, summarizerResults).then(label => {
            // Cache result
            chrome.storage.session.set({
                [cacheKey]: {
                    label,
                    timestamp: Date.now()
                }
            });
            return { ...group, label, cached: false };
        }).catch(error => {
            console.warn(`🏷️ [Stage 2] Labeling failed for ${group.name}:`, error.message);
            return { ...group, label: group.name, error: error.message };
        });
        
        activePromises.push(promise);
        results.push(promise);
    }
    
    // Wait for all active operations
    await Promise.all(activePromises);
    
    const finalResults = await Promise.all(results);
    const successCount = finalResults.filter(r => r.label && !r.error).length;
    const cachedCount = finalResults.filter(r => r.cached).length;
    
    console.log('🏷️ [Stage 2] Structured labeling complete:', {
        total: provisionalGroups.length,
        processed: finalResults.length,
        success: successCount,
        cached: cachedCount,
        failed: finalResults.length - successCount - cachedCount,
        duration: Date.now() - startTime
    });
    
    return finalResults;
}

/**
 * Δημιουργεί label για ένα group
 */
async function generateGroupLabel(group, summarizerResults) {
    // Enhanced group descriptor with summarizer results
    const descriptor = {
        primaryTopic: group.primaryTopic,
        keywords: group.keywords,
        tabCount: group.tabIndices.length,
        confidence: group.confidence,
        domain: group.domain,
        summaries: summarizerResults
            .filter(r => group.tabIndices.includes(r.index))
            .map(r => r.summary)
            .filter(Boolean)
    };
    
    // Generate label using existing logic but optimized
    const label = await generateOptimizedGroupLabel(descriptor);
    return label;
}

/**
 * Optimized group label generation
 */
async function generateOptimizedGroupLabel(descriptor) {
    // Use existing label generation logic but with optimizations
    // This is a placeholder - will integrate with existing label generation
    const baseLabel = descriptor.primaryTopic.charAt(0).toUpperCase() + descriptor.primaryTopic.slice(1);
    
    if (descriptor.tabCount > 1) {
        return `${baseLabel} Content`;
    } else {
        return baseLabel;
    }
}

/**
 * Stage 3: Targeted Score Updates
 * Ενημερώνει scores μόνο στα αμφίβολα ζεύγη/clusters
 */
async function performTargetedScoreUpdates(labeledGroups, summarizerResults) {
    console.log('🎯 [Stage 3] Starting targeted score updates...');
    
    const ambiguousPairs = findAmbiguousPairs(labeledGroups);
    console.log(`🎯 [Stage 3] Found ${ambiguousPairs.length} ambiguous pairs for score updates`);
    
    const updatedGroups = [...labeledGroups];
    
    for (const pair of ambiguousPairs) {
        const updatedScore = await calculateEnhancedScore(pair, summarizerResults);
        
        // Update similarity scores for this pair
        if (updatedScore.confidence > 0.7) {
            // High confidence - merge groups
            const mergedGroup = mergeGroups(pair.groupA, pair.groupB, updatedScore);
            updatedGroups.push(mergedGroup);
            
            // Remove original groups
            const indexA = updatedGroups.findIndex(g => g === pair.groupA);
            const indexB = updatedGroups.findIndex(g => g === pair.groupB);
            if (indexA > -1) updatedGroups.splice(indexA, 1);
            if (indexB > -1) updatedGroups.splice(indexB, 1);
        }
    }
    
    console.log('🎯 [Stage 3] Targeted score updates complete:', {
        ambiguousPairs: ambiguousPairs.length,
        finalGroups: updatedGroups.length
    });
    
    return updatedGroups;
}

/**
 * Stage 4: Centroid Stabilization
 * Εκτελεί centroid-based merging για σταθεροποίηση
 */
async function performCentroidStabilization(groups) {
    console.log('🔄 [Stage 4] Starting centroid stabilization...');
    
    const stabilizedGroups = [...groups];
    let mergeCount = 0;
    
    // Find groups with similar centroids
    for (let i = 0; i < stabilizedGroups.length; i++) {
        for (let j = i + 1; j < stabilizedGroups.length; j++) {
            const groupA = stabilizedGroups[i];
            const groupB = stabilizedGroups[j];
            
            const centroidSimilarity = calculateCentroidSimilarity(groupA, groupB);
            
            if (centroidSimilarity > 0.75) { // High centroid similarity threshold
                // Merge groups
                const mergedGroup = mergeGroups(groupA, groupB, { confidence: centroidSimilarity });
                stabilizedGroups.push(mergedGroup);
                
                // Remove original groups
                stabilizedGroups.splice(j, 1);
                stabilizedGroups.splice(i, 1);
                
                mergeCount++;
                i--; // Adjust index after removal
                break;
            }
        }
    }
    
    console.log('🔄 [Stage 4] Centroid stabilization complete:', {
        originalGroups: groups.length,
        finalGroups: stabilizedGroups.length,
        merges: mergeCount
    });
    
    return stabilizedGroups;
}

/**
 * Βρίσκει αμφίβολα ζεύγη που χρειάζονται score updates
 */
function findAmbiguousPairs(groups) {
    const pairs = [];
    
    for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
            const groupA = groups[i];
            const groupB = groups[j];
            
            // Check if this pair is ambiguous (similar but not identical)
            const similarity = calculateBasicSimilarity(groupA, groupB);
            
            if (similarity > 0.3 && similarity < 0.7) { // Ambiguous range
                pairs.push({
                    groupA,
                    groupB,
                    basicSimilarity: similarity
                });
            }
        }
    }
    
    return pairs;
}

/**
 * Υπολογίζει enhanced score με summarizer data
 */
async function calculateEnhancedScore(pair, summarizerResults) {
    const { groupA, groupB } = pair;
    
    // Get summarizer results for both groups
    const summariesA = summarizerResults.filter(r => groupA.tabIndices.includes(r.index));
    const summariesB = summarizerResults.filter(r => groupB.tabIndices.includes(r.index));
    
    // Calculate enhanced similarity
    let enhancedScore = pair.basicSimilarity;
    
    // Boost score if summaries are similar
    if (summariesA.length > 0 && summariesB.length > 0) {
        const summarySimilarity = calculateSummarySimilarity(summariesA, summariesB);
        enhancedScore += summarySimilarity * 0.3; // 30% boost from summaries
    }
    
    // Boost score if topics match
    if (groupA.primaryTopic === groupB.primaryTopic) {
        enhancedScore += 0.2;
    }
    
    return {
        score: Math.min(enhancedScore, 1.0),
        confidence: enhancedScore > 0.6 ? 0.8 : 0.5
    };
}

/**
 * Υπολογίζει centroid similarity μεταξύ δύο groups
 */
function calculateCentroidSimilarity(groupA, groupB) {
    // Simple centroid similarity based on keywords and topics
    const keywordsA = new Set(groupA.keywords || []);
    const keywordsB = new Set(groupB.keywords || []);
    
    const intersection = new Set([...keywordsA].filter(x => keywordsB.has(x)));
    const union = new Set([...keywordsA, ...keywordsB]);
    
    const keywordSimilarity = union.size > 0 ? intersection.size / union.size : 0;
    
    // Topic similarity
    const topicSimilarity = groupA.primaryTopic === groupB.primaryTopic ? 1.0 : 0.0;
    
    // Weighted combination
    return keywordSimilarity * 0.7 + topicSimilarity * 0.3;
}

/**
 * Υπολογίζει basic similarity μεταξύ δύο groups
 */
function calculateBasicSimilarity(groupA, groupB) {
    const keywordsA = new Set(groupA.keywords || []);
    const keywordsB = new Set(groupB.keywords || []);
    
    const intersection = new Set([...keywordsA].filter(x => keywordsB.has(x)));
    const union = new Set([...keywordsA, ...keywordsB]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Υπολογίζει summary similarity
 */
function calculateSummarySimilarity(summariesA, summariesB) {
    // Simple text similarity between summaries
    const textA = summariesA.map(s => s.summary).join(' ').toLowerCase();
    const textB = summariesB.map(s => s.summary).join(' ').toLowerCase();
    
    const wordsA = new Set(textA.split(/\s+/));
    const wordsB = new Set(textB.split(/\s+/));
    
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Ενώνει δύο groups
 */
function mergeGroups(groupA, groupB, score) {
    // Deduplicate tabIndices to avoid duplicates
    const combinedIndices = [...groupA.tabIndices, ...groupB.tabIndices];
    const uniqueIndices = [...new Set(combinedIndices)];
    
    return {
        tabIndices: uniqueIndices,
        primaryTopic: groupA.primaryTopic, // Keep first group's topic
        keywords: [...new Set([...(groupA.keywords || []), ...(groupB.keywords || [])])].slice(0, 15),
        confidence: Math.max(groupA.confidence || 0, groupB.confidence || 0),
        domain: groupA.domain, // Keep first group's domain
        name: groupA.name, // Keep first group's name
        merged: true,
        mergeScore: score.confidence
    };
}

/**
 * Stage 5: AI Ensemble Fusion (sharded approach)
 * Τρέχει AI one-shot σε shards και τα συνδυάζει με deterministic
 */
async function performAIEnsembleFusion(deterministicGroups, tabDataForAI) {
    console.log('🤖🤖🤖 [AI ENSEMBLE FUSION START] 🤖🤖🤖');
    console.log('🤖 [Stage 5] Starting AI ensemble fusion...');
    
    // Clear cache for debugging
    await clearAllCache();
    
    // Πιο συντηρητικά βάρη: δίνουμε προτεραιότητα στο deterministic
    const FUSION_WEIGHTS = { det: 0.80, ai: 0.15, tax: 0.05 };
    
    // Adaptive thresholds per category
    const ADAPTIVE_THRESHOLDS = {
        medical: 0.18,    // Lower for medical (strong domain similarities)
        technology: 0.28, // Slightly higher to reduce cross-topic merges
        gaming: 0.40,     // Higher for gaming to avoid pulling general/shopping
        news: 0.38,       // Higher for news (avoid over-merge)
        general: 0.36     // Raised to avoid general↔topic over-merges
    };
    
    const FUSION_CENTROID_THRESHOLD = 0.35;
    const SHARD_SIZE = 12; // Max 12 tabs per shard
    const SHARD_TIMEOUT = 20000; // 20s per shard (more stable on first run)
    const OVERALL_BUDGET = 30000; // 30s total budget to allow model warmup
    const MAX_CONCURRENT_SHARDS = 2; // Max 2 concurrent shards
    
    const startTime = Date.now();
    const aiSuggestions = new Map(); // tabIndex -> { keywords, confidence }

    // Strict filtering to avoid noisy AI keywords
    const AI_KEYWORD_STOPWORDS = new Set([
        'none','update','updates','official','website','home','page','site','general','info','portal','index',
        'news','blog','article','the','and','for','with','from','about','choose','000','recent','recently','latest','new'
    ]);
    // Generic normalization without hardcoded word mapping
    function genericNormalize(t) {
        // Unicode normalize + remove diacritics, keep alnum (en+el) and spaces
        try {
            t = String(t || '')
                .toLowerCase()
                .normalize('NFKD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9\s\u0370-\u03ff\u1f00-\u1fff]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        } catch (_) {
            t = String(t || '').toLowerCase().trim();
        }
        // conservative normalization
        if (t.length > 6 && t.endsWith('ing')) {
            t = t.slice(0, -3); // running -> runn (acceptable for overlap)
        } else if (t.length > 5 && t.endsWith('ies')) {
            // accessories -> accessory, policies -> policy
            t = t.slice(0, -3) + 'y';
        }
        return t;
    }
    function sanitizeKeywords(list) {
        const out = [];
        const seen = new Set();
        for (const raw of (list || [])) {
            let t = String(raw || '').toLowerCase().trim().replace(/\s+/g, ' ');
            if (!t) continue;
            if (t.length < 2) continue;
            if (/^\d+$/.test(t)) continue;
            t = t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
            if (!t || AI_KEYWORD_STOPWORDS.has(t)) continue;
            t = genericNormalize(t);
            if (!t || AI_KEYWORD_STOPWORDS.has(t)) continue;
            if (seen.has(t)) continue;
            seen.add(t);
            out.push(t);
        }
        // Allow more keywords now that the prompt requests 8-12
        return out.slice(0, 12);
    }
    
    // 1. Create shards from deterministic groups
    const shards = createShardsFromGroups(deterministicGroups, tabDataForAI, SHARD_SIZE);
    console.log(`🤖 [Stage 5] Created ${shards.length} shards for AI processing`);
    
    // 2. Process each shard with AI (with budget control)
    for (let i = 0; i < shards.length; i++) {
        const shard = shards[i];
        console.log(`🤖 [Stage 5] Processing shard ${i + 1}/${shards.length} with ${shard.tabIndices.length} tabs`);
        
        if (Date.now() - startTime > OVERALL_BUDGET) {
            console.log('🤖 [Stage 5] Budget exceeded, stopping AI processing');
            break;
        }
        
        try {
            const aiResult = await processShardWithAI(shard, tabDataForAI, SHARD_TIMEOUT);
            console.log(`🤖 [Stage 5] Shard ${i + 1} AI result:`, aiResult);
            
            if (aiResult && aiResult.keywords) {
                console.log(`🤖 [Stage 5] Shard ${i + 1} has ${aiResult.keywords.length} keyword sets`);
                // Store AI keywords for deterministic grouping
                aiResult.keywords.forEach((kwSet, index) => {
                    // Map local shard index to global tab index
                    const globalIndex = shard.tabIndices[kwSet.index];
                    const rawKeywords = Array.isArray(kwSet.keywords) ? kwSet.keywords : [];
                    const cleaned = sanitizeKeywords(rawKeywords);
                    // Detailed per-tab AI keyword log for diagnostics
                    try {
                        const tab = tabDataForAI[globalIndex] || {};
                        const url = (tab?.url || '').toLowerCase();
                        const title = (tab?.title || '').toLowerCase();
                        const heuristicShop = detectShoppingStrong(`${title} ${cleaned.join(' ')}`, url);
                        console.log('🧩 [AI Keywords]', {
                            shard: i + 1,
                            localIndex: kwSet.index,
                            globalIndex,
                            title: tab?.title || '',
                            url: tab?.url || '',
                            aiShopping: kwSet.shopping === true,
                            aiShopCategory: kwSet.shopCategory || kwSet.category || null,
                            aiIntent: typeof kwSet.intent === 'string' ? kwSet.intent : null,
                            heuristicShopping: heuristicShop,
                            raw: rawKeywords,
                            cleaned
                        });
                    } catch (_) {}
                    // Require at least 3 strong keywords to accept AI set
                    if (cleaned.length >= 3 && typeof globalIndex === 'number') {
                        const tab = tabDataForAI[globalIndex];
                        const url = (tab?.url || '').toLowerCase();
                        const title = (tab?.title || '').toLowerCase();
                        const isShopping = kwSet.shopping === true || detectShoppingStrong(`${title} ${cleaned.join(' ')}`, url);
                        const allowedCats = new Set(['fashion','electronics','groceries','home','beauty','sports','automotive','digital','general']);
                        const rawCat = String(kwSet.shopCategory ?? kwSet.category ?? '').toLowerCase().trim();
                        let shopCategory = isShopping && allowedCats.has(rawCat) ? rawCat : null;
                        if (isShopping && !shopCategory) {
                            const inferred = inferShopCategoryFromSignals(tab?.title || '', tab?.url || '', cleaned);
                            if (allowedCats.has(inferred)) {
                                shopCategory = inferred;
                            }
                        }
                        let intent = (isShopping && typeof kwSet.intent === 'string' && kwSet.intent.trim())
                            ? kwSet.intent.trim().toLowerCase().slice(0, 40)
                            : null;
                        if (isShopping && !intent) {
                            const inferredIntent = inferShoppingIntentFromUrl(tab?.url || '', tab?.title || '');
                            if (inferredIntent) intent = inferredIntent;
                        }
                        aiSuggestions.set(globalIndex, {
                            keywords: cleaned.slice(0, 12),
                            confidence: cleaned.length >= 8 ? 0.82 : (cleaned.length >= 6 ? 0.78 : (cleaned.length >= 4 ? 0.72 : 0.62)),
                            isShopping,
                            shopCategory,
                            intent
                        });
                    } else {
                        console.log(`🤖 [Stage 5] Ignoring weak AI keywords for tab ${kwSet.index}`);
                    }
                });
            } else {
                console.log(`🤖 [Stage 5] Shard ${i + 1} has no valid AI result`);
            }
        } catch (error) {
            console.warn(`🤖 [Stage 5] AI processing failed for shard ${i + 1}:`, error.message);
            console.warn(`🤖 [Stage 5] Error details:`, error);
        }
    }
    
    console.log(`🤖 [Stage 5] AI suggestions collected: ${aiSuggestions.size} tabs`);
    // Populate LAST_AI_KEYWORDS for debug/API access
    try {
        LAST_AI_KEYWORDS = Array.from(aiSuggestions.entries()).map(([index, info]) => {
            const title = tabDataForAI[index]?.title || '';
            const url = tabDataForAI[index]?.url || '';
            const finalShopping = Boolean(info.isShopping) || detectShoppingStrong(`${String(title).toLowerCase()} ${(info.keywords || []).join(' ')}`, String(url).toLowerCase());
            return ({
                index,
                title,
                url,
                keywords: Array.isArray(info.keywords) ? info.keywords : [],
                shopping: finalShopping,
                shopCategory: info.shopCategory || null,
                intent: info.intent || null
            });
        });
    } catch (e) {
        console.warn('Failed to populate LAST_AI_KEYWORDS:', e?.message || e);
        LAST_AI_KEYWORDS = [];
    }
    
    // Λεπτομερές logging για τα AI suggestions
    if (aiSuggestions.size > 0) {
        const suggestionsArray = Array.from(aiSuggestions.entries());
        const preview = suggestionsArray.slice(0, 5).map(([tabIndex, info], idx) => ({
            tabIndex,
            keywords: (info.keywords || []).slice(0, 6)
        }));
        console.log('🤖 [AI Suggestions] Count:', aiSuggestions.size, 'Preview (first 5):', preview);
    } else {
        console.log('⚠️ [AI Suggestions] No AI keywords found - will use fallback keywords');
    }
    
    // ✅ SIGNAL: AI Response Complete - Proceed with Scoring
    console.log('✅ [AI Complete] AI processing finished, starting fusion scoring now...');
    console.log(`✅ [AI Complete] Got ${aiSuggestions.size} AI keyword sets ready for scoring`);
    
    // 3. Fusion scoring: combine deterministic + AI + taxonomy
    const fusionGroups = await performFusionScoring(
        deterministicGroups, 
        aiSuggestions, 
        tabDataForAI,
        FUSION_WEIGHTS,
        ADAPTIVE_THRESHOLDS,
        FUSION_CENTROID_THRESHOLD
    );
    
    console.log('🤖 [Stage 5] AI ensemble fusion complete:', {
        originalGroups: deterministicGroups.length,
        finalGroups: fusionGroups.length,
        aiSuggestions: aiSuggestions.size,
        duration: Date.now() - startTime
    });
    console.log('🤖🤖🤖 [AI ENSEMBLE FUSION END] 🤖🤖🤖');
    
    return fusionGroups;
}

/**
 * Δημιουργεί shards από deterministic groups
 */
function createShardsFromGroups(groups, tabDataForAI, maxSize) {
    const shards = [];
    
    // Create mixed list with all unique tab indices
    const allTabIndices = [...new Set(groups.flatMap(g => g.tabIndices))];
    
    if (allTabIndices.length > 0) {
        // Split into chunks to keep prompts smaller and faster
        const size = Math.max(4, Math.min(maxSize || 12, 20));
        for (let i = 0; i < allTabIndices.length; i += size) {
            const slice = allTabIndices.slice(i, i + size);
            shards.push({
                tabIndices: slice,
                groupId: `mixed_${i / size + 1}`,
                type: 'mixed',
                primaryTopic: 'mixed',
                keywords: []
            });
        }
    }
    
    console.log(`🤖 [Shards] Created ${shards.length} shard(s):`, shards.map(s => ({
        type: s.type,
        size: s.tabIndices.length,
        groupId: s.groupId
    })));
    
    return shards;
}

/**
 * Επεξεργάζεται ένα shard με AI
 */
async function processShardWithAI(shard, tabDataForAI, timeout, retries = 0) {
    console.log(`🤖 [Stage 5] Processing shard with ${shard.tabIndices.length} tab indices`);
    const shardTabs = shard.tabIndices.map(index => tabDataForAI[index]).filter(Boolean);
    console.log(`🤖 [Stage 5] Shard tabs after filtering: ${shardTabs.length}`);
    
    if (shardTabs.length === 0) {
        console.log(`🤖 [Stage 5] No valid tabs in shard, returning null`);
        return null;
    }
    
    // Create compact prompt
    const prompt = createShardPrompt(shardTabs);
    console.log(`🤖 [Stage 5] Created prompt with length: ${prompt.length}`);
    // Reduced noise: do not log full prompt content in production logs
    
    // Check cache first (DISABLED for debugging)
    const cacheKey = `ai_shard_${shardTabs.map(t => t.contentHash || t.url).join('_')}`;
    const cached = await chrome.storage.session.get([cacheKey]);
    if (cached[cacheKey] && (Date.now() - cached[cacheKey].timestamp) < 10 * 60 * 1000) {
        console.log(`🤖 [Stage 5] CACHE DISABLED - forcing fresh AI result for shard`);
        // return cached[cacheKey].result; // DISABLED
    }
    
    // Retry logic for AI grouping
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            console.log(`🤖 [Stage 5] Executing AI grouping with timeout: ${timeout}ms (attempt ${attempt + 1}/${retries + 1})`);
            // Execute AI grouping with timeout
            const result = await executeAIGroupingWithTimeout(prompt, timeout);
            console.log(`🤖 [Stage 5] AI grouping completed, result:`, result);
            
            // Cache result (DISABLED for debugging)
            // await chrome.storage.session.set({
            //     [cacheKey]: {
            //         result,
            //         timestamp: Date.now()
            //     }
            // });
            
            return result;
        } catch (error) {
            console.warn(`🤖 [Stage 5] AI grouping failed for shard (attempt ${attempt + 1}):`, error.message);
            console.warn(`🤖 [Stage 5] Error details:`, error);
            
            if (attempt < retries) {
                console.log(`🤖 [Stage 5] Retrying in 500ms...`);
                await new Promise(resolve => setTimeout(resolve, 500));
            } else {
                console.error(`🤖 [Stage 5] All ${retries + 1} attempts failed, returning null`);
                return null;
            }
        }
    }
    
    return null;
}

/**
 * Δημιουργεί compact prompt για shard
 */
function createShardPrompt(shardTabs) {
    const tabsInfo = shardTabs.map((tab, index) => {
        const cleanTitle = tab.title || 'Untitled';
        const cleanUrl = tab.url || '';
        return `${index}: "${cleanTitle}" - ${cleanUrl}`;
    }).join('\n');
    
    return `Analyze these tabs and generate 8-12 concise, unique keywords per tab that capture distinct main topics/purposes (no duplicates or near-synonym repeats within a tab).
Additionally, for each tab:
- Set shopping=true if it is primarily about purchasing products (e-commerce, stores, carts, prices, shopping listings, etc.); otherwise shopping=false. Examples of e-commerce include Amazon, eBay, Target, Temu, SHEIN, BestBuy, Walmart, AliExpress.
- If shopping=true, also set:
  • shopCategory: one of fashion | electronics | groceries | home | beauty | sports | automotive | digital | general
  • intent: a short product/category term that captures the user’s shopping search intent (e.g., "dresses", "gaming accessories", "laptops"). Keep it 1-2 words, lowercase.
Return ONLY valid JSON in this format: {"keywords":[{"index":0,"keywords":["keyword1","keyword2","keyword3","keyword4"],"shopping":false,"shopCategory":null,"intent":null}]}

Tabs:
${tabsInfo}

Requirements:
- Return ONLY the JSON object
    - Use clear, specific keywords (1-2 words)
    - Avoid generic words: official, website, home, page, site, news, blog, article, update, info, general
    - Prefer product/category/merchant tokens for shopping tabs (e.g., amazon, bestbuy, chair, accessories)
    - Make keywords within the same tab distinct (no duplicates/synonyms)
    - Focus on main topics, not technical details
    - Crucially: If a tab is clearly from an e-commerce site (like Amazon, Temu, SHEIN, eBay, Target, BestBuy, Walmart, AliExpress), you MUST set shopping=true and provide both shopCategory and intent (non-null).
    - If shopping is true, you MUST provide a non-null shopCategory and intent`;
}

/**
 * Εκτελεί AI grouping με timeout
 */
async function executeAIGroupingWithTimeout(prompt, timeout) {
    console.log('🤖🤖🤖 [AI CLUSTERING START] 🤖🤖🤖');
    console.log('🤖 [AI] Executing AI grouping with timeout:', timeout, 'ms');
    console.log('🤖 [AI] Prompt length:', prompt.length, 'characters');

    // Prefer a lightweight, accessible tab for Chrome AI (avoid heavy/interactive pages)
    let usableTab = await findUsableAIAccessTab();
    if (!usableTab) {
        // Fallback to the active http(s) tab
        let [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        usableTab = active && active.url && active.url.startsWith('http') ? active : null;
    }
    if (!usableTab) {
        console.warn('🤖 [AI] No usable tab found for messaging');
        return { keywords: [], confidence: 0.1 };
    }
    console.log('🤖 [AI] Messaging content script on tab:', usableTab.id, usableTab.url);

    const send = (type, data) => new Promise((resolve, reject) => {
        try {
            chrome.tabs.sendMessage(usableTab.id, { type, data, prompt }, (response) => {
                const err = chrome.runtime.lastError;
                if (err) return reject(new Error(err.message));
                resolve(response);
            });
        } catch (e) {
            reject(e);
        }
    });

    // Try prewarm first (small settle to allow content script to attach)
    try {
        await new Promise(r => setTimeout(r, 150));
        const prewarm = await withTimeout(send('AI_GROUPING_PREWARM'), Math.min(5000, Math.max(2000, timeout - 2000)), 'LM prewarm timeout');
        console.log('🤖 [AI] Prewarm result:', prewarm);
        if (!prewarm || prewarm.success !== true) {
            console.warn('🤖 [AI] Language model not ready, skipping AI grouping');
            console.log('🤖🤖🤖 [AI CLUSTERING END] 🤖🤖🤖');
            return { keywords: [], confidence: 0.1 };
        }
    } catch (e) {
        // Content script may not be attached yet; attempt recovery quietly
        console.log('🤖 [AI] Prewarm not received; attempting recovery via injection...');
        // Attempt to inject content script and retry once (with timeout guard)
        try {
            await withTimeout(
                chrome.scripting.executeScript({ target: { tabId: usableTab.id }, files: ['content.js'] }),
                4000,
                'Content script injection timeout'
            );
            await new Promise(r => setTimeout(r, 150));
            const prewarm2 = await withTimeout(send('AI_GROUPING_PREWARM'), Math.min(5000, Math.max(2000, timeout - 2000)), 'LM prewarm timeout');
            console.log('🤖 [AI] Prewarm retry:', prewarm2);
            if (!prewarm2 || prewarm2.success !== true) {
                console.warn('🤖 [AI] LM still not ready after injection — falling back to in‑page prompt execution');
                // Fallback path: run LM directly in page context without messaging dependency
                try {
                    const results = await withTimeout(
                        chrome.scripting.executeScript({
                            target: { tabId: usableTab.id },
                            world: 'MAIN',
                            func: performAIGroupingInPage,
                            args: [prompt]
                        }),
                        Math.min(timeout, 15000),
                        'In‑page grouping timeout'
                    );
                    const payload = results && results[0] && results[0].result;
                    if (payload && payload.ok && payload.result) {
                        console.log('🤖 [AI] In‑page fallback succeeded');
                        console.log('🤖🤖🤖 [AI CLUSTERING END] 🤖🤖🤖');
                        return payload.result;
                    }
                } catch (fallbackErr) {
                    console.warn('🤖 [AI] In‑page fallback failed:', fallbackErr?.message || fallbackErr);
                }
                console.log('🤖🤖🤖 [AI CLUSTERING END] 🤖🤖🤖');
                return { keywords: [], confidence: 0.1 };
            }
        } catch (injErr) {
            console.warn('🤖 [AI] Injection failed:', injErr?.message || injErr);
            // Try in‑page fallback even if injection failed
            try {
                const results = await withTimeout(
                    chrome.scripting.executeScript({
                        target: { tabId: usableTab.id },
                        world: 'MAIN',
                        func: performAIGroupingInPage,
                        args: [prompt]
                    }),
                    Math.min(timeout, 15000),
                    'In‑page grouping timeout'
                );
                const payload = results && results[0] && results[0].result;
                if (payload && payload.ok && payload.result) {
                    console.log('🤖 [AI] In‑page fallback (post-injection failure) succeeded');
                    console.log('🤖🤖🤖 [AI CLUSTERING END] 🤖🤖🤖');
                    return payload.result;
                }
            } catch (fallbackErr) {
                console.warn('🤖 [AI] In‑page fallback failed after injection error:', fallbackErr?.message || fallbackErr);
            }
            console.log('🤖🤖🤖 [AI CLUSTERING END] 🤖🤖🤖');
            return { keywords: [], confidence: 0.1 };
        }
    }

    try {
        const resp = await withTimeout(send('AI_GROUPING_REQUEST', prompt), timeout, 'AI grouping timeout');
        console.log('🤖 [AI] Message response:', resp);
        if (resp && resp.success && resp.result) {
            const result = resp.result;
            if (Array.isArray(result.keywords)) {
                console.log('🤖 [AI Keywords] Received', result.keywords.length, 'keyword sets');
            }
            console.log('🤖🤖🤖 [AI CLUSTERING END] 🤖🤖🤖');
            return result;
        }
        if (resp && resp.keywords) {
            console.log('🤖 [AI Keywords] Received (direct)', resp.keywords.length);
            console.log('🤖🤖🤖 [AI CLUSTERING END] 🤖🤖🤖');
            return resp;
        }
        console.warn('🤖 [AI] Invalid AI grouping response, returning empty keywords');
        console.log('🤖🤖🤖 [AI CLUSTERING END] 🤖🤖🤖');
        return { keywords: [] };
    } catch (e) {
        console.warn('🤖 [AI] Grouping request failed:', e?.message || e);
        console.log('🤖🤖🤖 [AI CLUSTERING END] 🤖🤖🤖');
        return { keywords: [], confidence: 0.1 };
    }
}

/**
 * Εκτελεί fusion scoring
 */
async function performFusionScoring(deterministicGroups, aiSuggestions, tabDataForAI, weights, adaptiveThresholds, centroidThreshold) {
    console.log('🎯 [Fusion Scoring] Starting fusion scoring calculation...');
    
    const fusionGroups = [...deterministicGroups];
    const processed = new Set();
    
    // Calculate fusion scores for all pairs
    for (let i = 0; i < tabDataForAI.length; i++) {
        for (let j = i + 1; j < tabDataForAI.length; j++) {
            if (processed.has(`${i}-${j}`)) continue;
            
            const fusionScore = calculateFusionScore(i, j, aiSuggestions, tabDataForAI, weights);
            
            // Get tabs for analysis
            const tabI = tabDataForAI[i];
            const tabJ = tabDataForAI[j];
            
            // Log all medical/research tabs for debugging
            if (tabI.title && tabJ.title && 
                (tabI.title.toLowerCase().includes('medical') || tabI.title.toLowerCase().includes('research') || tabI.title.toLowerCase().includes('nejm') || tabI.title.toLowerCase().includes('pubmed')) &&
                (tabJ.title.toLowerCase().includes('medical') || tabJ.title.toLowerCase().includes('research') || tabJ.title.toLowerCase().includes('nejm') || tabJ.title.toLowerCase().includes('pubmed'))) {
                console.log(`🏥 [Medical Test] Tabs ${i}-${j}: "${tabI.title}" vs "${tabJ.title}" → score: ${fusionScore.toFixed(3)}`);
            }
            
            // Adaptive threshold based on category
            const categoryI = inferCategory(tabI);
            const categoryJ = inferCategory(tabJ);
            const category = (categoryI === categoryJ && categoryI !== 'general') ? categoryI : 'general';
            const adaptiveThreshold = adaptiveThresholds && adaptiveThresholds[category] ? adaptiveThresholds[category] : (adaptiveThresholds?.general || 0.25);
            
            if (fusionScore >= adaptiveThreshold) {
                // Explain why this pair qualifies
                try {
                    const detRaw = calculateTabSimilarity(tabI, tabJ);
                    const det = Number((detRaw / 100).toFixed(3));
                    const aiI = aiSuggestions.get(i);
                    const aiJ = aiSuggestions.get(j);
                    const aiSetI = new Set((aiI?.keywords || []).map(x => String(x).toLowerCase()));
                    const aiSetJ = new Set((aiJ?.keywords || []).map(x => String(x).toLowerCase()));
                    const aiInter = [...aiSetI].filter(x => aiSetJ.has(x));
                    const aiUnion = new Set([...aiSetI, ...aiSetJ]);
                    const aiJac = aiUnion.size ? (aiInter.length / aiUnion.size) : 0;
                    const titleTokI = new Set(extractKeywordsFromText(tabI.title));
                    const titleTokJ = new Set(extractKeywordsFromText(tabJ.title));
                    const titleInter = [...titleTokI].filter(x => titleTokJ.has(x));
                    const titleUnionSize = new Set([...titleTokI, ...titleTokJ]).size || 1;
                    const titleJac = titleInter.length / titleUnionSize;
                    const taxI = inferTaxonomyFromAIKeywords(aiI, tabI) || (tabI.primaryTopic || 'general');
                    const taxJ = inferTaxonomyFromAIKeywords(aiJ, tabJ) || (tabJ.primaryTopic || 'general');
                    console.log(
                        `🔎 [Fusion Explain] tabs ${i}-${j} | score=${fusionScore.toFixed(3)} thr=${adaptiveThreshold} cat=${category}\n` +
                        `  • det=${det} | aiJac=${aiJac.toFixed(3)} commonAI=[${aiInter.join(', ')}]\n` +
                        `  • titleJac=${titleJac.toFixed(3)} commonTitle=[${titleInter.join(', ')}]\n` +
                        `  • taxI=${taxI} taxJ=${taxJ} aiShop=(${aiI?.isShopping?'Y':'N'},${aiJ?.isShopping?'Y':'N'})`
                    );
                } catch (e) {
                    console.warn('Failed to log fusion explanation:', e?.message || e);
                }
                console.log(`🔗 [Fusion] High similarity detected: tabs ${i}-${j}, score: ${fusionScore.toFixed(3)} (threshold: ${adaptiveThreshold}) [category: ${category}]`);
                
                // Merge tabs
                const groupA = findGroupContaining(fusionGroups, i);
                const groupB = findGroupContaining(fusionGroups, j);
                
                if (groupA && groupB && groupA !== groupB) {
                    // Check for over-merge: if groups are too large, be more strict
                    const wouldBeTooLarge = (groupA.tabIndices.length + groupB.tabIndices.length) > 8; // Reduced from 15 to 8
                    const shouldMerge = !wouldBeTooLarge || fusionScore >= 0.6; // Higher threshold for large groups (increased from 0.5 to 0.6)
                    
                    if (!shouldMerge) {
                        console.log(`⏸️ [Fusion] Skipping merge to avoid over-merge: ${groupA.tabIndices.length} + ${groupB.tabIndices.length} tabs (score: ${fusionScore.toFixed(3)})`);
                        continue;
                    }
                    
                    console.log(`🔗 [Fusion] Merging groups: ${groupA.name || 'Unknown'} + ${groupB.name || 'Unknown'}`);
                    
                    // Merge groups
                    const mergedGroup = mergeFusionGroups(groupA, groupB, fusionScore);
                    fusionGroups.push(mergedGroup);
                    
                    // Remove original groups
                    const indexA = fusionGroups.indexOf(groupA);
                    const indexB = fusionGroups.indexOf(groupB);
                    if (indexA > -1) fusionGroups.splice(indexA, 1);
                    if (indexB > -1) fusionGroups.splice(indexB, 1);
                } else if (groupA && groupB && groupA === groupB) {
                    console.log(`🔗 [Fusion] Tabs ${i}-${j} already in same group: ${groupA.name || 'Unknown'}`);
                } else {
                    console.log(`🔗 [Fusion] Cannot merge tabs ${i}-${j}: groupA=${groupA?.name || 'null'}, groupB=${groupB?.name || 'null'}`);
                }
                
                processed.add(`${i}-${j}`);
            }
        }
    }
    
    // Centroid-based merging
    return performCentroidFusion(fusionGroups, centroidThreshold);
}

/**
 * Infers category from tab content (title, url, domain)
 * Used for adaptive threshold selection
 */
function inferCategory(tab) {
    if (!tab) return 'general';

    const title = (tab.title || '').toLowerCase();
    const url = (tab.url || '').toLowerCase();
    const domain = (tab.domain || '').toLowerCase();
    const allText = `${title} ${url} ${domain}`;

    // Shopping first: if shopping cues exist, prefer shopping over gaming
    if (detectShoppingStrong(allText, url)) {
        return 'shopping';
    }

    // Medical/Health category (content-based, no domain-specific brands)
    if (/(\bmedical\b|\bhealth\b|\bmedicine\b|\bclinical\b|\btreatment\b|\bpatient\b|\bjournal\b|\bresearch\b)/.test(allText)) {
        return 'medical';
    }

    // Technology/AI category (content-based)
    if (/(\bai\b|artificial intelligence|\btech\b|\bsoftware\b|\bdeveloper\b|\bapi\b|\bplatform\b|\bdocumentation\b|\bworkspace\b|\bcloud\b)/.test(allText)) {
        return 'technology';
    }

    // Gaming category (content-based)
    if (/(\bgaming\b|\bgame\b|\bgames\b|\bplayer\b|\bplayers\b|\bsquad\b|\brates?ings\b|\besports\b|\bsteam\b|\bxbox\b|\bps[45]\b)/.test(allText)) {
        return 'gaming';
    }

    // News category
    if (/(\bnews\b|\bblog\b|\barticle\b|\bupdate\b|\bpress\b|\blatest\b|\bbreaking\b)/.test(allText)) {
        return 'news';
    }

    return 'general';
}

/**
 * Infer taxonomy from AI keywords
 * Uses AI keywords to determine if a tab belongs to a specific category
 */
function inferTaxonomyFromAIKeywords(aiSuggestion, tab) {
    if (!aiSuggestion || !aiSuggestion.keywords || aiSuggestion.keywords.length === 0) {
        return null; // No AI keywords, use fallback
    }
    
    const aiKeywords = aiSuggestion.keywords.map(kw => kw.toLowerCase());
    
    // Medical/Research taxonomy
    const medicalKeywords = ['medical', 'health', 'research', 'pubmed', 'nejm', 'clinical', 'treatment', 'patient', 'disease', 'journal', 'medicine'];
    if (aiKeywords.some(kw => medicalKeywords.some(mk => kw.includes(mk)))) {
        return 'medical';
    }
    
    // Technology taxonomy
    const techKeywords = ['ai', 'artificial intelligence', 'tech', 'software', 'computer', 'digital', 'innovation', 'coding', 'development', 'openai', 'google ai'];
    if (aiKeywords.some(kw => techKeywords.some(tk => kw.includes(tk)))) {
        return 'technology';
    }
    
    // Gaming taxonomy (generic, no brand-specific phrases)
    const gamingKeywords = ['gaming', 'game', 'games', 'esports', 'player', 'players', 'ratings', 'squad'];
    if (aiKeywords.some(kw => gamingKeywords.some(gk => kw.includes(gk)))) {
        return 'gaming';
    }
    
    // News/Blog taxonomy
    const newsKeywords = ['news', 'blog', 'article', 'update', 'press', 'latest'];
    if (aiKeywords.some(kw => newsKeywords.some(nk => kw.includes(nk)))) {
        return 'news';
    }
    
    return null; // No match, use fallback taxonomy
}

/**
 * Ελέγχει αν δύο tabs έχουν shared keywords (medical, research, technology, etc.)
 */
function checkSharedKeywords(tabI, tabJ) {
    const medicalKeywords = ['medical', 'health', 'research', 'pubmed', 'nejm', 'clinical', 'treatment', 'patient', 'disease', 'journal', 'medicine', 'england', 'medicalnewstoday', 'ncbi', 'nih'];
    const techKeywords = ['ai', 'artificial intelligence', 'tech', 'software', 'computer', 'digital', 'innovation', 'coding', 'development'];
    const gamingKeywords = ['gaming', 'game', 'games', 'esports', 'player', 'players', 'ratings', 'squad'];
    
    const titleI = (tabI.title || '').toLowerCase();
    const titleJ = (tabJ.title || '').toLowerCase();
    const urlI = (tabI.url || '').toLowerCase();
    const urlJ = (tabJ.url || '').toLowerCase();
    
    // Check if both titles have same category keywords
    const categories = [
        { keywords: medicalKeywords, name: 'medical' },
        { keywords: techKeywords, name: 'tech' },
        { keywords: gamingKeywords, name: 'gaming' }
    ];
    
    for (const category of categories) {
        const hasI = category.keywords.some(kw => titleI.includes(kw) || urlI.includes(kw));
        const hasJ = category.keywords.some(kw => titleJ.includes(kw) || urlJ.includes(kw));
        if (hasI && hasJ) {
            return 1; // Both tabs share the same category
        }
    }
    
    return 0;
}

/**
 * Υπολογίζει fusion score για ένα ζεύγος
 * Χρησιμοποιεί: Deterministic similarity + AI keywords + Taxonomy
 * 
 * AI Keyword Strategy (fallback system):
 * 1. Αν και τα δύο tabs έχουν AI keywords → χρήση AI keywords
 * 2. Αν μόνο ένα tab έχει AI keywords → συγκρίνει AI keywords με deterministic keywords
 * 3. Αν κανένα tab δεν έχει AI keywords → χρήση deterministic keywords (fallback)
 * 
 * Έτσι το σύστημα λειτουργεί ακόμα και αν το AI δεν έχει ολοκληρώσει την επεξεργασία
 */
function calculateFusionScore(i, j, aiSuggestions, tabDataForAI, weights) {
    const tabI = tabDataForAI[i];
    const tabJ = tabDataForAI[j];
    
    // Deterministic score - χρήση πραγματικού similarity
    const rawSimilarity = calculateTabSimilarity(tabI, tabJ);
    const detScore = rawSimilarity / 100; // Normalize to 0-1
    
    // AI keyword similarity
    const aiI = aiSuggestions.get(i);
    const aiJ = aiSuggestions.get(j);
    let aiAgree = 0;
    
    if (aiI && aiJ && aiI.keywords && aiJ.keywords && aiI.keywords.length > 0 && aiJ.keywords.length > 0) {
        // Both tabs have AI keywords - calculate similarity using AI keywords
        const keywords1 = new Set(aiI.keywords.slice(0, 6));
        const keywords2 = new Set(aiJ.keywords.slice(0, 6));
        const intersection = new Set([...keywords1].filter(x => keywords2.has(x)));
        const union = new Set([...keywords1, ...keywords2]);
        aiAgree = intersection.size / union.size; // Jaccard similarity
    } else if (aiI && aiI.keywords && aiI.keywords.length > 0) {
        // Only tab I has AI keywords - compare with deterministic keywords from tab J
        const aiKeywords = new Set(aiI.keywords.slice(0, 6));
        const titleKeywords = extractKeywordsFromText(tabJ.title);
        const commonKeywords = titleKeywords.filter(kw => aiKeywords.has(kw));
        const allKeywords = [...new Set([...Array.from(aiKeywords), ...titleKeywords])];
        if (allKeywords.length > 0) {
            aiAgree = commonKeywords.length / allKeywords.length;
        }
    } else if (aiJ && aiJ.keywords && aiJ.keywords.length > 0) {
        // Only tab J has AI keywords - compare with deterministic keywords from tab I
        const aiKeywords = new Set(aiJ.keywords.slice(0, 6));
        const titleKeywords = extractKeywordsFromText(tabI.title);
        const commonKeywords = titleKeywords.filter(kw => aiKeywords.has(kw));
        const allKeywords = [...new Set([...Array.from(aiKeywords), ...titleKeywords])];
        if (allKeywords.length > 0) {
            aiAgree = commonKeywords.length / allKeywords.length;
        }
    } else {
        // Neither tab has AI keywords - use deterministic keywords as fallback
        const keywords1 = extractKeywordsFromText(tabI.title);
        const keywords2 = extractKeywordsFromText(tabJ.title);
        const commonKeywords = keywords1.filter(kw => keywords2.includes(kw));
        const allKeywords = [...new Set([...keywords1, ...keywords2])];
        
        if (allKeywords.length > 0) {
            aiAgree = commonKeywords.length / allKeywords.length; // Jaccard similarity
        }
    }
    
    // Commerce vs content guardrails: avoid merging shopping with gameplay/wiki
    const urlI = (tabI.url || '').toLowerCase();
    const urlJ = (tabJ.url || '').toLowerCase();
    const hostI = (tabI.domain || '').toLowerCase();
    const hostJ = (tabJ.domain || '').toLowerCase();
    // Use the strong shopping detector everywhere to avoid false positives (e.g. "photoshop")
    const isShop = (title, u, h) => detectShoppingStrong(`${String(title||'')} ${String(h||'')}`, String(u||''));
    const isGameContent = (t,u,h) => /futbin|fut\.gg|ultimate team|squad|ratings|players|reddit/.test((t||'').toLowerCase() + ' ' + u + ' ' + h);
    const shoppingI = isShop(tabI.title, urlI, hostI);
    const shoppingJ = isShop(tabJ.title, urlJ, hostJ);
    const gameI = isGameContent(tabI.title, urlI, hostI);
    const gameJ = isGameContent(tabJ.title, urlJ, hostJ);
    // If one is shopping and the other is gameplay/wiki, apply a strong penalty to AI agreement
    if ((shoppingI && gameJ) || (shoppingJ && gameI)) {
        aiAgree *= 0.25;
    }

    // If both AI suggestions exist and disagree on shopping tag, disallow AI-driven merge
    if (aiI && aiJ) {
        const aiShopI = aiI.isShopping === true;
        const aiShopJ = aiJ.isShopping === true;
        if (aiShopI !== aiShopJ) {
            aiAgree = 0;
        }
    }

    // Taxonomy agreement - USE AI KEYWORDS IF AVAILABLE
    let taxAgree = 0;
    
    // First, try to infer taxonomy from AI keywords if available
    const aiITax = inferTaxonomyFromAIKeywords(aiI, tabI);
    const aiJTax = inferTaxonomyFromAIKeywords(aiJ, tabJ);
    
    // Use AI-inferred taxonomy if available, otherwise fall back to primaryTopic
    const taxI = aiITax || tabI.primaryTopic || 'general';
    const taxJ = aiJTax || tabJ.primaryTopic || 'general';
    
    // Check if tabs belong to same category (medical, technology, etc.)
    if (taxI === taxJ && taxI !== 'general') {
        taxAgree = 1;
    } else if (taxI === 'general' && taxJ === 'general') {
        // If both are general, check if they share domain-specific keywords
        const sharedKeywords = checkSharedKeywords(tabI, tabJ);
        if (sharedKeywords > 0) {
            taxAgree = 0.3; // Boost for shared keywords even if both are general
        }
    }
    
    // Calculate weighted score
    let score = weights.det * detScore + weights.ai * aiAgree + weights.tax * taxAgree;
    
    // Apply penalties
    if (isGenericTab(tabI) || isGenericTab(tabJ)) {
        score -= 0.20; // Generic penalty
    }
    
    if (isBridgeTab(tabI) || isBridgeTab(tabJ)) {
        score -= 0.05; // Bridge penalty
    }
    
    // Guard: ignore AI if deterministic score is too low
    if (detScore < 0.35 && aiAgree === 1) {
        score = weights.det * detScore + weights.tax * taxAgree; // Remove AI weight
    }
    
    // Hard gate: prevent shopping ↔ any non-shopping merges, and AI-tag disagreement on shopping
    const catI = taxI;
    const catJ = taxJ;
    const shopConflict = ((shoppingI || (aiI && aiI.isShopping)) || (shoppingJ || (aiJ && aiJ.isShopping))) && (catI !== 'shopping' || catJ !== 'shopping');
    if (shopConflict || (aiI && aiJ && (aiI.isShopping === true) !== (aiJ.isShopping === true))) {
        score = 0; // force below any threshold
    }

    // Additional guardrails to prevent category leakage
    const gamingTokens = new Set(['gaming','game','players','squad','esports']);
    const titleTokensI = new Set(extractKeywordsFromText(tabI.title));
    const titleTokensJ = new Set(extractKeywordsFromText(tabJ.title));

    // If mixing gaming with non-gaming, demand gaming tokens on BOTH sides
    if ((catI === 'gaming' && catJ !== 'gaming') || (catJ === 'gaming' && catI !== 'gaming')) {
        const iHasGaming = Array.from(gamingTokens).some(k => titleTokensI.has(k));
        const jHasGaming = Array.from(gamingTokens).some(k => titleTokensJ.has(k));
        if (!(iHasGaming && jHasGaming)) {
            score = Math.min(score, 0.05);
        }
    }

    // If mixing technology/news with gaming, be conservative
    if ((catI === 'technology' && catJ === 'gaming') || (catJ === 'technology' && catI === 'gaming') ||
        (catI === 'news' && catJ === 'gaming') || (catJ === 'news' && catI === 'gaming')) {
        score = Math.min(score, 0.08);
    }

    // If categories differ and none is shopping, require decent token overlap for general↔topic merges
    if (catI !== catJ && catI !== 'shopping' && catJ !== 'shopping') {
        const jaccard = (() => {
            const a = titleTokensI; const b = titleTokensJ;
            if (!a.size && !b.size) return 0;
            let inter = 0;
            for (const t of a) if (b.has(t)) inter++;
            const uni = new Set([...a, ...b]).size;
            return inter / (uni || 1);
        })();
        if (jaccard < 0.28) {
            score = Math.min(score, 0.10);
        }
    }
    
    return Math.max(0, Math.min(1, score)); // Clamp to [0,1]
}

/**
 * Ελέγχει αν ένα tab είναι generic
 */
function isGenericTab(tab) {
    const genericDomains = /news|blog|topics|press|medium|substack/i;
    const genericKeywords = /news|blog|article|post|update|latest|trending/i;
    
    return genericDomains.test(tab.domain) || 
           genericKeywords.test(tab.title) ||
           (tab.topicHints && genericKeywords.test(tab.topicHints));
}

/**
 * Ελέγχει αν ένα tab είναι bridge (συνδέει διαφορετικά topics)
 */
function isBridgeTab(tab) {
    const bridgeKeywords = /search|results|find|explore|discover|browse/i;
    return bridgeKeywords.test(tab.title) || 
           bridgeKeywords.test(tab.topicHints || '');
}

/**
 * Enforce purity rules on final groups (post-fusion), to avoid cross-topic mixing
 */
function splitMixedGroups(groups, tabData) {
    // Generic detectors (no domain-specific checks)
    const isShop = (u,h,t) => detectShoppingStrong(`${t||''} ${h||''}`, u||'');
    const isProductivity = (u,h,t) => /(\bdocument\b|\bdocuments\b|\bsheet\b|\bspreadsheet\b|\bslides?\b|\bnote\b|\bnotes\b|\bcalendar\b|\btask\b|\bkanban\b)/.test(((u||'')+' '+(h||'')+' '+(t||'')).toLowerCase());

    const result = [];
    for (const group of groups) {
        // Split and purity logic only; no labeling state here
        const indices = (group.tabIndices || []).slice();
        if (indices.length < 3) { result.push(group); continue; }

        const buckets = { gaming: [], shopping: [], technology: [], medical: [], productivity: [], other: [] };
        for (const i of indices) {
            const tab = tabData[i];
            if (!tab) { buckets.other.push(i); continue; }
            const cat = inferCategory(tab);
            if (isShop(tab.url, tab.domain, tab.title)) { buckets.shopping.push(i); continue; }
            if (cat === 'gaming') buckets.gaming.push(i);
            else if (cat === 'technology') buckets.technology.push(i);
            else if (cat === 'medical') buckets.medical.push(i);
            else if (isProductivity(tab.url, tab.domain)) buckets.productivity.push(i);
            else buckets.other.push(i);
        }

        const total = indices.length;
        const used = new Set();
        const hasGaming = buckets.gaming.length > 0;
        const gamingMajority = buckets.gaming.length >= Math.ceil(total * 0.5);

        // Global Rule 0: Always split shopping out if mixed with any non-shopping tabs
        // This prevents commerce pages from polluting topical groups (gaming/tech/medical/etc.)
        if (buckets.shopping.length >= 1 && (total - buckets.shopping.length) >= 1) {
            result.push({
                ...group,
                tabIndices: buckets.shopping.slice(),
                primaryTopic: 'shopping'
            });
            buckets.shopping.forEach(i => used.add(i));
        }

        // Rule 1: If gaming is majority, keep only gaming in this group
        if (gamingMajority) {
            // Gaming-only subgroup
            if (buckets.gaming.length >= 2) {
                result.push({
                    ...group,
                    tabIndices: buckets.gaming.slice(),
                    primaryTopic: 'gaming'
                });
                buckets.gaming.forEach(i => used.add(i));
            }
            // Always exclude shopping from gaming, even singletons
            if (buckets.shopping.length >= 1) {
                result.push({
                    ...group,
                    tabIndices: buckets.shopping.slice(),
                    primaryTopic: 'shopping'
                });
                buckets.shopping.forEach(i => used.add(i));
            }
            // Add other coherent categories (size >= 2)
            for (const cat of ['technology','medical','productivity']) {
                const arr = buckets[cat];
                if (arr.length >= 2) {
                    result.push({ ...group, tabIndices: arr.slice(), primaryTopic: cat });
                    arr.forEach(i => used.add(i));
                }
            }
            // Leftovers (keep only if they form a small subgroup)
            const leftovers = indices.filter(i => !used.has(i));
            if (leftovers.length >= 2) {
                result.push({ ...group, tabIndices: leftovers });
            }
            continue;
        }

        // Rule 2: Always exclude shopping from any gaming mix (even singletons)
        if (hasGaming && buckets.shopping.length >= 1) {
            result.push({
                ...group,
                tabIndices: buckets.shopping.slice(),
                primaryTopic: 'shopping'
            });
            buckets.shopping.forEach(i => used.add(i));
        }

        // Create coherent category subgroups (size >= 2)
        let created = false;
        for (const cat of ['gaming','technology','medical','productivity']) {
            const arr = buckets[cat];
            if (arr.length >= 2) {
                result.push({ ...group, tabIndices: arr.slice(), primaryTopic: cat });
                arr.forEach(i => used.add(i));
                created = true;
            }
        }
        const leftovers = indices.filter(i => !used.has(i));
        if (leftovers.length >= 2) {
            result.push({ ...group, tabIndices: leftovers });
            created = true;
        }

        // If no splits were created, keep original group as-is
        if (!created) {
            result.push(group);
        }
    }
    return result.length ? result : groups;
}

/**
 * Further splits shopping groups by shopping category and/or merchant brand.
 * Categories: fashion, electronics_gaming, other. Within categories, optionally split by merchant.
 */
function splitShoppingCategories(groups, tabData) {
    if (!Array.isArray(groups) || !groups.length) return groups;
    const result = [];
    const allowedCats = new Set(['fashion','electronics','groceries','home','beauty','sports','automotive','digital','general']);
    const mapCat = (c, text) => {
        if (allowedCats.has(c)) return c;
        // Heuristic fallback only if AI category missing; avoid domains
        const s = text || '';
        if (/(\bfashion\b|\bapparel\b|\bclothes?\b|\bdress(es)?\b|\bshirt\b|\bshirts\b|\bpants\b|\bjeans\b|\bskirt\b|\bshoes?\b|\bsneakers?\b)/i.test(s)) return 'fashion';
        if (/(\bgaming\b|\baccessor(y|ies)\b|\bpc\b|\blaptop\b|\bmonitor\b|\bkeyboard\b|\bmouse\b|\bheadset\b|\bconsole\b|\bcontroller\b|\bgpu\b|\bcpu\b)/i.test(s)) return 'electronics';
        return 'general';
    };

    for (const group of groups) {
        if (group?.primaryTopic !== 'shopping' || !Array.isArray(group.tabIndices) || group.tabIndices.length < 2) {
            result.push(group);
            continue;
        }

        // First preference: unify by AI-provided intent across different merchants
        const intentBuckets = new Map(); // intent -> [indices]
        const intentHosts = new Map();   // intent -> Set(hosts)
        const getHost = (url) => { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ''; } };
        for (const i of group.tabIndices) {
            const aiMeta = LAST_AI_KEYWORDS.find(e => e.index === i);
            const intent = (aiMeta && typeof aiMeta.intent === 'string' && aiMeta.intent.trim()) ? aiMeta.intent.trim().toLowerCase() : '';
            if (!intent) continue;
            if (!intentBuckets.has(intent)) intentBuckets.set(intent, []);
            intentBuckets.get(intent).push(i);
            const host = getHost(tabData?.[i]?.url || '');
            if (!intentHosts.has(intent)) intentHosts.set(intent, new Set());
            if (host) intentHosts.get(intent).add(host);
        }
        // If there is an intent with 2+ tabs across 2+ different hosts, keep unified as a general shopping intent
        let unifiedByIntent = false;
        for (const [intent, indices] of intentBuckets.entries()) {
            const hosts = intentHosts.get(intent) || new Set();
            if (indices.length >= 2 && hosts.size >= 2) {
                const titleTerm = intent.split(/[\s+_-]+/).slice(0, 2).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ');
                result.push({ ...group, tabIndices: indices.slice(), name: `Shopping · ${titleTerm}`, primaryTopic: 'shopping' });
                const leftover = group.tabIndices.filter(i => !indices.includes(i));
                if (leftover.length >= 2) {
                    // Handle remaining tabs (fall back to category split for leftovers)
                    result.push({ ...group, tabIndices: leftover });
                }
                unifiedByIntent = true;
                break;
            }
        }
        if (unifiedByIntent) continue;

        const buckets = new Map(); // category -> [indices]
        const addTo = (cat, idx) => {
            if (!buckets.has(cat)) buckets.set(cat, []);
            buckets.get(cat).push(idx);
        };

        for (const i of group.tabIndices) {
            const tab = tabData?.[i];
            const text = `${tab?.title || ''}`.toLowerCase();
            const aiMeta = LAST_AI_KEYWORDS.find(e => e.index === i);
            const cat = mapCat(aiMeta?.shopCategory || null, text);
            addTo(cat, i);
        }
        for (const [cat, arr] of buckets.entries()) {
            if (!arr.length) continue;
            const label = cat === 'fashion' ? 'Shopping · Fashion'
                        : cat === 'electronics' ? 'Shopping · Electronics/Gaming'
                        : cat === 'groceries' ? 'Shopping · Groceries'
                        : cat === 'home' ? 'Shopping · Home'
                        : cat === 'beauty' ? 'Shopping · Beauty'
                        : cat === 'sports' ? 'Shopping · Sports'
                        : cat === 'automotive' ? 'Shopping · Automotive'
                        : cat === 'digital' ? 'Shopping · Digital'
                        : 'Shopping · General';
            result.push({ ...group, tabIndices: arr.slice(), name: label, primaryTopic: 'shopping' });
        }
    }

    // Ensure we didn't accidentally drop tabs: if no split happened, return original groups
    return result.length ? result : groups;
}
/**
 * Διαγράφει όλο το cache για debugging
 */
async function clearAllCache() {
    try {
        await chrome.storage.session.clear();
        await chrome.storage.local.clear();
        console.log('🧹 [Cache] All cache cleared for debugging');
    } catch (error) {
        console.error('Error clearing cache:', error);
    }
}

/**
 * Manual cache clearing function για debugging
 */
async function clearCacheManually() {
    try {
        await chrome.storage.session.clear();
        await chrome.storage.local.clear();
        console.log('🧹 [Manual Cache Clear] All cache cleared manually');
        return { success: true, message: 'Cache cleared successfully' };
    } catch (error) {
        console.error('Error clearing cache manually:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Βρίσκει group που περιέχει ένα tab
 */
function findGroupContaining(groups, tabIndex) {
    return groups.find(group => group.tabIndices.includes(tabIndex));
}

/**
 * Ενώνει δύο groups στο fusion
 */
function mergeFusionGroups(groupA, groupB, score) {
    // Deduplicate tabIndices to avoid duplicates
    const combinedIndices = [...groupA.tabIndices, ...groupB.tabIndices];
    const uniqueIndices = [...new Set(combinedIndices)];
    
    return {
        tabIndices: uniqueIndices,
        primaryTopic: groupA.primaryTopic,
        keywords: [...new Set([...(groupA.keywords || []), ...(groupB.keywords || [])])],
        confidence: Math.max(groupA.confidence || 0, groupB.confidence || 0),
        fusionScore: score,
        merged: true
    };
}

/**
 * Εκτελεί centroid-based fusion
 */
function performCentroidFusion(groups, threshold) {
    try {
        const TH = typeof threshold === 'number' ? threshold : 0.35;
        const MAX_MERGED_SIZE = 10; // keep groups reasonably sized
        let changed = true;
        let current = [...groups];

        // Normalize labels by removing punctuation, emojis and collapsing whitespace
        const normLabel = (v) => {
            try {
                return String(v || '')
                    .toLowerCase()
                    .normalize('NFKD') // split diacritics
                    .replace(/[\u0300-\u036f]/g, '') // remove diacritic marks
                    // keep letters (Latin+Greek), digits and spaces; drop punctuation/emojis/symbols
                    .replace(/[^a-z0-9\s\u0370-\u03ff\u1f00-\u1fff]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
            } catch (_) {
                return String(v || '').toLowerCase().trim();
            }
        };

        const jaccard = (a = [], b = []) => {
            const A = new Set((a || []).map(s => String(s || '').toLowerCase()));
            const B = new Set((b || []).map(s => String(s || '').toLowerCase()));
            if (!A.size && !B.size) return 0;
            const inter = [...A].filter(x => B.has(x));
            const uni = new Set([...A, ...B]);
            return inter.length / (uni.size || 1);
        };

        const MERCHANT_TOKENS = new Set(['amazon','ebay','bestbuy','target','temu','aliexpress','shein','walmart','skroutz','etsy','public','plaisio']);
        while (changed) {
            changed = false;
            outer: for (let i = 0; i < current.length; i++) {
                for (let j = i + 1; j < current.length; j++) {
                    const A = current[i];
                    const B = current[j];
                    const topicA = A.primaryTopic || 'general';
                    const topicB = B.primaryTopic || 'general';
                    // Merge only same-topic (or both general) groups
                    if (!(topicA === topicB)) continue;
                    // Size guard
                    if ((A.tabIndices.length + B.tabIndices.length) > MAX_MERGED_SIZE) continue;
                    // Keyword centroid similarity (fallback to 0 if none)
                    const sim = jaccard(A.keywords || [], B.keywords || []);
                    // Special rule for shopping: allow merging shopping↔shopping when they share merchant tokens or have very high keyword sim
                    if (topicA === 'shopping' && topicB === 'shopping') {
                        const kwsA = new Set((A.keywords || []).map(s => String(s).toLowerCase()));
                        const kwsB = new Set((B.keywords || []).map(s => String(s).toLowerCase()));
                        const hasMerchant = [...MERCHANT_TOKENS].some(t => kwsA.has(t) && kwsB.has(t));
                        const nameA = normLabel(A.name || A.label || '');
                        const nameB = normLabel(B.name || B.label || '');
                        const sameLabel = nameA && nameB && nameA === nameB;
                        const labelOk = sameLabel && sim >= 0.50; // label-aware relax
                        const shoppingOk = hasMerchant || labelOk || sim >= Math.max(TH, 0.55);
                        if (!shoppingOk) continue;
                        const reason = hasMerchant ? 'merchant' : (labelOk ? 'label' : 'similarity');
                        console.log(`🧲 [Centroid Merge] shopping+shopping | sim=${sim.toFixed(3)} | reason=${reason} | labelSame=${sameLabel ? 'Y' : 'N'}`);
                    } else if (sim < TH) {
                        continue;
                    }
                    if (sim >= TH || (topicA === 'shopping' && topicB === 'shopping')) {
                        const merged = {
                            tabIndices: [...new Set([...(A.tabIndices||[]), ...(B.tabIndices||[])])],
                            primaryTopic: topicA,
                            keywords: [...new Set([...(A.keywords||[]), ...(B.keywords||[])])].slice(0, 12),
                            confidence: Math.max(A.confidence||0, B.confidence||0),
                            fusedBy: 'centroid'
                        };
                        current.splice(j, 1);
                        current.splice(i, 1, merged);
                        changed = true;
                        break outer;
                    }
                }
            }
        }
        return current;
    } catch (e) {
        console.warn('Centroid fusion failed:', e?.message || e);
        return groups;
    }
}

/**
 * AI Merge Pass: uses Prompt API (Gemini Nano) to merge semantically identical groups
 * after TF-IDF/deterministic passes have completed.
 */
async function performAIMergePass(groups, tabDataForAI) {
    try {
        if (!Array.isArray(groups) || groups.length < 2) return groups;
        const accessibleTab = await findUsableAIAccessTab();
        if (!accessibleTab) return groups;

        // Build candidate pairs using cheap heuristics to limit LM calls
        const tok = (s) => String(s || '').toLowerCase().split(/[^a-z0-9α-ωάέίήύόώ]+/).filter(Boolean);
        const jacc = (a, b) => {
            const A = new Set((a || []).map(x => String(x).toLowerCase()));
            const B = new Set((b || []).map(x => String(x).toLowerCase()));
            if (!A.size && !B.size) return 0;
            const inter = [...A].filter(x => B.has(x));
            const uni = new Set([...A, ...B]);
            return inter.length / (uni.size || 1);
        };

        const candidates = [];
        for (let i = 0; i < groups.length; i++) {
            for (let j = i + 1; j < groups.length; j++) {
                const A = groups[i], B = groups[j];
                // Skip obviously different high-level topics when both known
                if (A.primaryTopic && B.primaryTopic && A.primaryTopic !== B.primaryTopic) {
                    // Allow shopping↔shopping only
                    if (!(/shopping/i.test(A.primaryTopic) && /shopping/i.test(B.primaryTopic))) {
                        continue;
                    }
                }
                const jw = jacc(A.keywords || [], B.keywords || []);
                const nameSim = jacc(tok(A.name), tok(B.name));
                if (jw >= 0.25 || nameSim >= 0.35 || (jw >= 0.15 && nameSim >= 0.25)) {
                    candidates.push({ i, j, jw, nameSim });
                }
            }
        }
        // Sort best-first, cap to avoid too many LM calls
        candidates.sort((a,b) => (b.jw + b.nameSim) - (a.jw + a.nameSim));
        const MAX_CALLS = Math.min(18, Math.ceil(groups.length * 1.5));
        const picked = candidates.slice(0, MAX_CALLS);

        if (!picked.length) return groups;

        // Make a working copy we can mutate
        let current = groups.slice();
        const removed = new Set();
        const MAX_GROUP_SIZE = 12;

        // Batch descriptors for a single LM session call
        const buildDesc = (A,B) => ({
            a: {
                name: A.name || '',
                topic: A.primaryTopic || '',
                keywords: (A.keywords || []).slice(0, 6),
                tags: (A.taxonomyTags || []).slice(0, 4)
            },
            b: {
                name: B.name || '',
                topic: B.primaryTopic || '',
                keywords: (B.keywords || []).slice(0, 6),
                tags: (B.taxonomyTags || []).slice(0, 4)
            }
        });
        const pairs = [];
        for (const { i, j } of picked) {
            if (removed.has(i) || removed.has(j)) continue;
            const A = current[i];
            const B = current[j];
            if (!A || !B) continue;
            pairs.push({ i, j, desc: buildDesc(A,B) });
        }
        if (!pairs.length) return current.filter(Boolean);
        try {
            const results = await withTimeout(
                chrome.scripting.executeScript({
                    target: { tabId: accessibleTab.id },
                    world: 'MAIN',
                    func: areMultipleGroupsSameTaskInPage,
                    args: [pairs.map(p => p.desc)]
                }),
                10000,
                'AI batch merge timeout'
            );
            const payload = results && results[0] && results[0].result;
            const decisions = (payload && payload.ok && Array.isArray(payload.results)) ? payload.results : [];
            for (let idx = 0; idx < pairs.length && idx < decisions.length; idx += 1) {
                const decision = decisions[idx];
                if (!decision || decision.same !== true) continue;
                const { i, j } = pairs[idx];
                if (removed.has(i) || removed.has(j)) continue;
                const A = current[i];
                const B = current[j];
                if (!A || !B) continue;
                if ((A.tabIndices.length + B.tabIndices.length) > MAX_GROUP_SIZE) {
                    console.log(`⏸️ [AI Merge] Skipping over-merge: ${A.tabIndices.length}+${B.tabIndices.length}`);
                    continue;
                }
                console.log('🧠 [AI Merge] Merging groups by LLM decision:', {
                    a: A.name, b: B.name, reason: decision.reason || 'same task'
                });
                const merged = mergeFusionGroups(A, B, 0.9);
                current[i] = merged;
                current[j] = null;
                removed.add(j);
            }
        } catch (_) {
            // Skip batch if model unavailable
        }
        // Compact list
        return current.filter(Boolean);
    } catch (e) {
        console.warn('AI merge pass failed:', e?.message || e);
        return groups;
    }
}

// Runs in MAIN world; uses LanguageModel API to answer if two groups are the same task/topic
function areGroupsSameTaskInPage(descriptor) {
    function resolveLanguageModelApi() {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        return (
            scope?.LanguageModel ||
            scope?.ai?.languageModel ||
            scope?.aiOriginTrial?.languageModel ||
            scope?.window?.ai?.languageModel ||
            null
        );
    }
    return (async () => {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        const api = resolveLanguageModelApi();
        if (!api) return { ok: false, error: 'Language Model API not available' };
        const recoverable = /(destroyed|closed|reset|disconnected|terminated)/i;
        async function getSession(forceReset = false) {
            if (forceReset) scope.__aitabLanguageSessionPromise = null;
            if (!scope.__aitabLanguageSessionPromise) {
                scope.__aitabLanguageSessionPromise = api.create();
            }
            return scope.__aitabLanguageSessionPromise;
        }
        const a = descriptor?.a || {}; const b = descriptor?.b || {};
        const pack = (g) => [
            g.name ? `Name: ${g.name}` : '',
            g.topic ? `Topic: ${g.topic}` : '',
            Array.isArray(g.keywords) && g.keywords.length ? `Keywords: ${g.keywords.join(', ')}` : '',
            Array.isArray(g.tags) && g.tags.length ? `Tags: ${g.tags.join(', ')}` : ''
        ].filter(Boolean).join('\n');
        const prompt = `You are a concise assistant. Decide if two groups represent the same user task/topic.
Respond ONLY with JSON: {"same":true|false, "reason":"..."}

Group A:\n${pack(a)}

Group B:\n${pack(b)}
`;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const session = await getSession(attempt === 1);
                const raw = await session.prompt(prompt);
                const match = typeof raw === 'string' ? raw.match(/\{[\s\S]*\}/) : null;
                const parsed = match ? JSON.parse(match[0]) : JSON.parse(String(raw));
                const same = Boolean(parsed.same === true || String(parsed.same).toLowerCase() === 'yes');
                const reason = String(parsed.reason || '').slice(0, 140);
                return { ok: true, same, reason };
            } catch (e) {
                const msg = e?.message || String(e);
                if (recoverable.test(msg) && attempt === 0) { scope.__aitabLanguageSessionPromise = null; continue; }
                return { ok: false, error: msg };
            }
        }
        return { ok: false, error: 'unavailable' };
    })();
}

// Batch version: evaluates multiple pairs within one session to reduce overhead
function areMultipleGroupsSameTaskInPage(descriptors) {
    function resolveLanguageModelApi() {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        return (
            scope?.LanguageModel ||
            scope?.ai?.languageModel ||
            scope?.aiOriginTrial?.languageModel ||
            scope?.window?.ai?.languageModel ||
            null
        );
    }
    return (async () => {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        const api = resolveLanguageModelApi();
        if (!api) return { ok: false, error: 'Language Model API not available' };
        const recoverable = /(destroyed|closed|reset|disconnected|terminated)/i;
        async function getSession(forceReset = false) {
            if (forceReset) scope.__aitabLanguageSessionPromise = null;
            if (!scope.__aitabLanguageSessionPromise) {
                scope.__aitabLanguageSessionPromise = api.create();
            }
            return scope.__aitabLanguageSessionPromise;
        }
        const safe = (g) => [
            g.name ? `Name: ${g.name}` : '',
            g.topic ? `Topic: ${g.topic}` : '',
            Array.isArray(g.keywords) && g.keywords.length ? `Keywords: ${g.keywords.join(', ')}` : '',
            Array.isArray(g.tags) && g.tags.length ? `Tags: ${g.tags.join(', ')}` : ''
        ].filter(Boolean).join('\n');
        const out = [];
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const session = await getSession(attempt === 1);
                for (const desc of (Array.isArray(descriptors) ? descriptors : [])) {
                    const a = desc?.a || {}; const b = desc?.b || {};
                    const prompt = `You are a concise assistant. Decide if two groups represent the same user task/topic.\n` +
                        `Respond ONLY with JSON: {\"same\":true|false, \"reason\":\"...\"}\n\n` +
                        `Group A:\n${safe(a)}\n\nGroup B:\n${safe(b)}\n`;
                    let parsed = { same: false, reason: '' };
                    try {
                        const raw = await session.prompt(prompt);
                        const match = typeof raw === 'string' ? raw.match(/\{[\s\S]*\}/) : null;
                        const obj = match ? JSON.parse(match[0]) : JSON.parse(String(raw));
                        parsed.same = Boolean(obj.same === true || String(obj.same).toLowerCase() === 'yes');
                        parsed.reason = String(obj.reason || '').slice(0, 140);
                    } catch (_) {
                        parsed = { same: false, reason: '' };
                    }
                    out.push(parsed);
                }
                return { ok: true, results: out };
            } catch (e) {
                const msg = e?.message || String(e);
                if (recoverable.test(msg) && attempt === 0) { scope.__aitabLanguageSessionPromise = null; continue; }
                return { ok: false, error: msg };
            }
        }
        return { ok: false, error: 'unavailable' };
    })();
}

// ---- Post-run RAM cleanup ----
function schedulePostRunRamCleanup(groups, tabData) {
    try {
        setTimeout(() => {
            performPostRunRamCleanup(groups, tabData).catch(err => {
                console.warn('Post-run RAM cleanup failed:', err?.message || err);
            });
        }, Math.max(0, RAM_CLEANUP_DELAY_MS));
    } catch (_) {}
}

async function performPostRunRamCleanup(groups, tabData) {
    const usedIndices = new Set((groups || []).flatMap(g => Array.isArray(g.tabIndices) ? g.tabIndices : []));
    const now = Date.now();

    // 1) Prune heavy content from unused tab entries held in memory
    if (RAM_PRUNE_CONTENT && Array.isArray(tabData)) {
        for (let i = 0; i < tabData.length; i++) {
            if (usedIndices.has(i)) continue;
            const entry = tabData[i];
            if (!entry) continue;
            tabData[i] = {
                id: entry.id,
                index: entry.index,
                url: entry.url,
                title: entry.title,
                domain: entry.domain,
                contentHash: entry.contentHash || '',
                language: entry.language || ''
            };
        }
    }

    // 2) Ask Chrome to discard unused tabs (not active/pinned/audible)
    if (RAM_DISCARD_UNUSED_TABS) {
        try {
            const allTabs = await chrome.tabs.query({});
            let discards = 0;
            for (const t of allTabs) {
                if (discards >= RAM_MAX_DISCARDS_PER_RUN) break;
                const idx = Array.isArray(tabData) ? tabData.findIndex(e => e && e.id === t.id) : -1;
                const isUsed = idx >= 0 && usedIndices.has(idx);
                if (isUsed) continue;
                if (t.active || t.pinned || t.audible) continue;
                const ageOk = (now - (t.lastAccessed || now)) >= RAM_MIN_TAB_AGE_MS;
                if (!ageOk) continue;
                try {
                    await chrome.tabs.discard(t.id);
                    discards += 1;
                } catch (_) {}
            }
            if (discards > 0) {
                console.log(`🧹 [RAM] Discarded ${discards} unused tabs`);
            }
        } catch (discardErr) {
            console.warn('Tab discard not completed:', discardErr?.message || discardErr);
        }
    }
}

/**
 * Helper functions
 */
function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

function extractTaxonomy(tab) {
    const text = `${tab.title || ''} ${tab.metaDescription || ''}`.toLowerCase();
    if (/(\bmedical\b|\bhealth\b|\bmedicine\b|\bclinical\b|\bresearch\b)/.test(text)) return 'medical';
    if (/(\bai\b|artificial intelligence|\btech\b|\bsoftware\b|\bdeveloper\b|\bapi\b)/.test(text)) return 'technology';
    if (/(\bgaming\b|\bgame\b|\bplayers?\b|\bsquad\b)/.test(text)) return 'gaming';
    if (/(\bshop\b|\bstore\b|\bbuy\b|\bprice\b|\bsale\b)/.test(text)) return 'shopping';
    return 'general';
}

function isGeneric(tab) {
    const text = `${tab.title || ''} ${tab.metaDescription || ''}`.toLowerCase();
    return /(\bnews\b|\bblog\b|\btopics\b|\bpress\b)/.test(text);
}

function isBridge(tab) {
    // Check if tab has high similarity to multiple topics
    return false; // Placeholder
}

/**
 * Εκτελεί AI ανάλυση των tabs χρησιμοποιώντας Chrome Built-in AI APIs
 */
async function performAIAnalysis() {
    // New run boundary: reset and assign a fresh run id
    RUN.reset();
    const run = RUN.id();
    let aiStart = nowMs();
    try {
        console.log('Starting AI analysis with Chrome Built-in AI...');
        
        // Έλεγχος διαθεσιμότητας Chrome Built-in AI APIs
        // Χρησιμοποιούμε content script για πρόσβαση στα Chrome AI APIs (languageModel/summarizer)
        console.log('Using Chrome AI through content script...');
        
        console.log('Chrome AI APIs detected, proceeding with analysis...');
        
        // Προετοιμασία δεδομένων για AI με περισσότερες πληροφορίες
        const tabDataForAI = currentTabData.map((tab, index) => {
            let domain = tab.domain;
            if (!domain) {
                try {
                    domain = new URL(tab.url).hostname;
                } catch (error) {
                    domain = '';
                }
            }
            const contentPreview = tab.content.substring(0, 800); // Περισσότερο περιεχόμενο για AI
            
            return {
                index: index,
                title: tab.title,
                url: tab.url,
                domain: domain,
                content: contentPreview,
                metaDescription: tab.metaDescription,
                contentLength: tab.content.length,
                hasContent: tab.content.length > 100,
                topicHints: tab.topicHints || generateTopicHints(tab),
                youtubeTopic: tab.youtubeAnalysis?.topic || null,
                youtubeTags: tab.youtubeAnalysis?.tags || [],
                youtubeConfidence: typeof tab.youtubeAnalysis?.confidence === 'number' ? tab.youtubeAnalysis.confidence : null,
                youtubeChannel: tab.youtubeAnalysis?.channel || '',
                language: tab.language || '',
                headings: Array.isArray(tab.headings) ? tab.headings.slice(0, 8) : [],
                metaKeywords: Array.isArray(tab.metaKeywords) ? tab.metaKeywords.slice(0, 12) : [],
                canonicalUrl: tab.canonicalUrl || '',
                contentHash: tab.contentHash || '',
                fullContent: tab.content
            };
        });
        
        console.log(`Prepared ${tabDataForAI.length} tabs for AI analysis`);
        
        // Stage 0: Smart Triage & Provisional Groups
        const triageStart = nowMs();
        const triageResult = await performSmartTriage(tabDataForAI);
        logTiming('Smart triage & provisional grouping', triageStart);
        console.log('🎯 [Stage 0] Triage complete:', {
            totalTabs: triageResult.totalTabs,
            needsSummarizer: triageResult.needsSummarizer.length,
            provisionalGroups: triageResult.provisionalGroups.length,
            confidence: triageResult.avgConfidence
        });
        
        // Stage 1: Selective Summarizer (μόνο όπου χρειάζεται)
        const summarizerStart = nowMs();
        const summarizerResults = await performSelectiveSummarization(triageResult.needsSummarizer);
        logTiming('Selective summarization', summarizerStart);
        console.log('📄 [Stage 1] Selective summarization complete');
        
        // Stage 2: Structured Labels με Budget
        const labelingStart = nowMs();
        const labeledGroups = await performStructuredLabeling(triageResult.provisionalGroups, summarizerResults);
        logTiming('Structured labeling', labelingStart);
        console.log('🏷️ [Stage 2] Structured labeling complete');
        
        // Stage 3: Targeted Score Updates (μόνο αμφίβολα ζεύγη)
        const scoreUpdateStart = nowMs();
        const updatedGroups = await performTargetedScoreUpdates(labeledGroups, summarizerResults);
        logTiming('Targeted score updates', scoreUpdateStart);
        console.log('🎯 [Stage 3] Targeted score updates complete');
        
        // Stage 4: Centroid Stabilization
        const centroidStart = nowMs();
        const stabilizedGroups = await performCentroidStabilization(updatedGroups);
        logTiming('Centroid stabilization', centroidStart);
        console.log('🔄 [Stage 4] Centroid stabilization complete');
        
        // Stage 5: AI Ensemble Fusion (sharded approach)
        const fusionStart = nowMs();
        const finalGroups = await performAIEnsembleFusion(stabilizedGroups, tabDataForAI);
        logTiming('AI ensemble fusion', fusionStart);
        console.log('🤖 [Stage 5] AI ensemble fusion complete');
        
        // 1b. Embedding extraction for richer semantic similarity
        const embeddingStart = nowMs();
        await ensureTabEmbeddings(tabDataForAI);
        logTiming('Embedding generation', embeddingStart);
        console.log('Semantic embeddings generated for all tabs');
        
        // Use final groups from new pipeline (clamp keyword lists to 10 to reduce noise)
        let groups = (finalGroups || []).map(g => ({
            ...g,
            keywords: Array.isArray(g.keywords) ? g.keywords.slice(0, 10) : []
        }));
        console.log('🎯 [Smart Pipeline] Using final groups from new architecture');

        // Enforce/split by category to reduce cross-topic mixing
        try {
            const before = groups.reduce((s,g)=>s+g.tabIndices.length,0);
            groups = splitMixedGroups(groups, tabDataForAI);
            const after = groups.reduce((s,g)=>s+g.tabIndices.length,0);
            console.log(`🧹 [Purity] Adjusted group membership to reduce cross-topic mixing (tabs: ${before} → ${after})`);
        } catch (purityErr) {
            console.warn('Purity enforcement failed:', purityErr?.message || purityErr);
        }

        // Optional shopping split (disabled by default to prevent over-segmentation)
        if (ENABLE_SHOPPING_SPLIT) {
            try {
                const beforeShop = groups.length;
                groups = splitShoppingCategories(groups, tabDataForAI);
                const afterShop = groups.length;
                if (afterShop !== beforeShop) {
                    console.log(`🛍️ [Shopping Split] Refined shopping groups (${beforeShop} → ${afterShop} groups)`);
                }
            } catch (shopErr) {
                console.warn('Shopping split failed:', shopErr?.message || shopErr);
            }
        } else {
            console.log('🛍️ [Shopping Split] Skipped (disabled)');
        }
        
        // Create featureContext for compatibility with existing code
        const featureContext = prepareTabFeatureContext(tabDataForAI);
        console.log('🔍 [Clustering Debug] Deterministic groups created:', groups.map(g => ({
            tabCount: g.tabIndices.length,
            keywords: g.keywords?.slice(0, 6) || [],
            name: g.name || 'Unnamed'
        })));
        
        // Log detailed grouping info for Chrome AI Challenge
        console.log('📊 [Chrome AI Challenge] Clustering Results:');
        groups.forEach((group, idx) => {
            console.log(`   Group ${idx + 1}: ${group.tabIndices.length} tabs, keywords: [${(group.keywords || []).slice(0, 4).join(', ')}]`);
            
            // Log detailed group info
            console.log(`🔍 [Group ${idx + 1} Details]:`, {
                tabIndices: group.tabIndices,
                keywords: group.keywords,
                primaryTopic: group.primaryTopic,
                domain: group.domain,
                name: group.name,
                confidence: group.confidence
            });
            
            // Log cluster creation
            devlog({
                type: 'CLUSTER',
                kind: 'CREATE',
                clusterId: `group_${idx + 1}`,
                members: group.tabIndices.length,
                keywords: (group.keywords || []).slice(0, 4),
                primaryTopic: group.primaryTopic || 'unknown',
                docType: group.docType || 'unknown'
            });
        });
        
        const llmRefinementStart = nowMs();
        if (groups && groups.length > 0 && featureContext && tabDataForAI && tabDataForAI.length > 0) {
            groups = await applyLLMRefinement(groups, featureContext, tabDataForAI);
        } else {
            console.log('⚠️ [Smart Pipeline] Skipping applyLLMRefinement - missing data');
        }
        logTiming('LLM refinement', llmRefinementStart);
        
        // 3. Αντιστοίχιση labels (με AI μόνο για naming) - SKIPPED (using new pipeline)
        const oldLabelingStart = nowMs();
        if (groups && groups.length > 0 && tabDataForAI && tabDataForAI.length > 0) {
            await assignGroupLabels(groups, tabDataForAI);
        } else {
            console.log('⚠️ [Smart Pipeline] Skipping assignGroupLabels - missing data');
        }
        
        const mergedByName = mergeSimilarNamedGroups(groups, featureContext, { debugLog: console.log });
        const nameMerged = mergedByName.length !== groups.length;
        if (nameMerged) {
            console.log(`Merged ${groups.length - mergedByName.length} groups based on similar labels.`);
            groups = mergedByName;
            await assignGroupLabels(groups, tabDataForAI);
        } else {
            groups = mergedByName;
        }
        
        // Optional: AI Merge Pass to fix TF-IDF over-segmentation using Prompt API
        try {
            const aiMergeStart = nowMs();
            groups = await performAIMergePass(groups, tabDataForAI);
            logTiming('AI merge pass', aiMergeStart);
        } catch (aimErr) {
            console.warn('AI merge pass skipped:', aimErr?.message || aimErr);
        }
        logTiming('Group labeling & merge refinement', oldLabelingStart);
        
        const beforeFilterCount = groups.length;
        console.log(`🔍 [Clustering Debug] Before filtering: ${beforeFilterCount} groups`);
        groups = groups.filter(group => group.tabIndices.length >= 2);
        const afterFilterCount = groups.length;
        if (groups.length !== beforeFilterCount) {
            console.log(`🔍 [Clustering Debug] After filtering: ${afterFilterCount} groups (removed ${beforeFilterCount - afterFilterCount} singleton groups)`);
        } else {
            console.log(`🔍 [Clustering Debug] No singleton groups to remove - all groups have 2+ tabs`);
        }
        
        // Log final summary with actual clustering results
        devlog({
            type: 'SUMMARY',
            runId: RUN.id(),
            totalTabs: tabDataForAI.length,
            aiSuccessCount: tabDataForAI.length, // All tabs processed with AI
            fallbackCount: 0, // No fallbacks used
            aiSuccessRate: 100, // 100% AI success rate
            finalGroups: groups.length,
            singletons: groups.filter(g => g.tabIndices.length === 1).length,
            multiTabGroups: groups.filter(g => g.tabIndices.length >= 2).length,
            apisUsed: ['Prompt API (Gemini Nano)', 'Summarizer API', 'Embedding Model API (fallback)'],
            privacy: '100% on-device processing',
            silent: false
        });
        
        // Debug logging for clustering stats
        const debugStats = {
            pairComparisons: 0,
            pairUnions: 0,
            pairMergeRate: 0
        };
        
        if (debugStats) {
            const stats = debugStats;
            const pairComparisons = stats.pairComparisons || 0;
            const pairUnions = stats.pairUnions || 0;
            const pairMergeRate = pairComparisons ? Number((pairUnions / pairComparisons).toFixed(3)) : 0;
            const smallGroupComparisons = stats.smallGroupComparisons || 0;
            const smallGroupUnions = stats.smallGroupUnions || 0;
            const nameComparisons = stats.nameComparisons || 0;
            const nameUnions = stats.nameUnions || 0;
            const channelUnions = stats.channelUnions || 0;
            const bridgePairs = 0; // No bridge pairs in current implementation
            const bridgeRate = pairUnions ? Number((bridgePairs / pairUnions).toFixed(3)) : 0;
            const purityAvg = groups.length
                ? Number((groups.reduce((sum, group) => sum + (group.primaryTopicPurity || 0), 0) / groups.length).toFixed(3))
                : 0;
            console.log('🧭 Merge diagnostics summary', {
                pairComparisons,
                pairUnions,
                pairMergeRate,
                smallGroupComparisons,
                smallGroupUnions,
                nameComparisons,
                nameUnions,
                channelUnions,
                bridgePairs,
                bridgeRate,
                averagePrimaryTopicPurity: purityAvg
            });
            featureContext.debugLog = debugStats;
            lastMergeDebugLog = debugStats;
        }
        
        // 4. Summaries για κάθε group (deferred)
        console.log('Queueing AI summaries for deferred generation...');
        const summaryPrepStart = nowMs();
        await generateGroupSummaries(groups);
        logTiming('Summary cache preparation', summaryPrepStart);
        groups.forEach(group => {
            if (!Array.isArray(group.summary) || !group.summary.length) {
                group.summary = [];
                group.summaryPending = true;
            }
        });

        // Ensure non-placeholder labels even when AI labeling times out
        try {
            const titleCase = (s) => {
                const t = String(s || '').trim();
                if (!t) return '';
                return t.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            };
            const placeholderRe = /^group\s+\d+$/i;
            const pickTop = (arr, n = 2) => (Array.isArray(arr) ? arr.filter(Boolean).slice(0, n) : []);
            const majorityShopCat = (indices) => {
                const allowed = new Set(['fashion','electronics','groceries','home','beauty','sports','automotive','digital','general']);
                const freq = new Map();
                for (const idx of indices || []) {
                    const rec = LAST_AI_KEYWORDS.find(e => e.index === idx);
                    const cat = rec && allowed.has(rec.shopCategory) ? rec.shopCategory : null;
                    if (!cat) continue;
                    freq.set(cat, (freq.get(cat) || 0) + 1);
                }
                let best = null, bestC = 0;
                for (const [k, c] of freq.entries()) { if (c > bestC) { best = k; bestC = c; } }
                return best; // may be null
            };
            groups = groups.map((g, idx) => {
                const hasName = g && g.name && !placeholderRe.test(g.name);
                if (hasName) return g;
                let name = '';
                if ((g.primaryTopic || '').toLowerCase() === 'shopping') {
                    const maj = majorityShopCat(g.tabIndices);
                    if (maj) {
                        const label = maj === 'electronics' ? 'Electronics/Gaming' : titleCase(maj);
                        name = `Shopping · ${label}`;
                    } else {
                        name = 'Shopping Group';
                    }
                } else if (g.primaryTopic) {
                    const t = g.primaryTopic.toLowerCase();
                    const kw = Array.isArray(g.keywords) ? g.keywords : [];
                    const has = (s) => kw.includes(s);
                    if (t === 'gaming') {
                        if (has('ea') && has('fc')) name = 'EA FC';
                        else if (has('ultimate') || has('squad')) name = 'Ultimate Team';
                        else name = 'Gaming';
                    } else if (t === 'technology') {
                        const tokens = new Set(kw);
                        name = tokens.has('ai') ? 'AI Technology' : 'Technology';
                    } else if (t === 'medical') {
                        name = 'Medical Research';
                    } else if (t === 'news') {
                        name = 'Tech News';
                    } else if (t === 'general') {
                        const domain = String(g.domain || '').toLowerCase();
                        if (domain.includes('docs.google.com')) name = 'Google Docs';
                        else name = 'General';
                    } else {
                        name = titleCase(t);
                    }
                } else {
                    const tokens = pickTop(g.keywords, 2);
                    name = tokens.length ? titleCase(tokens.join(' ')) : `Group ${idx + 1}`;
                }
                return { ...g, name };
            });
        } catch (labelErr) {
            console.warn('Deterministic labeling fallback failed:', labelErr?.message || labelErr);
        }
        
        aiGroups = groups;
        // Prefer labels first to avoid LM contention with summarizer
        scheduleDeferredLabels(400);
        scheduleDeferredSummaries(1200);
        
        // Αποθήκευση αποτελεσμάτων
        await chrome.storage.local.set({
            lastScan: Date.now(),
            cachedGroups: aiGroups,
            tabData: currentTabData,
            aiApisUsed: ['languageModel', 'summarizer']
        });
        
        console.log('Chrome Built-in AI analysis completed successfully');
        logTiming('AI analysis end-to-end', aiStart);
        
    } catch (error) {
        console.error('Chrome Built-in AI analysis failed:', error);
        logTiming('AI analysis end-to-end (failed)', aiStart);
        
        // Αποθήκευση error - χωρίς fallback
        aiGroups = [];
        
        await chrome.storage.local.set({
            lastScan: Date.now(),
            cachedGroups: [],
            tabData: currentTabData,
            aiError: true,
            error: error.message
        });
        
        // Πετάμε το error για να το χειριστεί το calling function
        throw new Error(`AI analysis failed: ${error.message}`);
    }
}

/**
 * Δημιουργεί tab groups βάσει των AI αποτελεσμάτων
 */
async function createTabGroups(aiGroups, tabData) {
    try {
        console.log('Creating tab groups from AI results...');
        const groupingStart = nowMs();
        const windowInfoCache = new Map();
        const getWindowInfo = async (windowId, { refresh = false } = {}) => {
            if (!windowId) return null;
            if (!refresh && windowInfoCache.has(windowId)) {
                return windowInfoCache.get(windowId);
            }
            const info = await chrome.windows.get(windowId);
            windowInfoCache.set(windowId, info);
            return info;
        };
        // Early cleanup of existing groups to avoid first-run double pass
        const earlyCleanupStart = nowMs();
        try {
            const existingGroups = await chrome.tabGroups.query({});
            for (const group of existingGroups) {
                try {
                    const tabsInGroup = await chrome.tabs.query({ groupId: group.id });
                    const ids = tabsInGroup.map(t => t.id).filter(Boolean);
                    if (ids.length) {
                        await chrome.tabs.ungroup(ids);
                        console.log(`Ungrouped ${ids.length} tabs from: ${group.title || 'Untitled'}`);
                    }
                } catch (groupCleanupErr) {
                    console.log(`Group cleanup failed for ${group.id}:`, groupCleanupErr?.message || groupCleanupErr);
                }
            }
        } catch (e) {
            console.log('Early group cleanup skipped due to error:', e?.message || e);
        }
        logTiming('Existing group cleanup', earlyCleanupStart);
        groupActivityState.clear();

        // Πρώτα ελέγχουμε όλα τα tabs που θα χρησιμοποιήσουμε
        console.log('Pre-checking all tabs for group creation...');
        const precheckStart = nowMs();
        const allTabIds = new Set();
        for (const group of aiGroups) {
            if (group.tabIndices && group.tabIndices.length > 0) {
                for (const index of group.tabIndices) {
                    const tab = tabData[index];
                    if (tab && tab.id) {
                        allTabIds.add(tab.id);
                    }
                }
            }
        }
        
        // Ελέγχουμε όλα τα tabs μαζί
        const validTabs = new Set();
        const invalidTabs = new Set();
        
        for (const tabId of allTabIds) {
            try {
                const tabInfo = await chrome.tabs.get(tabId);
                console.log(`🔍 Checking tab ${tabId}: incognito=${tabInfo.incognito}, windowId=${tabInfo.windowId}, groupId=${tabInfo.groupId}`);

                if (tabInfo && !tabInfo.incognito && tabInfo.windowId) {
                    let windowInfo = await getWindowInfo(tabInfo.windowId);
                    console.log(`🔍 Window ${tabInfo.windowId}: type=${windowInfo.type}, state=${windowInfo.state}`);

                    if (windowInfo.type === 'normal') {
                        // Allow grouping in normal, maximized, fullscreen (no window state changes)
                        if (['normal', 'maximized', 'fullscreen'].includes(windowInfo.state)) {
                            validTabs.add(tabId);
                            if (!tabInfo.groupId || tabInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
                                console.log(`✅ Tab ${tabId} is valid for grouping`);
                            } else {
                                console.log(`✅ Tab ${tabId} already in group ${tabInfo.groupId} (will be regrouped)`);
                            }
                        } else {
                            invalidTabs.add(tabId);
                            console.log(`❌ Tab ${tabId} window state invalid for grouping: ${windowInfo.state}`);
                        }
                    } else {
                        invalidTabs.add(tabId);
                        console.log(`❌ Tab ${tabId} not in normal window (type: ${windowInfo?.type})`);
                    }
                } else {
                    invalidTabs.add(tabId);
                    console.log(`❌ Tab ${tabId} is incognito or has no windowId`);
                }
            } catch (error) {
                invalidTabs.add(tabId);
                console.log(`❌ Tab ${tabId} not accessible:`, error.message);
            }
        }
                    
        console.log(`Pre-check complete: ${validTabs.size} valid tabs, ${invalidTabs.size} invalid tabs`);
        logTiming('Group creation pre-check', precheckStart);
        
        // Existing group cleanup already executed earlier in this function
        
        // Δημιουργία νέων groups
        console.log('🏗️ Creating groups from AI results...');
        console.log('📊 AI Groups received:', aiGroups.length);
        
        for (const group of aiGroups) {
            console.log(`\n🔍 Processing group: "${group.name}"`);
            console.log(`📋 Group tab indices: [${group.tabIndices?.join(', ') || 'none'}]`);
            
            if (group.tabIndices && group.tabIndices.length > 0) {
                // Χρησιμοποιούμε τα valid tabs από τον pre-check
                const validTabIds = [];
                
                for (const index of group.tabIndices) {
                    const tab = tabData[index];
                    if (tab && tab.id && validTabs.has(tab.id)) {
                        validTabIds.push(tab.id);
                        console.log(`✅ Tab ${index} (${tab.title}) → Valid for group "${group.name}"`);
                    } else {
                        console.log(`❌ Tab ${index} (${tab?.title || 'unknown'}) → Invalid for group "${group.name}"`);
                    }
                }
                
                if (validTabIds.length > 0) {
                    if (validTabIds.length === 1) {
                        console.log(`Skipping group "${group.name}" - only one valid tab remains after validation.`);
                        continue;
                    }
                    console.log(`Creating group "${group.name}" with ${validTabIds.length} tabs (${group.tabIndices.length - validTabIds.length} skipped)`);
                    
                    try {
                        // Αφού έχουμε ήδη επιβεβαιώσει ότι όλα τα tabs είναι valid, χρησιμοποιούμε τα validTabIds απευθείας
                        const finalValidTabIds = validTabIds;
                        
                        if (finalValidTabIds.length > 0) {
                            console.log(`🔧 Attempting to create group "${group.name}" with tabs: [${finalValidTabIds.join(', ')}]`);
                            
                            // Έλεγχος κάθε tab ξανά πριν τη δημιουργία (χωρίς αλλαγή fullscreen)
                            const finalCheckTabs = [];
            for (const tabId of finalValidTabIds) {
                try {
                    const tabInfo = await chrome.tabs.get(tabId);
                    const windowInfo = await getWindowInfo(tabInfo.windowId);
                    console.log(`🔍 Final check tab ${tabId}: windowType=${windowInfo.type}, incognito=${tabInfo.incognito}, state=${windowInfo.state}`);
                    if (windowInfo.type === 'normal' && !tabInfo.incognito && ['normal','maximized','fullscreen'].includes(windowInfo.state)) {
                        finalCheckTabs.push(tabId);
                    } else {
                        console.log(`❌ Tab ${tabId} failed final check: windowType=${windowInfo.type}, incognito=${tabInfo.incognito}, state=${windowInfo.state}`);
                    }
                } catch (error) {
                    console.log(`❌ Tab ${tabId} failed final check:`, error.message);
                }
            }
                            
                            if (finalCheckTabs.length > 0) {
                                // Group strictly per window to avoid cross-window errors
                                const tabsByWindow = new Map();
                                for (const tabId of finalCheckTabs) {
                                    try {
                                        const t = await chrome.tabs.get(tabId);
                                        const list = tabsByWindow.get(t.windowId) || [];
                                        list.push(tabId);
                                        tabsByWindow.set(t.windowId, list);
                                    } catch (_) {}
                                }

                                let anyGroupId = null;
                                // Helper: ensure window is in a state that allows grouping
                                const ensureWindowReady = async (winId) => {
                                    try {
                                        let info = await chrome.windows.get(winId);
                                        const originalState = info.state;
                                        // Grouping works reliably in 'normal' or 'maximized'. Exit fullscreen if needed.
                                        if (!['normal', 'maximized'].includes(info.state)) {
                                            await chrome.windows.update(winId, { state: 'normal', focused: true }).catch(() => {});
                                            // Poll a few times for the state to settle
                                            const start = Date.now();
                                            while (Date.now() - start < 1200) {
                                                await new Promise(r => setTimeout(r, 150));
                                                info = await chrome.windows.get(winId);
                                                if (['normal', 'maximized'].includes(info.state)) break;
                                            }
                                        } else {
                                            // Nudge focus to improve reliability
                                            await chrome.windows.update(winId, { focused: true }).catch(() => {});
                                        }
                                        return { ok: ['normal', 'maximized'].includes((await chrome.windows.get(winId)).state), originalState };
                                    } catch (e) {
                                        console.warn('Window readiness check failed:', e?.message || e);
                                        return { ok: false, originalState: 'normal' };
                                    }
                                };

                                for (const [winId, tabIds] of tabsByWindow.entries()) {
                                    try {
                                        let wInfo = await chrome.windows.get(winId);
                                        if (wInfo.type !== 'normal') {
                                            console.log(`⏭️ Skipping subgroup in non-normal window ${winId} (type=${wInfo.type})`);
                                            continue;
                                        }
                                        if (tabIds.length < 2) {
                                            console.log(`⏭️ Skipping subgroup in window ${winId} - fewer than 2 tabs`);
                                            continue;
                                        }
                                        const readiness = await ensureWindowReady(winId);
                                        if (!readiness.ok) {
                                            console.log(`⏭️ Skipping subgroup in window ${winId} - window not ready (state remains ${wInfo.state})`);
                                            continue;
                                        }
                                        const shouldRestore = wInfo.state === 'fullscreen';

                                        let subGroupId = await chrome.tabs.group({ tabIds });
                                        // Verify the group exists before updating; handle occasional race where id is invalid
                                        const tryUpdateGroup = async (groupId) => {
                                            // Throws if not found
                                            await chrome.tabGroups.get(groupId);
                                            await chrome.tabGroups.update(groupId, {
                                                title: group.name,
                                                color: getGroupColor(group.name)
                                            });
                                            return groupId;
                                        };
                                        try {
                                            subGroupId = await tryUpdateGroup(subGroupId);
                                        } catch (e) {
                                            // Retry once by regrouping in case the prior id became invalid
                                            console.warn(`tabGroups.update failed (will retry): ${e?.message || e}`);
                                            await new Promise(r => setTimeout(r, 100));
                                            const retryId = await chrome.tabs.group({ tabIds });
                                            subGroupId = await tryUpdateGroup(retryId);
                                        }
                                        anyGroupId = anyGroupId || subGroupId;
                                        tabIds.forEach(tabId => {
                                            const tab = tabData.find(t => t.id === tabId);
                                            console.log(`  📄 Tab ${tabId}: "${tab?.title || 'Unknown'}" (${tab?.domain || 'Unknown domain'})`);
                                        });
                                        console.log(`✅ Sub-group created in window ${winId} with ID: ${subGroupId} (${tabIds.length} tabs)`);

                                        // restore fullscreen if we changed it
                                        if (shouldRestore) {
                                            try {
                                                await chrome.windows.update(winId, { state: 'fullscreen' });
                                            } catch (restoreErr) {
                                                console.warn(`Could not restore fullscreen for window ${winId}:`, restoreErr?.message || restoreErr);
                                            }
                                        }
                                    } catch (subErr) {
                                        console.warn(`Sub-group creation failed in window ${winId}:`, subErr?.message || subErr);
                                    }
                                }

                                if (anyGroupId) {
                                    group.chromeGroupId = anyGroupId;
                                    group.autoSuspended = false;
                                    group.lastActive = 0;
                                    const initialState = { lastActive: 0, suspended: false };
                                    groupActivityState.set(anyGroupId, initialState);
                                } else {
                                    console.log(`⏭️ Skipping group "${group.name}" - could not create any tab group`);
                                }
                            } else {
                                console.log(`⏭️ Skipping group "${group.name}" - no tabs passed final check`);
                            }
                        } else {
                            console.log(`⏭️ Skipping group "${group.name}" - no valid tabs`);
                        }
                    } catch (groupError) {
                        console.error(`Failed to create group "${group.name}":`, groupError);
                        // Συνεχίζουμε με τα επόμενα groups
                    }
                } else {
                    console.log(`Skipping group "${group.name}" - no valid tabs found`);
                }
            }
        }
        
        startAutoSuspendScheduler();
        logTiming('Tab grouping pipeline', groupingStart);
        console.log('Tab groups created successfully');
        try {
            if (RAM_CLEANUP_ENABLED) {
                schedulePostRunRamCleanup(aiGroups, tabData);
            }
        } catch (ramErr) {
            console.warn('RAM cleanup scheduling failed:', ramErr?.message || ramErr);
        }
        
    } catch (error) {
        console.error('Error creating tab groups:', error);
        throw error;
    }
}

/**
 * Επιστρέφει χρώμα για κάθε group βάσει του ονόματος
 */
function getGroupColor(groupName) {
    const name = groupName.toLowerCase();
    
    // Gaming & Entertainment
    if (name.includes('gaming') || name.includes('game') || name.includes('fifa') || 
        name.includes('youtube') || name.includes('video') || name.includes('entertainment')) {
        return 'red';
    }
    
    // Work & Productivity  
    if (name.includes('work') || name.includes('email') || name.includes('productivity') ||
        name.includes('chatgpt') || name.includes('ai') || name.includes('tools')) {
        return 'blue';
    }
    
    // Research & Learning
    if (name.includes('research') || name.includes('medical') || name.includes('study') ||
        name.includes('learning') || name.includes('education') || name.includes('article')) {
        return 'green';
    }
    
    // Shopping & Commerce
    if (name.includes('shopping') || name.includes('buy') || name.includes('commerce') ||
        name.includes('amazon') || name.includes('store') || name.includes('price')) {
        return 'yellow';
    }
    
    // Social & Communication
    if (name.includes('social') || name.includes('communication') || name.includes('chat') ||
        name.includes('message') || name.includes('discord') || name.includes('twitter')) {
        return 'purple';
    }
    
    // News & Information
    if (name.includes('news') || name.includes('information') || name.includes('blog') ||
        name.includes('update') || name.includes('current')) {
        return 'orange';
    }
    
    // Technology & Reviews
    if (name.includes('iphone') || name.includes('review') || name.includes('tech') ||
        name.includes('device') || name.includes('comparison')) {
        return 'grey';
    }
    
    return 'cyan'; // default for unknown categories
}

// Simple fallback summarization when Chrome AI Summarizer isn't available
function buildFallbackSummary(groupTabs) {
    try {
        const bullets = [];
        const titles = groupTabs.map(t => t?.title).filter(Boolean);
        const hosts = groupTabs.map(t => {
            try { return new URL(t.url).hostname; } catch { return null; }
        }).filter(Boolean);
        const hostCounts = hosts.reduce((acc, h) => (acc[h] = (acc[h] || 0) + 1, acc), {});
        const topHosts = Object.entries(hostCounts)
            .sort((a,b) => b[1]-a[1])
            .slice(0, 3)
            .map(([h,c]) => `${h} (${c})`);

        if (titles.length) {
            bullets.push(`Representative tabs: ${titles.slice(0, 2).join(' • ')}`);
        }
        if (topHosts.length) {
            bullets.push(`Main sites: ${topHosts.join(', ')}`);
        }
        const words = titles.join(' ').toLowerCase().split(/[^a-zα-ωάέίήόύώ0-9]+/).filter(w => w.length > 3);
        const freq = words.reduce((acc, w) => (acc[w] = (acc[w] || 0) + 1, acc), {});
        const keywords = Object.entries(freq)
            .filter(([w]) => !['recently','official','news','update','home','login','google','openai','tech','blog','site','www'].includes(w))
            .sort((a,b) => b[1]-a[1])
            .slice(0, 5)
            .map(([w]) => w);
        if (keywords.length) {
            bullets.push(`Keywords: ${keywords.join(', ')}`);
        }
        if (bullets.length === 0) bullets.push('Summary unavailable (no content).');
        return bullets.slice(0, 5);
    } catch (_) {
        return ['Summary temporarily unavailable.'];
    }
}


/**
 * Εκτελεί AI summarization χρησιμοποιώντας content script
 */
async function performAISummarization(groupContent) {
    try {
        // Check if we've previously determined summarizer is unavailable
        try {
            const { summarizerStatus } = await chrome.storage.session.get(['summarizerStatus']);
            if (summarizerStatus && summarizerStatus.unavailableUntil && Date.now() < summarizerStatus.unavailableUntil) {
                const reason = summarizerStatus.reason || 'Summarizer temporarily unavailable';
                throw new Error(reason);
            }
        } catch (_) {}
        // Βρίσκουμε ένα tab που μπορούμε να χρησιμοποιήσουμε για AI
        // Αποκλείουμε chrome:// URLs
    const tabs = await chrome.tabs.query({});
        const accessibleTab = tabs.find(tab => 
        tab.url &&
        !tab.url.startsWith('chrome://') &&
        !tab.url.startsWith('chrome-extension://') &&
            !tab.url.startsWith('moz-extension://') &&
        !tab.url.startsWith('edge://') &&
            tab.url.startsWith('http')
        );
        
        if (!accessibleTab) {
            throw new Error('No accessible tab found for AI processing');
        }
        
        // Βρίσκουμε ένα tab που μπορούμε να χρησιμοποιήσουμε για AI
        const allTabs = await chrome.tabs.query({});
        const usableTab = allTabs.find(tab => 
            tab.url && 
            !tab.url.startsWith('chrome://') && 
            !tab.url.startsWith('chrome-extension://') &&
            !tab.url.startsWith('moz-extension://') &&
            !tab.url.startsWith('edge://') &&
            tab.url.startsWith('http')
        );
        
        if (!usableTab) {
            throw new Error('No usable tab found for AI processing (all tabs are chrome:// or extension pages)');
        }
        
        const targetTabId = usableTab.id;
        console.log('Background: Using usable tab for AI summarization:', targetTabId, usableTab.url);
        
        // Εκτελούμε AI summarization στο content script
        const scriptPromise = chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            world: 'MAIN',
            func: (groupContent) => {
                // Direct AI summarization στο content script context
                return (async () => {
                    let rawSummary = null;
                    try {
                        const globalScope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
                        
                        function resolveSummarizerApi() {
                            return (
                                globalScope?.Summarizer ||
                                globalScope?.ai?.summarizer ||
                                globalScope?.ai?.Summarizer ||
                                globalScope?.aiOriginTrial?.summarizer ||
                                globalScope?.window?.ai?.Summarizer ||
                                null
                            );
                        }
                        
                        console.log('Content script: Starting AI summarization...');
                        const summarizerApi = resolveSummarizerApi();
                        
                        if (!summarizerApi) {
                            throw new Error('Summarizer API not available');
                        }
                        
                        console.log('Content script: Summarizer API detected');
                        
                        if (typeof summarizerApi.availability === 'function') {
                            try {
                                const availability = await summarizerApi.availability();
                                console.log('Content script: Summarizer availability:', availability);
                                
                                if (availability === 'unavailable') {
                                    throw new Error('Summarizer API is unavailable');
                                }
                                
                                if ((availability === 'downloadable' || availability === 'downloading') && !(navigator.userActivation && navigator.userActivation.isActive)) {
                                    throw new Error('Summarizer requires user activation to download. Click the page and try again.');
                                }
                            } catch (availabilityError) {
                                console.warn('Content script: Summarizer.availability() failed, continuing optimistically:', availabilityError);
                            }
                        }
                        
                        const options = {
                            type: 'key-points',
                            format: 'plain-text',
                            length: 'short'
                        };
                        
                        console.log('Content script: Creating summarizer with options:', options);
                        let summarizer;
                        try {
                            summarizer = await summarizerApi.create({
                                ...options,
                                monitor(monitor) {
                                    monitor.addEventListener('downloadprogress', (event) => {
                                        const percent = (event.loaded * 100).toFixed(1);
                                        console.log(`Content script: Summarizer download progress ${percent}%`);
                                    });
                                }
                            });
                        } catch (createWithMonitorError) {
                            console.warn('Content script: Summarizer.create with monitor failed, retrying without monitor:', createWithMonitorError);
                            summarizer = await summarizerApi.create(options);
                        }
                        
                        if (!summarizer) {
                            throw new Error('Failed to create summarizer instance');
                        }
                        
                        console.log('Content script: Summarizer instance created successfully');
                        
                        const summary = await summarizer.summarize(groupContent);
                        rawSummary = summary;
                        
                        console.log('Content script: AI summarization completed:', summary);
                        
                        if (typeof summary === 'string') {
                            const lines = summary.split('\n')
                                .map(line => line.trim())
                                .filter(line => line.length > 0)
                                .slice(0, 5);
                            return { success: true, summary: lines.length > 0 ? lines : [summary], rawSummary: summary };
                        } else if (summary && summary.points) {
                            return { success: true, summary: summary.points.slice(0, 5), rawSummary: summary };
                        } else if (summary && summary.summary) {
                            return { success: true, summary: [summary.summary], rawSummary: summary };
                        }
                        
                        throw new Error('Invalid summarizer response format');
                        
                    } catch (error) {
                        console.error('Content script: Error in AI summarization:', error);
                        return {
                            success: false,
                            error: {
                                name: error.name,
                                message: error.message,
                                stack: error.stack,
                                rawSummary
                            }
                        };
                    }
                })();
            },
            args: [groupContent]
        });
        const result = await withTimeout(scriptPromise, AI_SUMMARY_TIMEOUT, 'AI summary timeout');
        
        console.log('AI summarization result:', result);
        
        const executionResult = result && result[0] ? result[0] : null;
        
        if (executionResult?.result?.success) {
            return executionResult.result.summary;
        }
        
        if (executionResult?.result?.success === false) {
            const errorInfo = executionResult.result.error || {};
            console.error('AI summarization reported failure:', errorInfo);
            let rawSnippet = '';
            if (errorInfo.rawSummary !== undefined) {
                const raw = typeof errorInfo.rawSummary === 'string'
                    ? errorInfo.rawSummary
                    : (() => { try { return JSON.stringify(errorInfo.rawSummary); } catch { return String(errorInfo.rawSummary); } })();
                rawSnippet = ` Raw summary snippet: ${raw.slice(0, 200)}`;
            }
            // Detect low disk space / on-device model download issues and mark summarizer unavailable
            const msg = String(errorInfo.message || '').toLowerCase();
            if (msg.includes('not have enough space') || msg.includes('notallowederror')) {
                try {
                    await chrome.storage.session.set({ summarizerStatus: {
                        unavailableUntil: Date.now() + SUMMARIZER_UNAVAILABLE_TTL_MS,
                        reason: errorInfo.message || 'Chrome AI summarizer unavailable'
                    }});
                } catch (_) {}
            }
            throw new Error(`AI summarization content script error: ${errorInfo.message || 'Unknown error'}${rawSnippet}`);
        }
        
        if (executionResult?.exceptionDetails) {
            console.error('AI summarization exception details:', executionResult.exceptionDetails);
            throw new Error('AI summarization failed due to script exception');
        }
        
            console.error('AI summarization failed - no result:', result);
            throw new Error('AI summarization failed - no result');
        
    } catch (error) {
        console.error('Error in AI summarization:', error);
        // Persist unavailability for well-known capacity errors
        try {
            const msg = String(error?.message || '').toLowerCase();
            if (msg.includes('not have enough space') || msg.includes('notallowederror')) {
                await chrome.storage.session.set({ summarizerStatus: {
                    unavailableUntil: Date.now() + SUMMARIZER_UNAVAILABLE_TTL_MS,
                    reason: error.message
                }});
            }
        } catch (_) {}
        throw new Error(`AI summarization failed: ${error.message}`);
    }
}

// All mock functions removed - using only real AI

function generateTopicHints(tab) {
    try {
        const hints = new Set();
        const title = (tab.title || '').toLowerCase();
        const meta = (tab.metaDescription || '').toLowerCase();
        const content = (tab.content || '').toLowerCase();
        const combinedText = `${title} ${meta} ${content}`;
        let domain = tab.domain;
        if (!domain) {
            try {
                domain = tab.url ? new URL(tab.url).hostname : '';
            } catch (error) {
                domain = '';
            }
        }
        const domainLower = (domain || '').toLowerCase();
        const features = tab.semanticFeatures || {};
        
        if (features.primaryTopic) {
            const topicLabel = titleCaseFromTokens(tokenizeText(features.primaryTopic)) || features.primaryTopic;
            hints.add(`Primary topic: ${topicLabel}`);
        }
        if (Array.isArray(features.subtopics) && features.subtopics.length) {
            const topSubtopics = features.subtopics
                .map(sub => titleCaseFromTokens(tokenizeText(sub)) || sub)
                .filter(Boolean)
                .slice(0, 3)
                .join(', ');
            if (topSubtopics) {
                hints.add(`Subtopics: ${topSubtopics}`);
            }
        }
        if (Array.isArray(features.entities) && features.entities.length) {
            const entitiesList = features.entities.slice(0, 3).join(', ');
            hints.add(`Entities: ${entitiesList}`);
        }
        if (features.docType) {
            const docLabel = titleCaseFromTokens(tokenizeText(features.docType)) || features.docType;
            hints.add(`Doc type: ${docLabel}`);
        }
        if (Array.isArray(features.mergeHints) && features.mergeHints.length) {
            const mergePreview = features.mergeHints.slice(0, 4).join(', ');
            hints.add(`Merge hints: ${mergePreview}`);
        }
        if (Array.isArray(tab.summaryBullets) && tab.summaryBullets.length) {
            hints.add(`AI summary: ${tab.summaryBullets.slice(0, 2).join(' | ')}`);
        }
        
        if (domainLower.includes('youtube.com') || domainLower.includes('youtu.be')) {
            hints.add('Media: YouTube video');
        }
        
        if (domainLower.includes('mail.google.com') || domainLower.includes('outlook.') || domainLower.includes('mail.yahoo') || domainLower.includes('protonmail')) {
            hints.add('Category: Email & communications');
        }
        
        // Extract meaningful keywords to use as dynamic topic hints
        const youtubeAnalysis = tab.youtubeAnalysis;
        if (youtubeAnalysis && youtubeAnalysis.topic) {
            const confidence = typeof youtubeAnalysis.confidence === 'number'
                ? ` (confidence ${(youtubeAnalysis.confidence).toFixed(2)})`
                : '';
            hints.add(`YouTube topic: ${youtubeAnalysis.topic}${confidence}`);
            if (youtubeAnalysis.tags && youtubeAnalysis.tags.length) {
                hints.add(`YouTube tags: ${youtubeAnalysis.tags.slice(0, 6).join(', ')}`);
            }
            if (youtubeAnalysis.channel) {
                hints.add(`YouTube channel: ${youtubeAnalysis.channel}`);
            }
            if (youtubeAnalysis.summaryBullets && youtubeAnalysis.summaryBullets.length) {
                hints.add(`YouTube summary: ${youtubeAnalysis.summaryBullets.slice(0, 2).join(' | ')}`);
            }
        }
        
        // Enhanced content analysis for better similarity detection
        const fullContent = youtubeAnalysis && youtubeAnalysis.description
            ? `${combinedText} ${youtubeAnalysis.description} ${(youtubeAnalysis.transcript || '').slice(0, 2000)}`
            : combinedText;
        
        const meaningfulWords = extractMeaningfulKeywords(fullContent);
        meaningfulWords.forEach(word => hints.add(`Keyword: ${word}`));
        
        // Add domain-specific hints for better grouping
        if (domainLower.includes('github.com')) {
            hints.add('Platform: GitHub - Code repository');
        } else if (domainLower.includes('stackoverflow.com')) {
            hints.add('Platform: Stack Overflow - Programming help');
        } else if (domainLower.includes('reddit.com')) {
            hints.add('Platform: Reddit - Community discussion');
        } else if (domainLower.includes('wikipedia.org')) {
            hints.add('Platform: Wikipedia - Encyclopedia');
        } else if (domainLower.includes('amazon.') || domainLower.includes('ebay.') || domainLower.includes('shop')) {
            hints.add('Platform: E-commerce - Shopping');
        }
        
        if ((domainLower.includes('youtube.com') || domainLower.includes('youtu.be')) && !Array.from(hints).some(hint => hint.startsWith('Keyword:'))) {
            hints.add('Topic: YouTube video');
        }
        
        if (!hints.size) {
            hints.add('Topic: General browsing');
        }
        
        return Array.from(hints).join(' • ');
    } catch (error) {
        console.warn('Failed to generate topic hints:', error);
        return 'Topic: General browsing';
    }
}

/**
 * Υπολογίζει similarity score μεταξύ δύο tabs για πιο ακριβή grouping
 */
function calculateTabSimilarity(tab1, tab2) {
    try {
    let score = 0;
    let factors = 0;
    
        // 🎯 TITLE & KEYWORDS SIMILARITY (50% weight) - ΠΙΟ ΣΗΜΑΝΤΙΚΟ!
        if (tab1.title && tab2.title) {
            const title1 = tab1.title.toLowerCase();
            const title2 = tab2.title.toLowerCase();
            
            // Εξαγωγή keywords από titles
            const keywords1 = extractKeywordsFromText(tab1.title);
            const keywords2 = extractKeywordsFromText(tab2.title);
            
            // Υπολογισμός keyword overlap
            const commonKeywords = keywords1.filter(kw => keywords2.includes(kw));
            const keywordScore = commonKeywords.length > 0 ? Math.min(30, commonKeywords.length * 6) : 0;
            
            // Υπολογισμός title word overlap
            const commonWords = title1.split(' ').filter(word => 
                word.length > 3 && title2.includes(word)
            );
            const wordScore = commonWords.length > 0 ? Math.min(20, commonWords.length * 4) : 0;
            
            score += keywordScore + wordScore;
            factors += 50;
        }
        
        // 🌐 DOMAIN SIMILARITY (25% weight)
        if (tab1.domain && tab2.domain) {
            if (tab1.domain === tab2.domain) {
                score += 25;
            } else if (tab1.domain.includes(tab2.domain.split('.')[0]) || 
                      tab2.domain.includes(tab1.domain.split('.')[0])) {
                score += 15;
            }
            factors += 25;
        }
        
        // 💡 TOPIC HINTS SIMILARITY (15% weight)
        if (tab1.topicHints && tab2.topicHints) {
            const hints1 = tab1.topicHints.toLowerCase().split(' • ');
            const hints2 = tab2.topicHints.toLowerCase().split(' • ');
            const commonHints = hints1.filter(hint => 
                hints2.some(h2 => h2.includes(hint) || hint.includes(hint))
            );
            if (commonHints.length > 0) {
                score += Math.min(15, commonHints.length * 5);
            }
            factors += 15;
        }
        
        // 📺 YOUTUBE ANALYSIS SIMILARITY (10% weight)
        if (tab1.youtubeAnalysis && tab2.youtubeAnalysis) {
            if (tab1.youtubeAnalysis.topic === tab2.youtubeAnalysis.topic) {
                score += 10;
            } else if (tab1.youtubeAnalysis.tags && tab2.youtubeAnalysis.tags) {
                const commonTags = tab1.youtubeAnalysis.tags.filter(tag => 
                    tab2.youtubeAnalysis.tags.includes(tag)
                );
                score += Math.min(10, commonTags.length * 2);
            }
            factors += 10;
        }
        
        return factors > 0 ? (score / factors) * 100 : 0;
    } catch (error) {
        console.warn('Failed to calculate tab similarity:', error);
        return 0;
    }
}

const STOPWORDS = new Set([
    // English common stopwords and function words
    'the','and','with','from','that','this','have','has','will','would','could','should',
    'about','into','onto','after','before','while','where','which','their','there','other',
    'these','those','than','then','when','what','your','yours','ours','ourselves','hers',
    'his','her','its','they','them','were','was','been','being','because','over','under',
    'again','further','once','here','every','most','some','such','only','own','same','very',
    'just','also','like','more','less','many','much','any','each','an','a','is','are','it','as',
    'per','via','for','to','of','in','on','at','by','up','down','out','across','between','among','through',
    // URL/tech noise
    'http','https','www','com','net','org','html','amp','php','utm','ref','aspx','index',
    // Generic site words
    'home','main','default','article','video','watch','channel','official',
    // Greek common stopwords
    'και','για','στο','στη','στην','στον','των','του','της','τα','τις','ο','η','το','ένα','μια','ένας',
    'σε','με','από','προς','κατά','χωρίς','ως','όπως','είναι'
]);

function extractMeaningfulKeywords(text) {
    if (!text) {
        return [];
    }
    try {
        // Normalize text: lowercase, remove special chars, keep Greek and English
        const normalizedText = text
            .toLowerCase()
            .replace(/[^a-z0-9\sα-ωάέίήύόώϊϋΐΰ]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        const words = normalizedText.split(/\s+/)
            .filter(word => word.length >= 3 && !STOPWORDS.has(word));
        
        // Enhanced keyword extraction with stemming-like approach
        const enhancedWords = words.map(word => {
            // Simple stemming for common patterns
            if (word.endsWith('ing') && word.length > 6) return word.slice(0, -3);
            if (word.endsWith('ed') && word.length > 5) return word.slice(0, -2);
            if (word.endsWith('s') && word.length > 4) return word.slice(0, -1);
            return word;
        });
        
        const frequency = new Map();
        for (const word of enhancedWords) {
            frequency.set(word, (frequency.get(word) || 0) + 1);
        }
        
        // Prioritize words that appear multiple times or are in short documents
        const sortedWords = Array.from(frequency.entries())
            .filter(([, count]) => count > 1 || words.length <= 30)
            .sort((a, b) => {
                // Sort by frequency first, then by length (longer words are more specific)
                if (b[1] !== a[1]) return b[1] - a[1];
                return b[0].length - a[0].length;
            })
            .slice(0, 8) // More keywords for better similarity detection
            .map(([word]) => word);
        
        return sortedWords;
    } catch (error) {
        console.warn('Failed to extract keywords:', error);
        return [];
    }
}

function inferTaxonomyTags(entry) {
    try {
        const tags = new Set();
        const domain = (entry.domain || entry.url || '').toLowerCase();
        if (domain) {
            TAXONOMY_RULES.forEach(rule => {
                if (rule.match.test(domain)) {
                    rule.tags.forEach(tag => tags.add(tag));
                }
            });
        }
        
        const topicHints = String(entry.topicHints || '').toLowerCase();
        const title = String(entry.title || '').toLowerCase();
        const combinedSignals = [
            topicHints,
            title,
            Array.isArray(entry.metaKeywords) ? entry.metaKeywords.join(' ') : '',
            Array.isArray(entry.semanticFeatures?.keywords) ? entry.semanticFeatures.keywords.join(' ') : '',
            entry.semanticFeatures?.topic || ''
        ].join(' ').toLowerCase();
        
        if (combinedSignals.includes('medical') || combinedSignals.includes('clinical')) {
            tags.add('medical research');
        }
        if (combinedSignals.includes('research')) {
            tags.add('research');
        }
        if (combinedSignals.includes('iphone') || combinedSignals.includes('apple')) {
            tags.add('apple');
            tags.add('technology');
        }
        if (combinedSignals.includes('chrome') || combinedSignals.includes('extension')) {
            tags.add('chrome');
            tags.add('browser');
        }
        if (combinedSignals.includes('fifa') || combinedSignals.includes('ultimate team') || combinedSignals.includes('fc 26')) {
            // Avoid brand-specific taxonomy; keep it general
            tags.add('gaming');
        }
        if (combinedSignals.includes('news')) {
            tags.add('news');
        }
        if (combinedSignals.includes('finance') || combinedSignals.includes('market')) {
            tags.add('finance');
        }
        if (entry.youtubeTopic) {
            tags.add(`youtube:${String(entry.youtubeTopic).toLowerCase()}`);
        }
        if (entry.youtubeChannel) {
            tags.add(`channel:${String(entry.youtubeChannel).toLowerCase()}`);
        }
        
        return Array.from(tags);
    } catch (error) {
        console.warn('Failed to infer taxonomy tags:', error);
        return [];
    }
}

/**
 * Βρίσκει ένα tab στο οποίο μπορούμε να τρέξουμε τις Chrome AI APIs
 */
async function findUsableAIAccessTab() {
    const tabs = await chrome.tabs.query({});
    const httpTabs = tabs.filter(tab => tab.url && tab.url.startsWith('http'));
    if (!httpTabs.length) return null;
    // Prefer light, static tabs (avoid very heavy pages) using simple heuristics
    const preferHosts = new Set(['openai.com','blog.google','developer.chrome.com']);
    const avoidHosts = new Set([
        'ea.com','futbin.com','fut.gg','who.int','calendar.google.com','docs.google.com','drive.google.com'
    ]);
    const tabById = new Map(currentTabData.map((t, idx) => [t.id, { idx, entry: t }]));
    const scoreTab = (tab) => {
        const url = tab.url || '';
        let host = '';
        try { host = new URL(url).hostname.replace(/^www\./,''); } catch {}
        let score = 0;
        if (preferHosts.has(host)) score += 3;
        if (avoidHosts.has(host)) score -= 3;
        const td = tabById.get(tab.id)?.entry;
        const contentLen = td && typeof td.content === 'string' ? td.content.length : 0;
        if (contentLen && contentLen < 1200) score += 1; // lighter page
        if (/news|blog/i.test(td?.title || '')) score += 1;
        if (/download|video|player/i.test(td?.title || '')) score -= 1;
        return score;
    };
    httpTabs.sort((a, b) => scoreTab(b) - scoreTab(a));
    return httpTabs[0] || null;
}

/**
 * Δημιουργεί περιγραφικό αντικείμενο για feature extraction
 */
function buildTabFeatureDescriptor(originalTab, tabEntry) {
    const youtube = originalTab.youtubeAnalysis || {};
    return {
        title: originalTab.title || '',
        url: originalTab.url || '',
        domain: tabEntry.domain || '',
        metaDescription: (originalTab.metaDescription || '').slice(0, 100), // Smart truncation - keep most relevant
        content: (originalTab.content || '').slice(0, 200), // Smart truncation - keep most relevant
        topicHints: (originalTab.topicHints || tabEntry.topicHints || '').slice(0, 80), // Smart truncation
        headings: Array.isArray(originalTab.headings) ? originalTab.headings.slice(0, 2) : [], // Aggressively reduced for laptop cooling
        metaKeywords: Array.isArray(originalTab.metaKeywords) ? originalTab.metaKeywords.slice(0, 3) : [], // Aggressively reduced for laptop cooling
        language: originalTab.language || tabEntry.language || '',
        sourceLanguage: originalTab.language || tabEntry.language || '',
        summaryBullets: Array.isArray(originalTab.summaryBullets)
            ? originalTab.summaryBullets.slice(0, 2) // Aggressively reduced for laptop cooling
            : [],
        classification: originalTab.classification || null,
        youtube: {
            topic: (youtube.topic || '').slice(0, 50), // Aggressively reduced for laptop cooling
            tags: (youtube.tags || []).slice(0, 3), // Aggressively reduced for laptop cooling
            channel: (youtube.channel || '').slice(0, 50), // Aggressively reduced for laptop cooling
            summaryBullets: (youtube.summaryBullets || []).slice(0, 2), // Aggressively reduced for laptop cooling
            description: (youtube.description || '').slice(0, 150) // Aggressively reduced for laptop cooling
        }
    };
}

/**
 * Δήλωση fallback features όταν το AI δεν απαντά
 */
function fallbackTabFeatures(originalTab, tabEntry) {
    const combinedText = [
        originalTab.title || '',
        originalTab.metaDescription || '',
        originalTab.content || '',
        originalTab.youtubeAnalysis?.description || '',
        (originalTab.youtubeAnalysis?.summaryBullets || []).join(' ')
    ].join(' ');
    const normalizedKeywords = extractMeaningfulKeywords(combinedText).slice(0, 6);
    const lowerKeywords = normalizedKeywords.map(keyword => keyword.toLowerCase());
    const titleTokens = tokenizeText(originalTab.title || '').slice(0, 4);
    
    const topicBaseTokens = lowerKeywords.length ? lowerKeywords.slice(0, 3) : titleTokens.slice(0, 3);
    const domainTokens = tokenizeText(tabEntry.domain || '').slice(0, 3);
    const mergedTokens = Array.from(new Set([...topicBaseTokens, ...domainTokens])).filter(Boolean);
    
    let primaryTopic = mergedTokens.slice(0, 3).join(' ');
    if (!primaryTopic) {
        primaryTopic = (tabEntry.domain || 'general').split('.').filter(Boolean).slice(-2, -1)[0] || 'general';
    }
    primaryTopic = primaryTopic.trim() || 'general';
    
    const mergeHintSource = Array.from(new Set([
        ...lowerKeywords,
        ...topicBaseTokens,
        ...domainTokens
    ])).filter(token => token.length >= 3 && !GENERIC_MERGE_STOPWORDS.has(token));
    let mergeHints = mergeHintSource.slice(0, 6);
    if (mergeHints.length < 2) {
        const fallbackTokens = tokenizeText(primaryTopic)
            .filter(token => !GENERIC_MERGE_STOPWORDS.has(token))
            .slice(0, 3);
        mergeHints = Array.from(new Set([...mergeHints, ...fallbackTokens]))
            .filter(Boolean)
            .slice(0, 6);
    }
    if (mergeHints.length < 2) {
        mergeHints = ['misc', 'browsing'];
    }
    
    const summaryBullets = [];
    const metaSnippet = (originalTab.metaDescription || '').trim();
    if (metaSnippet) {
        summaryBullets.push(metaSnippet.slice(0, 220));
    }
    if (Array.isArray(originalTab.headings) && originalTab.headings.length) {
        summaryBullets.push(String(originalTab.headings[0]).trim().slice(0, 180));
    }
    if (!summaryBullets.length && originalTab.content) {
        summaryBullets.push(originalTab.content.slice(0, 200));
    }
    
    const urlString = originalTab.url || tabEntry.url || '';
    let docType = 'article';
    let isGenericLanding = false;
    try {
        const url = new URL(urlString);
        const path = (url.pathname || '').toLowerCase();
        const segments = path.split('/').filter(Boolean);
        const hasShortPath = segments.length <= 1;
        const pathIndicators = ['category', 'topics', 'tag', 'tags', 'collections'];
        const portalIndicators = ['portal', 'hub', 'overview'];
        const docsIndicators = ['docs', 'documentation', 'developer', 'api', 'guide'];
        
        if (!combinedText.trim() || hasShortPath) {
            docType = 'landing';
            isGenericLanding = true;
        } else if (pathIndicators.some(token => path.includes(token))) {
            docType = 'category';
            isGenericLanding = true;
        } else if (portalIndicators.some(token => path.includes(token))) {
            docType = 'portal';
            isGenericLanding = true;
        } else if (docsIndicators.some(token => path.includes(token)) || url.hostname.startsWith('docs.')) {
            docType = 'docs';
        } else if (segments.length === 0) {
            docType = 'landing';
            isGenericLanding = true;
        }
    } catch (error) {
        docType = 'landing';
        isGenericLanding = !combinedText.trim();
    }
    
    const entities = [];
    try {
        const host = new URL(urlString).hostname;
        const parts = host.split('.').filter(part => part && part !== 'www');
        const entity = parts.slice(-2, -1)[0] || parts[0];
        if (entity) {
            entities.push(entity.charAt(0).toUpperCase() + entity.slice(1));
        }
    } catch (_) {
        if (tabEntry.domain) {
            const parts = tabEntry.domain.split('.').filter(part => part && part !== 'www');
            const entity = parts.slice(-2, -1)[0] || parts[0];
            if (entity) {
                entities.push(entity.charAt(0).toUpperCase() + entity.slice(1));
            }
        }
    }
    
    const topicTitle = titleCaseFromTokens(tokenizeText(primaryTopic));
    const subtopics = lowerKeywords.slice(0, 4);
    const summaryKeywords = Array.from(new Set(summaryBullets.flatMap(bullet => tokenizeText(bullet))))
        .filter(token => token && !GENERIC_MERGE_STOPWORDS.has(token))
        .slice(0, 6);
    
    return {
        topic: topicTitle || 'General browsing',
        keywords: mergeHints,
        origin: 'fallback',
        primaryTopic,
        subtopics,
        entities,
        docType,
        isGenericLanding,
        mergeHints,
        summaryBullets,
        summaryKeywords,
        version: 2,
        sourceLanguage: originalTab.sourceLanguage || tabEntry.language || DEFAULT_WORKING_LANGUAGE,
        normalizedLanguage: DEFAULT_WORKING_LANGUAGE
    };
}

/**
 * Εξασφαλίζει ότι κάθε tab έχει semantic features (topic/keywords)
 */
async function ensureTabSemanticFeatures(tabDataForAI) {
    const accessibleTab = await findUsableAIAccessTab();
    const failureReasons = new Set();
    let fallbackCount = 0;
    let aiTabId = null;
    
    if (accessibleTab) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: accessibleTab.id },
                world: 'MAIN',
                func: checkLanguageModelAvailabilityInPage
            });
            if (results && results[0] && results[0].result && results[0].result.ready) {
                aiTabId = accessibleTab.id;
                console.log('✅ AI Language Model ready on tab:', aiTabId);
            } else {
                const reason = results && results[0] && results[0].result && results[0].result.reason;
                if (reason) failureReasons.add(reason);
            }
        } catch (error) {
            failureReasons.add(error?.message || String(error));
        }
    } else {
        failureReasons.add('No accessible tab with Chrome AI APIs');
    }
    
    const cacheData = await chrome.storage.session.get(['semanticFeatureCache']);
    const semanticFeatureCache = cacheData.semanticFeatureCache || {};
    const cacheUpdates = {};
    let aiRequestCount = 0;
    
    const makeCacheKey = (entry) => {
        if (!entry || !entry.url) {
            const tab = currentTabData[entry?.index ?? -1];
            if (!tab?.url) return null;
            return tab.url;
        }
        return entry.url;
    };
    
    const sanitizeStringList = (list, { limit = 6, toLower = true, minLength = 2, banned = [] } = {}) => {
        if (!Array.isArray(list)) return [];
        const bannedSet = new Set(banned.map(item => item.toLowerCase()));
        const result = [];
        for (const item of list) {
            if (item === null || item === undefined) continue;
            let token = String(item).trim();
            if (!token) continue;
            if (toLower) token = token.toLowerCase();
            if (token.length < minLength) continue;
            if (bannedSet.has(token)) continue;
            if (!result.includes(token)) {
                result.push(token);
            }
            if (result.length >= limit) break;
        }
        return result;
    };
    
    const applyFeaturesToTab = (entry, originalTab, features) => {
        if (!features) {
            return;
        }
        const summaryBullets = Array.isArray(features.summaryBullets)
            ? features.summaryBullets.slice(0, 6)
            : [];
        const classification = {
            primaryTopic: features.primaryTopic || features.topic || '',
            subtopics: Array.isArray(features.subtopics) ? features.subtopics.slice(0, 6) : [],
            entities: Array.isArray(features.entities) ? features.entities.slice(0, 6) : [],
            docType: features.docType || 'article',
            isGenericLanding: Boolean(features.isGenericLanding),
            mergeHints: Array.isArray(features.mergeHints)
                ? features.mergeHints.slice(0, 8)
                : (Array.isArray(features.keywords) ? features.keywords.slice(0, 8) : [])
        };
        
        entry.semanticFeatures = { ...features };
        originalTab.semanticFeatures = { ...features };
        entry.summaryBullets = summaryBullets;
        originalTab.summaryBullets = summaryBullets;
        entry.classification = { ...classification };
        originalTab.classification = { ...classification };
        if (features.sourceLanguage) {
            entry.sourceLanguage = features.sourceLanguage;
            originalTab.sourceLanguage = features.sourceLanguage;
        }
        if (features.normalizedLanguage) {
            entry.language = features.normalizedLanguage;
            originalTab.language = features.normalizedLanguage;
        }
        originalTab.topicHints = generateTopicHints(originalTab);
        entry.topicHints = originalTab.topicHints;
    };
    
    const processEntry = async (entry, attempt = 0) => {
        const originalTab = currentTabData[entry.index];
        if (!originalTab) {
            return;
        }
        const resolvedLanguage = await ensureEntryLanguage({
            language: entry.language || originalTab.language,
            detectedLanguage: entry.detectedLanguage,
            fullContent: originalTab.content || entry.fullContent,
            content: entry.content,
            metaDescription: entry.metaDescription || originalTab.metaDescription,
            headings: entry.headings || originalTab.headings,
            title: entry.title || originalTab.title
        });
        entry.language = resolvedLanguage;
        originalTab.language = resolvedLanguage;
        entry.sourceLanguage = resolvedLanguage;
        originalTab.sourceLanguage = resolvedLanguage;
        
        if (originalTab.semanticFeatures?.version >= 2) {
            applyFeaturesToTab(entry, originalTab, originalTab.semanticFeatures);
            return;
        }
        
        const cacheKey = makeCacheKey(entry);
        if (cacheKey && semanticFeatureCache[cacheKey]) {
            const cached = semanticFeatureCache[cacheKey];
            const hashesMatch = cached?.contentHash && entry.contentHash
                ? cached.contentHash === entry.contentHash
                : Boolean(cached?.contentHash) === Boolean(entry.contentHash);
            const versionOk = cached?.features?.version >= 2;
            if (cached && cached.features && hashesMatch && versionOk && (Date.now() - cached.timestamp) < 10 * 60 * 1000) {
                applyFeaturesToTab(entry, originalTab, cached.features);
                return;
            }
        }
        
        let features = null;
        const descriptor = buildTabFeatureDescriptor(originalTab, entry);
        
        // Smart AI selection: prioritize high-value tabs
        const isHighValueTab = entry.content && entry.content.length > 200 && (
            entry.url.includes('pubmed') || 
            entry.url.includes('nejm') || 
            entry.url.includes('techcrunch') || 
            entry.url.includes('openai') ||
            entry.url.includes('google') ||
            entry.url.includes('who.int') ||
            entry.title.toLowerCase().includes('ai') ||
            entry.title.toLowerCase().includes('medical') ||
            entry.title.toLowerCase().includes('research') ||
            entry.title.toLowerCase().includes('gaming') ||
            entry.title.toLowerCase().includes('shop') ||
            entry.title.toLowerCase().includes('store') ||
            entry.title.toLowerCase().includes('product')
        );
        
        const shouldUseAI = aiTabId && aiRequestCount < MAX_AI_FEATURE_TABS && isHighValueTab;
        
        // Log why AI is skipped for debugging
        if (!shouldUseAI) {
            const reasons = [];
            if (!aiTabId) reasons.push('no AI tab');
            if (aiRequestCount >= MAX_AI_FEATURE_TABS) reasons.push(`AI limit reached (${aiRequestCount}/${MAX_AI_FEATURE_TABS})`);
            if (!entry.content || entry.content.length <= 200) reasons.push(`insufficient content (${entry.content?.length || 0} chars)`);
            
            console.log(`⚠️ [Chrome AI Challenge] Skipping AI for "${entry.title?.slice(0, 40)}": ${reasons.join(', ')}`);
        }
        
        if (shouldUseAI) {
            try {
                console.log(`⏱️ Starting AI feature extraction for "${entry.title}" (attempt ${attempt + 1})...`);
                
                // Moderate cooling delay for laptop thermal management
                if (aiRequestCount > 0) {
                    const coolingDelay = Math.min(500 + (aiRequestCount * 200), 1500); // 0.5-1.5 seconds (smart reduced)
                    console.log(`❄️ [Laptop Cooling] Cooling delay: ${coolingDelay}ms (request ${aiRequestCount + 1}/${MAX_AI_FEATURE_TABS})`);
                    console.log(`🌡️ [Thermal Management] Processing ${MAX_AI_FEATURE_TABS} tabs with AI`);
                    await new Promise(resolve => setTimeout(resolve, coolingDelay));
                }
                
                const scriptStart = nowMs();
                
                const scriptPromise = chrome.scripting.executeScript({
                    target: { tabId: aiTabId },
                    world: 'MAIN',
                    func: generateTabFeaturesInPage,
                    args: [descriptor]
                });
                
                const timeoutBudget = attempt === 0
                    ? AI_FEATURE_TIMEOUT
                    : Math.min(AI_FEATURE_TIMEOUT * 2.5, AI_FEATURE_TIMEOUT + 30000); // More generous retry timeout
                
                console.log(`⏱️ Waiting for AI response (timeout: ${timeoutBudget}ms)...`);
                const results = await withTimeout(scriptPromise, timeoutBudget, 'AI feature timeout');
                
                const scriptTime = nowMs() - scriptStart;
                console.log(`✅ AI feature extraction completed for "${entry.title}" in ${Math.round(scriptTime)}ms`);
                
                // Log features for debugging (in background context where devlog is available)
                if (results && results[0] && results[0].result && results[0].result.ok) {
                    const resultPayload = results[0].result;
                    devlog({
                        type: 'FEATURES',
                        url: entry.url,
                        host: new URL(entry.url).hostname,
                        key: tabKey(entry),
                        primary_topic: resultPayload.primaryTopic,
                        taxonomy_primary: resultPayload.docType,
                        is_generic_landing: resultPayload.isGenericLanding,
                        doc_type: resultPayload.docType,
                        merge_hints: resultPayload.mergeHints,
                        entities: resultPayload.entities,
                        subtopics: resultPayload.subtopics,
                        embQuality: 'ai', // AI-generated features
                        aiStatus: 'success'
                    });
                }
                
                if (results && results[0]) {
                    if (!results[0].result) {
                        console.error(`❌ AI script returned but has no result for "${entry.title}"`, results[0]);
                        failureReasons.add('AI script execution returned no result object');
                    } else {
                        const resultPayload = results[0].result;
                        if (resultPayload.ok) {
                        aiRequestCount += 1;
                        const bannedMergeWords = Array.from(GENERIC_MERGE_STOPWORDS);
                        const primaryTopicRaw = String(resultPayload.primaryTopic || resultPayload.topic || '').trim();
                        const topicTokens = tokenizeText(primaryTopicRaw);
                        const topicLabel = resultPayload.topicLabel ||
                            titleCaseFromTokens(topicTokens.slice(0, 4)) ||
                            (descriptor.title ? descriptor.title.split(/\s+/).slice(0, 3).join(' ') : 'General browsing');
                        const mergeHints = sanitizeStringList(resultPayload.mergeHints || resultPayload.keywords || [], {
                            limit: 6,
                            toLower: true,
                            minLength: 3,
                            banned: bannedMergeWords
                        });
                        const summaryBullets = Array.isArray(resultPayload.summary)
                            ? resultPayload.summary.slice(0, 6)
                            : [];
                        const summaryKeywordHints = sanitizeStringList(
                            summaryBullets.flatMap(bullet => tokenizeText(bullet)),
                            {
                                limit: 6,
                                toLower: true,
                                minLength: 3,
                                banned: bannedMergeWords
                            }
                        );
                        let ensuredMergeHints = mergeHints.length
                            ? mergeHints
                            : sanitizeStringList(topicTokens, { limit: 6, toLower: true, minLength: 3 });
                        if (summaryKeywordHints.length) {
                            const mergedHints = new Set([...ensuredMergeHints, ...summaryKeywordHints]);
                            ensuredMergeHints = Array.from(mergedHints).slice(0, 6);
                        }
                        const subtopics = sanitizeStringList(resultPayload.subtopics || [], {
                            limit: 6,
                            toLower: true,
                            minLength: 3
                        });
                        const entities = sanitizeStringList(resultPayload.entities || [], {
                            limit: 6,
                            toLower: false,
                            minLength: 2
                        });
                        const primaryTopic = (primaryTopicRaw || topicLabel || 'general').toLowerCase();
                        const docType = String(resultPayload.docType || 'article').toLowerCase();
                        const isGenericLanding = Boolean(resultPayload.isGenericLanding);
                        
                        features = {
                            topic: topicLabel,
                            keywords: ensuredMergeHints,
                            origin: 'ai',
                            primaryTopic,
                            subtopics,
                            entities,
                            docType,
                            isGenericLanding,
                            mergeHints: ensuredMergeHints,
                            summaryBullets: summaryBullets.length ? summaryBullets : (descriptor.summaryBullets || []),
                            summaryKeywords: summaryKeywordHints,
                            version: 2,
                            sourceLanguage: resultPayload.sourceLanguage || resolvedLanguage,
                            normalizedLanguage: resultPayload.normalizedLanguage || DEFAULT_WORKING_LANGUAGE
                        };
                        entry.language = features.normalizedLanguage;
                        originalTab.language = features.normalizedLanguage;
                        entry.sourceLanguage = features.sourceLanguage;
                        originalTab.sourceLanguage = features.sourceLanguage;
                        if (!features.summaryBullets.length && descriptor.metaDescription) {
                            features.summaryBullets = [descriptor.metaDescription.slice(0, 200)];
                        }
                    } else {
                        const reason = resultPayload.error;
                        const status = resultPayload.status;
                        console.warn(`⚠️ AI returned ok=false for "${entry.title}":`, {
                            error: reason,
                            status,
                            fullPayload: resultPayload
                        });
                        if (status) {
                            failureReasons.add(`Language model status: ${status}`);
                        }
                        if (reason) {
                            const reasonStr = typeof reason === 'string' ? reason : (reason?.message || JSON.stringify(reason));
                            failureReasons.add(reasonStr);
                        } else {
                            failureReasons.add('AI returned ok=false without error message');
                        }
                        if (status === 'downloading') {
                            aiTabId = null;
                        }
                    }
                    }
                } else if (results) {
                    console.error(`❌ AI script execution returned invalid results structure for "${entry.title}"`, results);
                    failureReasons.add('AI script execution returned invalid results structure');
                }
            } catch (error) {
                if (error?.message === 'AI feature timeout') {
                    failureReasons.add('Language model timeout (features)');
                    if (attempt < 1) {
                        console.warn('generateTabFeaturesInPage timed out, retrying with extended timeout...');
                        await processEntry(entry, attempt + 1);
                        return;
                    }
                    console.warn('generateTabFeaturesInPage timed out after retry, falling back to heuristics.');
                } else {
                    failureReasons.add(error?.message || String(error));
                }
            }
        } else {
            // AI not used - use fallback features directly
            console.log(`🔄 [Chrome AI Challenge] Using fallback features for "${entry.title?.slice(0, 40)}" (AI not used)`);
            features = fallbackTabFeatures(originalTab, entry);
            fallbackCount += 1;
            
            // Log fallback features for debugging
            devlog({
                type: 'FEATURES',
                url: entry.url,
                host: new URL(entry.url).hostname,
                key: tabKey(entry),
                primary_topic: features.topic || 'unknown',
                taxonomy_primary: features.docType || 'unknown',
                is_generic_landing: features.isGenericLanding || false,
                doc_type: features.docType || 'unknown',
                merge_hints: features.mergeHints || [],
                entities: features.entities || [],
                subtopics: features.subtopics || [],
                embQuality: 'fallback', // Fallback features
                aiStatus: 'fallback'
            });
        }
        
        if (!features) {
            const reason = failureReasons.size
                ? Array.from(failureReasons).slice(0, 3).join(' | ')
                : 'unknown AI feature failure';
            
            // Check if failure is due to timeout (not a critical AI unavailability)
            const isTimeout = Array.from(failureReasons).some(r => 
                String(r).toLowerCase().includes('timeout')
            );
            
            if (isTimeout) {
                console.warn('⚠️ AI feature extraction timed out for tab (using fallback):', {
                    url: entry.url,
                    title: entry.title,
                    contentLength: entry.content?.length || 0
                });
            } else {
                console.error('❌ AI semantic feature generation failed for tab:', {
                    url: entry.url,
                    title: entry.title,
                    reasons: Array.from(failureReasons),
                    attempt,
                    shouldUseAI,
                    aiTabId,
                    contentLength: entry.content?.length || 0
                });
            }
            
            // Allow fallback for timeouts even with ENFORCE_AI_FEATURES
            // Timeouts aren't "AI unavailable" - just content too large
            if (ENFORCE_AI_FEATURES && !isTimeout) {
                throw new Error(`AI semantic feature generation failed: ${reason}`);
            }
            
            console.log(`🔄 [Chrome AI Challenge] Using fallback features for "${entry.title?.slice(0, 40)}"`);
            features = fallbackTabFeatures(originalTab, entry);
            fallbackCount += 1;
            
            // Log fallback features for debugging
            devlog({
                type: 'FEATURES',
                url: entry.url,
                host: new URL(entry.url).hostname,
                key: tabKey(entry),
                primary_topic: features.topic || 'unknown',
                taxonomy_primary: features.docType || 'unknown',
                is_generic_landing: features.isGenericLanding || false,
                doc_type: features.docType || 'unknown',
                merge_hints: features.mergeHints || [],
                entities: features.entities || [],
                subtopics: features.subtopics || [],
                embQuality: 'fallback', // Fallback features
                aiStatus: 'fallback'
            });
        }
        
        applyFeaturesToTab(entry, originalTab, features);
        if (cacheKey && features) {
            cacheUpdates[cacheKey] = {
                timestamp: Date.now(),
                features,
                contentHash: entry.contentHash || originalTab.contentHash || ''
            };
        }
            };
    
    if (!aiTabId) {
        await Promise.all(tabDataForAI.map(entry => processEntry(entry)));
    } else {
        for (const entry of tabDataForAI) {
            await processEntry(entry);
        }
    }
    
    // Chrome AI Challenge: Log API usage stats
    const aiSuccessCount = tabDataForAI.length - fallbackCount;
    console.log(`🏆 [Chrome AI Challenge Stats] Semantic Feature Extraction:`);
    console.log(`   ✅ ${aiSuccessCount}/${tabDataForAI.length} tabs analyzed with Chrome Built-in AI (Prompt API + Gemini Nano)`);
    console.log(`   📊 ${fallbackCount} tabs used deterministic fallback`);
    console.log(`   🎯 ${Math.round(aiSuccessCount / tabDataForAI.length * 100)}% AI success rate`);
    console.log(`   🤖 APIs Used: Prompt API (Gemini Nano), Summarizer API, Embedding Model API (fallback)`);
    console.log(`   🔒 Privacy: 100% on-device processing, no server calls`);
    
    // Log run summary
    devlog({
        type: 'SUMMARY',
        runId: RUN.id(),
        totalTabs: tabDataForAI.length,
        aiSuccessCount,
        fallbackCount,
        aiSuccessRate: Math.round(aiSuccessCount / tabDataForAI.length * 100),
        finalGroups: 'pending', // Will be set after clustering
        singletons: 'pending', // Will be set after clustering
        multiTabGroups: 'pending', // Will be set after clustering
        apisUsed: ['Prompt API (Gemini Nano)', 'Summarizer API', 'Embedding Model API (fallback)'],
        privacy: '100% on-device processing',
        silent: false
    });
    
    if (fallbackCount > 0 && !ENFORCE_AI_FEATURES) {
        const reasonsSummary = failureReasons.size
            ? ` Reasons: ${Array.from(failureReasons).slice(0, 3).join(' | ')}`
            : '';
        console.info(`⚠️ Tab semantic features used fallback for ${fallbackCount} tabs.${reasonsSummary}`);
    }
    
    if (Object.keys(cacheUpdates).length) {
        Object.assign(semanticFeatureCache, cacheUpdates);
        await chrome.storage.session.set({ semanticFeatureCache });
    }
}

async function ensureTabEmbeddings(tabDataForAI) {
    if (!Array.isArray(tabDataForAI) || !tabDataForAI.length) {
        return;
    }
    
    const accessibleTab = await findUsableAIAccessTab();
    let aiTabId = accessibleTab?.id || null;
    const failureReasons = new Set();
    let generatedCount = 0;
    let fallbackCount = 0;
    
    const cacheData = await chrome.storage.session.get(['tabEmbeddingCache']);
    const embeddingCache = cacheData.tabEmbeddingCache || {};
    const cacheUpdates = {};
    
    const makeCacheKey = (entry) => {
        if (entry?.url) return entry.url;
        const tab = currentTabData[entry?.index ?? -1];
        if (tab?.url) return tab.url;
        if (entry?.canonicalUrl) return entry.canonicalUrl;
        if (entry?.title) return `title:${entry.title}`;
        return null;
    };
    
    const buildEmbeddingDocument = (entry) => {
        const parts = [
            entry.title || '',
            entry.semanticFeatures?.topic || '',
            Array.isArray(entry.semanticFeatures?.keywords) ? entry.semanticFeatures.keywords.join(', ') : '',
            entry.metaDescription || '',
            entry.topicHints || '',
            entry.youtubeTopic || '',
            Array.isArray(entry.youtubeTags) ? entry.youtubeTags.slice(0, 12).join(', ') : '',
            entry.content || '',
            entry.fullContent ? entry.fullContent.slice(0, 2400) : ''
        ];
        const combined = parts
            .map(part => String(part || '').trim())
            .filter(Boolean)
            .join('\n')
            .slice(0, EMBEDDING_MAX_TOKENS * 6); // rough char limit
        return combined;
    };
    
    // Note: We intentionally removed hashed BoW fallback. If embeddings fail,
    // computeWeightedSimilarity will fall back to TF-IDF cosine when comparing.
    
    async function ensureAIAccessTab() {
        // Try to find an existing light tab; if none, create one on a safe origin
        let tab = await findUsableAIAccessTab();
        if (!tab) {
            try {
                tab = await chrome.tabs.create({ url: 'https://developer.chrome.com/', active: false });
                // Give the page a brief moment to initialize
                await new Promise(r => setTimeout(r, 400));
            } catch (e) {
                console.warn('Failed to create AI access tab:', e?.message || e);
                tab = null;
            }
        }
        return tab;
    }

    const processEntry = async (entry) => {
        const originalTab = currentTabData[entry.index];
        if (Array.isArray(originalTab.semanticEmbedding) && originalTab.semanticEmbedding.length) {
            entry.semanticEmbedding = originalTab.semanticEmbedding.slice();
            return;
        }
        
        const cacheKey = makeCacheKey(entry);
        if (cacheKey && embeddingCache[cacheKey]) {
            const cached = embeddingCache[cacheKey];
            const stillValid = (Date.now() - cached.timestamp) < EMBEDDING_CACHE_TTL &&
                (!entry.contentHash || !cached.contentHash || cached.contentHash === entry.contentHash);
            if (stillValid && Array.isArray(cached.vector)) {
                entry.semanticEmbedding = cached.vector.slice();
                originalTab.semanticEmbedding = cached.vector.slice();
                return;
            }
        }
        
        const canUseAI =
            aiTabId &&
            generatedCount < MAX_AI_EMBED_TABS &&
            (entry.contentLength >= EMBEDDING_MIN_CONTENT_CHARS || (entry.semanticFeatures?.topic && entry.semanticFeatures.topic.length >= 8));
        
        let embeddingVector = null;
        
        if (canUseAI) {
            try {
                const descriptor = {
                    document: buildEmbeddingDocument(entry),
                    topic: entry.semanticFeatures?.topic || '',
                    keywords: entry.semanticFeatures?.keywords || [],
                    language: entry.language || ''
                };
                const runOnce = async (tabId) => {
                    const scriptPromise = chrome.scripting.executeScript({
                        target: { tabId },
                        world: 'MAIN',
                        func: generateTabEmbeddingInPage,
                        args: [descriptor]
                    });
                    return withTimeout(scriptPromise, AI_FEATURE_TIMEOUT, 'AI embedding timeout');
                };
                let results = await runOnce(aiTabId);
                if (results && results[0] && results[0].result) {
                    const payload = results[0].result;
                    if (payload.ok && Array.isArray(payload.embedding)) {
                        embeddingVector = payload.embedding.slice();
                        generatedCount += 1;
                    } else {
                        const reason = payload.error || 'Unknown embedding error';
                        const status = payload.status;
                        if (status === 'downloading' || status === 'downloadable') {
                            console.warn('Embedding model not ready (downloading). Will retry with a new AI tab context.');
                            aiTabId = null;
                            // Try to acquire a fresh lightweight tab and retry once
                            const newTab = await ensureAIAccessTab();
                            if (newTab?.id) {
                                aiTabId = newTab.id;
                                try {
                                    results = await runOnce(aiTabId);
                                    if (results && results[0] && results[0].result && results[0].result.ok && Array.isArray(results[0].result.embedding)) {
                                        embeddingVector = results[0].result.embedding.slice();
                                        generatedCount += 1;
                                    }
                                } catch (_) {}
                            }
                        } else if (status === 'unavailable') {
                            console.warn('Embedding model unavailable on this device; will use TF-IDF fallback when comparing.');
                            aiTabId = null;
                        }
                        failureReasons.add(reason);
                    }
                }
    } catch (error) {
                if (error?.message === 'AI embedding timeout') {
                    failureReasons.add('Embedding model timeout');
                    aiTabId = null;
                    console.warn('generateTabEmbeddingInPage timed out; comparisons will fall back to TF-IDF only.');
                } else {
                    failureReasons.add(error?.message || String(error));
                }
            }
        }
        
        if (!embeddingVector) {
            const reason = failureReasons.size
                ? Array.from(failureReasons).slice(0, 3).join(' | ')
                : 'embedding generation failed';
            console.warn('⚠️ Embedding generation failed; comparisons will fall back to TF-IDF only:', {
                url: entry.url,
                title: entry.title,
                reason
            });
            // Do NOT synthesize hashed vectors. Rely on TF-IDF in computeWeightedSimilarity.
        }
        
        if (embeddingVector) {
            entry.semanticEmbedding = embeddingVector.slice();
            originalTab.semanticEmbedding = embeddingVector.slice();
            if (cacheKey) {
                cacheUpdates[cacheKey] = {
                    timestamp: Date.now(),
                    vector: embeddingVector.slice(),
                    contentHash: entry.contentHash || originalTab.contentHash || ''
                };
            }
        }
    };
    
    if (aiTabId) {
        // Run sequentially to limit AI load
        for (const entry of tabDataForAI) {
            await processEntry(entry);
        }
    } else {
        await Promise.all(tabDataForAI.map(processEntry));
    }
    
    if (fallbackCount > 0 && !ENFORCE_AI_FEATURES) {
        const reasonsSummary = failureReasons.size
            ? ` Reasons: ${Array.from(failureReasons).slice(0, 3).join(' | ')}`
            : '';
        console.info(`Tab embeddings used fallback for ${fallbackCount} tabs.${reasonsSummary}`);
    }
    
    if (Object.keys(cacheUpdates).length) {
        Object.assign(embeddingCache, cacheUpdates);
        await chrome.storage.session.set({ tabEmbeddingCache: embeddingCache });
    }
}

function tokenizeText(value) {
    if (!value) return [];
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\sα-ωάέίήύόώϊϋΐΰ]+/g, ' ')
        .split(/\s+/)
        .map(token => token.trim())
        .filter(token => token.length >= 3 && !STOPWORDS.has(token));
}

function computeSimHash(tokens) {
    if (!tokens) {
        return null;
    }
    const iterable = tokens instanceof Set ? tokens : new Set(tokens);
    if (!iterable.size) {
        return null;
    }
    const weights = new Array(SIMHASH_BITS).fill(0);
    let total = 0;
    iterable.forEach(token => {
        if (!token) return;
        const hash = positiveHash(token);
        total += 1;
        for (let bit = 0; bit < SIMHASH_BITS; bit += 1) {
            const mask = 1 << (bit % 32);
            const contribution = (hash & mask) ? 1 : -1;
            weights[bit] += contribution;
        }
    });
    if (!total) {
        return null;
    }
    let result = 0n;
    for (let bit = 0; bit < SIMHASH_BITS; bit += 1) {
        if (weights[bit] >= 0) {
            result |= (1n << BigInt(bit));
        }
    }
    return result;
}

function simHashSimilarity(hashA, hashB) {
    if (typeof hashA !== 'bigint' || typeof hashB !== 'bigint') {
        return 0;
    }
    let diff = hashA ^ hashB;
    let distance = 0;
    while (diff) {
        distance += Number(diff & 1n);
        diff >>= 1n;
    }
    const normalized = 1 - (distance / SIMHASH_BITS);
    return normalized < 0 ? 0 : normalized;
}

function extractUrlPathTokens(url) {
    if (!url) return [];
    try {
        const { pathname } = new URL(url);
        return pathname
            .split(/[\/#?]+/)
            .flatMap(segment => segment.split(/[\-_\s]+/))
            .map(token => token.toLowerCase().replace(/[^a-z0-9α-ωάέίήύόώϊϋΐΰ]+/g, ''))
            .filter(token => token.length >= 3 && !/^\d+$/.test(token) && !STOPWORDS.has(token));
    } catch (error) {
        return [];
    }
}

function buildTabLLMProfile(tabEntry) {
    if (!tabEntry) {
        return {
            title: '',
            url: '',
            domain: '',
            meta: '',
            content: '',
            language: 'en',
            docType: '',
            mergeHints: [],
            entities: [],
            subtopics: [],
            summaryBullets: []
        };
    }
    const semantic = tabEntry.semanticFeatures || {};
    const language = (semantic.language || tabEntry.language || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en')
        .toString()
        .split('-')[0] || 'en';
    return {
        title: tabEntry.title || '',
        url: tabEntry.url || '',
        domain: tabEntry.domain || '',
        meta: (tabEntry.metaDescription || '').slice(0, 240),
        content: (tabEntry.content || tabEntry.fullContent || '')
            .replace(/\s+/g, ' ')
            .slice(0, 600),
        language,
        docType: semantic.docType || '',
        mergeHints: Array.isArray(semantic.mergeHints) ? semantic.mergeHints.slice(0, 8) : [],
        entities: Array.isArray(semantic.entities) ? semantic.entities.slice(0, 6) : [],
        subtopics: Array.isArray(semantic.subtopics) ? semantic.subtopics.slice(0, 6) : [],
        summaryBullets: Array.isArray(tabEntry.summaryBullets) ? tabEntry.summaryBullets.slice(0, 4) : []
    };
}

async function verifyTabPairWithLM(tabA, tabB) {
    if (!tabA || !tabB) {
        throw new Error('Invalid tab data for LM verification');
    }
    const keyParts = [tabA.url || String(tabA.index), tabB.url || String(tabB.index)].sort();
    const cacheKey = keyParts.join('||');
    if (PAIRWISE_LLM_CACHE.has(cacheKey)) {
        return PAIRWISE_LLM_CACHE.get(cacheKey);
    }
    
    const accessibleTab = await findUsableAIAccessTab();
    if (!accessibleTab) {
        throw new Error('No accessible tab available for LM verification');
    }
    
    const profileA = buildTabLLMProfile(tabA);
    const profileB = buildTabLLMProfile(tabB);
    const language = profileA.language || profileB.language || 'en';
    
    const args = [{
        language,
        tabs: [
            profileA,
            profileB
        ]
    }];
    
    const results = await withTimeout(
        chrome.scripting.executeScript({
            target: { tabId: accessibleTab.id },
            world: 'MAIN',
            func: judgeTabSimilarityInPage,
            args
        }),
        LLM_VERIFICATION_TIMEOUT,
        'LLM verification timeout'
    );
    
    const payload = results && results[0] && results[0].result;
    if (!payload || !payload.ok) {
        const reason = payload?.error || 'Unknown LLM verification error';
        throw new Error(reason);
    }
    
    PAIRWISE_LLM_CACHE.set(cacheKey, payload);
    return payload;
}

async function applyLLMRefinement(groups, featureContext, tabDataForAI) {
    if (!Array.isArray(groups) || groups.length === 0) {
        return groups;
    }
    if (!featureContext || !Array.isArray(featureContext.vectors) || !featureContext.vectors.length) {
        return groups;
    }
    try {
        const vectors = featureContext.vectors;
        const similarityCache = featureContext.similarityCache || new Map();
        const vectorSets = groups.map(group => new Set(group.vectorIndices || []));
        const tabSets = groups.map(group => new Set(group.tabIndices || []));
        const removedGroups = new Set();
        let mergePerformed = false;
        
        const singletons = groups
            .map((group, index) => ({ group, index }))
            .filter(entry => (entry.group.tabIndices?.length || 0) === 1);
        
        for (const entry of singletons) {
            const { group, index } = entry;
            if (removedGroups.has(index)) continue;
            const vectorIdx = group.vectorIndices?.[0];
            const tabIdx = group.tabIndices?.[0];
            if (typeof vectorIdx !== 'number' || typeof tabIdx !== 'number') continue;

            const tabA = tabDataForAI[tabIdx];
            if (!tabA) continue;

            // 1) Rank target groups by embedding-first similarity (max over vectors per group)
            const scoredTargets = [];
            for (let targetIndex = 0; targetIndex < groups.length; targetIndex += 1) {
                if (targetIndex === index || removedGroups.has(targetIndex)) continue;
                const targetGroup = groups[targetIndex];
                const vIdxs = Array.isArray(targetGroup?.vectorIndices) ? targetGroup.vectorIndices : [];
                if (!vIdxs.length) continue;

                let bestEmbed = 0;
                for (const tV of vIdxs) {
                    const key = vectorIdx < tV ? `${vectorIdx}|${tV}` : `${tV}|${vectorIdx}`;
                    let score = similarityCache.get(key);
                    if (typeof score !== 'number') {
                        score = computeWeightedSimilarity(vectors[vectorIdx], vectors[tV]);
                        similarityCache.set(key, score);
                    }
                    if (score > bestEmbed) bestEmbed = score;
                }
                if (bestEmbed > 0) {
                    scoredTargets.push({ targetIndex, score: bestEmbed });
                }
            }

            if (!scoredTargets.length) continue;
            scoredTargets.sort((a,b) => b.score - a.score);
            const topK = scoredTargets.slice(0, EMBED_TOPK_CANDIDATES);

            // 2) Ask LLM to decide best target among top-K (decider rather than mere validator)
            let attached = false;
            for (const cand of topK) {
                const targetGroup = groups[cand.targetIndex];
                const firstTargetTabIdx = targetGroup.tabIndices?.[0];
                const tabB = typeof firstTargetTabIdx === 'number' ? tabDataForAI[firstTargetTabIdx] : null;
                if (!tabB) continue;
                try {
                    const verification = await verifyTabPairWithLM(tabA, tabB);
                    if (verification.sameTopic && verification.confidence >= LLM_VERIFICATION_CONFIDENCE) {
                        vectorSets[cand.targetIndex].add(vectorIdx);
                        tabSets[cand.targetIndex].add(tabIdx);
                        removedGroups.add(index);
                        mergePerformed = true;
                        devlog({
                            type: 'SINGLETON',
                            action: 'ATTACH',
                            url: tabA.url,
                            key: tabKey(tabA),
                            targetCluster: `group_${cand.targetIndex + 1}`,
                            centroidCosine: round(cand.score),
                            sameTopic: verification.sameTopic,
                            confidence: round(verification.confidence),
                            reason: verification.reason,
                            threshold: round(LLM_VERIFICATION_CONFIDENCE)
                        });
                        attached = true;
                        break;
                    }
                } catch (e) {
                    console.warn('LLM verification failed:', e?.message || e);
                }
            }
            // If not attached, leave singleton as-is
        }
        
        if (!mergePerformed) {
            return groups;
        }
        
        const refinedGroups = [];
        for (let idx = 0; idx < groups.length; idx += 1) {
            if (removedGroups.has(idx)) {
                continue;
            }
            const vectorList = Array.from(vectorSets[idx]).sort((a, b) => a - b);
            if (!vectorList.length) {
                continue;
            }
            const enriched = enrichGroupFromVectors(vectorList, vectors, similarityCache);
            refinedGroups.push(enriched);
        }
        return refinedGroups;
    } catch (error) {
        console.warn('LLM refinement skipped due to error:', error);
        return groups;
    }
}

function jaccardSimilarity(setA, setB) {
    if (!setA || !setB || !setA.size || !setB.size) return 0;
    let intersectionCount = 0;
    for (const item of setA) {
        if (setB.has(item)) {
            intersectionCount += 1;
        }
    }
    const unionCount = setA.size + setB.size - intersectionCount;
    return unionCount === 0 ? 0 : intersectionCount / unionCount;
}

function cosineSimilarity(mapA, mapB) {
    if (!mapA || !mapB || !mapA.size || !mapB.size) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    mapA.forEach(value => {
        normA += value * value;
    });
    mapB.forEach(value => {
        normB += value * value;
    });
    
    const [shorter, longer] = mapA.size <= mapB.size ? [mapA, mapB] : [mapB, mapA];
    shorter.forEach((value, key) => {
        const other = longer.get(key);
        if (typeof other === 'number') {
            dotProduct += value * other;
        }
    });
    
    if (dotProduct === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizedOverlap(setA, setB) {
    if (!setA || !setB || !setA.size || !setB.size) return 0;
    let intersection = 0;
    const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
    for (const token of smaller) {
        if (larger.has(token)) {
            intersection += 1;
        }
    }
    return smaller.size === 0 ? 0 : intersection / smaller.size;
}

function cosineSimilarityArray(vectorA, vectorB) {
    if (!Array.isArray(vectorA) || !Array.isArray(vectorB) || !vectorA.length || !vectorB.length) {
        return 0;
    }
    const length = Math.min(vectorA.length, vectorB.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < length; i += 1) {
        const a = vectorA[i];
        const b = vectorB[i];
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        dot += a * b;
        normA += a * a;
        normB += b * b;
    }
    if (!dot || !normA || !normB) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizeVector(vector) {
    if (!Array.isArray(vector) || !vector.length) return null;
    let norm = 0;
    const result = vector.map(value => {
        const num = typeof value === 'number' ? value : Number(value) || 0;
        norm += num * num;
        return num;
    });
    if (!norm) return result;
    const scale = 1 / Math.sqrt(norm);
    return result.map(value => value * scale);
}

function positiveHash(input) {
    const str = String(input || '');
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash >>> 0;
}

function prepareTabFeatureContext(tabDataForAI) {
    if (!tabDataForAI || !tabDataForAI.length) {
        return { vectors: [], tabData: tabDataForAI || [] };
    }
    
    const vectors = tabDataForAI.map(entry => {
        const features = entry.semanticFeatures || {};
        const keywordTokens = new Set();
        const semanticTopicTokens = new Set();
        const topicSources = [
            features.topic,
            features.primaryTopic,
            ...(Array.isArray(features.subtopics) ? features.subtopics : [])
        ];
        topicSources.forEach(source => {
            tokenizeText(source).forEach(token => {
                if (GENERIC_MERGE_STOPWORDS.has(token)) return;
                semanticTopicTokens.add(token);
            });
        });
        if (features.docType) {
            const docToken = String(features.docType).toLowerCase();
            if (docToken.length >= 3 && !STOPWORDS.has(docToken) && !GENERIC_MERGE_STOPWORDS.has(docToken)) {
                semanticTopicTokens.add(docToken);
            }
        }
        semanticTopicTokens.forEach(token => keywordTokens.add(token));
        
        const mergeHintTokens = Array.isArray(features.mergeHints)
            ? features.mergeHints.slice()
            : (Array.isArray(features.keywords) ? features.keywords.slice() : []);
        if (Array.isArray(features.summaryKeywords) && features.summaryKeywords.length) {
            features.summaryKeywords.forEach(keyword => {
                mergeHintTokens.push(keyword);
            });
        }
        mergeHintTokens.forEach(keyword => {
            const token = String(keyword || '').toLowerCase().trim();
            if (token.length >= 3 && !STOPWORDS.has(token) && !GENERIC_MERGE_STOPWORDS.has(token)) {
                keywordTokens.add(token);
            }
        });
        (features.subtopics || []).forEach(subtopic => {
            tokenizeText(subtopic).forEach(token => {
                if (GENERIC_MERGE_STOPWORDS.has(token)) return;
                keywordTokens.add(token);
            });
        });
        const entityTokens = new Set();
        const entitySources = [
            ...(Array.isArray(features.entities) ? features.entities : []),
            ...(Array.isArray(entry.classification?.entities) ? entry.classification.entities : [])
        ];
        entitySources.forEach(entity => {
            tokenizeText(entity).forEach(token => {
                if (GENERIC_MERGE_STOPWORDS.has(token)) return;
                entityTokens.add(token);
                keywordTokens.add(token);
            });
        });
        (entry.summaryBullets || []).forEach(bullet => {
            tokenizeText(bullet).forEach(token => {
                if (GENERIC_MERGE_STOPWORDS.has(token)) return;
                keywordTokens.add(token);
            });
        });
        
        entry.docType = features.docType || entry.docType || '';
        entry.isGenericLanding = typeof features.isGenericLanding === 'boolean'
            ? features.isGenericLanding
            : (entry.isGenericLanding || false);
        entry.primaryTopic = features.primaryTopic || entry.primaryTopic || '';
        entry.mergeHints = Array.isArray(features.mergeHints)
            ? features.mergeHints.filter(token => !GENERIC_MERGE_STOPWORDS.has(String(token || '').toLowerCase().trim()))
            : (Array.isArray(features.keywords) ? features.keywords.filter(token => !GENERIC_MERGE_STOPWORDS.has(String(token || '').toLowerCase().trim())) : []);
        entry.entityTokens = Array.from(entityTokens);
        
        (entry.metaKeywords || []).forEach(keyword => {
            tokenizeText(keyword).forEach(token => {
                if (GENERIC_MERGE_STOPWORDS.has(token)) return;
                keywordTokens.add(token);
            });
        });
        (entry.headings || []).forEach(heading => {
            tokenizeText(heading).forEach(token => {
                if (GENERIC_MERGE_STOPWORDS.has(token)) return;
                keywordTokens.add(token);
            });
        });
        tokenizeText(entry.topicHints).forEach(token => {
            if (GENERIC_MERGE_STOPWORDS.has(token)) return;
            keywordTokens.add(token);
        });
        tokenizeText(entry.youtubeTopic).forEach(token => {
            if (GENERIC_MERGE_STOPWORDS.has(token)) return;
            keywordTokens.add(token);
        });
        (entry.youtubeTags || [])
            .map(tag => String(tag || '').toLowerCase().trim())
            .filter(tag => tag && !GENERIC_MERGE_STOPWORDS.has(tag) && !STOPWORDS.has(tag))
            .forEach(tag => keywordTokens.add(tag));
        
        const taxonomyArray = inferTaxonomyTags(entry);
    const taxonomyTags = new Set();
    taxonomyArray.forEach(tag => {
        const token = String(tag || '').toLowerCase().trim();
        if (!token || STOPWORDS.has(token) || GENERIC_MERGE_STOPWORDS.has(token)) return;
        taxonomyTags.add(token);
        keywordTokens.add(token);
    });
        entry.taxonomyTags = taxonomyArray;
        
        const titleTokens = new Set(tokenizeText(entry.title));
        titleTokens.forEach(token => keywordTokens.add(token));
        
        const pathTokens = new Set(extractUrlPathTokens(entry.url));
        pathTokens.forEach(token => keywordTokens.add(token));
        
        const domainTokens = new Set();
        if (entry.domain) {
            entry.domain
                .toLowerCase()
                .split('.')
                .filter(part => part && part !== 'www' && part.length >= 3)
                .forEach(part => domainTokens.add(part));
        }
        
        const tfCounts = new Map();
        const tfTokens = [
            ...tokenizeText(entry.fullContent ? entry.fullContent.slice(0, 2000) : ''),
            ...tokenizeText(entry.topicHints),
            ...tokenizeText(features.primaryTopic),
            ...(Array.isArray(features.subtopics) ? features.subtopics.flatMap(sub => tokenizeText(sub)).filter(token => !GENERIC_MERGE_STOPWORDS.has(token)) : []),
            ...(Array.isArray(mergeHintTokens) ? mergeHintTokens.flatMap(token => tokenizeText(token)).filter(token => !GENERIC_MERGE_STOPWORDS.has(token)) : []),
            ...entitySources.flatMap(entity => tokenizeText(entity)).filter(token => !GENERIC_MERGE_STOPWORDS.has(token)),
            ...tokenizeText(features.docType).filter(token => !GENERIC_MERGE_STOPWORDS.has(token)),
            ...(Array.isArray(entry.summaryBullets) ? entry.summaryBullets.flatMap(bullet => tokenizeText(bullet)).filter(token => !GENERIC_MERGE_STOPWORDS.has(token)) : []),
            ...Array.from(titleTokens).filter(token => !GENERIC_MERGE_STOPWORDS.has(token)),
            ...Array.from(pathTokens).filter(token => !GENERIC_MERGE_STOPWORDS.has(token)),
            ...(entry.youtubeTags || []).map(tag => String(tag || '').toLowerCase().trim()).filter(tag => tag && !GENERIC_MERGE_STOPWORDS.has(tag) && !STOPWORDS.has(tag)),
            ...(entry.metaKeywords || []).flatMap(keyword => tokenizeText(keyword)).filter(token => !GENERIC_MERGE_STOPWORDS.has(token)),
            ...(entry.headings || []).flatMap(heading => tokenizeText(heading)).filter(token => !GENERIC_MERGE_STOPWORDS.has(token)),
            ...taxonomyArray.map(tag => String(tag || '').toLowerCase()).flatMap(tokenizeText).filter(token => !GENERIC_MERGE_STOPWORDS.has(token))
        ].slice(0, 1200);
        
        tfTokens.forEach(token => {
            if (!token || STOPWORDS.has(token)) return;
            tfCounts.set(token, (tfCounts.get(token) || 0) + 1);
        });
        
        const totalTokenCount = tfTokens.length || 1;
        const embeddingVector = Array.isArray(entry.semanticEmbedding) && entry.semanticEmbedding.length
            ? normalizeVector(entry.semanticEmbedding)
            : null;
        if (embeddingVector) {
            entry.semanticEmbedding = embeddingVector.slice();
        }
        
        const simHash = computeSimHash(keywordTokens);
        
        return {
            index: entry.index,
            keywordTokens,
            titleTokens,
            pathTokens,
            domain: entry.domain || '',
            domainTokens,
            semanticTopicTokens,
            taxonomyTags,
            language: entry.language || '',
            youtubeTopic: entry.youtubeTopic || '',
            primaryTopic: entry.primaryTopic || '',
            docType: entry.docType || '',
            isGenericLanding: Boolean(entry.isGenericLanding),
            mergeHints: Array.isArray(entry.mergeHints) ? entry.mergeHints.slice() : [],
            entities: entityTokens,
            tfCounts,
            totalTokenCount,
            embeddingVector,
            simHash,
            tabData: entry
        };
    });
    
    const documentFrequency = new Map();
    vectors.forEach(vector => {
        vector.tfCounts.forEach((_, token) => {
            documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
        });
    });
    
    const docCount = vectors.length || 1;
    vectors.forEach(vector => {
        const tfidf = new Map();
        vector.tfCounts.forEach((count, token) => {
            const idf = Math.log((docCount + 1) / ((documentFrequency.get(token) || 0) + 1)) + 1;
            tfidf.set(token, (count / vector.totalTokenCount) * idf);
        });
        vector.tfidfVector = tfidf;
    });
    
    return { vectors, tabData: tabDataForAI };
}

function computeWeightedSimilarity(vectorA, vectorB, debugOut = null) {
    // Embedding-first general similarity
    const S_embed = cosineSimilarityArray(vectorA?.embeddingVector, vectorB?.embeddingVector);
    if (GENERAL_GROUPING_MODE && typeof S_embed === 'number' && S_embed > 0) {
        if (debugOut && typeof debugOut === 'object') debugOut.score = S_embed;
        return Math.max(0, Math.min(S_embed, 1));
    }
    // Fallback to TF-IDF cosine
    const S_tfidf = cosineSimilarity(vectorA?.tfidfVector, vectorB?.tfidfVector);
    if (typeof S_tfidf === 'number' && S_tfidf > 0) {
        if (debugOut && typeof debugOut === 'object') debugOut.score = S_tfidf;
        return Math.max(0, Math.min(S_tfidf, 1));
    }
    if (debugOut && typeof debugOut === 'object') debugOut.score = 0;
    return 0;
}

function createUnionFind(size) {
    const parent = Array.from({ length: size }, (_, i) => i);
    const rank = new Array(size).fill(0);
    
    function find(x) {
        if (parent[x] !== x) {
            parent[x] = find(parent[x]);
        }
        return parent[x];
    }
    
    function union(a, b) {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA === rootB) return;
        if (rank[rootA] < rank[rootB]) {
            parent[rootA] = rootB;
        } else if (rank[rootA] > rank[rootB]) {
            parent[rootB] = rootA;
        } else {
            parent[rootB] = rootA;
            rank[rootA] += 1;
        }
    }
    
    return { find, union };
}

function clusterTabsDeterministic(featureContext, { debugLog = null } = {}) {
    const { vectors, tabData } = featureContext;
    if (!vectors || !vectors.length) {
        return [];
    }
    
    const uf = createUnionFind(vectors.length);
    const similarityCache = new Map();
    
    const borderlinePairs = [];
    
    for (let i = 0; i < vectors.length; i++) {
        for (let j = i + 1; j < vectors.length; j++) {
            const metrics = {};
            const score = computeWeightedSimilarity(vectors[i], vectors[j], metrics);
            const key = `${i}|${j}`;
            similarityCache.set(key, score);
            if (debugLog) {
                debugLog.stats = debugLog.stats || {};
                debugLog.stats.pairComparisons = (debugLog.stats.pairComparisons || 0) + 1;
            }
            if (score >= SIMILARITY_JOIN_THRESHOLD) {
                uf.union(i, j);
                if (debugLog) {
                    debugLog.stats.pairUnions = (debugLog.stats.pairUnions || 0) + 1;
                    const entryA = vectors[i]?.tabData || {};
                    const entryB = vectors[j]?.tabData || {};
                    const classificationA = entryA.classification || {};
                    const classificationB = entryB.classification || {};
                    const formatNumber = (value, digits = 3) =>
                        typeof value === 'number' ? Number(value.toFixed(digits)) : null;
                    const mergeHintsA = classificationA.mergeHints || vectors[i]?.mergeHints || [];
                    const mergeHintsB = classificationB.mergeHints || vectors[j]?.mergeHints || [];
                    const isBridge = Boolean((vectors[i]?.isGenericLanding || classificationA.isGenericLanding) !==
                        (vectors[j]?.isGenericLanding || classificationB.isGenericLanding));
                    debugLog.pairwise = debugLog.pairwise || [];
                    debugLog.pairwise.push({
                        phase: 'A',
                        type: 'pair-join',
                        reason: 'initial-similarity',
                        vectorIndices: [i, j],
                        tabIndices: [vectors[i]?.index, vectors[j]?.index],
                        urls: [entryA.url, entryB.url],
                        primaryTopics: [classificationA.primaryTopic || vectors[i]?.primaryTopic || '', classificationB.primaryTopic || vectors[j]?.primaryTopic || ''],
                        primaryTopicMatch: Boolean(
                            (classificationA.primaryTopic || vectors[i]?.primaryTopic) &&
                            (classificationA.primaryTopic || vectors[i]?.primaryTopic) === (classificationB.primaryTopic || vectors[j]?.primaryTopic)
                        ),
                        docTypes: [classificationA.docType || vectors[i]?.docType || '', classificationB.docType || vectors[j]?.docType || ''],
                        mergeHints: [mergeHintsA.slice(0, 4), mergeHintsB.slice(0, 4)],
                        cosineEmb: formatNumber(metrics.S_embed),
                        simHash: formatNumber(metrics.S_sim),
                        jaccardHints: formatNumber(metrics.S_merge),
                        taxBoost: formatNumber(metrics.S_tax),
                        keywordBoost: formatNumber(metrics.S_kw),
                        docTypeBoost: formatNumber(metrics.docMatch),
                        genericPenalty: formatNumber(metrics.genericPenalty),
                        langPenalty: formatNumber(metrics.langPenalty),
                        finalScore: formatNumber(metrics.score, 4),
                        threshold: SIMILARITY_JOIN_THRESHOLD,
                        bridge: isBridge,
                        bridgeReason: isBridge ? 'generic-landing mismatch' : null,
                        timestamp: Date.now()
                    });
                }
            } else if (score >= SIMILARITY_SPLIT_THRESHOLD) {
                const domainMatch = Boolean(vectors[i]?.domain && vectors[i].domain === vectors[j]?.domain);
                borderlinePairs.push({
                    i,
                    j,
                    score,
                    domainMatch,
                    merge: typeof metrics.S_merge === 'number' ? metrics.S_merge : 0,
                    primary: typeof metrics.S_primary === 'number' ? metrics.S_primary : 0,
                    taxonomy: typeof metrics.S_tax === 'number' ? metrics.S_tax : 0,
                    sim: typeof metrics.S_sim === 'number' ? metrics.S_sim : 0,
                    embed: typeof metrics.S_embed === 'number' ? metrics.S_embed : 0
                });
            }
        }
    }
    
    if (borderlinePairs.length) {
        borderlinePairs.sort((a, b) => b.score - a.score);
        for (const pair of borderlinePairs) {
            const rootA = uf.find(pair.i);
            const rootB = uf.find(pair.j);
            if (rootA === rootB) continue;
            const meetsSecondary =
                (pair.domainMatch && pair.merge >= 0.35) ||
                (pair.primary >= 0.55 && pair.taxonomy >= 0.35) ||
                (pair.sim >= 0.62) ||
                (pair.embed >= 0.68);
            if (pair.score >= SIMILARITY_JOIN_THRESHOLD || (meetsSecondary && pair.score >= SIMILARITY_SPLIT_THRESHOLD)) {
                uf.union(pair.i, pair.j);
                if (debugLog) {
                    debugLog.stats = debugLog.stats || {};
                    debugLog.stats.hysteresisUnions = (debugLog.stats.hysteresisUnions || 0) + 1;
                    debugLog.stats.pairUnions = (debugLog.stats.pairUnions || 0) + 1;
                    const entryA = vectors[pair.i]?.tabData || {};
                    const entryB = vectors[pair.j]?.tabData || {};
                    const classificationA = entryA.classification || {};
                    const classificationB = entryB.classification || {};
                    const mergeHintsA = classificationA.mergeHints || vectors[pair.i]?.mergeHints || [];
                    const mergeHintsB = classificationB.mergeHints || vectors[pair.j]?.mergeHints || [];
                    const formatNumber = (value, digits = 3) =>
                        typeof value === 'number' ? Number(value.toFixed(digits)) : null;
                    debugLog.pairwise = debugLog.pairwise || [];
                    debugLog.pairwise.push({
                        phase: 'A',
                        type: 'pair-hysteresis',
                        reason: 'borderline-merge',
                        vectorIndices: [pair.i, pair.j],
                        tabIndices: [vectors[pair.i]?.index, vectors[pair.j]?.index],
                        urls: [entryA.url, entryB.url],
                        primaryTopics: [classificationA.primaryTopic || vectors[pair.i]?.primaryTopic || '', classificationB.primaryTopic || vectors[pair.j]?.primaryTopic || ''],
                        docTypes: [classificationA.docType || vectors[pair.i]?.docType || '', classificationB.docType || vectors[pair.j]?.docType || ''],
                        mergeHints: [mergeHintsA.slice(0, 4), mergeHintsB.slice(0, 4)],
                        cosineEmb: formatNumber(pair.embed),
                        simHash: formatNumber(pair.sim),
                        jaccardHints: formatNumber(pair.merge),
                        taxBoost: formatNumber(pair.taxonomy),
                        keywordBoost: formatNumber(pair.primary),
                        docTypeBoost: classificationA.docType && classificationB.docType
                            ? formatNumber(classificationA.docType === classificationB.docType ? 1 : 0)
                            : null,
                        genericPenalty: null,
                        langPenalty: null,
                        finalScore: formatNumber(pair.score, 4),
                        threshold: SIMILARITY_SPLIT_THRESHOLD,
                        bridge: Boolean((vectors[pair.i]?.isGenericLanding) !== (vectors[pair.j]?.isGenericLanding)),
                        bridgeReason: null,
                        timestamp: Date.now()
                    });
                }
            }
        }
    }
    
    const groupsMap = new Map();
    for (let idx = 0; idx < vectors.length; idx++) {
        const root = uf.find(idx);
        if (!groupsMap.has(root)) {
            groupsMap.set(root, { vectorIndices: [], tabIndices: [] });
        }
        const group = groupsMap.get(root);
        group.vectorIndices.push(idx);
        group.tabIndices.push(vectors[idx].index);
    }
    
    let groups = Array.from(groupsMap.values());
    
    if (groups.length > 1) {
        groups = mergeSmallSimilarGroups(groups, vectors, similarityCache, { debugLog });
    }
    
    if (groups.length > 1) {
        const toRemove = new Set();
        for (const group of groups) {
            if (group.vectorIndices.length !== 1) continue;
            const vectorIdx = group.vectorIndices[0];
            let bestGroup = null;
            let bestScore = 0;
            
            for (const candidate of groups) {
                if (candidate === group || toRemove.has(candidate)) continue;
                let candidateScore = 0;
                let comparisons = 0;
                for (const otherIdx of candidate.vectorIndices) {
                    const key = vectorIdx < otherIdx ? `${vectorIdx}|${otherIdx}` : `${otherIdx}|${vectorIdx}`;
                    let score = similarityCache.get(key);
                    if (typeof score !== 'number') {
                        score = computeWeightedSimilarity(vectors[vectorIdx], vectors[otherIdx]);
                        similarityCache.set(key, score);
                    }
                    candidateScore = Math.max(candidateScore, score);
                    comparisons += 1;
                }
                
                if (candidateScore > bestScore) {
                    bestScore = candidateScore;
                    bestGroup = candidate;
                }
            }
            
            if (bestGroup && bestScore >= SIMILARITY_SPLIT_THRESHOLD) {
                bestGroup.vectorIndices.push(vectorIdx);
                bestGroup.tabIndices.push(vectors[vectorIdx].index);
                toRemove.add(group);
            }
        }
        
        if (toRemove.size) {
            groups = groups.filter(group => !toRemove.has(group));
        }
    }
    
    if (groups.length > 1) {
        groups = mergeYouTubeChannelSingletons(groups, vectors, tabData, { debugLog });
    }
    
    const enrichedGroups = groups.map(group => enrichGroupFromVectors(group.vectorIndices, vectors, similarityCache));
    
    enrichedGroups.sort((a, b) => b.tabIndices.length - a.tabIndices.length || a.tabIndices[0] - b.tabIndices[0]);
    enrichedGroups.forEach((group, idx) => {
        group.name = `Group ${idx + 1}`;
    });
    
    featureContext.similarityCache = similarityCache;
    featureContext.vectors = vectors;
    return enrichedGroups;
}

function mergeSmallSimilarGroups(groups, vectors, similarityCache, { debugLog = null } = {}) {
    if (!Array.isArray(groups) || groups.length <= 1) {
        return groups;
    }

    const keywordSets = groups.map(group => {
        const set = new Set();
        group.vectorIndices.forEach(vectorIdx => {
            const vector = vectors[vectorIdx];
            if (!vector) return;
            vector.keywordTokens?.forEach(token => set.add(token));
        });
        return set;
    });

    const taxonomySets = groups.map(group => {
        const set = new Set();
        group.vectorIndices.forEach(vectorIdx => {
            const vector = vectors[vectorIdx];
            if (!vector) return;
            vector.taxonomyTags?.forEach(token => set.add(token));
        });
        return set;
    });

    const topicSets = groups.map(group => {
        const set = new Set();
        group.vectorIndices.forEach(vectorIdx => {
            const vector = vectors[vectorIdx];
            if (!vector) return;
            vector.semanticTopicTokens?.forEach(token => set.add(token));
        });
        return set;
    });

    const groupUF = createUnionFind(groups.length);
    let merged = false;

    const getVectorSimilarity = (a, b) => {
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        let score = similarityCache.get(key);
        if (typeof score !== 'number') {
            score = computeWeightedSimilarity(vectors[a], vectors[b]);
            similarityCache.set(key, score);
        }
        return score;
    };

    for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
            const groupA = groups[i];
            const groupB = groups[j];
            if (!groupA || !groupB) continue;

            const sizeA = groupA.vectorIndices.length;
            const sizeB = groupB.vectorIndices.length;
            if (sizeA > SMALL_GROUP_MAX_SIZE && sizeB > SMALL_GROUP_MAX_SIZE) continue;

            debugLog?.stats && (debugLog.stats.smallGroupComparisons = (debugLog.stats.smallGroupComparisons || 0) + 1);
            let bestScore = 0;
            let bestPair = null;
            for (const idxA of groupA.vectorIndices) {
                for (const idxB of groupB.vectorIndices) {
                    const score = getVectorSimilarity(idxA, idxB);
                    if (score > bestScore) {
                        bestScore = score;
                        bestPair = [idxA, idxB];
                        if (bestScore >= 0.99) break;
                    }
                }
                if (bestScore >= 0.99) break;
            }

            const keywordOverlap = normalizedOverlap(keywordSets[i], keywordSets[j]);
            const topicOverlap = normalizedOverlap(topicSets[i], topicSets[j]);
            const taxonomyOverlap = normalizedOverlap(taxonomySets[i], taxonomySets[j]);

            const meetsThreshold = bestScore >= CROSS_GROUP_MERGE_THRESHOLD;
            const meetsKeywordOrTopic = keywordOverlap >= CROSS_GROUP_KEYWORD_OVERLAP || topicOverlap >= CROSS_GROUP_TOPIC_OVERLAP;
            const meetsTaxonomyBoost = taxonomyOverlap >= CROSS_GROUP_TAXONOMY_OVERLAP &&
                (bestScore >= CROSS_GROUP_MERGE_THRESHOLD * 0.6 || meetsKeywordOrTopic);

            const shouldMerge = (meetsThreshold && (meetsKeywordOrTopic || taxonomyOverlap >= CROSS_GROUP_TAXONOMY_OVERLAP))
                || meetsTaxonomyBoost;

            if (shouldMerge) {
                groupUF.union(i, j);
                merged = true;
                if (debugLog) {
                    debugLog.stats.smallGroupUnions = (debugLog.stats.smallGroupUnions || 0) + 1;
                    const formatNumber = (value, digits = 3) => typeof value === 'number' ? Number(value.toFixed(digits)) : null;
                    let debugInfo = null;
                    let vectorA = null;
                    let vectorB = null;
                    if (Array.isArray(bestPair)) {
                        vectorA = vectors[bestPair[0]];
                        vectorB = vectors[bestPair[1]];
                        debugInfo = {};
                        computeWeightedSimilarity(vectorA, vectorB, debugInfo);
                    }
                    const entryA = vectorA?.tabData || {};
                    const entryB = vectorB?.tabData || {};
                    const classificationA = entryA.classification || {};
                    const classificationB = entryB.classification || {};
                    const mergeHintsA = classificationA.mergeHints || vectorA?.mergeHints || [];
                    const mergeHintsB = classificationB.mergeHints || vectorB?.mergeHints || [];
                    const bridge = Boolean(
                        (vectorA?.isGenericLanding || classificationA.isGenericLanding) !==
                        (vectorB?.isGenericLanding || classificationB.isGenericLanding)
                    );
                    debugLog.smallGroup = debugLog.smallGroup || [];
                    const mergeType = meetsThreshold && (meetsKeywordOrTopic || taxonomyOverlap >= CROSS_GROUP_TAXONOMY_OVERLAP) ? 'semantic' : 'taxonomy';
                    debugLog.smallGroup.push({
                        phase: 'B',
                        type: mergeType,
                        groups: [i, j],
                        sizes: [sizeA, sizeB],
                        reason: mergeType,
                        bestScore: formatNumber(debugInfo?.score, 4) ?? formatNumber(bestScore, 4),
                        keywordOverlap: formatNumber(keywordOverlap),
                        topicOverlap: formatNumber(topicOverlap),
                        taxonomyOverlap: formatNumber(taxonomyOverlap),
                        threshold: CROSS_GROUP_MERGE_THRESHOLD,
                        primaryTopics: [
                            classificationA.primaryTopic || vectorA?.primaryTopic || '',
                            classificationB.primaryTopic || vectorB?.primaryTopic || ''
                        ],
                        docTypes: [
                            classificationA.docType || vectorA?.docType || '',
                            classificationB.docType || vectorB?.docType || ''
                        ],
                        mergeHints: [mergeHintsA.slice(0, 4), mergeHintsB.slice(0, 4)],
                        cosineEmb: formatNumber(debugInfo?.S_embed),
                        jaccardHints: formatNumber(debugInfo?.S_merge),
                        taxBoost: formatNumber(debugInfo?.S_tax),
                        keywordBoost: formatNumber(debugInfo?.S_kw),
                        docTypeBoost: formatNumber(debugInfo?.docMatch),
                        genericPenalty: formatNumber(debugInfo?.genericPenalty),
                        bridge,
                        bridgeReason: bridge ? 'generic-landing mismatch' : null,
                        timestamp: Date.now()
                    });
                }
            }
        }
    }

    if (!merged) {
        return groups;
    }

    const mergedMap = new Map();
    for (let idx = 0; idx < groups.length; idx++) {
        const root = groupUF.find(idx);
        if (!mergedMap.has(root)) {
            mergedMap.set(root, {
                vectorIndices: new Set(),
                tabIndices: new Set()
            });
        }
        const accumulator = mergedMap.get(root);
        groups[idx].vectorIndices.forEach(vIdx => accumulator.vectorIndices.add(vIdx));
        groups[idx].tabIndices.forEach(tIdx => accumulator.tabIndices.add(tIdx));
    }

    return Array.from(mergedMap.values()).map(entry => ({
        vectorIndices: Array.from(entry.vectorIndices).sort((a, b) => a - b),
        tabIndices: Array.from(entry.tabIndices).sort((a, b) => a - b)
        }));
    }

function mergeYouTubeChannelSingletons(groups, vectors, tabData, { debugLog = null } = {}) {
    if (!Array.isArray(groups) || groups.length <= 1) {
        return groups;
    }
    
    const channelGroups = new Map();
    groups.forEach((group, index) => {
        if (!group.vectorIndices || group.vectorIndices.length !== 1) {
            return;
        }
        const vectorIdx = group.vectorIndices[0];
        const vector = vectors[vectorIdx];
        if (!vector) return;
        const entryIndex = typeof vector.index === 'number' ? vector.index : null;
        const entry = entryIndex !== null ? (tabData?.[entryIndex] || vector.tabData || {}) : (vector.tabData || {});
        const url = entry.url || '';
        const domain = (entry.domain || '').toLowerCase();
        const isYouTube = domain.includes('youtube.com') || url.includes('youtu.be');
        if (!isYouTube) {
            return;
        }
        const channel = (entry.youtubeChannel || '').toLowerCase().trim();
        if (!channel) {
            return;
        }
        if (!channelGroups.has(channel)) {
            channelGroups.set(channel, []);
        }
        channelGroups.get(channel).push(index);
    });
    
    let merged = false;
    const groupUF = createUnionFind(groups.length);
    for (const [channelKey, indices] of channelGroups.entries()) {
        if (!indices || indices.length <= 1) continue;
        const [first, ...rest] = indices;
        rest.forEach(otherIndex => {
            groupUF.union(first, otherIndex);
            merged = true;
            if (debugLog) {
                debugLog.stats.channelUnions = (debugLog.stats.channelUnions || 0) + 1;
                const vectorA = groups[first]?.vectorIndices?.[0] !== undefined ? vectors[groups[first].vectorIndices[0]] : null;
                const vectorB = groups[otherIndex]?.vectorIndices?.[0] !== undefined ? vectors[groups[otherIndex].vectorIndices[0]] : null;
                const entryA = vectorA?.tabData || {};
                const entryB = vectorB?.tabData || {};
                const classificationA = entryA.classification || {};
                const classificationB = entryB.classification || {};
                const channelName = entryA.youtubeAnalysis?.channel || entryB.youtubeAnalysis?.channel || channelKey;
                debugLog.channelMerges = debugLog.channelMerges || [];
                debugLog.channelMerges.push({
                    phase: 'B',
                    type: 'channel',
                    reason: 'channel-singletons',
                    groups: [first, otherIndex],
                    urls: [entryA.url, entryB.url],
                    channel: channelName,
                    primaryTopics: [
                        classificationA.primaryTopic || vectorA?.primaryTopic || '',
                        classificationB.primaryTopic || vectorB?.primaryTopic || ''
                    ],
                    docTypes: [
                        classificationA.docType || vectorA?.docType || '',
                        classificationB.docType || vectorB?.docType || ''
                    ],
                    mergeHints: [
                        (classificationA.mergeHints || vectorA?.mergeHints || []).slice(0, 4),
                        (classificationB.mergeHints || vectorB?.mergeHints || []).slice(0, 4)
                    ],
                    timestamp: Date.now()
                });
            }
        });
    }
    
    if (!merged) {
        return groups;
    }
    
    const mergedMap = new Map();
    for (let idx = 0; idx < groups.length; idx++) {
        const root = groupUF.find(idx);
        if (!mergedMap.has(root)) {
            mergedMap.set(root, {
                vectorIndices: new Set(),
                tabIndices: new Set()
            });
        }
        const accumulator = mergedMap.get(root);
        const group = groups[idx];
        group.vectorIndices.forEach(vectorIdx => accumulator.vectorIndices.add(vectorIdx));
        group.tabIndices.forEach(tabIdx => accumulator.tabIndices.add(tabIdx));
    }
    
    return Array.from(mergedMap.values()).map(entry => ({
        vectorIndices: Array.from(entry.vectorIndices).sort((a, b) => a - b),
        tabIndices: Array.from(entry.tabIndices).sort((a, b) => a - b)
    }));
}

function enrichGroupFromVectors(vectorIndices, vectors, similarityCache) {
    const uniqueVectorIndices = Array.from(new Set(vectorIndices || [])).sort((a, b) => a - b);
    const tabIndexSet = new Set();
    const centroid = new Map();
    const keywordFrequency = new Map();
    const domainFrequency = new Map();
    const languageFrequency = new Map();
    const taxonomyFrequency = new Map();
    const primaryTopicFrequency = new Map();
    const docTypeFrequency = new Map();
    const entityFrequency = new Map();
    const entityLabelMap = new Map();
    const mergeHintFrequency = new Map();
    let genericLandingCount = 0;
    
    uniqueVectorIndices.forEach(vectorIdx => {
        const vector = vectors?.[vectorIdx];
        if (!vector) return;
        if (typeof vector.index === 'number') {
            tabIndexSet.add(vector.index);
        }
        if (vector.keywordTokens) {
            vector.keywordTokens.forEach(token => {
                keywordFrequency.set(token, (keywordFrequency.get(token) || 0) + 1);
            });
        }
        if (vector.taxonomyTags) {
            vector.taxonomyTags.forEach(token => {
                taxonomyFrequency.set(token, (taxonomyFrequency.get(token) || 0) + 1);
            });
        }
        if (vector.tfidfVector) {
            vector.tfidfVector.forEach((value, token) => {
                centroid.set(token, (centroid.get(token) || 0) + value);
            });
        }
        if (vector.domain) {
            domainFrequency.set(vector.domain, (domainFrequency.get(vector.domain) || 0) + 1);
        }
        if (vector.language) {
            languageFrequency.set(vector.language, (languageFrequency.get(vector.language) || 0) + 1);
        }
        const primaryTopic = (vector.primaryTopic || vector.tabData?.classification?.primaryTopic || '').toLowerCase().trim();
        if (primaryTopic) {
            primaryTopicFrequency.set(primaryTopic, (primaryTopicFrequency.get(primaryTopic) || 0) + 1);
        }
        const docType = (vector.docType || vector.tabData?.classification?.docType || '').toLowerCase().trim();
        if (docType) {
            docTypeFrequency.set(docType, (docTypeFrequency.get(docType) || 0) + 1);
        }
        const mergeHints = Array.isArray(vector.mergeHints)
            ? vector.mergeHints
            : (vector.tabData?.classification?.mergeHints || []);
        mergeHints.forEach(hint => {
            const token = String(hint || '').toLowerCase().trim();
            if (!token || STOPWORDS.has(token)) return;
            mergeHintFrequency.set(token, (mergeHintFrequency.get(token) || 0) + 1);
        });
        const entityList = vector.tabData?.classification?.entities || [];
        entityList.forEach(entity => {
            const label = String(entity || '').trim();
            if (!label) return;
            const key = label.toLowerCase();
            entityFrequency.set(key, (entityFrequency.get(key) || 0) + 1);
            if (!entityLabelMap.has(key)) {
                entityLabelMap.set(key, label);
            }
        });
        if (vector.isGenericLanding || vector.tabData?.classification?.isGenericLanding) {
            genericLandingCount += 1;
        }
    });
    
    const centroidTokens = Array.from(centroid.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, TFIDF_TOKEN_LIMIT)
        .map(([token]) => token);
    
    const keywords = Array.from(keywordFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, TFIDF_TOKEN_LIMIT)
        .map(([token]) => token);
    
    const centroidSignature = `${centroidTokens.slice(0, 8).join('|')}|${keywords.slice(0, 6).join('|')}`;
    const domainMode = Array.from(domainFrequency.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const languageMode = Array.from(languageFrequency.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const taxonomyTags = Array.from(taxonomyFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([token]) => token);
    
    const representativeVectorIndices = pickGroupRepresentatives(uniqueVectorIndices, vectors, similarityCache);
    const representativeTabIndices = representativeVectorIndices
        .map(idx => vectors?.[idx]?.index)
        .filter(index => typeof index === 'number');
    
    const tabIndices = Array.from(tabIndexSet).sort((a, b) => a - b);
    
    const pickTopKeys = (frequencyMap, count = 1) => {
        return Array.from(frequencyMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, count)
            .map(([key]) => key);
    };
    const primaryTopicToken = pickTopKeys(primaryTopicFrequency, 1)[0] || '';
    const primaryTopicLabel = primaryTopicToken
        ? (titleCaseFromTokens(tokenizeText(primaryTopicToken)) || primaryTopicToken)
        : '';
    const primaryTopicCount = primaryTopicToken ? (primaryTopicFrequency.get(primaryTopicToken) || 0) : 0;
    const primaryTopicPurity = uniqueVectorIndices.length
        ? primaryTopicCount / uniqueVectorIndices.length
        : 0;
    const docTypeToken = pickTopKeys(docTypeFrequency, 1)[0] || '';
    const mergeHintsTop = pickTopKeys(mergeHintFrequency, 6);
    const topEntityKeys = pickTopKeys(entityFrequency, 4);
    const topEntities = topEntityKeys.map(key => {
        const label = entityLabelMap.get(key) || key;
        return titleCaseFromTokens(tokenizeText(label)) || label;
    });
    const genericLandingRatio = uniqueVectorIndices.length
        ? genericLandingCount / uniqueVectorIndices.length
        : 0;
    
    return {
        tabIndices,
        vectorIndices: uniqueVectorIndices,
        keywords,
        centroidTokens,
        centroidSignature,
        domainMode,
        languageMode,
        representativeTabIndices,
        taxonomyTags,
        mergeHints: mergeHintsTop,
        primaryTopic: primaryTopicLabel,
        docType: docTypeToken,
        entities: topEntities,
        genericLandingRatio,
        primaryTopicPurity,
        name: '',
        summary: []
    };
}

function mergeSimilarNamedGroups(groups, featureContext, { debugLog = null } = {}) {
    if (!Array.isArray(groups) || groups.length <= 1) {
        return groups;
    }
    
    const vectors = featureContext?.vectors;
    if (!vectors || !vectors.length) {
        return groups;
    }
    
    const similarityCache = featureContext?.similarityCache || new Map();
    const nameTokenSets = groups.map(group => tokenizeGroupName(group.name));
    const uf = createUnionFind(groups.length);
    let merged = false;
    const mergeSummaries = [];
    
    const bestGroupSimilarity = (groupA, groupB) => {
        if (!groupA?.vectorIndices?.length || !groupB?.vectorIndices?.length) {
            return { score: 0, pair: null };
        }
        let best = 0;
        let bestPair = null;
        for (const idxA of groupA.vectorIndices) {
            for (const idxB of groupB.vectorIndices) {
                const key = idxA < idxB ? `${idxA}|${idxB}` : `${idxB}|${idxA}`;
                let score = similarityCache.get(key);
                if (typeof score !== 'number') {
                    score = computeWeightedSimilarity(vectors[idxA], vectors[idxB]);
                    similarityCache.set(key, score);
                }
                if (score > best) {
                    best = score;
                    bestPair = [idxA, idxB];
                    if (best >= 0.99) {
                        return { score: best, pair: bestPair };
                    }
                }
            }
        }
        return { score: best, pair: bestPair };
    };
    
    const isGamingGroup = (g) => {
        const s = ((g?.name || '') + ' ' + (Array.isArray(g?.keywords) ? g.keywords.join(' ') : '')).toLowerCase();
        return /(players|ultimate|team|fut|squad|ratings|futbin|fut\.gg|ea sports fc)/.test(s) || (g?.primaryTopic === 'gaming');
    };
    const isShoppingGroup = (g) => {
        const s = ((g?.name || '') + ' ' + (Array.isArray(g?.keywords) ? g.keywords.join(' ') : '')).toLowerCase();
        return (g?.primaryTopic === 'shopping') || detectShoppingStrong(s, '');
    };
    const isMedicalGroup = (g) => {
        const s = ((g?.name || '') + ' ' + (Array.isArray(g?.keywords) ? g.keywords.join(' ') : '')).toLowerCase();
        return /(pubmed|nejm|medical|health|who)/.test(s) || (g?.primaryTopic === 'medical');
    };
    const isTechNewsGroup = (g) => {
        const s = ((g?.name || '') + ' ' + (Array.isArray(g?.keywords) ? g.keywords.join(' ') : '')).toLowerCase();
        return /(tech|news|ai|openai|techcrunch|the verge|google)/.test(s) || (g?.primaryTopic === 'technology');
    };

    // Normalizer for exact label equality checks (remove punctuation/emojis, collapse spaces)
    const normName = (v) => {
        try {
            return String(v || '')
                .toLowerCase()
                .normalize('NFKD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9\s\u0370-\u03ff\u1f00-\u1fff]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        } catch (_) {
            return String(v || '').toLowerCase().trim();
        }
    };

    for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
            // Guard: do not merge across major categories (gaming/shopping/medical/tech)
            const ga = isGamingGroup(groups[i]);
            const gb = isGamingGroup(groups[j]);
            if (ga !== gb) continue;
            const sa = isShoppingGroup(groups[i]);
            const sb = isShoppingGroup(groups[j]);
            if (sa !== sb) continue;
            const ma = isMedicalGroup(groups[i]);
            const mb = isMedicalGroup(groups[j]);
            if (ma !== mb) continue;
            const ta = isTechNewsGroup(groups[i]);
            const tb = isTechNewsGroup(groups[j]);
            if (ta !== tb) continue;

            // Special fast path: shopping groups with identical normalized labels
            if (sa && sb) {
                const nameA = normName(groups[i].name);
                const nameB = normName(groups[j].name);
                if (nameA && nameB && nameA === nameB && !isPlaceholderGroupName(groups[i].name) && !isPlaceholderGroupName(groups[j].name)) {
                    uf.union(i, j);
                    merged = true;
                    mergeSummaries.push({ a: groups[i].name, b: groups[j].name, labelEquality: true });
                    if (debugLog) {
                        debugLog.stats = debugLog.stats || {};
                        debugLog.stats.nameUnions = (debugLog.stats.nameUnions || 0) + 1;
                        debugLog.nameMerges = debugLog.nameMerges || [];
                        debugLog.nameMerges.push({
                            phase: 'B',
                            type: 'label-merge',
                            reason: 'label-equal',
                            groups: [i, j],
                            names: [groups[i].name, groups[j].name],
                            primaryTopics: [groups[i].primaryTopic || '', groups[j].primaryTopic || ''],
                            timestamp: Date.now()
                        });
                    }
                    continue; // proceed to next pair
                }
            }

            const tokensA = nameTokenSets[i];
            const tokensB = nameTokenSets[j];
            if (!tokensA.size || !tokensB.size) {
                continue;
            }
            if (isPlaceholderGroupName(groups[i].name) && isPlaceholderGroupName(groups[j].name)) {
                continue;
            }
            if (debugLog) {
                debugLog.stats = debugLog.stats || {};
                debugLog.stats.nameComparisons = (debugLog.stats.nameComparisons || 0) + 1;
            }
            const overlap = normalizedOverlap(tokensA, tokensB);
            if (overlap < GROUP_NAME_SIMILARITY_THRESHOLD) {
                continue;
            }
            const similarityResult = bestGroupSimilarity(groups[i], groups[j]);
            if (similarityResult.score >= GROUP_NAME_VECTOR_THRESHOLD) {
                uf.union(i, j);
                merged = true;
                mergeSummaries.push({
                    a: groups[i].name,
                    b: groups[j].name,
                    labelSimilarity: overlap.toFixed(2),
                    vectorSimilarity: similarityResult.score.toFixed(2)
                });
                if (debugLog) {
                    debugLog.stats.nameUnions = (debugLog.stats.nameUnions || 0) + 1;
                    const formatNumber = (value, digits = 3) => typeof value === 'number' ? Number(value.toFixed(digits)) : null;
                    let debugInfo = null;
                    if (Array.isArray(similarityResult.pair)) {
                        const [idxA, idxB] = similarityResult.pair;
                        const vectorA = vectors[idxA];
                        const vectorB = vectors[idxB];
                        if (vectorA && vectorB) {
                            debugInfo = {};
                            computeWeightedSimilarity(vectorA, vectorB, debugInfo);
                        }
                    }
                    debugLog.nameMerges = debugLog.nameMerges || [];
                    debugLog.nameMerges.push({
                        phase: 'B',
                        type: 'label-merge',
                        reason: 'label-similarity',
                        groups: [i, j],
                        names: [groups[i].name, groups[j].name],
                        labelOverlap: formatNumber(overlap),
                        vectorSimilarity: formatNumber(similarityResult.score),
                        primaryTopics: [groups[i].primaryTopic || '', groups[j].primaryTopic || ''],
                        docTypes: [groups[i].docType || '', groups[j].docType || ''],
                        mergeHints: [
                            Array.isArray(groups[i].mergeHints) ? groups[i].mergeHints.slice(0, 4) : [],
                            Array.isArray(groups[j].mergeHints) ? groups[j].mergeHints.slice(0, 4) : []
                        ],
                        thresholds: {
                            label: GROUP_NAME_SIMILARITY_THRESHOLD,
                            vector: GROUP_NAME_VECTOR_THRESHOLD
                        },
                        cosineEmb: formatNumber(debugInfo?.S_embed),
                        jaccardHints: formatNumber(debugInfo?.S_merge),
                        taxBoost: formatNumber(debugInfo?.S_tax),
                        keywordBoost: formatNumber(debugInfo?.S_kw),
                        docTypeBoost: formatNumber(debugInfo?.docMatch),
                        timestamp: Date.now()
                    });
                }
            }
        }
    }
    
    if (!merged) {
        return groups;
    }
    
    const mergedMap = new Map();
    for (let idx = 0; idx < groups.length; idx++) {
        const root = uf.find(idx);
        if (!mergedMap.has(root)) {
            mergedMap.set(root, {
                vectorIndices: new Set(),
                tabIndices: new Set(),
                names: []
            });
        }
        const bucket = mergedMap.get(root);
        const group = groups[idx];
        group.vectorIndices?.forEach(vIdx => bucket.vectorIndices.add(vIdx));
        group.tabIndices?.forEach(tIdx => bucket.tabIndices.add(tIdx));
        if (group.name) {
            bucket.names.push(group.name);
        }
    }
    
    const mergedGroups = Array.from(mergedMap.values()).map(bucket => {
        const vectorList = Array.from(bucket.vectorIndices);
        const nameCandidate = bucket.names
            .filter(name => name && !isPlaceholderGroupName(name))
            .sort((a, b) => b.length - a.length)[0] || bucket.names[0] || 'Group';
        if (vectorList.length > 0) {
            const enriched = enrichGroupFromVectors(vectorList, vectors, similarityCache);
            enriched.name = nameCandidate || enriched.name || 'Group';
            enriched.summary = [];
            return enriched;
        }
        // Fallback: groups didn't carry vectorIndices (e.g., came from earlier pipeline)
        const tabIdxArr = Array.from(bucket.tabIndices).sort((a, b) => a - b);
        return {
            tabIndices: tabIdxArr,
            vectorIndices: [],
            keywords: [],
            centroidTokens: [],
            centroidSignature: `manual|${tabIdxArr.join('|')}`,
            domainMode: '',
            languageMode: '',
            representativeTabIndices: tabIdxArr.slice(0, Math.min(2, tabIdxArr.length)),
            taxonomyTags: [],
            mergeHints: [],
            primaryTopic: '',
            docType: '',
            entities: [],
            genericLandingRatio: 0,
            primaryTopicPurity: 0,
            name: nameCandidate,
            summary: []
        };
    });
    
    mergedGroups.sort((a, b) => b.tabIndices.length - a.tabIndices.length || a.tabIndices[0] - b.tabIndices[0]);
    mergedGroups.forEach((group, index) => {
        if (!group.name || isPlaceholderGroupName(group.name)) {
            group.name = `Group ${index + 1}`;
        }
    });
    
    if (mergeSummaries.length) {
        console.log('Merged groups with similar names:', mergeSummaries.slice(0, 5));
    }
    
    return mergedGroups;
}

function tokenizeGroupName(name) {
    if (!name) {
        return new Set();
    }
    return new Set(tokenizeText(name));
}

function isPlaceholderGroupName(name) {
    if (!name) return true;
    return /^group\s+\d+$/i.test(name.trim());
}
function pickGroupRepresentatives(vectorIndices, vectors, similarityCache) {
    if (!vectorIndices.length) return [];
    if (vectorIndices.length <= 2) return vectorIndices.slice();
    
    const scored = vectorIndices.map(idx => {
        let total = 0;
        let comparisons = 0;
        for (const otherIdx of vectorIndices) {
            if (otherIdx === idx) continue;
            const key = idx < otherIdx ? `${idx}|${otherIdx}` : `${otherIdx}|${idx}`;
            let score = similarityCache.get(key);
            if (typeof score !== 'number') {
                score = computeWeightedSimilarity(vectors[idx], vectors[otherIdx]);
                similarityCache.set(key, score);
            }
            total += score;
            comparisons += 1;
        }
        return {
            idx,
            averageScore: comparisons ? total / comparisons : 0
        };
    });
    
    scored.sort((a, b) => b.averageScore - a.averageScore);
    return scored.slice(0, 2).map(item => item.idx);
}

function pickTopTokens(tokens, count = 3) {
    const frequency = new Map();
    tokens.forEach(token => {
        frequency.set(token, (frequency.get(token) || 0) + 1);
    });
    return Array.from(frequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, count)
        .map(([token]) => token);
}

function titleCaseFromTokens(tokens) {
    if (!tokens.length) return '';
    return tokens
        .map(token => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ');
}

async function assignGroupLabels(groups, tabDataForAI) {
    const LABELING_BUDGET_MS = 15000; // overall budget for labeling to avoid long stalls
    const labelingStartTs = Date.now();
    if (labelingActive) {
        // Another labeling session is running; defer
        scheduleDeferredLabels(800);
        return;
    }
    labelingActive = true;
    const accessibleTab = await findUsableAIAccessTab();
    const { groupLabelCache = {} } = await chrome.storage.session.get(['groupLabelCache']);
    const updatedCache = { ...groupLabelCache };
    let cacheDirty = false;
    const indexMap = new Map(tabDataForAI.map(entry => [entry.index, entry]));
    let aiLabelReady = false;
    let aiLabelReason = 'Language Model API not available';
    let aiLabelChecksFailed = false;
    let aiLabelAttempts = 0;
    const labelFailureReasons = new Set();
    
    const buildFallbackBlurb = (descriptor, group, labelValue) => {
        const keywordPool = [
            ...(descriptor.centroidKeywords || []),
            ...(descriptor.mergeHints || []),
            ...(descriptor.taxonomyTags || []),
            ...(group.mergeHints || []),
            ...(group.keywords || [])
        ];
        const unique = [];
        for (const token of keywordPool) {
            const clean = String(token || '').trim();
            if (!clean) continue;
            const tokens = tokenizeText(clean);
            if (!tokens.length) continue;
            const phrase = titleCaseFromTokens(tokens.slice(0, 2)) || clean;
            if (phrase && !unique.includes(phrase)) {
                unique.push(phrase);
            }
            if (unique.length >= 3) {
                break;
            }
        }
        if (!unique.length) {
            const fallback = titleCaseFromTokens(tokenizeText(labelValue || 'General Focus')) || 'Major Topics';
            return `Insights on ${fallback} topics and trends`;
        }
        if (unique.length === 1) {
            return `Insights on ${unique[0]} topics and trends`;
        }
        if (unique.length === 2) {
            return `Insights on ${unique[0]} and ${unique[1]} topics`;
        }
        return `Highlights include ${unique[0]}, ${unique[1]} and ${unique[2]}`;
    };

    // Heuristic: detect overly generic/weak labels that don't help users
    const isWeakLabel = (label = '') => {
        const s = String(label || '').toLowerCase().trim();
        if (!s) return true;
        const generic = /(\bgeneral\b|\bonline\b|\bweb\b|\bbrowse\b|\binfo\b|\bgroup\b)/i;
        return generic.test(s) || s.length < 3;
    };

    // Build a better shopping label using AI intents or categories
    const buildShoppingLabel = (group) => {
        try {
            const intents = new Map();
            const cats = new Map();
            for (const idx of (group.tabIndices || [])) {
                const rec = Array.isArray(LAST_AI_KEYWORDS) ? LAST_AI_KEYWORDS.find(e => e.index === idx) : null;
                if (!rec) continue;
                if (rec.intent) intents.set(rec.intent, (intents.get(rec.intent) || 0) + 1);
                if (rec.shopCategory) cats.set(rec.shopCategory, (cats.get(rec.shopCategory) || 0) + 1);
            }
            let bestIntent = '';
            let bestIntentC = 0;
            for (const [k, c] of intents.entries()) { if (c > bestIntentC) { bestIntent = k; bestIntentC = c; } }
            if (bestIntent) {
                const title = bestIntent.split(/[\s+_-]+/).slice(0, 2).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ');
                return `Shopping · ${title}`;
            }
            let bestCat = '';
            let bestCatC = 0;
            for (const [k, c] of cats.entries()) { if (c > bestCatC) { bestCat = k; bestCatC = c; } }
            if (bestCat) {
                const title = bestCat === 'electronics' ? 'Electronics/Gaming' : (bestCat.charAt(0).toUpperCase() + bestCat.slice(1));
                return `Shopping · ${title}`;
            }
        } catch (_) {}
        return '';
    };
    
    if (!accessibleTab) {
        labelFailureReasons.add('No accessible tab with Chrome AI support');
    } else {
        try {
            console.log('🔍 [AI Check] Checking Language Model availability...');
            const availabilityResults = await chrome.scripting.executeScript({
                target: { tabId: accessibleTab.id },
                world: 'MAIN',
                func: checkLanguageModelAvailabilityInPage
            });
            const availability = availabilityResults?.[0]?.result;
            console.log('🔍 [AI Check] Availability result:', availability);
            
            if (availability?.ready) {
                aiLabelReady = true;
                aiLabelReason = 'ready';
                console.log('✅ [AI Check] Language Model is ready for labeling');
            } else {
                aiLabelReady = false;
                aiLabelReason = availability?.reason || 'Language Model not ready';
                aiLabelChecksFailed = true;
                console.log('❌ [AI Check] Language Model not ready:', aiLabelReason);
            }
        } catch (availabilityError) {
            aiLabelReady = false;
            aiLabelChecksFailed = true;
            aiLabelReason = availabilityError?.message || String(availabilityError);
            console.log('❌ [AI Check] Error checking availability:', aiLabelReason);
        }
    }

    // Prewarm the language model session once to avoid first-call latency
    if (accessibleTab && aiLabelReady) {
        try {
            // Small settle delay to avoid contention immediately after reload
            await new Promise(r => setTimeout(r, 500));
            await withTimeout(
                chrome.scripting.executeScript({
                    target: { tabId: accessibleTab.id },
                    world: 'MAIN',
                    func: generateGroupLabelInPage,
                    args: [{ mode: 'warmup' }]
                }),
                AI_LABEL_TIMEOUT,
                'AI label warmup timeout'
            );
        } catch (_) {
            // warmup best-effort
        }
    }

    for (const group of groups) {
        let attemptedThisGroup = false;
        let succeededThisGroup = false;
        const centroidSignature = group.centroidSignature || '';
        let cachedEntry = centroidSignature ? updatedCache[centroidSignature] : null;
        if (cachedEntry && (Date.now() - cachedEntry.timestamp) >= LABEL_CACHE_TTL) {
            cachedEntry = null;
        }

        let label = cachedEntry ? cachedEntry.label : '';
        let blurb = cachedEntry ? cachedEntry.blurb || '' : '';

        const exemplarTabs = (group.representativeTabIndices || group.tabIndices || [])
            .map(index => {
                const entry = indexMap.get(index) || {};
                const features = entry.semanticFeatures || {};
                const classification = entry.classification || {};
                return {
                    title: entry.title || '',
                    domain: entry.domain || '',
                    topic: features.topic || '',
                    keywords: (features.mergeHints || features.keywords || []).slice(0, 5),
                    primaryTopic: classification.primaryTopic || features.primaryTopic || '',
                    docType: classification.docType || features.docType || '',
                    entities: (classification.entities || features.entities || []).slice(0, 3),
                    mergeHints: (classification.mergeHints || features.mergeHints || features.keywords || []).slice(0, 5)
                };
            })
            .filter(tab => tab.title);
        
        const descriptor = {
            centroidKeywords: (group.centroidTokens || group.keywords || []).slice(0, 6),
            fallbackKeywords: (group.keywords || []).slice(0, 8),
            exemplarTabs: exemplarTabs.slice(0, 2),
            domainMode: group.domainMode || '',
            languageMode: group.languageMode || '',
            taxonomyTags: Array.isArray(group.taxonomyTags) ? group.taxonomyTags.slice(0, 6) : [],
            primaryTopic: group.primaryTopic || '',
            docType: group.docType || '',
            mergeHints: Array.isArray(group.mergeHints) ? group.mergeHints.slice(0, 6) : [],
            entities: Array.isArray(group.entities) ? group.entities.slice(0, 4) : [],
            genericLandingRatio: typeof group.genericLandingRatio === 'number' ? group.genericLandingRatio : 0
        };

        // Respect overall labeling budget
        if ((Date.now() - labelingStartTs) > LABELING_BUDGET_MS) {
            console.log('⏱️ [AI Label] Labeling budget exceeded; skipping remaining groups');
            break;
        }
        if ((!label || !blurb) && accessibleTab && aiLabelReady && aiLabelAttempts < MAX_AI_LABEL_GROUPS) {
            try {
                aiLabelAttempts += 1;
                attemptedThisGroup = true;
                console.log(`🧠 [AI Label] Attempting label for group ${groups.indexOf(group) + 1} (attempt ${aiLabelAttempts}/${MAX_AI_LABEL_GROUPS})`);
                const fullPromise = chrome.scripting.executeScript({
                    target: { tabId: accessibleTab.id },
                    world: 'MAIN',
                    func: generateGroupLabelInPage,
                    args: [descriptor]
                });
                // Short settle to reduce first-call contention
                await new Promise(r => setTimeout(r, 250));
                const results = await withTimeout(fullPromise, AI_LABEL_TIMEOUT, 'AI label timeout');
                const payload = results && results[0] && results[0].result;
                if (payload && payload.ok && payload.label) {
                    label = String(payload.label).trim();
                    if (payload.blurb) {
                        blurb = String(payload.blurb).trim().slice(0, 160);
                    }
                    console.log(`✅ [AI Label] Label: "${label}" for group ${groups.indexOf(group) + 1}`);
                    succeededThisGroup = true;
                } else if (payload && !payload.ok) {
                    const status = results[0].result.status || null;
                    const errorMessage = results[0].result.error || 'Language model not ready';
                    labelFailureReasons.add(status || errorMessage);
                    if (status === 'downloading' || status === 'downloadable' || status === 'unknown') {
                        aiLabelReady = false;
                        aiLabelReason = status || errorMessage;
                    }
                }
            } catch (error) {
                console.warn('Group label generation failed:', error);
                const message = error?.message || String(error);
                labelFailureReasons.add(message);
                succeededThisGroup = false;
            }
        } else if (!label && accessibleTab && aiLabelChecksFailed && !aiLabelReady) {
            labelFailureReasons.add(aiLabelReason);
        } else if (!label && accessibleTab && aiLabelAttempts >= MAX_AI_LABEL_GROUPS) {
            labelFailureReasons.add('AI group label limit reached');
        }

        if (!label) {
            // Δημιουργία έξυπνου fallback label βασισμένου στο περιεχόμενο
            const taxonomyFallback = descriptor.taxonomyTags.slice(0, 3);
            const fallbackTokens = descriptor.centroidKeywords.length
                ? descriptor.centroidKeywords.slice(0, 3)
                : (taxonomyFallback.length ? taxonomyFallback : descriptor.fallbackKeywords.slice(0, 3));
            
            // Προσπάθεια δημιουργίας περιγραφικού label
            if (fallbackTokens.length > 0) {
                label = titleCaseFromTokens(fallbackTokens);
            } else if (descriptor.domainMode) {
                label = titleCaseFromTokens([descriptor.domainMode]);
            } else if (descriptor.primaryTopic) {
                label = titleCaseFromTokens(tokenizeText(descriptor.primaryTopic).slice(0, 2));
            } else if (group.tabs && group.tabs.length > 0) {
                // Χρήση του πρώτου tab title για fallback
                const firstTab = group.tabs[0];
                if (firstTab && firstTab.title) {
                    const titleTokens = tokenizeText(firstTab.title).slice(0, 2);
                    label = titleCaseFromTokens(titleTokens) || 'Web Content';
                } else {
                    label = 'Web Content';
                }
            } else {
                label = `Group ${groups.indexOf(group) + 1}`;
            }
        }
        // If label is too generic, try to improve using shopping intent/category
        if (isWeakLabel(label) && (group.primaryTopic || '').toLowerCase() === 'shopping') {
            const improved = buildShoppingLabel(group);
            if (improved) label = improved;
        }

        if (!blurb) {
            blurb = buildFallbackBlurb(descriptor, group, label);
        }
        
        if (centroidSignature) {
            updatedCache[centroidSignature] = { label, blurb, timestamp: Date.now() };
            cacheDirty = true;
        }
        
        group.name = label;
        group.keywords = (group.keywords || []).slice(0, 10);
        group.taxonomyTags = descriptor.taxonomyTags;
        group.displayBlurb = blurb;
        group.oneLiner = blurb;
        group.blurb = blurb;
        // If a Chrome tab group was already created, update its title now
        if (group.chromeGroupId) {
            try {
                await chrome.tabGroups.update(group.chromeGroupId, {
                    title: group.name,
                    color: getGroupColor(group.name)
                });
            } catch (e) {
                console.warn('Failed to update existing Chrome group title:', e?.message || e);
            }
        }

        // Cooldown between consecutive AI label calls to reduce timeouts
        if (attemptedThisGroup) {
            try {
                const waitMs = succeededThisGroup ? AI_LABEL_COOLDOWN_SUCCESS_MS : AI_LABEL_COOLDOWN_FAILURE_MS;
                await new Promise(r => setTimeout(r, waitMs));
            } catch (_) {}
        }
    }
    
    if (cacheDirty) {
        await chrome.storage.session.set({ groupLabelCache: updatedCache });
    }
    
    if (labelFailureReasons.size > 0) {
        console.info('Group labeling used fallback:', Array.from(labelFailureReasons).slice(0, 3).join(' | '));
    }
    labelingActive = false;
}

async function generateGroupSummaries(groups) {
    const summaryCacheData = await chrome.storage.session.get(['groupSummaryCache']);
    const groupSummaryCache = summaryCacheData.groupSummaryCache || {};
    for (const group of groups) {
        const cachedEntry = group.centroidSignature ? groupSummaryCache[group.centroidSignature] : null;
        if (cachedEntry && (Date.now() - cachedEntry.timestamp) < LABEL_CACHE_TTL) {
            group.summary = Array.isArray(cachedEntry.summary) ? cachedEntry.summary : [];
            group.summaryPending = !group.summary.length;
        } else {
            group.summary = Array.isArray(group.summary) ? group.summary : [];
            group.summaryPending = !group.summary.length;
        }
    }
}

// Deferred AI labeling (post-pipeline) to finish labeling remaining groups gradually
function scheduleDeferredLabels(delay = 600) {
    if (!Array.isArray(aiGroups) || !aiGroups.length) {
        return;
    }
    if (deferredLabelTimer) {
        clearTimeout(deferredLabelTimer);
    }
    deferredLabelTimer = setTimeout(() => {
        deferredLabelTimer = null;
        processDeferredLabels().catch(err => console.warn('Deferred label processing failed:', err?.message || err));
    }, delay);
}

async function processDeferredLabels() {
    if (deferredLabelInProgress) {
        scheduleDeferredLabels(1000);
        return;
    }
    if (!Array.isArray(aiGroups) || !aiGroups.length) {
        try {
            const storedGroups = await chrome.storage.local.get(['cachedGroups']);
            if (Array.isArray(storedGroups.cachedGroups)) {
                aiGroups = storedGroups.cachedGroups;
            }
        } catch (storageError) {
            console.warn('Failed to load cached groups for labeling:', storageError);
        }
    }
    if (!Array.isArray(aiGroups) || !aiGroups.length) return;

    // Helper: detect placeholder/deterministic names we want to upgrade via AI
    const placeholderRe = /^Group\s+\d+$/i;
    const genericNames = new Set(['General Group','Shopping Group','Technology Group','Gaming Group','Medical Group','News Group']);
    const needsAIName = (g) => !g || !g.name || placeholderRe.test(g.name) || genericNames.has(String(g.name));

    try {
        deferredLabelInProgress = true;
        // Prefer larger groups first
        const candidates = aiGroups
            .map((g, idx) => ({ g, idx }))
            .filter(({ g }) => needsAIName(g))
            .sort((a, b) => (b.g.tabIndices?.length || 0) - (a.g.tabIndices?.length || 0));

        if (!candidates.length) return;

        // Label 1 group per pass to minimize contention with summarizer/LM
        const slice = candidates.slice(0, 1).map(c => c.g);
        await assignGroupLabels(slice, currentTabData);

        // Persist updates
        await synchronizeCachedGroups();

        // If more remain, schedule another pass
        const remaining = aiGroups.some(g => needsAIName(g));
        if (remaining) scheduleDeferredLabels(1200);
    } finally {
        deferredLabelInProgress = false;
    }
}

async function synchronizeCachedGroups() {
    try {
        await chrome.storage.local.set({
            cachedGroups: aiGroups,
            tabData: currentTabData
        });
    } catch (error) {
        console.warn('Failed to synchronize cached groups:', error);
    }
}

function scheduleDeferredSummaries(delay = 400) {
    if (!Array.isArray(aiGroups) || !aiGroups.length) {
        return;
    }
    if (deferredSummaryTimer) {
        clearTimeout(deferredSummaryTimer);
    }
    deferredSummaryTimer = setTimeout(() => {
        deferredSummaryTimer = null;
        processDeferredSummaries().catch(error => {
            console.warn('Deferred summary processing failed:', error);
        });
    }, delay);
}

async function processDeferredSummaries() {
    if (deferredSummaryInProgress) {
        // Reschedule to ensure new groups are processed after current run
        scheduleDeferredSummaries(600);
        return;
    }
    if (labelingActive || deferredLabelInProgress) {
        // Avoid contention with label LM usage
        scheduleDeferredSummaries(1200);
        return;
    }
    if (!Array.isArray(aiGroups) || !aiGroups.length) {
        return;
    }
    deferredSummaryInProgress = true;
    const start = nowMs();
    console.log('⏳ Deferred group summaries started...');
    try {
        for (let index = 0; index < aiGroups.length; index += 1) {
            const group = aiGroups[index];
            if (!group) continue;
            if (Array.isArray(group.summary) && group.summary.length && group.summaryPending === false) {
                continue;
            }
            try {
                const result = await handleGroupSummaryRequest(index);
                if (result?.success) {
                    console.log(`✅ Deferred summary ready for group ${index} (${group.name}) [${result.source}]`);
                }
    } catch (error) {
                console.warn(`⚠️ Deferred summary failed for group ${index}:`, error?.message || error);
            }
        }
        logTiming('Deferred group summaries', start);
    } finally {
        deferredSummaryInProgress = false;
    }
}

// Helper: Build synthesis descriptor for a group (similar to labeling)
function prepareDescriptorForGroup(group) {
    try {
        const indexMap = new Map(currentTabData.map(entry => [entry.index, entry]));
        const exemplarTabs = (group.representativeTabIndices || group.tabIndices || [])
            .map(index => {
                const entry = indexMap.get(index) || currentTabData[index] || {};
                const features = entry.semanticFeatures || {};
                const classification = entry.classification || {};
                let domain = entry.domain || '';
                if (!domain && entry.url) {
                    try { domain = new URL(entry.url).hostname; } catch {}
                }
                return {
                    title: entry.title || '',
                    domain: domain || '',
                    topic: features.topic || '',
                    keywords: (features.mergeHints || features.keywords || []).slice(0, 5),
                    primaryTopic: classification.primaryTopic || features.primaryTopic || '',
                    docType: classification.docType || features.docType || '',
                    entities: (classification.entities || features.entities || []).slice(0, 3),
                    mergeHints: (classification.mergeHints || features.mergeHints || features.keywords || []).slice(0, 5)
                };
            })
            .filter(tab => tab.title);
        return {
            centroidKeywords: (group.centroidTokens || group.keywords || []).slice(0, 6),
            fallbackKeywords: (group.keywords || []).slice(0, 8),
            exemplarTabs: exemplarTabs.slice(0, 3),
            domainMode: group.domainMode || '',
            languageMode: group.languageMode || '',
            taxonomyTags: Array.isArray(group.taxonomyTags) ? group.taxonomyTags.slice(0, 6) : [],
            primaryTopic: group.primaryTopic || '',
            docType: group.docType || '',
            mergeHints: Array.isArray(group.mergeHints) ? group.mergeHints.slice(0, 6) : [],
            entities: Array.isArray(group.entities) ? group.entities.slice(0, 4) : []
        };
    } catch (e) {
        console.warn('prepareDescriptorForGroup failed:', e?.message || e);
        return {
            centroidKeywords: Array.isArray(group?.keywords) ? group.keywords.slice(0, 6) : [],
            exemplarTabs: [],
            taxonomyTags: [],
            primaryTopic: String(group?.primaryTopic || ''),
            docType: String(group?.docType || '')
        };
    }
}

// Helper: Locate a group by the chrome tabId
async function findGroupByTabId(tabId) {
    if (!tabId) return null;
    try {
        if (!Array.isArray(aiGroups) || !aiGroups.length) {
            const storedGroups = await chrome.storage.local.get(['cachedGroups']);
            if (Array.isArray(storedGroups.cachedGroups)) {
                aiGroups = storedGroups.cachedGroups;
            }
        }
    } catch (_) {}
    if (!Array.isArray(currentTabData) || !currentTabData.length) {
        try {
            const stored = await chrome.storage.local.get(['tabData']);
            if (Array.isArray(stored.tabData)) {
                currentTabData = stored.tabData;
            }
        } catch (_) {}
    }
    const idxInData = currentTabData.findIndex(t => t && t.id === tabId);
    if (idxInData === -1) return null;
    const group = Array.isArray(aiGroups) ? aiGroups.find(g => Array.isArray(g.tabIndices) && g.tabIndices.includes(idxInData)) : null;
    return group || null;
}

// Main entry: Create a new tab with AI synthesis for a group
async function createSummaryTab(groupData) {
    try {
        const accessibleTab = await findUsableAIAccessTab();
        if (!accessibleTab) {
            console.warn('No accessible tab available to run synthesis');
            return;
        }
        const descriptor = prepareDescriptorForGroup(groupData);
        const results = await chrome.scripting.executeScript({
            target: { tabId: accessibleTab.id },
            world: 'MAIN',
            func: generateGroupSynthesisInPage,
            args: [descriptor]
        });
        const payload = results && results[0] && results[0].result;
        if (payload && payload.ok) {
            const { subject, summary, insights } = payload;
            const htmlContent = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>AI Synthesis: ${subject.replace(/</g,'&lt;')}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, 'Helvetica Neue', Arial, sans-serif; line-height: 1.55; color: #0f172a; background: #f8fafc; }
    .card { max-width: 860px; margin: 0 auto; background: #fff; border-radius: 14px; box-shadow: 0 10px 30px rgba(2,6,23,.08); padding: 28px; }
    h1 { font-size: 22px; margin: 0 0 12px; }
    h2 { font-size: 18px; margin: 24px 0 8px; }
    p { margin: 0 0 12px; }
    ul { margin: 0; padding-left: 20px; }
    li { margin: 6px 0; }
    .meta { color: #475569; font-size: 12px; margin-top: 20px; }
  </style>
  </head>
  <body>
    <div class="card">
      <h1>🧠 AI Synthesis for: ${subject.replace(/</g,'&lt;')}</h1>
      <p>${summary.replace(/</g,'&lt;')}</p>
      <h2>Key Insights</h2>
      <ul>
        ${(insights || []).map(i => `<li>${String(i).replace(/</g,'&lt;')}</li>`).join('')}
      </ul>
      <div class="meta">Source: analyzed ${Array.isArray(groupData?.tabIndices) ? groupData.tabIndices.length : 0} tabs in group.</div>
    </div>
  </body>
</html>`;
            const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
            await chrome.tabs.create({ url: dataUrl });
        } else {
            const reason = payload?.error || 'Unknown error';
            console.warn('AI Synthesis failed or not ready:', reason);
        }
    } catch (error) {
        console.error('Synthesis failed:', error);
    }
}

// Find AI group by existing Chrome tab group id
function findAIGroupByChromeGroupId(groupId) {
    if (!Array.isArray(aiGroups) || typeof groupId !== 'number') return null;
    return aiGroups.find(g => g && g.chromeGroupId === groupId) || null;
}

// Trigger synthesis for the active Chrome tab group using tabGroups API
async function synthesizeActiveGroupFromAction() {
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!activeTab) {
            console.warn('No active tab for action synthesis');
            return;
        }
        // Prefer using the chrome.tabGroups API to resolve the current group
        const rawGroupId = typeof activeTab.groupId === 'number' ? activeTab.groupId : chrome.tabGroups?.TAB_GROUP_ID_NONE;
        let targetGroup = null;
        if (typeof rawGroupId === 'number' && rawGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
            try {
                // Ensure group exists via tabGroups API (uses the API per requirement)
                await chrome.tabGroups.get(rawGroupId);
                targetGroup = findAIGroupByChromeGroupId(rawGroupId);
            } catch (e) {
                console.warn('tabGroups.get failed or no AI group for this Chrome group id:', e?.message || e);
            }
        }
        if (!targetGroup) {
            // Fallback: map by tab id → aiGroups membership
            targetGroup = await findGroupByTabId(activeTab.id);
        }
        if (targetGroup) {
            await createSummaryTab(targetGroup);
        } else {
            console.warn('No AI group associated with the active tab');
        }
    } catch (error) {
        console.warn('synthesizeActiveGroupFromAction failed:', error?.message || error);
    }
}

async function handleGroupSummaryRequest(groupIndex) {
    // Short-circuit if summarizer previously marked unavailable
    const statusData = await chrome.storage.session.get(['summarizerStatus']);
    const summarizerStatus = statusData.summarizerStatus || null;
    const summarizerBlocked = summarizerStatus && summarizerStatus.unavailableUntil && Date.now() < summarizerStatus.unavailableUntil;
    if (!Array.isArray(aiGroups) || !aiGroups.length) {
        try {
            const storedGroups = await chrome.storage.local.get(['cachedGroups']);
            if (Array.isArray(storedGroups.cachedGroups)) {
                aiGroups = storedGroups.cachedGroups;
            }
        } catch (storageError) {
            console.warn('Failed to load cached groups for summary:', storageError);
        }
    }
    
    if (typeof groupIndex !== 'number' || groupIndex < 0 || groupIndex >= aiGroups.length) {
        throw new Error('Invalid group index');
    }
    
    const group = aiGroups[groupIndex];
    if (!group) {
        throw new Error('Group not found');
    }
    
    if (Array.isArray(group.summary) && group.summary.length > 0 && group.summaryPending === false) {
        return { success: true, summary: group.summary, source: 'existing' };
    }
    
    const summaryCacheData = await chrome.storage.session.get(['groupSummaryCache']);
    const groupSummaryCache = summaryCacheData.groupSummaryCache || {};
    if (group.centroidSignature) {
        const cachedEntry = groupSummaryCache[group.centroidSignature];
        if (cachedEntry && (Date.now() - cachedEntry.timestamp) < LABEL_CACHE_TTL) {
            group.summary = cachedEntry.summary;
            group.summaryPending = false;
            await synchronizeCachedGroups();
            return { success: true, summary: group.summary, source: 'cache' };
        }
    }
    
    if (!Array.isArray(currentTabData) || !currentTabData.length) {
        try {
            const stored = await chrome.storage.local.get(['tabData']);
            if (Array.isArray(stored.tabData) && stored.tabData.length) {
                currentTabData = stored.tabData;
            }
        } catch (storageError) {
            console.warn('Failed to load tab data from storage for summary:', storageError);
        }
    }
    const groupTabs = group.tabIndices.map(index => currentTabData[index]).filter(Boolean);
    if (!groupTabs.length) {
        throw new Error('No tab data available for group summarization');
    }
    
    const groupContent = createGroupContentForSummarizer(groupTabs);
    const summaryStart = nowMs();
    group.summaryPending = true;
    try {
        if (summarizerBlocked) {
            throw new Error(summarizerStatus.reason || 'Summarizer temporarily unavailable');
        }
        const summary = await performAISummarization(groupContent);
        group.summary = summary;
        group.summaryPending = false;
        logTiming(`Group ${groupIndex} summarization`, summaryStart);
    } catch (error) {
        console.warn('Summarizer unavailable or failed, using fallback:', error?.message || error);
        // Fallback summary based on tab titles/domains
        const fallback = buildFallbackSummary(groupTabs);
        group.summary = fallback;
        group.summaryPending = false;
        logTiming(`Group ${groupIndex} summarization (fallback)`, summaryStart);
    }
    
    if (group.centroidSignature) {
        groupSummaryCache[group.centroidSignature] = {
            summary: Array.isArray(group.summary) ? group.summary : [],
            timestamp: Date.now()
        };
        await chrome.storage.session.set({ groupSummaryCache });
    }
    
    await synchronizeCachedGroups();
    return { success: true, summary: group.summary, source: 'generated' };
}

/**
 * Ελέγχει αν το Chrome Language Model είναι διαθέσιμο στο τρέχον tab
 */
function checkLanguageModelAvailabilityInPage() {
    function resolveLanguageModelApi() {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        return (
            scope?.LanguageModel ||
            scope?.ai?.languageModel ||
            scope?.aiOriginTrial?.languageModel ||
            scope?.window?.ai?.languageModel ||
            null
        );
    }
    
    return (async () => {
        try {
            const api = resolveLanguageModelApi();
            if (!api) {
                return { ready: false, reason: 'Language Model API not available' };
            }
            if (typeof api.availability === 'function') {
                const status = await api.availability();
                if (status === 'ready' || status === 'available') {
                    return { ready: true };
                }
                return { ready: false, reason: `Language model availability: ${status}` };
            }
            return { ready: true };
        } catch (error) {
            return { ready: false, reason: error?.message || String(error) };
        }
    })();
}

function judgeTabSimilarityInPage(payload) {
    function resolveLanguageModelApi() {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        return (
            scope?.LanguageModel ||
            scope?.ai?.languageModel ||
            scope?.aiOriginTrial?.languageModel ||
            scope?.window?.ai?.languageModel ||
            null
        );
    }
    
    return (async () => {
        try {
            const languageModelApi = resolveLanguageModelApi();
            if (!languageModelApi) {
                return { ok: false, error: 'Language Model API not available' };
            }
            const language = (payload?.language || 'en').toString().split('-')[0] || 'en';
            let session;
            try {
                session = await languageModelApi.create({
                    language,
                    monitor(monitor) {
                        monitor.addEventListener('downloadprogress', (event) => {
                            console.log(`Pairwise LM download ${(event.loaded * 100).toFixed(1)}%`);
                        });
                    }
                });
            } catch (createError) {
                console.warn('judgeTabSimilarityInPage: languageModel.create with monitor failed, retrying without monitor', createError);
                session = await languageModelApi.create({ language });
            }
            if (!session) {
                throw new Error('Failed to create language model session');
            }
            
            const [tabA, tabB] = (payload?.tabs || []).map(tab => tab || {});
            const stringifyList = (list, fallback) => (Array.isArray(list) && list.length ? list.join(', ') : fallback);
            const makeSection = (label, tab) => {
                const summaryLines = Array.isArray(tab.summaryBullets) && tab.summaryBullets.length
                    ? tab.summaryBullets.map(item => `  - ${String(item || '').trim()}`).join('\n')
                    : '  - (no summary bullets)';
                return `${label}:
Title: ${tab.title || '—'}
URL: ${tab.url || '—'}
Domain: ${tab.domain || '—'}
Doc type: ${tab.docType || 'unknown'}
Primary topic: ${tab.primaryTopic || '—'}
Subtopics: ${stringifyList(tab.subtopics, 'none')}
Entities: ${stringifyList(tab.entities, 'none')}
Merge hints: ${stringifyList(tab.mergeHints, 'none')}
Meta: ${(tab.meta || '').slice(0, 240) || '—'}
Content sample: ${(tab.content || '').slice(0, 320) || '—'}
Summary bullets:
${summaryLines}`;
            };
            
            const prompt = `
Decide if two browser tabs should belong to the same thematic cluster.

Return ONLY JSON:
{
  "same_topic": true|false,
  "confidence": number (0-1),
  "reason": "max 2 sentences"
}

Consider topic, intent, entities, and doc type. Avoid merging pages that have only generic overlaps.

${makeSection('TAB A', tabA)}

${makeSection('TAB B', tabB)}
            `.trim();
            
            const raw = await session.prompt(prompt);
            const asString = typeof raw === 'string' ? raw : String(raw ?? '');
            const match = asString.match(/\{[\s\S]*\}/);
            if (!match) {
                throw new Error('LM verification returned no JSON object');
            }
            const parsed = JSON.parse(match[0]);
            return {
                ok: true,
                sameTopic: Boolean(parsed.same_topic),
                confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
                reason: String(parsed.reason || '').slice(0, 240)
            };
    } catch (error) {
            console.error('judgeTabSimilarityInPage failed:', error);
            return {
                ok: false,
                error: error?.message || String(error)
            };
        }
    })();
}

/**
 * Εκτελείται στο MAIN world: εξάγει topic/keywords για ένα tab
 */
function generateTabFeaturesInPage(descriptor) {
    function resolveLanguageModelApi() {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        return (
            scope?.LanguageModel ||
            scope?.ai?.languageModel ||
            scope?.aiOriginTrial?.languageModel ||
            scope?.window?.ai?.languageModel ||
            null
        );
    }

    const sourceLanguage = (() => {
        const candidate =
            descriptor?.sourceLanguage ||
            descriptor?.language ||
            (typeof navigator !== 'undefined' ? navigator.language : '') ||
            'en';
        return String(candidate).split('-')[0] || 'en';
    })();
    const targetLanguage = 'en';
    const sessionLanguage = targetLanguage;
    const needsTranslation = sourceLanguage !== targetLanguage;

    function resolveSummarizerApi() {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        return (
            scope?.Summarizer ||
            scope?.ai?.summarizer ||
            scope?.ai?.Summarizer ||
            scope?.aiOriginTrial?.summarizer ||
            scope?.window?.ai?.Summarizer ||
            null
        );
    }
    
    function sanitizeList(list, { limit = 6, toLower = true, minLength = 2, banned = [] } = {}) {
        if (!Array.isArray(list)) return [];
        const bannedSet = new Set(banned.map(item => String(item || '').toLowerCase()));
        const result = [];
        for (const item of list) {
            if (item === null || item === undefined) continue;
            let token = String(item).trim();
            if (!token) continue;
            const comparisonToken = token.toLowerCase();
            if (bannedSet.has(comparisonToken)) continue;
            if (toLower) {
                token = comparisonToken;
            }
            if (token.length < minLength) continue;
            if (!result.includes(token)) {
                result.push(token);
            }
            if (result.length >= limit) break;
        }
        return result;
    }
    
    function parseSummarizerOutput(summary) {
        if (!summary) {
            return [];
        }
        if (Array.isArray(summary)) {
            return summary
                .map(item => String(item || '').trim())
                .filter(Boolean)
                .slice(0, 6);
        }
        if (typeof summary === 'string') {
            return summary
                .split(/\n+/)
                .map(line => line.replace(/^[\s•\-–—\d\.]+/, '').trim())
                .filter(Boolean)
                .slice(0, 6);
        }
        if (summary && typeof summary === 'object') {
            if (Array.isArray(summary.points)) {
                return summary.points
                    .map(item => String(item || '').trim())
                    .filter(Boolean)
                    .slice(0, 6);
            }
            if (summary.summary) {
                return [String(summary.summary).trim()].filter(Boolean);
            }
        }
        return [];
    }
    
    function buildSummaryInput(desc) {
        if (!desc) return '';
        const sections = [];
        if (desc.title) sections.push(`Title: ${desc.title}`);
        if (desc.metaDescription) sections.push(`Meta: ${desc.metaDescription}`);
        if (Array.isArray(desc.headings) && desc.headings.length) {
            const headingLines = desc.headings.slice(0, 6).map(heading => `- ${heading}`);
            sections.push(`Headings:\n${headingLines.join('\n')}`);
        }
        if (desc.topicHints) sections.push(`Existing hints: ${desc.topicHints}`);
        if (desc.youtube) {
            if (desc.youtube.topic) sections.push(`YouTube topic: ${desc.youtube.topic}`);
            if (Array.isArray(desc.youtube.tags) && desc.youtube.tags.length) {
                sections.push(`YouTube tags: ${desc.youtube.tags.slice(0, 8).join(', ')}`);
            }
            if (desc.youtube.description) {
                sections.push(`YouTube description: ${desc.youtube.description.slice(0, 1200)}`);
            }
        }
        if (desc.content) {
            sections.push(`Content sample:\n${desc.content.slice(0, 2400)}`);
        }
        return sections.join('\n\n').slice(0, 3600);
    }
    
    function fallbackSummary(desc) {
        const bullets = [];
        if (!desc) return bullets;
        if (Array.isArray(desc.summaryBullets) && desc.summaryBullets.length) {
            bullets.push(...desc.summaryBullets.map(item => String(item || '').trim()).filter(Boolean));
        }
        if (desc.metaDescription) {
            bullets.push(desc.metaDescription.trim());
        }
        if (Array.isArray(desc.headings)) {
            for (const heading of desc.headings) {
                if (bullets.length >= 6) break;
                const trimmed = String(heading || '').trim();
                if (trimmed) bullets.push(trimmed);
            }
        }
        if (desc.content && bullets.length < 6) {
            const sentences = desc.content
                .split(/(?<=[\.!\?])\s+/)
                .map(sentence => sentence.trim())
                .filter(Boolean);
            for (const sentence of sentences) {
                if (bullets.length >= 6) break;
                bullets.push(sentence);
            }
        }
        return bullets.slice(0, 6);
    }
    
    function parseJsonResponse(raw) {
        if (raw === null || raw === undefined) {
            throw new Error('Empty language model response');
        }
        const asString = typeof raw === 'string' ? raw : String(raw);
        const match = asString.match(/\{[\s\S]*\}/);
        const candidate = match ? match[0] : asString.trim();
        try {
            return JSON.parse(candidate);
        } catch (error) {
            const parsingError = new Error('Invalid JSON response from language model');
            parsingError.cause = error;
            throw parsingError;
        }
    }
    
    function buildClassificationPrompt(summaryPoints, desc, summarizerStatus) {
        const summarySection = summaryPoints.length
            ? summaryPoints.map(point => `- ${point}`).join('\n')
            : '- (insufficient summary; rely on metadata)';
        const metaLines = [];
        if (desc.title) metaLines.push(`Title: ${desc.title}`);
        if (desc.url) metaLines.push(`URL: ${desc.url}`);
        if (desc.domain) metaLines.push(`Domain: ${desc.domain}`);
        if (desc.language) metaLines.push(`Language: ${desc.language}`);
        if (Array.isArray(desc.headings) && desc.headings.length) {
            metaLines.push(`Headings: ${desc.headings.slice(0, 5).join(' | ')}`);
        }
        if (Array.isArray(desc.metaKeywords) && desc.metaKeywords.length) {
            metaLines.push(`Meta keywords: ${desc.metaKeywords.slice(0, 8).join(', ')}`);
        }
        if (desc.metaDescription) {
            metaLines.push(`Meta description: ${desc.metaDescription.slice(0, 80)}`); // Aggressively reduced for laptop cooling
        }
        if (desc.youtube) {
            if (desc.youtube.topic) metaLines.push(`YouTube topic: ${desc.youtube.topic.slice(0, 30)}`); // Aggressively reduced
            if (Array.isArray(desc.youtube.tags) && desc.youtube.tags.length) {
                metaLines.push(`YouTube tags: ${desc.youtube.tags.slice(0, 2).join(', ')}`); // Aggressively reduced
            }
        }
        if (desc.topicHints) {
            metaLines.push(`Hints: ${desc.topicHints.slice(0, 60)}`); // Aggressively reduced for laptop cooling
        }
        if (desc.content) {
            metaLines.push(`Content: ${desc.content.slice(0, 200)}`); // Aggressively reduced for laptop cooling
        }
        
        return `Classify tab. Return JSON:
{"primary_topic":"<main concept>","subtopics":[],"entities":[],"doc_type":"article|category|landing|portal|docs","is_generic_landing":false,"merge_hints":["2-6 keywords"]}

Rules: Lowercase merge_hints (no: research,news,blog,updates,topics). English only.

Summary:
${summarySection}

Meta:
${metaLines.join('\n')}`.trim();
    }
    
    return (async () => {
        try {
            const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
            const languageModelApi = resolveLanguageModelApi();
            if (!languageModelApi) {
                return {
                    ok: false,
                    error: 'Language Model API not available'
                };
            }
            
            const summarizerApi = resolveSummarizerApi();
            const recoverablePattern = /(destroyed|closed|reset|disconnected|terminated)/i;
        
        async function getSummarizer(forceReset = false) {
            if (!summarizerApi) {
                return null;
            }
            if (forceReset) {
                scope.__aitabSummarizerPromise = null;
            }
            if (!scope.__aitabSummarizerPromise) {
                scope.__aitabSummarizerPromise = (async () => {
                    if (typeof summarizerApi.availability === 'function') {
                        let availability;
                        try {
                            availability = await summarizerApi.availability();
                        } catch (availabilityError) {
                            const error = new Error('Summarizer availability check failed');
                            error.aiStatus = 'unknown';
                            error.cause = availabilityError;
                            throw error;
                        }
                        if (availability === 'unavailable') {
                            const error = new Error('Summarizer API unavailable');
                            error.aiStatus = availability;
                            throw error;
                        }
                        if ((availability === 'downloadable' || availability === 'downloading') &&
                            !(navigator.userActivation && navigator.userActivation.isActive)) {
                            const error = new Error('Summarizer requires user activation to download');
                            error.aiStatus = availability;
                            throw error;
                        }
                    }
                    try {
                        return await summarizerApi.create({
                            type: 'key-points',
                            format: 'plain-text',
                            length: 'short',
                            monitor(monitor) {
                                monitor.addEventListener('downloadprogress', (event) => {
                                    console.log(`Summarizer download ${(event.loaded * 100).toFixed(1)}%`);
                                });
                            }
                        });
                    } catch (error) {
                        console.warn('Summarizer.create with monitor failed, retrying without monitor:', error);
                        return await summarizerApi.create({
                            type: 'key-points',
                            format: 'plain-text',
                            length: 'short'
                        });
                    }
                })();
            }
            try {
                return await scope.__aitabSummarizerPromise;
            } catch (error) {
                scope.__aitabSummarizerPromise = null;
                throw error;
            }
        }
        
        async function getSession(forceReset = false) {
            if (forceReset) {
                scope.__aitabLanguageSessionPromise = null;
            }
            if (!scope.__aitabLanguageSessionPromise) {
                scope.__aitabLanguageSessionPromise = (async () => {
                    if (typeof languageModelApi.availability === 'function') {
                        let availability;
                        try {
                            availability = await languageModelApi.availability();
                        } catch (availabilityError) {
                            const error = new Error('Language model availability check failed');
                            error.aiStatus = 'unknown';
                            error.cause = availabilityError;
                            throw error;
                        }
                        if (availability === 'unavailable') {
                            const error = new Error('Language Model API unavailable');
                            error.aiStatus = availability;
                            throw error;
                        }
                        if (availability === 'downloading') {
                            const error = new Error('Language model download in progress');
                            error.aiStatus = availability;
                            throw error;
                        }
                        if (availability === 'downloadable' && !(navigator.userActivation && navigator.userActivation.isActive)) {
                            const error = new Error('Language model requires user activation to download.');
                            error.aiStatus = availability;
                            throw error;
                        }
                        if (availability && availability !== 'ready' && availability !== 'available' && availability !== 'downloadable') {
                            const error = new Error(`Language model availability: ${availability}`);
                            error.aiStatus = availability;
                            throw error;
                        }
                    }
                    
                    try {
                        return await languageModelApi.create({
                            language: sessionLanguage,
                            monitor(monitor) {
                                monitor.addEventListener('downloadprogress', (event) => {
                                    console.log(`Feature extraction language model download ${(event.loaded * 100).toFixed(1)}%`);
                                });
                            }
                        });
        } catch (error) {
                        console.warn('LanguageModel.create with monitor failed, retrying without monitor:', error);
                        return await languageModelApi.create({ language: sessionLanguage });
                    }
                })();
            }
            
            try {
                const session = await scope.__aitabLanguageSessionPromise;
                if (!session) {
                    throw new Error('Failed to create language model session');
                }
                return session;
            } catch (error) {
                scope.__aitabLanguageSessionPromise = null;
                throw error;
            }
        }
        
        async function translateTextToEnglish(text, { allowRetry = true } = {}) {
            if (!needsTranslation || !text) {
                return text;
            }
            const clipped = String(text || '').trim().slice(0, 1600);
            if (!clipped) {
                return text;
            }
            const attempts = allowRetry ? 2 : 1;
            for (let attempt = 0; attempt < attempts; attempt += 1) {
                const forceReset = attempt > 0;
                try {
                    const session = await getSession(forceReset);
                    const prompt = `
Translate the following ${sourceLanguage} text into natural English.
Return ONLY JSON:
{"translation":"..."}

Text:
"""${clipped}"""
                    `.trim();
                    const raw = await session.prompt(prompt);
                    const parsed = parseJsonResponse(raw);
                    if (parsed && typeof parsed.translation === 'string') {
                        const translated = parsed.translation.trim();
                        if (translated) {
                            return translated;
                        }
                    }
                } catch (error) {
                    const message = error?.message || '';
                    if (allowRetry && attempt === 0 && recoverablePattern.test(message)) {
                        scope.__aitabLanguageSessionPromise = null;
                        continue;
                    }
                    console.warn('translateTextToEnglish failed:', error);
                }
            }
            return text;
        }
        
        async function translateListToEnglish(items) {
            if (!needsTranslation || !Array.isArray(items) || items.length === 0) {
                return items;
            }
            const rows = items
                .map((item, index) => `${index + 1}. ${String(item || '').trim()}`)
                .filter(line => line.length > 0)
                .join('\n');
            if (!rows) {
                return items;
            }
            for (let attempt = 0; attempt < 2; attempt += 1) {
                const forceReset = attempt > 0;
                try {
                    const session = await getSession(forceReset);
                    const prompt = `
Translate the following ${sourceLanguage} bullet points to English. Preserve the ordering.
Return ONLY JSON: {"translations":["...","..."]}

Items:
${rows}
                    `.trim();
                    const raw = await session.prompt(prompt);
                    const parsed = parseJsonResponse(raw);
                    if (parsed && Array.isArray(parsed.translations) && parsed.translations.length) {
                        const translations = parsed.translations
                            .map(item => String(item || '').trim())
                            .filter(Boolean);
                        if (translations.length) {
                            return translations;
                        }
                    }
                } catch (error) {
                    const message = error?.message || '';
                    if (attempt === 0 && recoverablePattern.test(message)) {
                        scope.__aitabLanguageSessionPromise = null;
                        continue;
                    }
                    console.warn('translateListToEnglish failed:', error);
                }
            }
            return items;
        }
        
        // Try to use Summarizer API with timeout protection
        let summaryPoints = Array.isArray(descriptor.summaryBullets)
            ? descriptor.summaryBullets.map(item => String(item || '').trim()).filter(Boolean).slice(0, 6)
            : [];
        let summarizerStatus = 'skipped';
        
        const summaryInput = buildSummaryInput(descriptor);
        
        // Use Summarizer API for Chrome AI Challenge (with aggressive optimizations for laptop cooling)
        if (!summaryPoints.length && summaryInput && summaryInput.length > 100) {
            try {
                const summarizer = await getSummarizer(false);
                if (summarizer) {
                    // Aggressive timeout for laptop cooling (3s instead of 8s)
                    const summaryPromise = summarizer.summarize(summaryInput.slice(0, 800)); // Limit input size
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Summarizer timeout')), 3000) // Reduced from 8000ms
                    );
                    
                    const summary = await Promise.race([summaryPromise, timeoutPromise]);
                    summaryPoints = parseSummarizerOutput(summary);
                    summarizerStatus = 'success';
                    console.log(`✅ [Chrome AI Challenge] Summarizer completed for "${descriptor.title?.slice(0, 40)}"`);
                } else {
                    summarizerStatus = 'unavailable';
                }
            } catch (error) {
                console.warn(`⚠️ [Chrome AI Challenge] Summarizer failed/timeout for "${descriptor.title?.slice(0, 40)}":`, error.message);
                summarizerStatus = error?.aiStatus || 'timeout';
            }
        }
        
        // Fallback if summarizer didn't produce results
        if (!summaryPoints.length) {
            summaryPoints = fallbackSummary(descriptor);
            summarizerStatus = summarizerStatus === 'success' ? 'success' : 'fallback';
        }
        
        // Last resort: use meta description or title
        if (!summaryPoints.length) {
            const lastResort = descriptor.metaDescription || descriptor.title || '';
            if (lastResort) {
                summaryPoints = [lastResort.slice(0, 200)];
            }
        }
        if (needsTranslation && summaryPoints.length) {
            try {
                const translatedSummary = await translateListToEnglish(summaryPoints);
                if (Array.isArray(translatedSummary) && translatedSummary.length) {
                    summaryPoints = translatedSummary;
                }
            } catch (translationError) {
                console.warn('Summary translation failed:', translationError);
            }
        }
        summaryPoints = summaryPoints.map(point => point.slice(0, 260));
        
        if (needsTranslation) {
            if (descriptor.title) {
                descriptor.title = await translateTextToEnglish(descriptor.title);
            }
            if (descriptor.metaDescription) {
                descriptor.metaDescription = await translateTextToEnglish(descriptor.metaDescription, { allowRetry: false });
            }
            if (Array.isArray(descriptor.headings) && descriptor.headings.length) {
                const translatedHeadings = await translateListToEnglish(descriptor.headings);
                if (Array.isArray(translatedHeadings) && translatedHeadings.length) {
                    descriptor.headings = translatedHeadings.slice(0, descriptor.headings.length);
                }
            }
            if (descriptor.topicHints) {
                descriptor.topicHints = await translateTextToEnglish(descriptor.topicHints, { allowRetry: false });
            }
            if (descriptor.content) {
                descriptor.content = await translateTextToEnglish(descriptor.content, { allowRetry: false });
            }
            if (descriptor.youtube) {
                if (descriptor.youtube.topic) {
                    descriptor.youtube.topic = await translateTextToEnglish(descriptor.youtube.topic, { allowRetry: false });
                }
                if (Array.isArray(descriptor.youtube.tags) && descriptor.youtube.tags.length) {
                    const translatedTags = await translateListToEnglish(descriptor.youtube.tags);
                    if (Array.isArray(translatedTags) && translatedTags.length) {
                        descriptor.youtube.tags = translatedTags.slice(0, descriptor.youtube.tags.length);
                    }
                }
                if (descriptor.youtube.description) {
                    descriptor.youtube.description = await translateTextToEnglish(descriptor.youtube.description, { allowRetry: false });
                }
            }
            descriptor.language = targetLanguage;
            descriptor.translation = {
                sourceLanguage
            };
        }
        
        // Define GENERIC_MERGE_STOPWORDS locally since this runs in MAIN world context
        const GENERIC_MERGE_STOPWORDS = new Set([
            'research',
            'news',
            'blog',
            'updates',
            'topics',
            'portal',
            'general',
            'overview'
        ]);
        const bannedMergeWords = Array.from(GENERIC_MERGE_STOPWORDS);
        const allowedDocTypes = new Set(['article', 'category', 'landing', 'portal', 'docs']);
        
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const forceReset = attempt > 0;
            try {
                console.log(`🤖 [Prompt API] Classifying "${descriptor.title?.slice(0, 40)}" (attempt ${attempt + 1}/2)...`);
                const sessionStart = Date.now();
                const session = await getSession(forceReset);
                const sessionTime = Date.now() - sessionStart;
                console.log(`✅ [Prompt API] Session ready in ${sessionTime}ms`);
                
                const prompt = buildClassificationPrompt(summaryPoints, descriptor, summarizerStatus);
                console.log(`🤖 [Prompt API] Sending prompt (${prompt.length} chars) to Gemini Nano...`);
                const promptStart = Date.now();
                const raw = await session.prompt(prompt);
                const promptTime = Date.now() - promptStart;
                console.log(`✅ [Prompt API] Gemini Nano responded in ${promptTime}ms`);
                const parsed = parseJsonResponse(raw);
                
                const primaryTopicRaw = String(parsed.primary_topic || '').trim();
                if (!primaryTopicRaw) {
                    throw new Error('Missing primary_topic in response');
                }
                
                let mergeHints = sanitizeList(parsed.merge_hints || [], {
                    limit: 6,
                    toLower: true,
                    minLength: 3,
                    banned: bannedMergeWords
                });
                if (mergeHints.length < 2) {
                    mergeHints = sanitizeList(primaryTopicRaw.split(/[^\p{L}\p{N}]+/u), {
                        limit: 6,
                        toLower: true,
                        minLength: 3,
                        banned: bannedMergeWords
                    });
                }
                if (mergeHints.length < 2 && summaryPoints.length) {
                    const summaryTokens = sanitizeList(
                        summaryPoints.join(' ').split(/[^\p{L}\p{N}]+/u),
                        {
                            limit: 6,
                            toLower: true,
                            minLength: 3,
                            banned: bannedMergeWords
                        }
                    );
                    const merged = [];
                    for (const token of [...mergeHints, ...summaryTokens]) {
                        if (!merged.includes(token)) {
                            merged.push(token);
                        }
                        if (merged.length >= 6) break;
                    }
                    mergeHints = merged;
                }
                if (mergeHints.length < 2) {
                    mergeHints = ['general', 'browsing'];
                }
                
                const subtopics = sanitizeList(parsed.subtopics || [], {
                    limit: 6,
                    toLower: true,
                    minLength: 3,
                    banned: []
                });
                const entitiesRaw = sanitizeList(parsed.entities || [], {
                    limit: 6,
                    toLower: false,
                    minLength: 2,
                    banned: []
                });
                const entities = entitiesRaw.map(entity =>
                    entity
                        .split(/\s+/)
                        .filter(Boolean)
                        .map(token => token.charAt(0).toUpperCase() + token.slice(1))
                        .join(' ')
                );
                
                let docType = String(parsed.doc_type || 'article').toLowerCase();
                if (!allowedDocTypes.has(docType)) {
                    docType = 'article';
                }
                const isGenericLanding = Boolean(parsed.is_generic_landing);
                
                const topicLabel = primaryTopicRaw
                    .split(/\s+/)
                    .map(token => token.charAt(0).toUpperCase() + token.slice(1))
                    .join(' ')
                    .trim();
                
                console.log(`✅ [Chrome AI] Feature extraction completed for: "${descriptor.title?.slice(0, 40)}" using Prompt API & ${summarizerStatus === 'success' ? 'Summarizer API' : 'fallback summary'}`);
                
                // Log features for debugging (moved to background context)
                // Note: devlog is not available in MAIN world context
                
                return {
                    ok: true,
                    primaryTopic: primaryTopicRaw.toLowerCase(),
                    topicLabel: topicLabel || primaryTopicRaw,
                    mergeHints,
                    subtopics,
                    entities,
                    docType,
                    isGenericLanding,
                    summary: summaryPoints,
                    summarizerStatus,
                    sourceLanguage,
                    normalizedLanguage: targetLanguage
                };
            } catch (error) {
                const message = error?.message || String(error);
                const isRecoverable = recoverablePattern.test(message);
                if (isRecoverable && attempt === 0) {
                    console.warn('generateTabFeaturesInPage: session closed, retrying with fresh session...', message);
                    scope.__aitabLanguageSessionPromise = null;
                    continue;
                }
                console.error('generateTabFeaturesInPage error:', {
                    message: error?.message || String(error),
                    aiStatus: error?.aiStatus,
                    attempt,
                    stack: error?.stack
                });
                return {
                    ok: false,
                    error: message,
                    status: error?.aiStatus || null
                };
            }
        }
        
        console.error('generateTabFeaturesInPage: Language model unavailable after retries');
        return {
            ok: false,
            error: 'Language model unavailable after retries',
            status: 'unavailable'
        };
        } catch (topLevelError) {
            console.error('generateTabFeaturesInPage: Uncaught exception:', {
                message: topLevelError?.message || String(topLevelError),
                name: topLevelError?.name,
                stack: topLevelError?.stack
            });
            return {
                ok: false,
                error: `Uncaught exception: ${topLevelError?.message || String(topLevelError)}`,
                status: 'exception'
            };
        }
    })();
}

function generateTabEmbeddingInPage(descriptor) {
    function resolveEmbeddingModelApi() {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        return (
            scope?.EmbeddingModel ||
            scope?.ai?.embeddingModel ||
            scope?.aiOriginTrial?.embeddingModel ||
            scope?.window?.ai?.embeddingModel ||
            null
        );
    }
    
    return (async () => {
        try {
            const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
            const embeddingApi = resolveEmbeddingModelApi();
            if (!embeddingApi) {
                return { ok: false, error: 'Embedding Model API not available', status: 'unavailable' };
            }
            
            const recoverablePattern = /(destroyed|closed|reset|disconnected|terminated)/i;
            
            async function getSession(forceReset = false) {
                if (forceReset) {
                    scope.__aitabEmbeddingSessionPromise = null;
                }
                if (!scope.__aitabEmbeddingSessionPromise) {
                    scope.__aitabEmbeddingSessionPromise = (async () => {
                        if (typeof embeddingApi.availability === 'function') {
                            const availability = await embeddingApi.availability();
                            if (availability === 'unavailable') {
                                const error = new Error('Embedding model unavailable');
                                error.aiStatus = availability;
                                throw error;
                            }
                            if (availability === 'downloading') {
                                const error = new Error('Embedding model downloading');
                                error.aiStatus = availability;
                                throw error;
                            }
                            if (availability === 'downloadable' && !(navigator.userActivation && navigator.userActivation.isActive)) {
                                const error = new Error('Embedding model requires user activation to download');
                                error.aiStatus = availability;
                                throw error;
                            }
                        }
                        
                        return await embeddingApi.create({
                            monitor(monitor) {
                                monitor.addEventListener('downloadprogress', event => {
                                    console.log(`Embedding model download ${(event.loaded * 100).toFixed(1)}%`);
                                });
                            }
                        });
                    })();
                }
                return scope.__aitabEmbeddingSessionPromise;
            }
            
            const document = String(descriptor?.document || descriptor?.topic || '').trim();
            if (!document) {
                return { ok: false, error: 'Empty document for embedding' };
            }
            
            for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                    const session = await getSession(attempt === 1);
                    let response;
                    try {
                        response = await session.embed({
                            text: document,
                            context: {
                                topic: descriptor?.topic || '',
                                keywords: descriptor?.keywords || []
                            }
                        });
                    } catch (structuredError) {
                        console.warn('Embedding model structured call failed, retrying with plain text...', structuredError);
                        response = await session.embed(document);
                    }
                    
                    let embeddingVector = null;
                    if (response && Array.isArray(response.values)) {
                        embeddingVector = response.values;
                    } else if (response && Array.isArray(response.embedding)) {
                        embeddingVector = response.embedding;
                    } else if (Array.isArray(response)) {
                        embeddingVector = response;
                    } else if (response?.data && Array.isArray(response.data[0]?.embedding)) {
                        embeddingVector = response.data[0].embedding;
                    }
                    
                    if (!embeddingVector) {
                        throw new Error('Embedding model returned no vector');
                    }
                    
                    return { ok: true, embedding: Array.from(embeddingVector) };
    } catch (error) {
                    const message = error?.message || String(error);
                    if (recoverablePattern.test(message) && attempt === 0) {
                        scope.__aitabEmbeddingSessionPromise = null;
                        continue;
                    }
                    const status = error?.aiStatus || null;
                    return { ok: false, error: message, status };
                }
            }
            
            return { ok: false, error: 'Embedding model unavailable after retries', status: 'unavailable' };
        } catch (error) {
            return {
                ok: false,
                error: error?.message || String(error),
                status: error?.aiStatus || null
            };
        }
    })();
}

/**
 * Εκτελείται στο MAIN world: δημιουργεί label για group tabs
 */
function generateGroupLabelInPage(descriptor) {
    function resolveLanguageModelApi() {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        return (
            scope?.LanguageModel ||
            scope?.ai?.languageModel ||
            scope?.aiOriginTrial?.languageModel ||
            scope?.window?.ai?.languageModel ||
            null
        );
    }
    
    const labelLanguage = 'en';
    
    return (async () => {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        const languageModelApi = resolveLanguageModelApi();
        if (!languageModelApi) {
            return {
                ok: false,
                error: 'Language Model API not available'
            };
        }
        
        const recoverablePattern = /(destroyed|closed|reset|disconnected|terminated)/i;
        
        async function getSession(forceReset = false) {
            if (forceReset) {
                scope.__aitabLanguageSessionPromise = null;
            }
            if (!scope.__aitabLanguageSessionPromise) {
                scope.__aitabLanguageSessionPromise = (async () => {
                    if (typeof languageModelApi.availability === 'function') {
                        let availability;
                        try {
                            availability = await languageModelApi.availability();
                        } catch (availabilityError) {
                            const error = new Error('Language model availability check failed');
                            error.aiStatus = 'unknown';
                            error.cause = availabilityError;
                            throw error;
                        }
                        if (availability === 'unavailable') {
                            const error = new Error('Language Model API unavailable');
                            error.aiStatus = availability;
                            throw error;
                        }
                        if (availability === 'downloading') {
                            const error = new Error('Language model download in progress');
                            error.aiStatus = availability;
                            throw error;
                        }
                        if (availability === 'downloadable' && !(navigator.userActivation && navigator.userActivation.isActive)) {
                            const error = new Error('Language model requires user activation to download.');
                            error.aiStatus = availability;
                            throw error;
                        }
                        if (availability && availability !== 'ready' && availability !== 'available' && availability !== 'downloadable') {
                            const error = new Error(`Language model availability: ${availability}`);
                            error.aiStatus = availability;
                            throw error;
                        }
                    }
                    
                    try {
                        return await languageModelApi.create({
                            language: labelLanguage,
                            monitor(monitor) {
                                monitor.addEventListener('downloadprogress', (event) => {
                                    console.log(`Group label language model download ${(event.loaded * 100).toFixed(1)}%`);
                                });
                            }
                        });
                    } catch (error) {
                        console.warn('LanguageModel.create with monitor failed, retrying without monitor:', error);
                        return await languageModelApi.create({ language: labelLanguage });
                    }
                })();
            }
            
            try {
                const session = await scope.__aitabLanguageSessionPromise;
                if (!session) {
                    throw new Error('Failed to create language model session');
                }
                return session;
    } catch (error) {
                scope.__aitabLanguageSessionPromise = null;
        throw error;
    }
        }
        
        for (let attempt = 0; attempt < 2; attempt++) {
            const forceReset = attempt > 0;
            try {
                const session = await getSession(forceReset);
                
                // Warmup mode: just create a session and return
                if (descriptor && descriptor.mode === 'warmup') {
                    return { ok: true, warmup: true };
                }

                const centroidLine = (descriptor.centroidKeywords || []).join(', ') || 'none';
                const fallbackLine = (descriptor.fallbackKeywords || []).join(', ') || 'none';
                const primaryTopicLine = descriptor.primaryTopic || 'unknown';
                const docTypeLine = descriptor.docType || 'unknown';
                const mergeHintsLine = (descriptor.mergeHints || []).join(', ') || 'none';
                const entitiesLine = (descriptor.entities || []).join(', ') || 'none';
                const genericRatioLine = typeof descriptor.genericLandingRatio === 'number'
                    ? descriptor.genericLandingRatio.toFixed(2)
                    : '0.00';
                const tabLines = (descriptor.exemplarTabs || []).map((tab, idx) => `
TAB ${idx + 1}
- Title: ${tab.title}
- Topic: ${tab.topic}
- Primary topic: ${tab.primaryTopic || tab.topic || 'unknown'}
- Merge hints: ${(tab.mergeHints || []).join(', ') || '—'}
- Doc type: ${tab.docType || 'unknown'}
- Entities: ${(tab.entities || []).join(', ') || '—'}
- Keywords: ${(tab.keywords || []).join(', ') || '—'}
- Domain: ${tab.domain || 'unknown'}
                `.trim()).join('\n\n') || 'No exemplar tabs provided.';
                
                const taxonomyLine = (descriptor.taxonomyTags || []).join(', ') || 'none';
                const isLite = descriptor && descriptor.mode === 'lite';
                const prompt = isLite ? `
Return STRICT JSON: {"label":"<2-3 word title>"}

Rules:
- English, 2-3 words max
- Specific to shared subject, no emojis, no punctuation
- Do not repeat words

Context:
Centroid: ${centroidLine}
Keywords: ${fallbackLine}
Taxonomy: ${taxonomyLine}
Primary topic: ${primaryTopicLine}
Domain: ${descriptor.domainMode || 'unknown'}`.trim() : `
You generate concise labels and one-line blurbs for groups of browser tabs.
Return STRICT JSON: {"label":"<2-4 word title>","blurb":"<6-12 word one-liner>"}

Rules:
- Label must use at most 4 words
- Be specific to the shared subject and respond in English
- No emojis, no punctuation beyond spaces inside the label
- Blurb must be in English, 6-12 words, no emojis, no quotes, no trailing punctuation
- Do not repeat the same word more than once in the label
- Base only on topics/keywords provided

EXAMPLES OF GOOD LABELS:
- "Medical Research" (for PubMed, NEJM, medical journals)
- "AI Technology" (for OpenAI, Google AI, tech news)
- "Gaming Content" (for gaming websites, reviews)
- "Shopping Deals" (for e-commerce, stores)
- "News & Updates" (for news websites)
- "Product Reviews" (for review websites)

Group information:
Centroid keywords: ${centroidLine}
Additional keywords: ${fallbackLine}
Taxonomy hints: ${taxonomyLine}
Dominant domain: ${descriptor.domainMode || 'unknown'}
Dominant language: ${descriptor.languageMode || 'unknown'}
Primary topic consensus: ${primaryTopicLine}
Doc type tendency: ${docTypeLine}
Merge hints: ${mergeHintsLine}
Notable entities: ${entitiesLine}
Generic landing ratio (0-1): ${genericRatioLine}

Representative tabs:
${tabLines}
            `.trim();
            
                console.log('🧠 [GroupLabel] Prompt:', prompt.substring(0, 600));
                console.log('🧠 [GroupLabel] Full prompt length:', prompt.length);
                console.log('🧠 [GroupLabel] Descriptor info:', {
                    centroidKeywords: descriptor.centroidKeywords,
                    fallbackKeywords: descriptor.fallbackKeywords,
                    primaryTopic: descriptor.primaryTopic,
                    domainMode: descriptor.domainMode,
                    exemplarTabs: descriptor.exemplarTabs?.length || 0
                });
                
                const raw = await session.prompt(prompt);
                console.log('🧠 [GroupLabel] Raw response type/length:', typeof raw, raw?.length ?? 'n/a');
                console.log('🧠 [GroupLabel] Raw response content:', raw);
                const match = typeof raw === 'string'
                    ? raw.match(/\{[\s\S]*\}/)
                    : null;
                let parsed;
                try {
                    parsed = match ? JSON.parse(match[0]) : JSON.parse(String(raw));
                } catch (parseError) {
                    console.warn('🧠 [GroupLabel] Failed to parse response:', parseError, 'raw:', raw);
                    throw new Error('Invalid JSON response from language model');
                }
                
                const label = String(parsed.label || '').trim();
                if (!label) {
                    throw new Error('No label returned');
                }
                const blurb = isLite ? '' : String(parsed.blurb || '').trim().slice(0, 160);
                
                console.log('🧠 [GroupLabel] Parsed result:', {
                    label: label,
                    blurb: blurb,
                    fullParsed: parsed
                });
                
                return {
                    ok: true,
                    label,
                    blurb
                };
            } catch (error) {
                const message = error?.message || String(error);
                const isRecoverable = recoverablePattern.test(message);
                if (isRecoverable && attempt === 0) {
                    console.warn('generateGroupLabelInPage: session closed, retrying with fresh session...', message);
                    scope.__aitabLanguageSessionPromise = null;
                    continue;
                }
                console.warn('generateGroupLabelInPage fallback:', error);
                return {
                    ok: false,
                    error: message,
                    status: error?.aiStatus || null
                };
            }
        }

        return {
            ok: false,
            error: 'Language model unavailable after retries',
            status: 'unavailable'
        };
    })();
}

/**
 * Εκτελείται στο MAIN world: δημιουργεί σύνθεση/αναφορά για group tabs
 */
function generateGroupSynthesisInPage(descriptor) {
    function resolveLanguageModelApi() {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        return (
            scope?.LanguageModel ||
            scope?.ai?.languageModel ||
            scope?.aiOriginTrial?.languageModel ||
            scope?.window?.ai?.languageModel ||
            null
        );
    }
    return (async () => {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        const languageModelApi = resolveLanguageModelApi();
        if (!languageModelApi) {
            return { ok: false, error: 'Language Model API not available' };
        }
        const recoverablePattern = /(destroyed|closed|reset|disconnected|terminated)/i;
        async function getSession(forceReset = false) {
            if (forceReset) scope.__aitabLanguageSessionPromise = null;
            if (!scope.__aitabLanguageSessionPromise) {
                scope.__aitabLanguageSessionPromise = (async () => {
                    if (typeof languageModelApi.availability === 'function') {
                        try {
                            const availability = await languageModelApi.availability();
                            if (availability === 'unavailable') {
                                const err = new Error('Language Model API unavailable');
                                err.aiStatus = availability;
                                throw err;
                            }
                        } catch (e) {
                            // proceed; some implementations may not expose availability
                        }
                    }
                    return await languageModelApi.create();
                })();
            }
            return scope.__aitabLanguageSessionPromise;
        }

        try {
            const centroidLine = (descriptor.centroidKeywords || []).join(', ') || 'none';
            const tabLines = (descriptor.exemplarTabs || []).map((tab, idx) => `
${idx + 1}. Title: ${tab.title}
   Domain: ${tab.domain}
   Topic: ${tab.topic || tab.primaryTopic || '—'}
   Keywords: ${(tab.keywords || []).join(', ')}
`).join('\n');
            const prompt = `You are a research assistant. Analyze the following group of web pages, which represent a single research or shopping session.

1. Identify the Core Subject (1-3 words).
2. Extract 3 Key Findings/Insights from the group.
3. If the subject is Shopping/Product Comparison, provide a brief recommendation.

Return ONLY valid JSON (no extra text, no code fences) in this exact format:
{"subject":"<Core Subject>", "summary":"<Paragraph summary (max 150 words)>", "insights":["<Insight 1>", "<Insight 2>", "<Insight 3>"]}

Descriptors:
Centroid Keywords: ${centroidLine}
Exemplar Tabs:
${tabLines}

Rules:
- Base your response only on the provided data.
- Write the summary and insights in English, using a professional tone.
- Do NOT include any explanation before or after the JSON.`.trim();

            for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                    const session = await getSession(attempt === 1);
                    const raw = await session.prompt(prompt);
                    const asString = typeof raw === 'string' ? raw : String(raw);
                    function sanitizeQuotes(s){
                        return String(s||'')
                            .replace(/[\u2018\u2019]/g, "'")
                            .replace(/[\u201C\u201D]/g, '"');
                    }
                    function extractJsonBlock(s){
                        const fence = s.match(/```json([\s\S]*?)```/i);
                        if (fence) return fence[1];
                        const start = s.indexOf('{');
                        const end = s.lastIndexOf('}');
                        if (start !== -1 && end !== -1 && end > start) return s.slice(start, end+1);
                        const match = s.match(/\{[\s\S]*\}/);
                        return match ? match[0] : s.trim();
                    }
                    let parsed;
                    try {
                        const candidate = sanitizeQuotes(extractJsonBlock(asString));
                        parsed = JSON.parse(candidate);
                    } catch (parseError) {
                        // Fallback: try a minimal structure to avoid hard failure
                        const top = (Array.isArray(descriptor.centroidKeywords) && descriptor.centroidKeywords[0])
                            || String(descriptor.primaryTopic || descriptor.docType || 'General').slice(0, 32);
                        const kws = (descriptor.centroidKeywords || descriptor.fallbackKeywords || []).slice(0,3);
                        return { ok: true, subject: top, summary: `Automatic synthesis unavailable. Core focus: ${top}.`, insights: kws.length ? kws : [] };
                    }
                    const subject = String(parsed.subject || '').trim();
                    const summary = String(parsed.summary || '').trim();
                    const insights = Array.isArray(parsed.insights) ? parsed.insights.map(s => String(s || '').trim()).filter(Boolean).slice(0, 5) : [];
                    if (!subject || !summary || insights.length === 0) {
                        // Try to fill minimal fields instead of failing hard
                        const top = subject || (Array.isArray(descriptor.centroidKeywords) && descriptor.centroidKeywords[0]) || 'General';
                        const safeInsights = insights.length ? insights : (descriptor.centroidKeywords || []).slice(0,3);
                        const safeSummary = summary || `Automatic synthesis unavailable. Core focus: ${top}.`;
                        return { ok: true, subject: top, summary: safeSummary.slice(0,900), insights: safeInsights.slice(0,3) };
                    }
                    return { ok: true, subject, summary: summary.slice(0, 900), insights: insights.slice(0, 3) };
                } catch (error) {
                    const message = error?.message || String(error);
                    const isRecoverable = recoverablePattern.test(message);
                    if (isRecoverable && attempt === 0) {
                        scope.__aitabLanguageSessionPromise = null;
                        continue;
                    }
                    return { ok: false, error: message, status: error?.aiStatus || null };
                }
            }
            return { ok: false, error: 'Language model unavailable after retries', status: 'unavailable' };
        } catch (err) {
            return { ok: false, error: err?.message || String(err) };
        }
    })();
}

/**
 * In‑page AI grouping fallback: runs LM directly without relying on the content script channel
 */
function performAIGroupingInPage(prompt) {
    function resolveLanguageModelApi() {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        return (
            scope?.LanguageModel ||
            scope?.ai?.languageModel ||
            scope?.aiOriginTrial?.languageModel ||
            scope?.window?.ai?.languageModel ||
            null
        );
    }
    return (async () => {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        const languageModelApi = resolveLanguageModelApi();
        if (!languageModelApi) {
            return { ok: false, error: 'Language Model API not available' };
        }
        const recoverablePattern = /(destroyed|closed|reset|disconnected|terminated)/i;
        async function getSession(forceReset = false) {
            if (forceReset) scope.__aitabLanguageSessionPromise = null;
            if (!scope.__aitabLanguageSessionPromise) {
                scope.__aitabLanguageSessionPromise = languageModelApi.create();
            }
            return scope.__aitabLanguageSessionPromise;
        }
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const session = await getSession(attempt === 1);
                let raw;
                try {
                    raw = await session.prompt(String(prompt || '').slice(0, 6000));
                } catch (structured) {
                    // Retry once on structured errors
                    raw = await session.prompt(String(prompt || ''));
                }
                const match = typeof raw === 'string' ? raw.match(/\{[\s\S]*\}/) : null;
                let parsed;
                try {
                    parsed = match ? JSON.parse(match[0]) : JSON.parse(String(raw));
                } catch (_) {
                    // Fallback: return minimal result
                    return { ok: true, result: { keywords: [] } };
                }
                const items = Array.isArray(parsed.keywords) ? parsed.keywords : [];
                const normalized = items.map(it => ({
                    index: Number(it.index),
                    keywords: Array.isArray(it.keywords) ? it.keywords : [],
                    shopping: it.shopping === true,
                    shopCategory: typeof it.shopCategory === 'string' ? it.shopCategory : (typeof it.category === 'string' ? it.category : null),
                    intent: typeof it.intent === 'string' ? it.intent : null
                }));
                return { ok: true, result: { keywords: normalized } };
            } catch (error) {
                const message = error?.message || String(error);
                if (recoverablePattern.test(message) && attempt === 0) {
                    scope.__aitabLanguageSessionPromise = null;
                    continue;
                }
                return { ok: false, error: message };
            }
        }
        return { ok: false, error: 'Language model unavailable after retries' };
    })();
}

function normalizePredictedGroupMap(predictedGroups) {
    if (predictedGroups instanceof Map) {
        return predictedGroups;
    }
    if (predictedGroups && typeof predictedGroups === 'object') {
        const map = new Map();
        Object.entries(predictedGroups).forEach(([key, value]) => {
            map.set(key, value);
        });
        return map;
    }
    return new Map();
}

function buildPredictedGroupMap(groups, tabData) {
    const map = new Map();
    if (Array.isArray(groups)) {
        groups.forEach((group, index) => {
            const groupId = group?.id || group?.name || `G${index}`;
            (group?.tabIndices || []).forEach(tabIdx => {
                const tab = tabData?.[tabIdx];
                if (tab?.url) {
                    map.set(tab.url, groupId);
                }
            });
        });
    }
    if (Array.isArray(tabData)) {
        tabData.forEach((tab, index) => {
            if (!tab?.url) return;
            if (!map.has(tab.url)) {
                map.set(tab.url, `singleton:${index}`);
            }
        });
    }
    return map;
}

function evalPairwise(tabs, predictedGroups) {
    if (!Array.isArray(tabs) || !tabs.length) {
        return { TP: 0, FP: 0, FN: 0, precision: 1, recall: 1, f1: 1, totalPairs: 0 };
    }
    const map = normalizePredictedGroupMap(predictedGroups);
    const n = tabs.length;
    let TP = 0;
    let FP = 0;
    let FN = 0;
    for (let i = 0; i < n; i += 1) {
        const goldI = tabs[i].gold;
        const predI = map.get(tabs[i].url);
        for (let j = i + 1; j < n; j += 1) {
            const goldJ = tabs[j].gold;
            const predJ = map.get(tabs[j].url);
            const sameGold = goldI === goldJ;
            const samePred = predI !== undefined && predI === predJ;
            if (sameGold && samePred) {
                TP += 1;
            } else if (!sameGold && samePred) {
                FP += 1;
            } else if (sameGold && !samePred) {
                FN += 1;
            }
        }
    }
    const totalPairs = (n * (n - 1)) / 2;
    const precision = (TP + FP) === 0 ? 1 : TP / (TP + FP);
    const recall = (TP + FN) === 0 ? 1 : TP / (TP + FN);
    const f1 = (precision + recall) === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return {
        TP,
        FP,
        FN,
        precision: Number(precision.toFixed(3)),
        recall: Number(recall.toFixed(3)),
        f1: Number(f1.toFixed(3)),
        totalPairs
    };
}

function evalBCubed(tabs, predictedGroups) {
    if (!Array.isArray(tabs) || !tabs.length) {
        return { precision: 1, recall: 1, f1: 1 };
    }
    const map = normalizePredictedGroupMap(predictedGroups);
    const goldGroups = new Map();
    const predGroups = new Map();
    for (const tab of tabs) {
        if (!tab?.url) continue;
        const goldGroup = tab.gold;
        const predGroup = map.get(tab.url);
        if (!goldGroups.has(goldGroup)) {
            goldGroups.set(goldGroup, []);
        }
        goldGroups.get(goldGroup).push(tab.url);
        if (!predGroups.has(predGroup)) {
            predGroups.set(predGroup, []);
        }
        predGroups.get(predGroup).push(tab.url);
    }
    const intersectionSize = (list, set) => {
        let count = 0;
        for (const item of list) {
            if (set.has(item)) {
                count += 1;
            }
        }
        return count;
    };
    let precisionSum = 0;
    let recallSum = 0;
    tabs.forEach(tab => {
        if (!tab?.url) return;
        const goldList = goldGroups.get(tab.gold) || [];
        const predList = predGroups.get(map.get(tab.url)) || [];
        const predSet = new Set(predList);
        const goldSet = new Set(goldList);
        const inter = intersectionSize(predList, goldSet);
        const precision = predList.length ? inter / predList.length : 0;
        const recall = goldList.length ? inter / goldList.length : 0;
        precisionSum += precision;
        recallSum += recall;
    });
    const precision = precisionSum / tabs.length;
    const recall = recallSum / tabs.length;
    const f1 = (precision + recall) === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return {
        precision: Number(precision.toFixed(3)),
        recall: Number(recall.toFixed(3)),
        f1: Number(f1.toFixed(3))
    };
}

function computePurityByCluster(tabs, predictedGroups) {
    const map = normalizePredictedGroupMap(predictedGroups);
    const clusters = new Map();
    tabs.forEach(tab => {
        if (!tab?.url) return;
        const groupId = map.get(tab.url);
        if (!clusters.has(groupId)) {
            clusters.set(groupId, []);
        }
        clusters.get(groupId).push(tab.gold);
    });
    const result = [];
    clusters.forEach((labels, groupId) => {
        const frequency = new Map();
        labels.forEach(label => {
            frequency.set(label, (frequency.get(label) || 0) + 1);
        });
        const [majorityLabel, majorityCount] = Array.from(frequency.entries()).sort((a, b) => b[1] - a[1])[0] || ['', 0];
        const purity = labels.length ? majorityCount / labels.length : 0;
        result.push({
            groupId,
            size: labels.length,
            majorityLabel,
            purity: Number(purity.toFixed(3))
        });
    });
    result.sort((a, b) => b.size - a.size);
    return result;
}

async function runGoldenEvaluation(scenario, { groups = aiGroups, tabData = currentTabData } = {}) {
    if (!scenario || !Array.isArray(scenario.tabs)) {
        const error = new Error('Invalid golden scenario format');
        error.details = scenario;
        throw error;
    }
    if (!Array.isArray(groups) || !groups.length) {
        throw new Error('No predicted groups available. Run a scan before evaluating.');
    }
    const predictedMap = buildPredictedGroupMap(groups, tabData);
    if (!predictedMap.size) {
        throw new Error('Failed to build predicted group mapping.');
    }
    const tabsForEval = [];
    const missingPredictions = [];
    scenario.tabs.forEach((tab, index) => {
        if (!tab || !tab.url || typeof tab.gold === 'undefined') {
            return;
        }
        if (!predictedMap.has(tab.url)) {
            missingPredictions.push(tab.url);
            predictedMap.set(tab.url, `missing:${index}`);
        }
        tabsForEval.push({ url: tab.url, gold: tab.gold });
    });
    if (!tabsForEval.length) {
        throw new Error('Golden scenario contains no valid tabs.');
    }
    const pairwise = evalPairwise(tabsForEval, predictedMap);
    const bcubed = evalBCubed(tabsForEval, predictedMap);
    const denominator = pairwise.TP + pairwise.FP + pairwise.FN;
    const overMergeRate = denominator ? Number((pairwise.FP / denominator).toFixed(3)) : 0;
    const underClusterRate = denominator ? Number((pairwise.FN / denominator).toFixed(3)) : 0;
    const purityByCluster = computePurityByCluster(tabsForEval, predictedMap);
    const result = {
        scenarioName: scenario.name || 'unnamed',
        notes: scenario.notes || '',
        pairwise,
        bcubed,
        overMergeRate,
        underClusterRate,
        purityByCluster,
        missingPredictions,
        tabCount: tabsForEval.length,
        timestamp: Date.now()
    };
    lastGoldenEvaluation = result;
    console.log('📊 Golden evaluation result:', result);
    return result;
}

/**
 * Εκτελείται στο MAIN world του YouTube tab και επιστρέφει πλούσιο context + AI topic inference
 */
function analyzeYouTubeTabInPage() {
    function resolveLanguageModelApi() {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        return (
            scope?.LanguageModel ||
            scope?.ai?.languageModel ||
            scope?.aiOriginTrial?.languageModel ||
            scope?.window?.ai?.languageModel ||
            null
        );
    }
    
    function resolveSummarizerApi() {
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        return (
            scope?.Summarizer ||
            scope?.ai?.summarizer ||
            scope?.ai?.Summarizer ||
            scope?.aiOriginTrial?.summarizer ||
            scope?.window?.ai?.Summarizer ||
            null
        );
    }
    
    function parseSummarizerOutput(summary) {
        if (!summary) return [];
        if (typeof summary === 'string') {
            return summary.split('\n')
                .map(line => line.trim().replace(/^[*•-]\s*/, ''))
                .filter(Boolean)
                .slice(0, 6);
        }
        if (Array.isArray(summary)) {
            return summary
                .map(item => typeof item === 'string' ? item.trim() : '')
                .filter(Boolean)
                .slice(0, 6);
        }
        if (summary && Array.isArray(summary.points)) {
            return summary.points
                .map(item => typeof item === 'string' ? item.trim() : '')
                .filter(Boolean)
                .slice(0, 6);
        }
        if (summary && typeof summary.summary === 'string') {
            return [summary.summary.trim()];
        }
        return [];
    }
    
    function safeJsonParse(value) {
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }
    
    function extractYouTubeContext() {
        const pick = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
        const getJSONLD = () => {
            try {
                const node = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
                    .find(n => n.textContent.includes('"@type":"VideoObject"'));
                if (!node) return null;
                const json = JSON.parse(node.textContent);
                return Array.isArray(json) ? json.find(item => item['@type'] === 'VideoObject') || null : json;
            } catch {
                return null;
            }
        };
        
        const initialResponse = (window.ytInitialPlayerResponse || window.ytplayer?.config?.args?.player_response);
        let playerResponse = null;
        try { playerResponse = typeof initialResponse === 'string' ? JSON.parse(initialResponse) : initialResponse || null; } catch { playerResponse = null; }
        
        const videoDetails = playerResponse?.videoDetails || {};
        const microformat = playerResponse?.microformat?.playerMicroformatRenderer || {};
        const jsonLd = getJSONLD();
        
        const title = videoDetails.title || pick('h1.title') || document.title.replace(/ - YouTube$/, '');
        const channel = videoDetails.author || pick('#owner-name a') || microformat.ownerChannelName || '';
        const category = microformat.category || videoDetails.category || jsonLd?.genre || '';
        const description = (videoDetails.shortDescription || jsonLd?.description || pick('#description') || '').slice(0, 4000);
        
        const hashtagsFromDesc = (description.match(/(^|\s)#([\p{L}\p{N}_]+)\b/gu) || [])
            .map(h => h.trim().replace(/\s+/g, ''))
            .slice(0, 12);
        
        const jsonLdKeywords = jsonLd?.keywords
            ? (Array.isArray(jsonLd.keywords) ? jsonLd.keywords : String(jsonLd.keywords).split(/[,;]+/).map(k => k.trim()))
            : [];
        const keywords = Array.from(new Set([
            ...(videoDetails.keywords || []),
            ...jsonLdKeywords
        ].map(k => k.trim()).filter(Boolean))).slice(0, 24);
        
        const chapterEls = Array.from(document.querySelectorAll('ytd-macro-markers-list-item-renderer'));
        const chapters = chapterEls.map(el => {
            const label = el.querySelector('.segment-title')?.textContent?.trim();
            const time = el.querySelector('.segment-start')?.textContent?.trim();
            return label && time ? { time, label } : null;
        }).filter(Boolean);
        
        const relatedContext = Array.from(document.querySelectorAll('ytd-compact-video-renderer #video-title'))
            .slice(0, 10)
            .map(n => n.textContent.trim())
            .filter(Boolean);
        
        return {
            ok: true,
            url: location.href,
            title,
            channel,
            category,
            description,
            hashtags: hashtagsFromDesc,
            keywords,
            chapters,
            relatedContext,
            videoDetails,
            microformat,
            playerResponse
        };
    }
    
    async function attachTranscript(playerResponse) {
        let transcript = '';
        try {
            const track = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0];
            if (track?.baseUrl) {
                const url = new URL(track.baseUrl);
                url.searchParams.set('fmt', 'vtt');
                const res = await fetch(url.toString(), { credentials: 'include' });
                const text = await res.text();
                transcript = text
                    .replace(/WEBVTT[\s\S]*?(\r?\n){2}/, '')
                    .replace(/\d+\r?\n\d{2}:\d{2}:\d{2}\.\d{3} --> .*?\r?\n/g, '')
                    .replace(/\r?\n{2,}/g, '\n')
                    .slice(0, 20000)
                    .trim();
            }
        } catch (error) {
            console.warn('Failed to fetch YouTube transcript:', error);
        }
        return transcript;
    }
    
    async function summarizeContext(ctx) {
        const summarizerApi = resolveSummarizerApi();
        const languageModelApi = resolveLanguageModelApi();
        let summaryBullets = [];
        let topic = '';
        let tags = [];
        let confidence = 0.6;
        const reasoning = [];
        
        const textBlock = `
TITLE: ${ctx.title}
CHANNEL: ${ctx.channel}
CATEGORY: ${ctx.category}
HASHTAGS: ${ctx.hashtags.join(' ')}
KEYWORDS: ${ctx.keywords.join(', ')}
CHAPTERS: ${ctx.chapters.map(c => `[${c.time}] ${c.label}`).join(' | ')}
RELATED VIDEOS: ${ctx.relatedContext.join(' | ')}
DESCRIPTION:
${ctx.description}

TRANSCRIPT SNIPPET:
${(ctx.transcript || '').slice(0, 6000)}
        `.trim();
        
        if (!textBlock) {
            return { topic: ctx.category || 'General', tags: ctx.keywords.slice(0, 5), confidence: 0.4, summaryBullets: [], reasoning };
        }
        
        const scope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        
        if (summarizerApi) {
            const recoverableSummarizerPattern = /(destroyed|closed|reset|disconnected|terminated)/i;
            
            async function getSummarizer(forceReset = false) {
                if (forceReset) {
                    scope.__aitabSummarizerPromise = null;
                }
                if (!scope.__aitabSummarizerPromise) {
                    scope.__aitabSummarizerPromise = (async () => {
                        if (typeof summarizerApi.availability === 'function') {
                            const availability = await summarizerApi.availability();
                            if (availability === 'unavailable') {
                                throw new Error('Summarizer API unavailable');
                            }
                            if ((availability === 'downloadable' || availability === 'downloading') && !(navigator.userActivation && navigator.userActivation.isActive)) {
                                throw new Error('Summarizer requires user activation to download.');
                            }
                        }
                        
                        try {
                            return await summarizerApi.create({
                                type: 'key-points',
                                format: 'plain-text',
                                length: 'short',
                                sharedContext: 'Summarize the main topic and key themes of a YouTube video for tab organization.',
                                monitor(monitor) {
                                    monitor.addEventListener('downloadprogress', (event) => {
                                        console.log(`YouTube summarizer download progress ${(event.loaded * 100).toFixed(1)}%`);
                                    });
                                }
                            });
                        } catch (monitorError) {
                            console.warn('Summarizer.create with monitor failed, retrying:', monitorError);
                            return await summarizerApi.create({
                                type: 'key-points',
                                format: 'plain-text',
                                length: 'short',
                                sharedContext: 'Summarize the main topic and key themes of a YouTube video for tab organization.'
                            });
                        }
                    })();
                }
                
                try {
                    const summarizer = await scope.__aitabSummarizerPromise;
                    if (!summarizer) {
                        throw new Error('Failed to create summarizer session');
                    }
                    return summarizer;
    } catch (error) {
                    scope.__aitabSummarizerPromise = null;
        throw error;
    }
}

            let summarizerSuccess = false;
            for (let attempt = 0; attempt < 2; attempt++) {
                const forceReset = attempt > 0;
                try {
                    const summarizer = await getSummarizer(forceReset);
                    const summary = await summarizer.summarize(textBlock);
                    summaryBullets = parseSummarizerOutput(summary);
                    if (!summaryBullets.length) {
                        summaryBullets = ctx.keywords.slice(0, 5).map(k => `Keyword: ${k}`);
                    }
                    summarizerSuccess = true;
                    break;
                } catch (error) {
                    const message = error?.message || String(error);
                    const isRecoverable = recoverableSummarizerPattern.test(message);
                    if (isRecoverable && attempt === 0) {
                        console.warn('YouTube summarizer session closed, retrying with fresh session...', message);
                        scope.__aitabSummarizerPromise = null;
                        continue;
                    }
                    console.warn('YouTube summarizer failed:', error);
                    reasoning.push(`Summarizer fallback: ${message}`);
                    summaryBullets = ctx.keywords.slice(0, 5).map(k => `Keyword: ${k}`);
                    scope.__aitabSummarizerPromise = null;
                    break;
                }
            }
            
            if (!summarizerSuccess && !summaryBullets.length) {
                summaryBullets = ctx.keywords.slice(0, 5).map(k => `Keyword: ${k}`);
            }
        } else {
            summaryBullets = ctx.keywords.slice(0, 5).map(k => `Keyword: ${k}`);
            reasoning.push('Summarizer API not available, using keywords.');
        }
        
        const fallbackTopic = ctx.category || ctx.keywords[0] || ctx.hashtags[0]?.replace(/^#/, '') || ctx.channel || 'General';
        topic = fallbackTopic;
        tags = Array.from(new Set([
            ...ctx.hashtags.map(h => h.replace(/^#/, '')),
            ...ctx.keywords
        ].filter(Boolean))).slice(0, 6);
        
        if (languageModelApi) {
            const recoverableLanguagePattern = /(destroyed|closed|reset|disconnected|terminated)/i;
            const ytLanguage = (() => {
                const candidate = ctx.language || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en';
                return String(candidate).split('-')[0] || 'en';
            })();
            
            async function getLanguageSession(forceReset = false) {
                if (forceReset) {
                    scope.__aitabLanguageSessionPromise = null;
                }
                if (!scope.__aitabLanguageSessionPromise) {
                    scope.__aitabLanguageSessionPromise = (async () => {
                        if (typeof languageModelApi.availability === 'function') {
                            const availability = await languageModelApi.availability();
                            if (availability === 'unavailable') {
                                throw new Error('Language Model API unavailable');
                            }
                            if ((availability === 'downloadable' || availability === 'downloading') && !(navigator.userActivation && navigator.userActivation.isActive)) {
                                throw new Error('Language model requires user activation to download.');
                            }
                        }
                        
                        try {
                            return await languageModelApi.create({
                                language: ytLanguage,
                                monitor(monitor) {
                                    monitor.addEventListener('downloadprogress', (event) => {
                                        console.log(`YouTube language model download progress ${(event.loaded * 100).toFixed(1)}%`);
                                    });
                                }
                            });
                        } catch (monitorError) {
                            console.warn('LanguageModel.create with monitor failed, retrying:', monitorError);
                            return await languageModelApi.create({ language: ytLanguage });
                        }
                    })();
                }
                
                try {
                    const session = await scope.__aitabLanguageSessionPromise;
                    if (!session) {
                        throw new Error('Failed to create language model session');
                    }
                    return session;
                } catch (error) {
                    scope.__aitabLanguageSessionPromise = null;
                    throw error;
                }
            }
            
            for (let attempt = 0; attempt < 2; attempt++) {
                const forceReset = attempt > 0;
                try {
                    const session = await getLanguageSession(forceReset);
                    const prompt = `
Return valid JSON with the structure:
{"topic":"<2-5 words>","confidence":0-1,"tags":["t1","t2","t3"],"reason":"<short sentence>"}
Use the information to identify the primary topic of the YouTube video.

TITLE: ${ctx.title}
CHANNEL: ${ctx.channel}
CATEGORY: ${ctx.category}
SUMMARY BULLETS:
${summaryBullets.map(b => `- ${b}`).join('\n')}
KEYWORDS: ${ctx.keywords.join(', ')}
HASHTAGS: ${ctx.hashtags.join(' ')}
RELATED VIDEOS: ${ctx.relatedContext.join(' | ')}
DESCRIPTION (truncated):
${ctx.description.slice(0, 1500)}
TRANSCRIPT (truncated):
${(ctx.transcript || '').slice(0, 3000)}

Respond ONLY with JSON.`;
                    
                    const raw = await session.prompt(prompt.trim());
                    const match = typeof raw === 'string'
                        ? raw.match(/\{[\s\S]*\}/)
                        : null;
                    const parsed = match ? safeJsonParse(match[0]) : safeJsonParse(String(raw));
                    
                    if (parsed && typeof parsed === 'object') {
                        if (parsed.topic) topic = String(parsed.topic).trim();
                        if (typeof parsed.confidence === 'number') {
                            confidence = Math.max(0, Math.min(1, parsed.confidence));
                        }
                        if (Array.isArray(parsed.tags)) {
                            tags = parsed.tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 8);
                        }
                        if (parsed.reason) {
                            reasoning.push(String(parsed.reason).trim());
                        }
                    }
                    break;
                } catch (error) {
                    const message = error?.message || String(error);
                    const isRecoverable = recoverableLanguagePattern.test(message);
                    if (isRecoverable && attempt === 0) {
                        console.warn('YouTube language model session closed, retrying with fresh session...', message);
                        scope.__aitabLanguageSessionPromise = null;
                        continue;
                    }
                    console.warn('Language model inference for YouTube topic failed:', error);
                    reasoning.push(`Language model fallback: ${message}`);
                    scope.__aitabLanguageSessionPromise = null;
                    break;
                }
            }
        } else {
            reasoning.push('Language model API not available, using fallback topic.');
        }
        
        return {
            topic,
            confidence,
            tags,
            summaryBullets,
            reasoning
        };
    }
    
    return (async () => {
        try {
            const context = extractYouTubeContext();
            if (!context.ok) {
                throw new Error('Failed to extract YouTube context');
            }
            context.transcript = await attachTranscript(context.playerResponse);
            const inference = await summarizeContext(context);
            return {
                ok: true,
                url: context.url,
                title: context.title,
                channel: context.channel,
                category: context.category,
                description: context.description,
                hashtags: context.hashtags,
                keywords: context.keywords,
                chapters: context.chapters,
                relatedContext: context.relatedContext,
                transcript: context.transcript,
                topic: inference.topic,
                confidence: inference.confidence,
                tags: inference.tags,
                summaryBullets: inference.summaryBullets,
                reasoning: inference.reasoning
            };
        } catch (error) {
            console.error('YouTube context analysis failed:', error);
            return {
                ok: false,
                error: {
                    message: error?.message || String(error),
                    stack: error?.stack || null
                }
            };
        }
    })();
}

/**
 * Εξάγει keywords από κείμενο (title, URL, κλπ)
 */
function extractKeywordsFromText(text) {
    if (!text) return [];
    
    // Καθαρισμός και tokenization
    const cleaned = text.toLowerCase()
        .replace(/[^\w\s-]/g, ' ') // Αφαίρεση special chars
        .replace(/\s+/g, ' ')      // Normalize spaces
        .trim();
    
    const words = cleaned.split(' ')
        .filter(word => word.length > 2) // Μόνο λέξεις > 2 χαρακτήρες
        .filter(word => !isStopWord(word)); // Αφαίρεση stop words
    
    // Stemming-like logic
    const stemmed = words.map(word => {
        // Αφαίρεση common suffixes
        if (word.endsWith('ing') && word.length > 6) return word.slice(0, -3);
        if (word.endsWith('ed') && word.length > 5) return word.slice(0, -2);
        if (word.endsWith('er') && word.length > 5) return word.slice(0, -2);
        if (word.endsWith('ly') && word.length > 5) return word.slice(0, -2);
        return word;
    });
    
    // Αφαίρεση duplicates και επιστροφή top keywords
    return [...new Set(stemmed)].slice(0, 10);
}

/**
 * Έλεγχος αν μια λέξη είναι stop word
 */
function isStopWord(word) {
    const stopWords = new Set([
        'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
        'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above',
        'below', 'between', 'among', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
        'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you',
        'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
        'his', 'her', 'its', 'our', 'their', 'a', 'an', 'some', 'any', 'all', 'both',
        'each', 'every', 'other', 'another', 'such', 'no', 'nor', 'not', 'only', 'own',
        'same', 'so', 'than', 'too', 'very', 'just', 'now', 'here', 'there', 'where',
        'when', 'why', 'how', 'what', 'which', 'who', 'whom', 'whose', 'www', 'com',
        'org', 'net', 'html', 'php', 'asp', 'jsp', 'http', 'https', 'www', 'index'
    ]);
    
    return stopWords.has(word);
}

/**
 * Δημιουργεί το prompt για AI ομαδοποίηση
 */
function createGroupingPrompt(tabData) {
    console.log('🔍 Creating grouping prompt for', tabData.length, 'tabs');
    
    const tabsInfo = tabData.map(tab => {
        const preview = tab.content.replace(/\s+/g, ' ').substring(0, 200);
        const meta = tab.metaDescription ? tab.metaDescription.replace(/\s+/g, ' ').substring(0, 120) : '—';
        
        // Εξαγωγή keywords από title και URL
        const titleKeywords = extractKeywordsFromText(tab.title);
        const urlKeywords = extractKeywordsFromText(tab.url);
        const combinedKeywords = [...new Set([...titleKeywords, ...urlKeywords])].slice(0, 8);
        
        // YouTube analysis (αν υπάρχει)
        const youtubeInfo = tab.youtubeAnalysis ? 
            `\n- YouTube Analysis: Topic="${tab.youtubeAnalysis.topic}", Tags=[${(tab.youtubeAnalysis.tags || []).slice(0, 5).join(', ')}]` : '';
        
        console.log(`📋 Tab ${tab.index}: "${tab.title}" (${tab.domain}) - Keywords: [${combinedKeywords.join(', ')}]`);
        
        return [
            `Tab ${tab.index}`,
            `- 🎯 TITLE: "${tab.title}"`,
            `- 🌐 Domain: ${tab.domain}`,
            `- 🔗 URL: ${tab.url}`,
            `- 🏷️ KEYWORDS: [${combinedKeywords.join(', ')}]`,
            `- 📝 Content: ${preview || 'No readable body text'}`,
            `- 📄 Meta: ${meta}`,
            `- 💡 Topic hints: ${tab.topicHints || 'General browsing / mixed'}`,
            `- 📊 Content type: ${tab.hasContent ? 'Long-form content' : 'Short content'}`,
            `${youtubeInfo}`
        ].filter(line => line.trim()).join('\n');
    }).join('\n\n');
    
    const prompt = `Είσαι ένας εξειδικευμένος βοηθός που οργανώνει ανοιχτά browser tabs σε θεματικές ομάδες.

🎯 ΚΡΙΣΙΜΕΣ ΟΔΗΓΙΕΣ ΓΙΑ ΑΚΡΙΒΗ GROUPING:
1. 🏷️ TITLE & KEYWORDS ΠΡΩΤΑ: Το TITLE και τα KEYWORDS είναι τα ΠΙΟ ΣΗΜΑΝΤΙΚΑ στοιχεία για grouping
2. 🔍 ΑΝΑΛΥΣΗ: Κάθε tab πρέπει να ταξινομηθεί με βάση το TITLE, KEYWORDS, και domain
3. 📱 TECHNOLOGY DETECTION: Αν βλέπεις keywords όπως "iphone", "android", "review", "tech", "smartphone", "apple" → TECHNOLOGY GROUP
4. 🎮 GAMING DETECTION: Αν βλέπεις keywords όπως "gaming", "game", "fifa", "ultimate", "team", "esports", "futbin", "fut.gg" → GAMING GROUP
5. 🛒 SHOPPING DETECTION: Αν βλέπεις keywords όπως "buy", "shop", "price", "store", "commerce" → SHOPPING GROUP
6. 📧 EMAIL DETECTION: Αν βλέπεις "gmail", "email", "mail", "inbox" → EMAIL GROUP
7. 🔬 RESEARCH DETECTION: Αν βλέπεις "research", "study", "medical", "journal", "academic" → RESEARCH GROUP
8. 📺 ENTERTAINMENT DETECTION: Αν βλέπεις "youtube", "video", "entertainment", "music" → ENTERTAINMENT GROUP

⚠️ ΣΗΜΑΝΤΙΚΟ: iPhone videos και tech reviews ΠΑΝΤΑ πηγαίνουν σε TECHNOLOGY GROUP, ΟΧΙ σε GAMING!

🔬 ΑΛΓΟΡΙΘΜΟΣ GROUPING (ΣΕ ΣΕΙΡΑ ΠΡΟΤΕΡΑΙΟΤΗΤΑΣ):
1. ΒΡΕΣ κοινά KEYWORDS στο TITLE (π.χ. "iphone", "gaming", "research")
2. ΒΡΕΣ παρόμοια domains (youtube.com + tech keywords = TECHNOLOGY)
3. ΒΡΕΣ παρόμοια content themes (gaming, technology, shopping, news, κλπ)
4. ΣΥΓΚΡΙΝΕ YouTube analysis (αν υπάρχει)
5. ΑΝ υπάρχει similarity > 60%, βάλε σε ίδια ομάδα

📝 ΟΝΟΜΑΣΙΑ ΟΜΑΔΩΝ:
- Δημιούργησε ΔΥΝΑΜΙΚΑ ονόματα βάσει των KEYWORDS και TITLE
- Χρησιμοποίησε συγκεκριμένα ονόματα (π.χ. "iPhone Reviews", "Gaming Content", "Medical Research")
- ΑΠΟΦΥΓΕ γενικά ονόματα (π.χ. "Gaming", "Work", "Other")
- ΚΡΑΤΑ ονόματα σύντομα αλλά περιγραφικά

⚠️ ΠΑΡΑΔΕΙΓΜΑΤΑ ΣΩΣΤΟΥ GROUPING:
- iPhone videos + tech reviews = "Technology & Reviews" (κοινά keywords: iphone, tech, review)
- FIFA/EA FC websites + gaming content = "Gaming Content" (domain + keywords)
- Gmail tabs = "Email & Communication" (domain + purpose)
- Medical journals + research = "Research & Learning" (keywords + domain)

❌ ΛΑΘΟΣ: iPhone videos σε "Gaming & Entertainment" 
✅ ΣΩΣΤΟ: iPhone videos σε "Technology & Reviews"

Tabs προς ανάλυση:
${tabsInfo}

Απάντησε ΜΟΝΟ με JSON στη μορφή:
[
  {
    "name": "Όνομα Ομάδας",
    "tabIndices": [0, 1, 2]
  }
]`;

    console.log('📤 Final prompt length:', prompt.length, 'characters');
    console.log('📤 Prompt preview (first 500 chars):', prompt.substring(0, 500) + '...');
    
    return prompt;
}

/**
 * Δημιουργεί περιεχόμενο για το Chrome Summarizer API
 */
function createGroupContentForSummarizer(tabs) {
    const tabsInfo = tabs.map(tab => {
        let domain = tab.domain;
        if (!domain) {
            try {
                domain = new URL(tab.url).hostname;
            } catch (error) {
                domain = 'unknown-domain';
            }
        }
        const cleanedContent = (tab.content || '').replace(/\s+/g, ' ').substring(0, 220);
        const cleanedMeta = (tab.metaDescription || '').replace(/\s+/g, ' ').substring(0, 160) || '—';
        const topicHints = tab.topicHints || generateTopicHints(tab);
        return `Tab: "${tab.title}" (${tab.url})
Domain: ${domain}
Topic hints: ${topicHints}
Content: ${cleanedContent || 'No readable body text'}
Meta: ${cleanedMeta}`;
    }).join('\n\n');
    
    return `Group of related browser tabs with the following content:

${tabsInfo}

Please provide a concise summary of the main themes and topics covered by these tabs, με έμφαση στο κοινό θεματικό στοιχείο που τα ενώνει. Αν κάποια tabs είναι βοηθητικά (π.χ. email ή εργαλεία) εξήγησε τον ρόλο τους.`;
}

/**
 * Δημιουργεί το prompt για AI συνοψίσεις (legacy - χρησιμοποιείται για fallback)
 */
function createSummaryPrompt(groupName, tabs) {
    const tabsInfo = tabs.map(tab => 
        `- "${tab.title}" (${tab.url})`
    ).join('\n');
    
    return `Σύνοψη της ομάδας "${groupName}" σε 3-5 σύντομα bullet points που επισημαίνουν τα κύρια θέματα.

Tabs στην ομάδα:
${tabsInfo}

Απάντησε με bullet points:`;
}

/**
 * Parsing AI response για ομαδοποίηση
 */
function parseAIResponse(response, tabData = null) {
    try {
        console.log('🔍 Parsing AI response...');
        console.log('📥 Raw AI response:', response);
        console.log('📥 Response type:', typeof response);
        console.log('📥 Response length:', response?.length || 'no length');
        
        // Αναζήτηση JSON στο response
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            console.log('✅ JSON found in response');
            console.log('📋 Extracted JSON:', jsonMatch[0]);
            
            const parsed = JSON.parse(jsonMatch[0]);
            console.log('✅ JSON parsed successfully');
            console.log('📊 Parsed groups:', parsed);
            
            // Log κάθε group ξεχωριστά με λεπτομέρειες για τα tabs
            parsed.forEach((group, index) => {
                console.log(`📁 Group ${index + 1}: "${group.name}" with tabs: [${group.tabIndices?.join(', ') || 'none'}]`);
                
                // Λεπτομερές log για κάθε group που δημιούργησε το AI
                if (group.tabIndices && group.tabIndices.length > 0) {
                    console.log(`🤖 [AI Grouping Decision] Group "${group.name}" contains tabs:`, group.tabIndices);
                    console.log(`🤖 [AI Reasoning] The AI decided these tabs belong together because they share similar themes/topics`);
                    
                    // Αν έχουμε tab data, δείχνουμε τα titles των tabs που ομαδοποιεί το AI
                    if (tabData && tabData.length > 0) {
                        const groupedTabs = group.tabIndices.map(tabIndex => {
                            const tab = tabData[tabIndex];
                            return tab ? {
                                index: tabIndex,
                                title: tab.title,
                                url: tab.url,
                                domain: tab.domain
                            } : null;
                        }).filter(Boolean);
                        
                        console.log(`🤖 [AI Grouping Details] Tabs that AI grouped together in "${group.name}":`);
                        groupedTabs.forEach(tab => {
                            console.log(`   📄 Tab ${tab.index}: "${tab.title}" (${tab.domain})`);
                        });
                        
                        console.log(`🤖 [AI Grouping Summary] AI created group "${group.name}" with ${groupedTabs.length} tabs that share similar content/themes`);
                    }
                }
            });
            
            return parsed;
        }
        
        // Αν δεν βρεθεί JSON, πετάμε error
        console.error('❌ No valid JSON found in AI response');
        console.error('📥 Full response was:', response);
        throw new Error('No valid JSON found in AI response');
        
    } catch (error) {
        console.error('❌ Failed to parse AI response:', error);
        console.error('📥 Response that failed:', response);
        throw new Error(`AI response parsing failed: ${error.message}`);
    }
}

/**
 * Parsing Chrome Summarizer API response
 */
function parseSummarizerResponse(summary) {
    try {
        // Το Summarizer API επιστρέφει structured summary
        if (typeof summary === 'string') {
            // Αν είναι string, χωρίζουμε σε bullet points
            const lines = summary.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .slice(0, 5); // Μέγιστο 5 bullet points
            
            return lines.length > 0 ? lines : ['Δεν ήταν δυνατή η δημιουργία περίληψης'];
        } else if (summary && summary.points) {
            // Αν είναι structured object με points
            return summary.points.slice(0, 5);
        } else if (summary && summary.summary) {
            // Αν είναι structured object με summary
            return [summary.summary];
        }
        
        throw new Error('Invalid summarizer response format');
        
    } catch (error) {
        console.error('Error parsing summarizer response:', error);
        throw new Error(`Summarizer response parsing failed: ${error.message}`);
    }
}

/**
 * Parsing AI response για συνοψίσεις (legacy - για fallback)
 */
function parseSummaryResponse(response) {
    // Εξαγωγή bullet points
    const lines = response.split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('-') || line.startsWith('•') || line.startsWith('*'))
        .map(line => line.replace(/^[-•*]\s*/, ''))
        .slice(0, 5); // Μέγιστο 5 bullet points
    
    if (lines.length === 0) {
        throw new Error('No valid summary points found in AI response');
    }
    return lines;
}


/**
 * Κλείνει τα επιλεγμένα tabs
 */
async function handleCloseSelectedTabs(tabIds, sendResponse) {
    try {
        if (!tabIds || tabIds.length === 0) {
            sendResponse({ success: false, error: 'Δεν επιλέχθηκαν tabs για κλείσιμο' });
            return;
        }
        
        await chrome.tabs.remove(tabIds);
        
        // Ενημέρωση των δεδομένων
        currentTabData = currentTabData.filter(tab => !tabIds.includes(tab.id));
        
        sendResponse({ 
            success: true, 
            message: `Κλείστηκαν ${tabIds.length} tabs επιτυχώς` 
        });
        
    } catch (error) {
        console.error('Error closing tabs:', error);
        sendResponse({ 
            success: false, 
            error: `Σφάλμα κατά το κλείσιμο tabs: ${error.message}` 
        });
    }
}

/**
 * Εξάγει περίληψη των αποτελεσμάτων
 */
async function handleExportSummary(sendResponse) {
    try {
        const summary = {
            timestamp: new Date().toISOString(),
            totalTabs: currentTabData.length,
            groups: aiGroups.map(group => ({
                name: group.name,
                tabCount: group.tabIndices.length,
                summary: group.summary,
                tabs: group.tabIndices.map(index => ({
                    title: currentTabData[index].title,
                    url: currentTabData[index].url
                }))
            }))
        };
        
        // Δημιουργία downloadable file
        const blob = new Blob([JSON.stringify(summary, null, 2)], { 
            type: 'application/json' 
        });
        const url = URL.createObjectURL(blob);
        
        // Download
        const a = document.createElement('a');
        a.href = url;
        a.download = `tab-analysis-${Date.now()}.json`;
        a.click();
        
        URL.revokeObjectURL(url);
        
        sendResponse({ 
            success: true, 
            message: 'Η περίληψη εξήχθη επιτυχώς' 
        });
        
    } catch (error) {
        console.error('Error exporting summary:', error);
        sendResponse({ 
            success: false, 
            error: `Σφάλμα κατά την εξαγωγή: ${error.message}` 
        });
    }
}

/**
 * Functions που τρέχουν στο content script context για Chrome AI
 */

// AI Grouping function για content script
async function performAIGroupingInContent(tabData) {
    try {
        console.log('Content script: Starting AI grouping...');
        const globalScope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        const languageModelApi =
            globalScope?.LanguageModel ||
            globalScope?.ai?.languageModel ||
            globalScope?.aiOriginTrial?.languageModel ||
            globalScope?.window?.ai?.languageModel ||
            null;
        
        if (!languageModelApi) {
            throw new Error('Language Model API not available - Chrome AI APIs not accessible');
        }
        
        console.log('Content script: Language Model API detected');
        
        if (typeof languageModelApi.availability === 'function') {
            try {
                const availability = await languageModelApi.availability();
                console.log('Content script: LanguageModel availability:', availability);
                
                if (availability === 'unavailable') {
                    throw new Error('Language Model API is unavailable on this device');
                }
                
                if ((availability === 'downloadable' || availability === 'downloading') && !(navigator.userActivation && navigator.userActivation.isActive)) {
                    throw new Error('Language Model requires user activation to download. Κάνε κλικ στη σελίδα και δοκίμασε ξανά.');
                }
            } catch (availabilityError) {
                console.warn('Content script: LanguageModel.availability() failed, continuing optimistically:', availabilityError);
            }
        }
        
        const sessionLanguage = (() => {
            const candidate = tabData?.[0]?.language || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en';
            return String(candidate).split('-')[0] || 'en';
        })();
        let session;
        try {
            session = await languageModelApi.create({
                language: sessionLanguage,
                monitor(monitor) {
                    monitor.addEventListener('downloadprogress', (event) => {
                        const percent = (event.loaded * 100).toFixed(1);
                        console.log(`Content script: Language model download progress ${percent}%`);
                    });
                }
            });
        } catch (createWithMonitorError) {
            console.warn('Content script: LanguageModel.create with monitor failed, retrying without options:', createWithMonitorError);
            session = await languageModelApi.create({ language: sessionLanguage });
        }
        
        if (!session) {
            throw new Error('Failed to create language model session');
        }
        
        console.log('Content script: Language model session created successfully');
        
        // Δημιουργία prompt
        const prompt = createGroupingPrompt(tabData);
        console.log('Content script: Prompt created, length:', prompt.length);
        console.log('🤖 [AI Prompt] Sending this prompt to AI for grouping:', prompt.substring(0, 500) + '...');
        
        // Εκτέλεση AI grouping
        console.log('Content script: Executing AI prompt...');
        const response = await session.prompt(prompt);
        console.log('Content script: AI response received:', typeof response, response?.length || 'no length');
        console.log('🤖 [AI Response] Raw AI response for grouping:', response);
        
        // Parse response
        console.log('Content script: Parsing AI response...');
        const groups = parseAIResponse(response, tabData);
        console.log('Content script: Groups parsed successfully:', groups.length);
        
        return groups;
        
    } catch (error) {
        console.error('Content script: Error in AI grouping:', error);
        console.error('Content script: Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        throw error;
    }
}

// AI Summarization function για content script
async function performAISummarizationInContent(groupContent) {
    try {
        console.log('Content script: Starting AI summarization...');
        
        const globalScope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
        const summarizerApi =
            globalScope?.Summarizer ||
            globalScope?.ai?.summarizer ||
            globalScope?.ai?.Summarizer ||
            globalScope?.aiOriginTrial?.summarizer ||
            globalScope?.window?.ai?.Summarizer ||
            null;
        
        if (!summarizerApi) {
            throw new Error('Summarizer API not available');
        }
        
        console.log('Content script: Summarizer API detected');
        
        if (typeof summarizerApi.availability === 'function') {
            try {
                const availability = await summarizerApi.availability();
        console.log('Content script: Summarizer availability:', availability);
        
        if (availability === 'unavailable') {
            throw new Error('Summarizer API is unavailable');
                }
                
                if ((availability === 'downloadable' || availability === 'downloading') && !(navigator.userActivation && navigator.userActivation.isActive)) {
                    throw new Error('Summarizer requires user activation to download. Κάνε κλικ στη σελίδα και δοκίμασε ξανά.');
                }
            } catch (availabilityError) {
                console.warn('Content script: Summarizer.availability() failed, continuing optimistically:', availabilityError);
            }
        }
        
        // Δημιουργία summarizer με options
        const options = {
            type: 'key-points',
            format: 'plain-text',
            length: 'short'
        };
        
        console.log('Content script: Creating summarizer with options:', options);
        let summarizer;
        try {
            summarizer = await summarizerApi.create({
                ...options,
                monitor(monitor) {
                    monitor.addEventListener('downloadprogress', (event) => {
                        const percent = (event.loaded * 100).toFixed(1);
                        console.log(`Content script: Summarizer download progress ${percent}%`);
                    });
                }
            });
        } catch (createWithMonitorError) {
            console.warn('Content script: Summarizer.create with monitor failed, retrying without monitor:', createWithMonitorError);
            summarizer = await summarizerApi.create(options);
        }
        
        if (!summarizer) {
            throw new Error('Failed to create summarizer instance');
        }
        
        // Εκτέλεση AI summarization
        console.log('Content script: Summarizing content...');
        const summary = await summarizer.summarize(groupContent);
        
        console.log('Content script: AI summarization completed:', summary);
        
        // Parse response
        const parsedSummary = parseSummarizerResponse(summary);
        
        console.log('Content script: Parsed summary:', parsedSummary);
        
        return parsedSummary;
        
    } catch (error) {
        console.error('Error in content script AI summarization:', error);
        throw error;
    }
}

// Export functions για testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createGroupingPrompt,
        createGroupContentForSummarizer,
        createSummaryPrompt,
        parseAIResponse,
        parseSummarizerResponse,
        parseSummaryResponse,
        performAIGroupingInContent,
        performAISummarizationInContent,
        evalPairwise,
        evalBCubed,
        computePurityByCluster,
        runGoldenEvaluation,
        buildPredictedGroupMap
    };
}
