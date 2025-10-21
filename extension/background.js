/**
 * AI Tab Companion - Background Script
 * Χειρίζεται την επικοινωνία μεταξύ popup και content scripts
 * και την ενσωμάτωση με το Chrome AI (Gemini Nano)
 */

// Global state για το extension
let isScanning = false;
let currentTabData = [];
let aiGroups = [];
let scanTimeout = null; // Για debounce

// Tunable constants για επιδόσεις και ακρίβεια
const CONTENT_EXTRACTION_CONCURRENCY = 8;
const TAB_EXTRACTION_TIMEOUT = 6000; // ms
const SIMILARITY_JOIN_THRESHOLD = 0.56;
const SIMILARITY_SPLIT_THRESHOLD = 0.45;
const CROSS_GROUP_MERGE_THRESHOLD = 0.54;
const CROSS_GROUP_KEYWORD_OVERLAP = 0.35;
const CROSS_GROUP_TOPIC_OVERLAP = 0.4;
const CROSS_GROUP_TAXONOMY_OVERLAP = 0.5;
const SMALL_GROUP_MAX_SIZE = 3;
const GROUP_NAME_SIMILARITY_THRESHOLD = 0.62;
const GROUP_NAME_VECTOR_THRESHOLD = 0.5;
const EMBEDDING_MIN_CONTENT_CHARS = 160;
const EMBEDDING_CACHE_TTL = 15 * 60 * 1000;
const EMBEDDING_MAX_TOKENS = 600;
const EMBEDDING_FALLBACK_DIM = 64;
const TFIDF_TOKEN_LIMIT = 24;
const LABEL_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const MAX_AI_FEATURE_TABS = 6;
const MAX_AI_EMBED_TABS = 12;
const MAX_AI_LABEL_GROUPS = 5;
const RESTRICTED_HOSTS = [
    'mail.google.com',
    'accounts.google.com',
    'chrome.google.com',
    'play.google.com',
    'outlook.live.com'
];

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
const AI_FEATURE_TIMEOUT = 4500;
const AI_LABEL_TIMEOUT = 3500;
const AI_SUMMARY_TIMEOUT = 9000;
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
        
        case 'REQUEST_GROUP_SUMMARY':
            handleGroupSummaryRequest(message.groupIndex)
                .then(result => sendResponse(result))
                .catch(error => {
                    console.error('REQUEST_GROUP_SUMMARY failed:', error);
                    sendResponse({ success: false, error: error.message });
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
        
        // Αποθήκευση στο session storage
        await chrome.storage.session.set({ 
            basicTabData: basicTabData,
            scanStartTime: Date.now()
        });
        
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
                console.log('Using cached AI analysis results');
                aiGroups = cachedResult[cacheKey].groups;
                currentTabData = cachedResult[cacheKey].tabData;
                scheduleDeferredSummaries(200);
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
                    sendResponse({ 
                        success: false, 
                        error: `AI ανάλυση απέτυχε: ${aiError.message}` 
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
 * Εκτελεί AI ανάλυση των tabs χρησιμοποιώντας Chrome Built-in AI APIs
 */
async function performAIAnalysis() {
    try {
        console.log('Starting AI analysis with Chrome Built-in AI...');
        const aiStart = nowMs();
        
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
        
        // 1. Semantic feature extraction ανά tab
        const semanticStart = nowMs();
        await ensureTabSemanticFeatures(tabDataForAI);
        logTiming('Semantic feature generation', semanticStart);
        console.log('Semantic features generated for all tabs');
        
        // 1b. Embedding extraction for richer semantic similarity
        const embeddingStart = nowMs();
        await ensureTabEmbeddings(tabDataForAI);
        logTiming('Embedding generation', embeddingStart);
        console.log('Semantic embeddings generated for all tabs');
        
        // 2. Deterministic clustering με βάση τα features
        const clusteringStart = nowMs();
        const featureContext = prepareTabFeatureContext(tabDataForAI);
        let groups = clusterTabsDeterministic(featureContext);
        logTiming('Feature preparation & clustering', clusteringStart);
        console.log('Deterministic groups created:', groups.map(g => ({
            tabCount: g.tabIndices.length,
            keywords: g.keywords?.slice(0, 6) || []
        })));
        
        // 3. Αντιστοίχιση labels (με AI μόνο για naming)
        const labelingStart = nowMs();
        await assignGroupLabels(groups, tabDataForAI);
        
        const mergedByName = mergeSimilarNamedGroups(groups, featureContext);
        const nameMerged = mergedByName.length !== groups.length;
        if (nameMerged) {
            console.log(`Merged ${groups.length - mergedByName.length} groups based on similar labels.`);
            groups = mergedByName;
            await assignGroupLabels(groups, tabDataForAI);
        } else {
            groups = mergedByName;
        }
        logTiming('Group labeling & merge refinement', labelingStart);
        
        const beforeFilterCount = groups.length;
        groups = groups.filter(group => group.tabIndices.length >= 2);
        if (groups.length !== beforeFilterCount) {
            console.log(`Filtered out ${beforeFilterCount - groups.length} single-tab groups from AI results.`);
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
        metaDescription: originalTab.metaDescription || '',
        content: originalTab.content || '',
        topicHints: originalTab.topicHints || tabEntry.topicHints || '',
        headings: Array.isArray(originalTab.headings) ? originalTab.headings.slice(0, 6) : [],
        metaKeywords: Array.isArray(originalTab.metaKeywords) ? originalTab.metaKeywords.slice(0, 10) : [],
        language: originalTab.language || '',
        youtube: {
            topic: youtube.topic || '',
            tags: youtube.tags || [],
            channel: youtube.channel || '',
            summaryBullets: youtube.summaryBullets || [],
            description: youtube.description || ''
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
    const keywords = extractMeaningfulKeywords(combinedText).slice(0, 6);
    let topic = originalTab.youtubeAnalysis?.topic || tabEntry.domain || originalTab.title || 'General browsing';
    if (topic.length > 40 && keywords.length >= 3) {
        topic = keywords.slice(0, 3).join(' ');
    }
    return {
        topic: topic.trim() || 'General browsing',
        keywords: keywords.length ? keywords : (topic.split(/\s+/).slice(0, 3).map(word => word.toLowerCase())),
        origin: 'fallback'
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
    
    const processEntry = async (entry) => {
        const originalTab = currentTabData[entry.index];
        if (originalTab.semanticFeatures && originalTab.semanticFeatures.topic && originalTab.semanticFeatures.keywords?.length) {
            entry.semanticFeatures = { ...originalTab.semanticFeatures };
            return;
        }
        
        const cacheKey = makeCacheKey(entry);
        if (cacheKey && semanticFeatureCache[cacheKey]) {
            const cached = semanticFeatureCache[cacheKey];
            const hashesMatch = cached?.contentHash && entry.contentHash
                ? cached.contentHash === entry.contentHash
                : Boolean(cached?.contentHash) === Boolean(entry.contentHash);
            if (cached && cached.features && hashesMatch && (Date.now() - cached.timestamp) < 10 * 60 * 1000) {
                originalTab.semanticFeatures = cached.features;
                entry.semanticFeatures = cached.features;
                originalTab.topicHints = generateTopicHints(originalTab);
                entry.topicHints = originalTab.topicHints;
                return;
            }
        }
        
        let features = null;
        const descriptor = buildTabFeatureDescriptor(originalTab, entry);
        
        const shouldUseAI =
            aiTabId &&
            aiRequestCount < MAX_AI_FEATURE_TABS &&
            (entry.content && entry.content.length > 200);
        
        if (shouldUseAI) {
            try {
                const scriptPromise = chrome.scripting.executeScript({
                    target: { tabId: aiTabId },
                    world: 'MAIN',
                    func: generateTabFeaturesInPage,
                    args: [descriptor]
                });
                const results = await withTimeout(scriptPromise, AI_FEATURE_TIMEOUT, 'AI feature timeout');
                
                if (results && results[0] && results[0].result) {
                    const resultPayload = results[0].result;
                    if (resultPayload.ok) {
                        aiRequestCount += 1;
                        features = {
                            topic: resultPayload.topic,
                            keywords: resultPayload.keywords,
                            origin: 'ai'
                        };
                    } else {
                        const reason = resultPayload.error;
                        const status = resultPayload.status;
                        if (status) {
                            failureReasons.add(`Language model status: ${status}`);
                        }
                        failureReasons.add(typeof reason === 'string' ? reason : (reason?.message || JSON.stringify(reason)));
                        if (status === 'downloading') {
                            aiTabId = null;
                        }
                    }
                }
            } catch (error) {
                if (error?.message === 'AI feature timeout') {
                    failureReasons.add('Language model timeout (features)');
                    aiTabId = null;
                    console.warn('generateTabFeaturesInPage timed out, falling back to heuristic features.');
                } else {
                    failureReasons.add(error?.message || String(error));
                }
            }
        }
        
        if (!features) {
            features = fallbackTabFeatures(originalTab, entry);
            fallbackCount += 1;
        }
        
        originalTab.semanticFeatures = features;
        entry.semanticFeatures = features;
        originalTab.topicHints = generateTopicHints(originalTab);
        entry.topicHints = originalTab.topicHints;
        if (cacheKey && features) {
            cacheUpdates[cacheKey] = {
                timestamp: Date.now(),
                features,
                contentHash: entry.contentHash || originalTab.contentHash || ''
            };
        }
            };
    
    if (!aiTabId) {
        await Promise.all(tabDataForAI.map(processEntry));
    } else {
        const concurrency = Math.min(4, Math.max(1, tabDataForAI.length));
        let cursor = 0;
        const workers = Array.from({ length: concurrency }, () => (async () => {
            while (true) {
                const index = cursor++;
                if (index >= tabDataForAI.length) break;
                await processEntry(tabDataForAI[index]);
            }
        })());
        await Promise.all(workers);
    }
    
    if (fallbackCount > 0) {
        const reasonsSummary = failureReasons.size
            ? ` Reasons: ${Array.from(failureReasons).slice(0, 3).join(' | ')}`
            : '';
        console.info(`Tab semantic features used fallback for ${fallbackCount} tabs.${reasonsSummary}`);
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
    
    if (fallbackCount > 0) {
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
        const semanticTopicTokens = new Set(tokenizeText(features.topic));
        semanticTopicTokens.forEach(token => keywordTokens.add(token));
        (features.keywords || []).forEach(keyword => {
            const token = String(keyword || '').toLowerCase().trim();
            if (token.length >= 3 && !STOPWORDS.has(token)) {
                keywordTokens.add(token);
            }
        });
        
        (entry.metaKeywords || []).forEach(keyword => {
            tokenizeText(keyword).forEach(token => keywordTokens.add(token));
        });
        (entry.headings || []).forEach(heading => {
            tokenizeText(heading).forEach(token => keywordTokens.add(token));
        });
        tokenizeText(entry.topicHints).forEach(token => keywordTokens.add(token));
        tokenizeText(entry.youtubeTopic).forEach(token => keywordTokens.add(token));
        (entry.youtubeTags || [])
            .map(tag => String(tag || '').toLowerCase().trim())
            .filter(Boolean)
            .forEach(tag => keywordTokens.add(tag));
        
        const taxonomyArray = inferTaxonomyTags(entry);
        const taxonomyTags = new Set();
        taxonomyArray.forEach(tag => {
            const token = String(tag || '').toLowerCase().trim();
            if (!token || STOPWORDS.has(token)) return;
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
            ...Array.from(titleTokens),
            ...Array.from(pathTokens),
            ...(entry.youtubeTags || []).map(tag => String(tag || '').toLowerCase().trim()).filter(Boolean),
            ...(entry.metaKeywords || []).flatMap(keyword => tokenizeText(keyword)),
            ...(entry.headings || []).flatMap(heading => tokenizeText(heading)),
            ...taxonomyArray.map(tag => String(tag || '').toLowerCase()).flatMap(tokenizeText)
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
            tfCounts,
            totalTokenCount,
            embeddingVector,
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

function computeWeightedSimilarity(vectorA, vectorB) {
    const S_kw = jaccardSimilarity(vectorA.keywordTokens, vectorB.keywordTokens);
    const S_topic = jaccardSimilarity(vectorA.semanticTopicTokens, vectorB.semanticTopicTokens);
    const S_title = jaccardSimilarity(vectorA.titleTokens, vectorB.titleTokens);
    const S_url = jaccardSimilarity(vectorA.pathTokens, vectorB.pathTokens);
    const S_tfidf = cosineSimilarity(vectorA.tfidfVector, vectorB.tfidfVector);
    const S_dom = vectorA.domain && vectorA.domain === vectorB.domain ? 1 : 0;
    const S_domTokens = jaccardSimilarity(vectorA.domainTokens, vectorB.domainTokens);
    const S_lang = vectorA.language && vectorA.language === vectorB.language ? 1 : 0;
    const S_embed = cosineSimilarityArray(vectorA.embeddingVector, vectorB.embeddingVector);
    const S_tax = normalizedOverlap(vectorA.taxonomyTags, vectorB.taxonomyTags);
    const langPenalty = (!vectorA.language || !vectorB.language || vectorA.language === vectorB.language) ? 1 : 0.85;
    
    let score =
        (0.18 * S_kw) +
        (0.16 * S_topic) +
        (0.10 * S_title) +
        (0.10 * S_tfidf) +
        (0.18 * S_embed) +
        (0.12 * S_tax) +
        (0.05 * S_url) +
        (0.04 * S_dom) +
        (0.03 * S_domTokens) +
        (0.02 * S_lang);
    
    if (vectorA.youtubeTopic && vectorA.youtubeTopic === vectorB.youtubeTopic) {
        score += 0.04;
    }
    
    score *= langPenalty;
    return Math.max(0, Math.min(score, 1));
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

function clusterTabsDeterministic(featureContext) {
    const { vectors, tabData } = featureContext;
    if (!vectors || !vectors.length) {
        return [];
    }
    
    const uf = createUnionFind(vectors.length);
    const similarityCache = new Map();
    
    for (let i = 0; i < vectors.length; i++) {
        for (let j = i + 1; j < vectors.length; j++) {
            const score = computeWeightedSimilarity(vectors[i], vectors[j]);
            const key = `${i}|${j}`;
            similarityCache.set(key, score);
            if (score >= SIMILARITY_JOIN_THRESHOLD) {
                uf.union(i, j);
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
        groups = mergeSmallSimilarGroups(groups, vectors, similarityCache);
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
        groups = mergeYouTubeChannelSingletons(groups, vectors, tabData);
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

function mergeSmallSimilarGroups(groups, vectors, similarityCache) {
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

            let bestScore = 0;
            for (const idxA of groupA.vectorIndices) {
                for (const idxB of groupB.vectorIndices) {
                    const score = getVectorSimilarity(idxA, idxB);
                    if (score > bestScore) {
                        bestScore = score;
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

            if (meetsThreshold && (meetsKeywordOrTopic || taxonomyOverlap >= CROSS_GROUP_TAXONOMY_OVERLAP)) {
                groupUF.union(i, j);
                merged = true;
            } else if (meetsTaxonomyBoost) {
                groupUF.union(i, j);
                merged = true;
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

function mergeYouTubeChannelSingletons(groups, vectors, tabData) {
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
    for (const indices of channelGroups.values()) {
        if (!indices || indices.length <= 1) continue;
        const [first, ...rest] = indices;
        rest.forEach(otherIndex => {
            groupUF.union(first, otherIndex);
            merged = true;
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
        name: '',
        summary: []
    };
}

function mergeSimilarNamedGroups(groups, featureContext) {
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
            return 0;
        }
        let best = 0;
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
                    if (best >= 0.99) {
                        return best;
                    }
                }
            }
        }
        return best;
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
            const overlap = normalizedOverlap(tokensA, tokensB);
            if (overlap < GROUP_NAME_SIMILARITY_THRESHOLD) {
                continue;
            }
            const vectorSimilarity = bestGroupSimilarity(groups[i], groups[j]);
            if (vectorSimilarity >= GROUP_NAME_VECTOR_THRESHOLD) {
                uf.union(i, j);
                merged = true;
                mergeSummaries.push({
                    a: groups[i].name,
                    b: groups[j].name,
                    labelSimilarity: overlap.toFixed(2),
                    vectorSimilarity: vectorSimilarity.toFixed(2)
                });
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
    
    if (!accessibleTab) {
        labelFailureReasons.add('No accessible tab with Chrome AI support');
    } else {
        try {
            const availabilityResults = await chrome.scripting.executeScript({
                target: { tabId: accessibleTab.id },
                world: 'MAIN',
                func: checkLanguageModelAvailabilityInPage
            });
            const availability = availabilityResults?.[0]?.result;
            if (availability?.ready) {
                aiLabelReady = true;
                aiLabelReason = 'ready';
            } else {
                aiLabelReady = false;
                aiLabelReason = availability?.reason || 'Language Model not ready';
                aiLabelChecksFailed = true;
            }
        } catch (availabilityError) {
            aiLabelReady = false;
            aiLabelChecksFailed = true;
            aiLabelReason = availabilityError?.message || String(availabilityError);
        }
    }

    for (const group of groups) {
        const centroidSignature = group.centroidSignature || '';
        let cachedEntry = centroidSignature ? updatedCache[centroidSignature] : null;
        if (cachedEntry && (Date.now() - cachedEntry.timestamp) >= LABEL_CACHE_TTL) {
            cachedEntry = null;
        }

        let label = cachedEntry ? cachedEntry.label : '';

        const exemplarTabs = group.representativeTabIndices
            .map(index => {
                const entry = indexMap.get(index) || {};
                const features = entry.semanticFeatures || {};
                return {
                    title: entry.title || '',
                    domain: entry.domain || '',
                    topic: features.topic || '',
                    keywords: (features.keywords || []).slice(0, 5)
                };
            })
            .filter(tab => tab.title);
        
        const descriptor = {
            centroidKeywords: group.centroidTokens.slice(0, 6),
            fallbackKeywords: group.keywords.slice(0, 8),
            exemplarTabs: exemplarTabs.slice(0, 2),
            domainMode: group.domainMode || '',
            languageMode: group.languageMode || '',
            taxonomyTags: Array.isArray(group.taxonomyTags) ? group.taxonomyTags.slice(0, 6) : []
        };

        if (!label && accessibleTab && aiLabelReady && aiLabelAttempts < MAX_AI_LABEL_GROUPS) {
            try {
                aiLabelAttempts += 1;
                const scriptPromise = chrome.scripting.executeScript({
                    target: { tabId: accessibleTab.id },
                    world: 'MAIN',
                    func: generateGroupLabelInPage,
                    args: [descriptor]
                });
                const results = await withTimeout(scriptPromise, AI_LABEL_TIMEOUT, 'AI label timeout');
                
                if (results && results[0] && results[0].result && results[0].result.ok && results[0].result.label) {
                    label = results[0].result.label;
                } else if (results && results[0] && results[0].result && !results[0].result.ok) {
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
            const taxonomyFallback = descriptor.taxonomyTags.slice(0, 3);
            const fallbackTokens = descriptor.centroidKeywords.length
                ? descriptor.centroidKeywords.slice(0, 3)
                : (taxonomyFallback.length ? taxonomyFallback : descriptor.fallbackKeywords.slice(0, 3));
            label = titleCaseFromTokens(fallbackTokens) ||
                (descriptor.domainMode ? titleCaseFromTokens([descriptor.domainMode]) : `Group ${groups.indexOf(group) + 1}`);
        }
        
        if (centroidSignature) {
            updatedCache[centroidSignature] = { label, timestamp: Date.now() };
            cacheDirty = true;
        }
        
        group.name = label;
        group.keywords = group.keywords.slice(0, 10);
        group.taxonomyTags = descriptor.taxonomyTags;
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
    
    function sanitizeKeywords(list) {
        if (!Array.isArray(list)) return [];
        return Array.from(new Set(
            list
                .map(item => String(item || '').toLowerCase().trim())
                .filter(token => token.length >= 3)
        )).slice(0, 8);
    }
    
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
                            monitor(monitor) {
                                monitor.addEventListener('downloadprogress', (event) => {
                                    console.log(`Feature extraction language model download ${(event.loaded * 100).toFixed(1)}%`);
                                });
                            }
                        });
                    } catch (error) {
                        console.warn('LanguageModel.create with monitor failed, retrying without monitor:', error);
                        return await languageModelApi.create();
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
                
                const parts = [
                    `TITLE: ${descriptor.title}`,
                    `URL: ${descriptor.url}`,
                    `DOMAIN: ${descriptor.domain}`,
                    `META: ${descriptor.metaDescription || '—'}`,
                    `LANGUAGE: ${descriptor.language || 'unknown'}`,
                    `HEADINGS: ${(descriptor.headings || []).slice(0, 5).join(' | ') || '—'}`,
                    `META KEYWORDS: ${(descriptor.metaKeywords || []).join(', ') || '—'}`,
                    `HINTS: ${descriptor.topicHints || '—'}`,
                    `CONTENT: ${(descriptor.content || '').slice(0, 1200)}`
                ];
                
                if (descriptor.youtube) {
                    parts.push(
                        `YOUTUBE TOPIC: ${descriptor.youtube.topic || '—'}`,
                        `YOUTUBE TAGS: ${(descriptor.youtube.tags || []).join(', ')}`,
                        `CHANNEL: ${descriptor.youtube.channel || '—'}`,
                        `YOUTUBE SUMMARY: ${(descriptor.youtube.summaryBullets || []).join(' | ')}`,
                        `YOUTUBE DESCRIPTION: ${(descriptor.youtube.description || '').slice(0, 1200)}`
                    );
                }
                
                const prompt = `
You are an AI that extracts semantic features from browser tabs. 
DO NOT GROUP. DO NOT CLASSIFY INTO FIXED CATEGORIES.

Given the tab TITLE and CONTENT SUMMARY, return STRICT JSON with:
{
  "topic": "<2-4 word description of the core theme>",
  "keywords": ["k1","k2","k3","k4","k5"]
}

Rules:
- Be concise and factual
- Use ONLY information from the tab
- No creative guesses
- No emojis
- The "topic" must describe the subject, not the category (e.g. "iPhone camera reviews", not "Technology")
- Keywords must be lowercase
- JSON only, no text outside the object

TAB DATA:
${parts.join('\n')}
            `.trim();
            
                console.log('🧠 [TabFeatures] Prompt preview:', prompt.substring(0, 600));
                
                const raw = await session.prompt(prompt);
                console.log('🧠 [TabFeatures] Raw response type/length:', typeof raw, raw?.length ?? 'n/a');
                
                const match = typeof raw === 'string'
                    ? raw.match(/\{[\s\S]*\}/)
                    : null;
                let parsed;
                try {
                    parsed = match ? JSON.parse(match[0]) : JSON.parse(String(raw));
                } catch (parseError) {
                    console.warn('🧠 [TabFeatures] Failed to parse response:', parseError, 'raw:', raw);
                    throw new Error('Invalid JSON response from language model');
                }
                
                const topic = String(parsed.topic || '').trim();
                const keywords = sanitizeKeywords(parsed.keywords || []);
                
                if (!topic) {
                    throw new Error('No topic returned by language model');
                }
                
                return {
                    ok: true,
                    topic,
                    keywords
                };
            } catch (error) {
                const message = error?.message || String(error);
                const isRecoverable = recoverablePattern.test(message);
                if (isRecoverable && attempt === 0) {
                    console.warn('generateTabFeaturesInPage: session closed, retrying with fresh session...', message);
                    scope.__aitabLanguageSessionPromise = null;
                    continue;
                }
                console.warn('generateTabFeaturesInPage fallback:', error);
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
                            monitor(monitor) {
                                monitor.addEventListener('downloadprogress', (event) => {
                                    console.log(`Group label language model download ${(event.loaded * 100).toFixed(1)}%`);
                                });
                            }
                        });
                    } catch (error) {
                        console.warn('LanguageModel.create with monitor failed, retrying without monitor:', error);
                        return await languageModelApi.create();
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
                const tabLines = (descriptor.exemplarTabs || []).map((tab, idx) => `
TAB ${idx + 1}
- Title: ${tab.title}
- Topic: ${tab.topic}
- Keywords: ${(tab.keywords || []).join(', ')}
- Domain: ${tab.domain || 'unknown'}
                `.trim()).join('\n\n') || 'No exemplar tabs provided.';
                
                const taxonomyLine = (descriptor.taxonomyTags || []).join(', ') || 'none';
                const prompt = `
You generate concise labels for groups of browser tabs.
Return STRICT JSON: {"label":"<2-4 word title>"}

Rules:
- Use at most 4 words
- Be specific to the shared subject
- No emojis, no punctuation beyond spaces
- Do not repeat the same word more than once
- Base only on topics/keywords provided

Group information:
Centroid keywords: ${centroidLine}
Additional keywords: ${fallbackLine}
Taxonomy hints: ${taxonomyLine}
Dominant domain: ${descriptor.domainMode || 'unknown'}
Dominant language: ${descriptor.languageMode || 'unknown'}

Representative tabs:
${tabLines}
            `.trim();
            
                console.log('🧠 [GroupLabel] Prompt:', prompt.substring(0, 600));
                
                const raw = await session.prompt(prompt);
                console.log('🧠 [GroupLabel] Raw response type/length:', typeof raw, raw?.length ?? 'n/a');
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
                
                return {
                    ok: true,
                    label
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
                                monitor(monitor) {
                                    monitor.addEventListener('downloadprogress', (event) => {
                                        console.log(`YouTube language model download progress ${(event.loaded * 100).toFixed(1)}%`);
                                    });
                                }
                            });
                        } catch (monitorError) {
                            console.warn('LanguageModel.create with monitor failed, retrying:', monitorError);
                            return await languageModelApi.create();
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
function parseAIResponse(response) {
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
            
            // Log κάθε group ξεχωριστά
            parsed.forEach((group, index) => {
                console.log(`📁 Group ${index + 1}: "${group.name}" with tabs: [${group.tabIndices?.join(', ') || 'none'}]`);
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
        
        let session;
        try {
            session = await languageModelApi.create({
                monitor(monitor) {
                    monitor.addEventListener('downloadprogress', (event) => {
                        const percent = (event.loaded * 100).toFixed(1);
                        console.log(`Content script: Language model download progress ${percent}%`);
                    });
                }
            });
        } catch (createWithMonitorError) {
            console.warn('Content script: LanguageModel.create with monitor failed, retrying without options:', createWithMonitorError);
            session = await languageModelApi.create();
        }
        
        if (!session) {
            throw new Error('Failed to create language model session');
        }
        
        console.log('Content script: Language model session created successfully');
        
        // Δημιουργία prompt
        const prompt = createGroupingPrompt(tabData);
        console.log('Content script: Prompt created, length:', prompt.length);
        
        // Εκτέλεση AI grouping
        console.log('Content script: Executing AI prompt...');
        const response = await session.prompt(prompt);
        console.log('Content script: AI response received:', typeof response, response?.length || 'no length');
        
        // Parse response
        console.log('Content script: Parsing AI response...');
        const groups = parseAIResponse(response);
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
        performAISummarizationInContent
    };
}
