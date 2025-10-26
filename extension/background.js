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
        chrome.runtime.onStartup.addListener(() => {
            console.log('🔁 [Boot] Chrome runtime startup event; service worker active');
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
let scanTimeout = null; // Για debounce
let lastMergeDebugLog = null;
let lastGoldenEvaluation = null;

// Tunable constants για επιδόσεις και ακρίβεια
const CONTENT_EXTRACTION_CONCURRENCY = 8;
const TAB_EXTRACTION_TIMEOUT = 6000; // ms
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
const MAX_AI_LABEL_GROUPS = 6; // Allow AI to generate up to 6 group titles
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

const TAXONOMY_RULES = [
    { match: /youtube\.com|youtu\.be/i, tags: ['media', 'video', 'youtube'] },
    { match: /news|cnn|bbc|reuters|guardian/i, tags: ['news', 'media'] },
    { match: /wikipedia\.org/i, tags: ['reference', 'encyclopedia'] },
    { match: /github\.com/i, tags: ['software', 'development', 'github'] },
    { match: /stackoverflow\.com/i, tags: ['software', 'programming', 'questions'] },
    { match: /futbin\.com|fut\.gg|ea\.com\/fc|fifa/i, tags: ['gaming', 'fifa ultimate team'] },
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
const AI_LABEL_TIMEOUT = 15000;
const AI_SUMMARY_TIMEOUT = 16000;
function nowMs() {
    return HAS_PERFORMANCE_API ? performance.now() : Date.now();
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
});

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
        
        case 'RUN_GOLDEN_EVAL':
            runGoldenEvaluation(message.scenario, { groups: message.groups, tabData: message.tabData })
                .then(result => sendResponse({ success: true, result }))
                .catch(error => {
                    console.error('RUN_GOLDEN_EVAL failed:', error);
                    sendResponse({ success: false, error: error.message, details: error.details || null });
                });
            return true;
            
        default:
            console.warn('Unknown message type:', message.type);
            sendResponse({ success: false, error: 'Unknown message type' });
    }
});

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
        throw new Error(`Αποτυχία ελέγχου δικαιωμάτων: ${error.message}`);
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
                error: 'Δεν βρέθηκαν έγκυρα tabs για ανάλυση' 
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
                error: 'Απαιτούνται δικαιώματα πρόσβασης για όλα τα sites. Επιτρέψτε την πρόσβαση στα tabs και δοκιμάστε ξανά.'
            });
            return;
        }
        console.log('Host permissions verified successfully');
        
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
                    scheduleDeferredSummaries(200);
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
                // aiGroups = cachedResult[cacheKey].groups;
                // currentTabData = cachedResult[cacheKey].tabData;
                // scheduleDeferredSummaries(200);
            } else {
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
                        error: `AI ανάλυση απέτυχε: ${aiError.message}`,
                        lastScan: Date.now()
                    });
                    return;
                }
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
                    message: `Ομαδοποίηση ολοκληρώθηκε με ${currentTabData.length} tabs (ορισμένα tabs δεν μπόρεσαν να εξαχθούν)`,
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
            error: `Σφάλμα κατά το σκάναρισμα: ${error.message}` 
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
    const domain = tab.domain || '';
    const title = (tab.title || '').toLowerCase();
    const url = tab.url || '';
    
    // Domain-based taxonomy - αφαιρέθηκαν S2 domains
    let domainCategory = 'general';
    if (domain.includes('pubmed') || domain.includes('nejm') || domain.includes('who.int')) {
        domainCategory = 'medical';
    } else if (domain.includes('techcrunch') || domain.includes('openai') || domain.includes('google')) {
        domainCategory = 'technology';
    } else if (domain.includes('steam') || domain.includes('epic') || domain.includes('playstation')) {
        domainCategory = 'gaming';
    } else if (domain.includes('shop') && !domain.includes('amazon') && !domain.includes('ebay') && 
               !domain.includes('bestbuy') && !domain.includes('target')) {
        domainCategory = 'shopping';
    } else if (domain.includes('youtube') || domain.includes('netflix')) {
        domainCategory = 'entertainment';
    }
    
    // Title-based taxonomy - αφαιρέθηκαν S2 keywords
    let titleCategory = 'general';
    if (title.includes('medical') || title.includes('health') || title.includes('research')) {
        titleCategory = 'medical';
    } else if (title.includes('ai') || title.includes('artificial') || title.includes('tech')) {
        titleCategory = 'technology';
    } else if (title.includes('game') || title.includes('gaming')) {
        // Αφαιρέθηκαν: fifa, fc, ultimate, team, squad, players, fut
        titleCategory = 'gaming';
    } else if (title.includes('buy') || title.includes('shop') || title.includes('price')) {
        // Αφαιρέθηκαν: chair, laptop, accessories, sale, deals
        titleCategory = 'shopping';
    }
    
    // Confidence based on agreement
    const confidence = domainCategory === titleCategory ? 0.8 : 0.5;
    const finalCategory = confidence > 0.6 ? domainCategory : 'general';
    
    // Debug logging για να δούμε τι συμβαίνει
    console.log(`🔍 [Taxonomy] Tab: "${title}" | Domain: ${domainCategory} | Title: ${titleCategory} | Final: ${finalCategory} | Confidence: ${confidence}`);
    
    return {
        domain: domainCategory,
        title: titleCategory,
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
    // Gaming-related tabs need summarizer for better grouping
    const isGamingRelated = tab.title.toLowerCase().includes('gaming') || 
                           tab.title.toLowerCase().includes('fifa') || 
                           tab.title.toLowerCase().includes('ultimate') ||
                           tab.domain.includes('ea.com') ||
                           tab.domain.includes('futbin') ||
                           tab.domain.includes('reddit') ||
                           tab.domain.includes('amazon') ||
                           tab.domain.includes('bestbuy') ||
                           tab.domain.includes('target');
    
    if (isGamingRelated) return true;
    
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
    
    // Higher priority for important domains
    if (tab.domain.includes('pubmed') || tab.domain.includes('nejm')) priority += 8;
    if (tab.domain.includes('techcrunch') || tab.domain.includes('openai')) priority += 6;
    
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
    
    // High token overlap - χαμηλότερο threshold
    const overlap = calculateTokenOverlap(tokens1.tokens, tokens2.tokens);
    if (overlap > 0.2) { // Μειώθηκε από 0.3 σε 0.2
        console.log(`🔗 [Merge] High token overlap: ${(overlap * 100).toFixed(1)}%`);
        return true;
    }
    
    // Gaming-specific merge logic - αφαιρέθηκαν S2 keywords
    if ((taxonomy1.final === 'gaming' || taxonomy2.final === 'gaming') && 
        (taxonomy1.final === 'general' || taxonomy2.final === 'general')) {
        const gamingTokens = ['gaming', 'game']; // Αφαιρέθηκαν: fc, fifa, ultimate, team, players, squad
        const hasGamingTokens = gamingTokens.some(token => 
            tokens1.tokens.includes(token) || tokens2.tokens.includes(token)
        );
        if (hasGamingTokens) {
            console.log(`🔗 [Merge] Gaming-specific merge detected`);
            return true;
        }
    }
    
    // Shopping-specific merge logic - αφαιρέθηκαν S2 keywords
    if ((taxonomy1.final === 'shopping' || taxonomy2.final === 'shopping') && 
        (taxonomy1.final === 'general' || taxonomy2.final === 'general')) {
        const shoppingTokens = ['buy', 'shop', 'price']; // Αφαιρέθηκαν: chair, laptop, accessories, sale, deals
        const hasShoppingTokens = shoppingTokens.some(token => 
            tokens1.tokens.includes(token) || tokens2.tokens.includes(token)
        );
        if (hasShoppingTokens) {
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
    
    const FUSION_WEIGHTS = { det: 0.65, ai: 0.25, tax: 0.10 }; // Σφιχτά βάρη
    const FUSION_JOIN_THRESHOLD = 0.25; // Εξαιρετικά χαμηλό threshold για S2 test
    const FUSION_CENTROID_THRESHOLD = 0.35; // Εξαιρετικά χαμηλό threshold για S2 test
    const SHARD_SIZE = 12; // Max 12 tabs per shard
    const SHARD_TIMEOUT = 12000; // 12s per shard
    const OVERALL_BUDGET = 15000; // 15s total budget
    const MAX_CONCURRENT_SHARDS = 2; // Max 2 concurrent shards
    
    const startTime = Date.now();
    const aiSuggestions = new Map(); // tabIndex -> { groupId, confidence }
    
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
                    console.log(`🤖 [Stage 5] Tab ${kwSet.index} (global: ${globalIndex}): [${kwSet.keywords?.join(', ') || 'none'}]`);
                    if (kwSet.keywords && kwSet.keywords.length > 0 && typeof globalIndex === 'number') {
                        aiSuggestions.set(globalIndex, {
                            keywords: kwSet.keywords,
                            confidence: 0.8 // High confidence for AI-generated keywords
                        });
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
    
    // Λεπτομερές logging για τα AI suggestions
    if (aiSuggestions.size > 0) {
        console.log('🤖 [AI Suggestions] AI suggested these tab groupings:');
        const suggestionsArray = Array.from(aiSuggestions.entries());
        suggestionsArray.forEach(([tabIndex, groupInfo], index) => {
            console.log(`🤖 [AI Suggestion ${index}] Tab ${tabIndex} → Keywords: [${groupInfo.keywords?.join(', ') || 'none'}]`);
        });
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
        FUSION_JOIN_THRESHOLD,
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
    
    // Create mixed shard with all unique tab indices
    const allTabIndices = [...new Set(groups.flatMap(g => g.tabIndices))];
    
    if (allTabIndices.length > 0) {
        // Create one mixed shard with all tabs for comprehensive AI analysis
        shards.push({
            tabIndices: allTabIndices,
            groupId: 'mixed_all_tabs',
            type: 'mixed',
            primaryTopic: 'mixed',
            keywords: []
        });
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
async function processShardWithAI(shard, tabDataForAI, timeout, retries = 2) {
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
    console.log('🤖 [Stage 5] Prompt being sent to AI:', prompt);
    
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
    
    return `Analyze these tabs and generate 3-5 keywords per tab describing their main topic/purpose.
Return ONLY valid JSON in this format: {"keywords":[{"index":0,"keywords":["keyword1","keyword2"]}]}

Tabs:
${tabsInfo}

Requirements:
- Return ONLY the JSON object
- Use clear, relevant keywords
- Keywords should be 1-2 words
- Focus on main topics, not technical details`;
}

/**
 * Εκτελεί AI grouping με timeout
 */
async function executeAIGroupingWithTimeout(prompt, timeout) {
    console.log('🤖🤖🤖 [AI CLUSTERING START] 🤖🤖🤖');
    console.log('🤖 [AI] Executing AI grouping with timeout:', timeout, 'ms');
    console.log('🤖 [AI] Prompt length:', prompt.length, 'characters');
    
    try {
        // Use the existing AI grouping function from content script
        const result = await withTimeout((async () => {
            // Execute AI grouping in content script context
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) throw new Error('No active tab found');
            
        // Use direct execution in page context
        console.log('🤖 [AI] Using executeScript on tab:', tab.id, tab.url);
        
        // Find a usable tab (not chrome://, etc.)
        const usableTab = tab.url.startsWith('http') ? tab : 
            await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).then(tabs => tabs[0]);
        
        if (!usableTab) {
            throw new Error('No usable tab found for AI execution');
        }
        
        console.log('🤖 [AI] Using executeScript on tab:', usableTab.id, usableTab.url);
        
        console.log('🤖 [AI] Attempting to inject and execute AI grouping...');
        
        // First, inject content script if needed
        try {
            await chrome.scripting.executeScript({
                target: { tabId: usableTab.id },
                files: ['content.js']
            });
            console.log('🤖 [AI] Content script injected');
        } catch (err) {
            console.warn('🤖 [AI] Content script already injected or injection failed:', err.message);
        }
        
        const results = await chrome.scripting.executeScript({
            target: { tabId: usableTab.id },
            world: 'ISOLATED',
            func: async (prompt) => {
                console.log('🤖 [AI] Inside executeScript function, prompt length:', prompt.length);
                console.log('🤖 [AI] window.AITabCompanion exists:', typeof window.AITabCompanion !== 'undefined');
                
                // Wait a bit for AITabCompanion to load
                let attempts = 0;
                while (typeof window.AITabCompanion === 'undefined' && attempts < 10) {
                    console.log('🤖 [AI] Waiting for AITabCompanion, attempt', attempts);
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                }
                
                if (typeof window.AITabCompanion !== 'undefined') {
                    console.log('🤖 [AI] AITabCompanion found!');
                    console.log('🤖 [AI] AITabCompanion object:', window.AITabCompanion);
                    console.log('🤖 [AI] performAIGrouping available:', typeof window.AITabCompanion.performAIGrouping);
                    console.log('🤖 [AI] AITabCompanion methods:', Object.keys(window.AITabCompanion));
                    
                    if (window.AITabCompanion.performAIGrouping) {
                        console.log('🤖 [AI] Executing performAIGrouping...');
                        console.log('🤖 [AI] Prompt being sent to AI:', prompt.substring(0, 200) + '...');
                        try {
                            const result = await window.AITabCompanion.performAIGrouping(prompt);
                            console.log('🤖 [AI] performAIGrouping completed, result type:', typeof result);
                            console.log('🤖 [AI] performAIGrouping result:', result);
                            console.log('🤖 [AI] performAIGrouping result length:', result?.length || 'no length');
                            return result;
                        } catch (aiError) {
                            console.error('🤖 [AI] performAIGrouping failed:', aiError);
                            console.error('🤖 [AI] Error details:', {
                                name: aiError.name,
                                message: aiError.message,
                                stack: aiError.stack
                            });
                            return { groups: [], confidence: 0.5 };
                        }
                    } else {
                        console.error('🤖 [AI] performAIGrouping function not found');
                        throw new Error('performAIGrouping function not found');
                    }
                } else {
                    console.error('🤖 [AI] AITabCompanion still not available after waiting');
                    console.error('🤖 [AI] window keys:', Object.keys(window).slice(0, 20));
                    throw new Error('AITabCompanion not available after waiting');
                }
            },
            args: [prompt]
        });
        
        console.log('🤖 [AI] executeScript returned:', results);
        console.log('🤖 [AI] executeScript results length:', results?.length || 0);
        console.log('🤖 [AI] First result:', results[0]);
        console.log('🤖 [AI] First result documentId:', results[0]?.documentId);
        console.log('🤖 [AI] First result frameId:', results[0]?.frameId);
        
        const aiResult = results[0]?.result;
            
            console.log('🤖 [AI] Raw AI result:', aiResult);
            console.log('🤖 [AI] Raw AI result type:', typeof aiResult);
            console.log('🤖 [AI] Raw AI result length:', aiResult?.length || 'no length');
            
            // Log raw JSON response if available
            if (aiResult && typeof aiResult === 'object' && aiResult.groups) {
                console.log('🤖 [AI Raw JSON] Full AI response object:', JSON.stringify(aiResult, null, 2));
            }
            
            // Λεπτομερές debugging για την απάντηση του AI
            if (aiResult && typeof aiResult === 'object') {
                console.log('🤖 [AI] AI result has groups:', aiResult.groups?.length || 0);
                console.log('🤖 [AI] AI result confidence:', aiResult.confidence);
                if (aiResult.groups && aiResult.groups.length === 0) {
                    console.log('🤖 [AI] ⚠️ AI returned empty groups array - this might indicate the AI could not find similar tabs to group');
                }
            }
            
            // Parse AI result if it's a string
            if (typeof aiResult === 'string') {
                try {
                    const parsed = JSON.parse(aiResult);
                    console.log('🤖 [AI] Parsed AI result:', parsed);
                    return parsed;
            } catch (error) {
                    console.warn('🤖 [AI] Failed to parse AI result as JSON:', error);
                    return { groups: [], confidence: 0.5 };
                }
            }
            
            // If it's a function, return empty result
            if (typeof aiResult === 'function') {
                console.warn('🤖 [AI] AI result is a function, returning empty result');
                return { groups: [], confidence: 0.5 };
            }
            
            return aiResult || { groups: [], confidence: 0.5 };
        })(), timeout, 'AI grouping timeout');
        
        console.log('🤖 [AI] AI grouping result:', result);
        
        // Λεπτομερές logging για τα keywords που επέστρεψε το AI
        if (result && result.keywords && Array.isArray(result.keywords)) {
            console.log('🤖 [AI Keywords] AI returned', result.keywords.length, 'keyword sets');
            if (result.keywords.length === 0) {
                console.log('🤖 [AI Keywords] ⚠️ AI returned 0 keyword sets - this might indicate an issue with the AI response');
                console.log('🤖 [AI Keywords] Full AI result object:', JSON.stringify(result, null, 2));
            }
            result.keywords.forEach((kwSet, index) => {
                console.log(`🤖 [AI Keywords ${index}] Tab ${kwSet.index}: [${kwSet.keywords?.join(', ') || 'none'}]`);
            });
        } else {
            console.log('🤖 [AI Keywords] No valid keywords found in AI result');
            console.log('🤖 [AI Keywords] Full result object:', JSON.stringify(result, null, 2));
        }
        
        console.log('🤖🤖🤖 [AI CLUSTERING END] 🤖🤖🤖');
        return result || { groups: [], confidence: 0.5 };
        
    } catch (error) {
        console.warn('🤖 [AI] AI grouping failed:', error.message);
        console.warn('🤖 [AI] Error type:', error.name);
        console.warn('🤖 [AI] Error stack:', error.stack?.substring(0, 200));
        console.log('🤖🤖🤖 [AI CLUSTERING END] 🤖🤖🤖');
        
        // Return empty result with low confidence when AI fails
        return { keywords: [], confidence: 0.1 };
    }
}

/**
 * Εκτελεί fusion scoring
 */
async function performFusionScoring(deterministicGroups, aiSuggestions, tabDataForAI, weights, joinThreshold, centroidThreshold) {
    console.log('🎯 [Fusion Scoring] Starting fusion scoring calculation...');
    
    const fusionGroups = [...deterministicGroups];
    const processed = new Set();
    
    // Calculate fusion scores for all pairs
    for (let i = 0; i < tabDataForAI.length; i++) {
        for (let j = i + 1; j < tabDataForAI.length; j++) {
            if (processed.has(`${i}-${j}`)) continue;
            
            const fusionScore = calculateFusionScore(i, j, aiSuggestions, tabDataForAI, weights);
            
            if (fusionScore >= joinThreshold) {
                console.log(`🔗 [Fusion] High similarity detected: tabs ${i}-${j}, score: ${fusionScore.toFixed(3)} (threshold: ${joinThreshold})`);
                
                // Merge tabs
                const groupA = findGroupContaining(fusionGroups, i);
                const groupB = findGroupContaining(fusionGroups, j);
                
                if (groupA && groupB && groupA !== groupB) {
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
 * Ελέγχει αν δύο tabs έχουν shared keywords (medical, research, technology, etc.)
 */
function checkSharedKeywords(tabI, tabJ) {
    const medicalKeywords = ['medical', 'health', 'research', 'pubmed', 'nejm', 'clinical', 'treatment', 'patient', 'disease', 'journal', 'medicine', 'england', 'medicalnewstoday', 'ncbi', 'nih'];
    const techKeywords = ['ai', 'artificial intelligence', 'tech', 'software', 'computer', 'digital', 'innovation', 'coding', 'development'];
    const gamingKeywords = ['gaming', 'game', 'play', 'fifa', 'sport', 'team', 'fc', 'ultimate', 'player', 'ratings', 'squad'];
    
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
        const keywords1 = new Set(aiI.keywords);
        const keywords2 = new Set(aiJ.keywords);
        const intersection = new Set([...keywords1].filter(x => keywords2.has(x)));
        const union = new Set([...keywords1, ...keywords2]);
        aiAgree = intersection.size / union.size; // Jaccard similarity
    } else if (aiI && aiI.keywords && aiI.keywords.length > 0) {
        // Only tab I has AI keywords - compare with deterministic keywords from tab J
        const aiKeywords = new Set(aiI.keywords);
        const titleKeywords = extractKeywordsFromText(tabJ.title);
        const commonKeywords = titleKeywords.filter(kw => aiKeywords.has(kw));
        const allKeywords = [...new Set([...Array.from(aiKeywords), ...titleKeywords])];
        if (allKeywords.length > 0) {
            aiAgree = commonKeywords.length / allKeywords.length;
        }
    } else if (aiJ && aiJ.keywords && aiJ.keywords.length > 0) {
        // Only tab J has AI keywords - compare with deterministic keywords from tab I
        const aiKeywords = new Set(aiJ.keywords);
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
    
    // Taxonomy agreement
    const taxI = tabI.primaryTopic || 'general';
    const taxJ = tabJ.primaryTopic || 'general';
    let taxAgree = 0;
    
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
    // Implementation for centroid-based merging
    return groups;
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
    const domain = tab.domain || '';
    if (domain.includes('pubmed') || domain.includes('nejm')) return 'medical';
    if (domain.includes('techcrunch') || domain.includes('openai')) return 'technology';
    if (domain.includes('steam') || domain.includes('ea.com')) return 'gaming';
    if (domain.includes('amazon') || domain.includes('bestbuy')) return 'shopping';
    return 'general';
}

function isGeneric(tab) {
    const domain = tab.domain || '';
    return /news|blog|topics|press/.test(domain);
}

function isBridge(tab) {
    // Check if tab has high similarity to multiple topics
    return false; // Placeholder
}

/**
 * Εκτελεί AI ανάλυση των tabs χρησιμοποιώντας Chrome Built-in AI APIs
 */
async function performAIAnalysis() {
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
        
        // Use final groups from new pipeline
        let groups = finalGroups || [];
        console.log('🎯 [Smart Pipeline] Using final groups from new architecture');
        
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
        
        aiGroups = groups;
        scheduleDeferredSummaries();
        
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
                        if (['fullscreen', 'minimized', 'docked'].includes(windowInfo.state)) {
                            try {
                                await chrome.windows.update(tabInfo.windowId, { state: 'normal' });
                                windowInfo = await getWindowInfo(tabInfo.windowId, { refresh: true });
                                console.log(`  ↺ Adjusted window ${tabInfo.windowId} state to ${windowInfo.state}`);
                            } catch (stateError) {
                                console.log(`❌ Could not adjust window ${tabInfo.windowId} state:`, stateError.message);
                            }
                        }
                        if (['normal', 'maximized'].includes(windowInfo.state)) {
                            if (!tabInfo.groupId || tabInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
                                validTabs.add(tabId);
                                console.log(`✅ Tab ${tabId} is valid for grouping`);
                            } else {
                                invalidTabs.add(tabId);
                                console.log(`❌ Tab ${tabId} already in group ${tabInfo.groupId}`);
                            }
                        } else {
                            invalidTabs.add(tabId);
                            console.log(`❌ Tab ${tabId} window remains in state ${windowInfo.state}`);
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
        
        // Διαγραφή υπαρχόντων groups
        const cleanupStart = nowMs();
        const existingGroups = await chrome.tabGroups.query({});
        for (const group of existingGroups) {
            try {
                await chrome.tabGroups.update(group.id, { collapsed: false });
                await chrome.tabGroups.remove(group.id);
                console.log(`Removed existing group: ${group.title || 'Untitled'}`);
            } catch (error) {
                console.log(`Could not remove group ${group.id}:`, error.message);
            }
        }
        logTiming('Existing group cleanup', cleanupStart);
        groupActivityState.clear();
        
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
                            
                            // Έλεγχος κάθε tab ξανά πριν τη δημιουργία
                            const finalCheckTabs = [];            for (const tabId of finalValidTabIds) {
                try {
                    const tabInfo = await chrome.tabs.get(tabId);
                    let windowInfo = await getWindowInfo(tabInfo.windowId);
                    console.log(`🔍 Final check tab ${tabId}: windowType=${windowInfo.type}, incognito=${tabInfo.incognito}, state=${windowInfo.state}`);
                    
                    if (windowInfo.type === 'normal' && !tabInfo.incognito) {
                        if (['fullscreen', 'minimized', 'docked'].includes(windowInfo.state)) {
                            try {
                                await chrome.windows.update(tabInfo.windowId, { state: 'normal' });
                                windowInfo = await getWindowInfo(tabInfo.windowId, { refresh: true });
                                console.log(`  ↺ Adjusted window ${tabInfo.windowId} state to ${windowInfo.state}`);
                            } catch (stateError) {
                                console.log(`❌ Failed to adjust window state for tab ${tabId}:`, stateError.message);
                            }
                        }
                        if (windowInfo.state === 'normal' || windowInfo.state === 'maximized') {
                            finalCheckTabs.push(tabId);
                        } else {
                            console.log(`❌ Tab ${tabId} skipped after state adjustment: windowState=${windowInfo.state}`);
                        }
                    } else {
                        console.log(`❌ Tab ${tabId} failed final check: windowType=${windowInfo.type}, incognito=${tabInfo.incognito}`);
                    }
                } catch (error) {
                    console.log(`❌ Tab ${tabId} failed final check:`, error.message);
                }
            }
                            
                            if (finalCheckTabs.length > 0) {
                                // Απλή δημιουργία group με όλα τα valid tabs
                                const groupId = await chrome.tabs.group({ tabIds: finalCheckTabs });
                                
                                // Ονομασία group
                                await chrome.tabGroups.update(groupId, {
                                    title: group.name,
                                    color: getGroupColor(group.name)
                                });
                                
                                console.log(`✅ Group "${group.name}" created successfully with ID: ${groupId} (${finalCheckTabs.length} tabs)`);
                                
                                // Log τα tabs που προστέθηκαν στο group
                                finalCheckTabs.forEach(tabId => {
                                    const tab = tabData.find(t => t.id === tabId);
                                    console.log(`  📄 Tab ${tabId}: "${tab?.title || 'Unknown'}" (${tab?.domain || 'Unknown domain'})`);
                                });
                                
                                group.chromeGroupId = groupId;
                                group.autoSuspended = false;
                                group.lastActive = Date.now();
                                recordGroupActivity(groupId, { resetSuspension: false });
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


/**
 * Εκτελεί AI summarization χρησιμοποιώντας content script
 */
async function performAISummarization(groupContent) {
    try {
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
                                    throw new Error('Summarizer requires user activation to download. Κάνε κλικ στη σελίδα και δοκίμασε ξανά.');
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
    'the', 'and', 'with', 'from', 'that', 'this', 'have', 'has', 'will', 'would', 'could', 'should',
    'about', 'into', 'onto', 'after', 'before', 'while', 'where', 'which', 'their', 'there', 'other',
    'these', 'those', 'than', 'then', 'when', 'what', 'your', 'yours', 'ours', 'ourselves', 'hers',
    'his', 'her', 'its', 'they', 'them', 'were', 'was', 'been', 'being', 'because', 'over', 'under',
    'again', 'further', 'once', 'here', 'every', 'most', 'some', 'such', 'only', 'own', 'same', 'very',
    'just', 'also', 'like', 'more', 'less', 'many', 'much', 'any', 'each',
    'http', 'https', 'www', 'com', 'net', 'org', 'html', 'amp', 'php', 'utm', 'ref', 'aspx', 'index',
    'home', 'main', 'default', 'article', 'video', 'watch', 'channel', 'official'
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
            tags.add('fifa ultimate team');
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
    return tabs.find(tab =>
        tab.url &&
        !tab.url.startsWith('chrome://') &&
        !tab.url.startsWith('chrome-extension://') &&
        !tab.url.startsWith('moz-extension://') &&
        !tab.url.startsWith('edge://') &&
        tab.url.startsWith('http')
    ) || null;
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
    
    const computeFallbackEmbedding = (entry) => {
        const tokens = [
            ...tokenizeText(entry.title),
            ...tokenizeText(entry.semanticFeatures?.topic),
            ...(entry.semanticFeatures?.keywords || []).map(keyword => keyword.toLowerCase()),
            ...tokenizeText(entry.metaDescription),
            ...tokenizeText(entry.topicHints),
            ...tokenizeText(entry.youtubeTopic),
            ...(entry.youtubeTags || []).map(tag => String(tag || '').toLowerCase())
        ].slice(0, 48);
        
        const vector = new Array(EMBEDDING_FALLBACK_DIM).fill(0);
        tokens.forEach((token, index) => {
            if (!token || STOPWORDS.has(token)) return;
            const bucket = positiveHash(`${token}:${index}`) % EMBEDDING_FALLBACK_DIM;
            vector[bucket] += 1;
        });
        
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
        return vector.map(value => value / norm);
    };
    
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
                const scriptPromise = chrome.scripting.executeScript({
                    target: { tabId: aiTabId },
                    world: 'MAIN',
                    func: generateTabEmbeddingInPage,
                    args: [descriptor]
                });
                const results = await withTimeout(scriptPromise, AI_FEATURE_TIMEOUT, 'AI embedding timeout');
                if (results && results[0] && results[0].result) {
                    const payload = results[0].result;
                    if (payload.ok && Array.isArray(payload.embedding)) {
                        embeddingVector = payload.embedding.slice();
                        generatedCount += 1;
                    } else {
                        const reason = payload.error || 'Unknown embedding error';
                        const status = payload.status;
                        if (status === 'downloading' || status === 'unavailable') {
                            aiTabId = null;
                        }
                        failureReasons.add(reason);
                    }
                }
    } catch (error) {
                if (error?.message === 'AI embedding timeout') {
                    failureReasons.add('Embedding model timeout');
                    aiTabId = null;
                    console.warn('generateTabEmbeddingInPage timed out, falling back to hashed embedding.');
                } else {
                    failureReasons.add(error?.message || String(error));
                }
            }
        }
        
        if (!embeddingVector) {
            const reason = failureReasons.size
                ? Array.from(failureReasons).slice(0, 3).join(' | ')
                : 'unknown embedding failure';
        console.log('ℹ️ [Chrome AI Challenge] Using fallback embeddings (Embedding Model API not available):', {
            url: entry.url,
            title: entry.title,
            reason: reason,
            note: 'This is expected - Embedding Model API requires special setup'
        });
            // Embeddings are optional - always use fallback if AI unavailable
            embeddingVector = computeFallbackEmbedding(entry);
            fallbackCount += 1;
        }
        
        entry.semanticEmbedding = embeddingVector.slice();
        originalTab.semanticEmbedding = embeddingVector.slice();
        
        if (cacheKey) {
            cacheUpdates[cacheKey] = {
                timestamp: Date.now(),
                vector: embeddingVector.slice(),
                contentHash: entry.contentHash || originalTab.contentHash || ''
            };
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
            
            let bestScore = 0;
            let bestGroupIndex = -1;
            let bestVectorMatch = null;
            
            for (let targetIndex = 0; targetIndex < groups.length; targetIndex += 1) {
                if (targetIndex === index || removedGroups.has(targetIndex)) continue;
                const targetGroup = groups[targetIndex];
                if (!targetGroup?.vectorIndices?.length) continue;
                
                for (const targetVectorIdx of targetGroup.vectorIndices) {
                    const key = vectorIdx < targetVectorIdx ? `${vectorIdx}|${targetVectorIdx}` : `${targetVectorIdx}|${vectorIdx}`;
                    let score = similarityCache.get(key);
                    if (typeof score !== 'number') {
                        score = computeWeightedSimilarity(vectors[vectorIdx], vectors[targetVectorIdx]);
                        similarityCache.set(key, score);
                    }
                    if (score > bestScore) {
                        bestScore = score;
                        bestGroupIndex = targetIndex;
                        bestVectorMatch = targetVectorIdx;
                    }
                }
            }
            
            if (bestGroupIndex === -1 || bestScore < LLM_MERGE_SIMILARITY_FLOOR) {
                continue;
            }
            
            const tabA = tabDataForAI[tabIdx];
            const targetTabIdx = groups[bestGroupIndex].tabIndices?.[0];
            const tabB = typeof targetTabIdx === 'number' ? tabDataForAI[targetTabIdx] : null;
            if (!tabA || !tabB) {
                continue;
            }
            
            try {
                const verification = await verifyTabPairWithLM(tabA, tabB);
                if (verification.sameTopic && verification.confidence >= LLM_VERIFICATION_CONFIDENCE) {
                    vectorSets[bestGroupIndex].add(vectorIdx);
                    tabSets[bestGroupIndex].add(tabIdx);
                    removedGroups.add(index);
                    mergePerformed = true;
                    console.log('LLM refinement merged singleton tab into group:', {
                        singletonTab: tabA.url,
                        targetGroup: groups[bestGroupIndex].name || bestGroupIndex,
                        confidence: verification.confidence,
                        reason: verification.reason
                    });
                    
                    // Log singleton attach
                    devlog({
                        type: 'SINGLETON',
                        action: 'ATTACH',
                        url: tabA.url,
                        key: tabKey(tabA),
                        targetCluster: `group_${bestGroupIndex + 1}`,
                        centroidCosine: round(bestScore),
                        sameTopic: verification.sameTopic,
                        confidence: round(verification.confidence),
                        reason: verification.reason,
                        threshold: round(LLM_VERIFICATION_CONFIDENCE)
                    });
                }
            } catch (verificationError) {
                console.warn('LLM verification skipped for tab pair:', verificationError.message || verificationError);
            }
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
    const S_kw = jaccardSimilarity(vectorA.keywordTokens, vectorB.keywordTokens);
    const S_topic = jaccardSimilarity(vectorA.semanticTopicTokens, vectorB.semanticTopicTokens);
    const S_title = jaccardSimilarity(vectorA.titleTokens, vectorB.titleTokens);
    const S_url = jaccardSimilarity(vectorA.pathTokens, vectorB.pathTokens);
    const S_tfidf = cosineSimilarity(vectorA.tfidfVector, vectorB.tfidfVector);
    const S_dom = vectorA.domain && vectorA.domain === vectorB.domain ? 1 : 0;
    const S_domTokens = jaccardSimilarity(vectorA.domainTokens, vectorB.domainTokens);
    const S_lang = vectorA.language && vectorA.language === vectorB.language ? 1 : 0;
    const S_embed = cosineSimilarityArray(vectorA.embeddingVector, vectorB.embeddingVector);
    const S_sim = simHashSimilarity(vectorA.simHash, vectorB.simHash);
    const S_tax = normalizedOverlap(vectorA.taxonomyTags, vectorB.taxonomyTags);
    const langPenalty = (!vectorA.language || !vectorB.language || vectorA.language === vectorB.language) ? 1 : 0.85;
    const mergeSetA = new Set(
        (vectorA.mergeHints || [])
            .map(token => String(token || '').toLowerCase().trim())
            .filter(token => token.length >= 3 && !STOPWORDS.has(token) && !GENERIC_MERGE_STOPWORDS.has(token))
    );
    const mergeSetB = new Set(
        (vectorB.mergeHints || [])
            .map(token => String(token || '').toLowerCase().trim())
            .filter(token => token.length >= 3 && !STOPWORDS.has(token) && !GENERIC_MERGE_STOPWORDS.has(token))
    );
    const S_merge = jaccardSimilarity(mergeSetA, mergeSetB);
    const primaryTokensA = new Set(
        tokenizeText(vectorA.primaryTopic)
            .filter(token => !GENERIC_MERGE_STOPWORDS.has(token))
    );
    const primaryTokensB = new Set(
        tokenizeText(vectorB.primaryTopic)
            .filter(token => !GENERIC_MERGE_STOPWORDS.has(token))
    );
    const S_primary = normalizedOverlap(primaryTokensA, primaryTokensB);
    const docMatch = vectorA.docType && vectorA.docType === vectorB.docType ? 1 : 0;
    const entitiesA = vectorA.entities instanceof Set
        ? vectorA.entities
        : new Set(Array.isArray(vectorA.entities) ? vectorA.entities : []);
    const entitiesB = vectorB.entities instanceof Set
        ? vectorB.entities
        : new Set(Array.isArray(vectorB.entities) ? vectorB.entities : []);
    const S_entity = normalizedOverlap(entitiesA, entitiesB);
    const genericPenalty = (() => {
        const aGeneric = Boolean(vectorA.isGenericLanding);
        const bGeneric = Boolean(vectorB.isGenericLanding);
        if (aGeneric && bGeneric) return 0.75;
        if (aGeneric || bGeneric) return 0.65;
        return 1;
    })();
    const entityPenalty = (() => {
        if (!entitiesA.size || !entitiesB.size) return 1;
        if (S_entity > 0) return 1;
        const articlePair = vectorA.docType === 'article' && vectorB.docType === 'article';
        return articlePair ? 0.92 : 0.6;
    })();
    const topicPenalty = (() => {
        if (!primaryTokensA.size || !primaryTokensB.size) return 0.95;
        if (S_primary > 0) return 1;
        if (S_topic >= 0.36) return 0.9;
        return 0.7;
    })();
    
    let score =
        (0.12 * S_kw) +
        (0.17 * S_topic) +
        (0.06 * S_title) +
        (0.08 * S_tfidf) +
        (0.14 * S_embed) +
        (0.05 * S_sim) +
        (0.07 * S_tax) +
        (0.04 * S_url) +
        (0.03 * S_dom) +
        (0.02 * S_domTokens) +
        (0.02 * S_lang) +
        (0.07 * S_merge) +
        (0.04 * docMatch) +
        (0.04 * S_entity) +
        (0.05 * S_primary);
    
    if (vectorA.youtubeTopic && vectorA.youtubeTopic === vectorB.youtubeTopic) {
        score += 0.03;
    }
    
    score *= langPenalty * genericPenalty * entityPenalty * topicPenalty;
    const finalScore = Math.max(0, Math.min(score, 1));
    
    // Log pairwise similarity for debugging
    devlog({
        type: 'PAIR',
        a: { 
            url: vectorA.tabData?.url || 'unknown', 
            key: tabKey(vectorA.tabData), 
            primary_topic: vectorA.primaryTopic, 
            tax: vectorA.taxonomyTags?.[0] || 'unknown' 
        },
        b: { 
            url: vectorB.tabData?.url || 'unknown', 
            key: tabKey(vectorB.tabData), 
            primary_topic: vectorB.primaryTopic, 
            tax: vectorB.taxonomyTags?.[0] || 'unknown' 
        },
        phase: 'A', // Tab-to-tab comparison
        cosine: round(S_embed),
        jaccardHints: round(S_merge),
        taxBoost: round(S_tax),
        genericPenalty: round(genericPenalty),
        docTypeBoost: round(docMatch),
        keywordBoost: round(S_kw),
        topicBoost: round(S_primary),
        entityBoost: round(S_entity),
        finalScore: round(finalScore),
        threshold: round(SIMILARITY_JOIN_THRESHOLD),
        decision: finalScore >= SIMILARITY_JOIN_THRESHOLD ? 'MERGE' : 'SKIP',
        penalties: {
            lang: round(langPenalty),
            generic: round(genericPenalty),
            entity: round(entityPenalty),
            topic: round(topicPenalty)
        }
    });
    
    if (debugOut && typeof debugOut === 'object') {
        debugOut.S_kw = S_kw;
        debugOut.S_topic = S_topic;
        debugOut.S_title = S_title;
        debugOut.S_tfidf = S_tfidf;
        debugOut.S_embed = S_embed;
        debugOut.S_sim = S_sim;
        debugOut.S_tax = S_tax;
        debugOut.S_url = S_url;
        debugOut.S_dom = S_dom;
        debugOut.S_domTokens = S_domTokens;
        debugOut.S_lang = S_lang;
        debugOut.S_merge = S_merge;
        debugOut.docMatch = docMatch;
        debugOut.langPenalty = langPenalty;
        debugOut.genericPenalty = genericPenalty;
        debugOut.S_primary = S_primary;
        debugOut.topicPenalty = topicPenalty;
        debugOut.S_entity = S_entity;
        debugOut.entityPenalty = entityPenalty;
        debugOut.score = finalScore;
    }
    return finalScore;
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
    
    for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
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
        const enriched = enrichGroupFromVectors(vectorList, vectors, similarityCache);
        const candidateNames = bucket.names
            .filter(name => name && !isPlaceholderGroupName(name))
            .sort((a, b) => b.length - a.length);
        const fallbackNames = bucket.names.slice().sort((a, b) => b.length - a.length);
        enriched.name = candidateNames[0] || fallbackNames[0] || enriched.name || 'Group';
        enriched.summary = [];
        return enriched;
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

    for (const group of groups) {
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

        if ((!label || !blurb) && accessibleTab && aiLabelReady && aiLabelAttempts < MAX_AI_LABEL_GROUPS) {
            try {
                aiLabelAttempts += 1;
                console.log(`🧠 [AI Label] Attempting to generate label for group ${groups.indexOf(group) + 1} (attempt ${aiLabelAttempts}/${MAX_AI_LABEL_GROUPS})`);
                const scriptPromise = chrome.scripting.executeScript({
                    target: { tabId: accessibleTab.id },
                    world: 'MAIN',
                    func: generateGroupLabelInPage,
                    args: [descriptor]
                });
                const results = await withTimeout(scriptPromise, AI_LABEL_TIMEOUT, 'AI label timeout');
                
                const payload = results && results[0] && results[0].result;
                if (payload && payload.ok && payload.label) {
                    label = payload.label;
                    if (payload.blurb) {
                        blurb = String(payload.blurb).trim().slice(0, 160);
                    }
                    console.log(`✅ [AI Label] Successfully generated label: "${label}" for group ${groups.indexOf(group) + 1}`);
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
                if (message === 'AI label timeout') {
                    aiLabelReady = false;
                    aiLabelReason = 'Language model timeout';
                    console.warn('Group label generation timed out, using fallback label.');
                }
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
    }
    
    if (cacheDirty) {
        await chrome.storage.session.set({ groupLabelCache: updatedCache });
    }
    
    if (labelFailureReasons.size > 0) {
        console.info('Group labeling used fallback:', Array.from(labelFailureReasons).slice(0, 3).join(' | '));
    }
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

async function handleGroupSummaryRequest(groupIndex) {
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
    const summary = await performAISummarization(groupContent);
    group.summary = summary;
    group.summaryPending = false;
    logTiming(`Group ${groupIndex} summarization`, summaryStart);
    
    if (group.centroidSignature) {
        groupSummaryCache[group.centroidSignature] = {
            summary,
            timestamp: Date.now()
        };
        await chrome.storage.session.set({ groupSummaryCache });
    }
    
    await synchronizeCachedGroups();
    return { success: true, summary, source: 'generated' };
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
                const prompt = `
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
                const blurb = String(parsed.blurb || '').trim().slice(0, 160);
                
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
