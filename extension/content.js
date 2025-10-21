/**
 * AI Tab Companion - Content Script
 * Εκτελείται σε κάθε σελίδα για εξαγωγή περιεχομένου
 */

console.log('AI Tab Companion content script loaded');

/**
 * Εξάγει το περιεχόμενο της σελίδας
 */
function extractPageContent() {
    try {
        // Εξαγωγή κειμένου από τη σελίδα
        const textContent = document.body ? document.body.innerText : '';
        
        // Καθαρισμός και περιορισμός περιεχομένου
        const cleanedContent = textContent
            .replace(/\s+/g, ' ') // Αντικατάσταση πολλαπλών whitespaces
            .trim();
        
        // Περιορισμός σε ~2000 χαρακτήρες για AI processing
        const limitedContent = cleanedContent.substring(0, 2000);
        
        // Εξαγωγή meta description
        const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
        
        // Εξαγωγή επιπλέον metadata
        const pageTitle = document.title || '';
        const pageUrl = window.location.href;
        
        // Εξαγωγή keywords από meta tags
        const keywords = document.querySelector('meta[name="keywords"]')?.content || '';
        
        // Εξαγωγή Open Graph description
        const ogDescription = document.querySelector('meta[property="og:description"]')?.content || '';
        
        // Εξαγωγή Twitter description
        const twitterDescription = document.querySelector('meta[name="twitter:description"]')?.content || '';
        
        // Επιλογή της καλύτερης description
        const bestDescription = metaDescription || ogDescription || twitterDescription || '';
        
        return {
            content: limitedContent,
            metaDescription: bestDescription,
            title: pageTitle,
            url: pageUrl,
            keywords: keywords,
            wordCount: cleanedContent.split(' ').length,
            hasImages: document.images.length > 0,
            hasVideos: document.querySelectorAll('video').length > 0,
            hasForms: document.querySelectorAll('form').length > 0
        };
        
    } catch (error) {
        console.error('Error extracting page content:', error);
        return { 
            content: '', 
            metaDescription: '',
            title: document.title || '',
            url: window.location.href,
            keywords: '',
            wordCount: 0,
            hasImages: false,
            hasVideos: false,
            hasForms: false
        };
    }
}

/**
 * Εξάγει structured data από τη σελίδα
 */
function extractStructuredData() {
    try {
        const structuredData = [];
        
        // JSON-LD structured data
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        jsonLdScripts.forEach(script => {
            try {
                const data = JSON.parse(script.textContent);
                structuredData.push(data);
            } catch (e) {
                console.warn('Failed to parse JSON-LD:', e);
            }
        });
        
        // Microdata
        const microdataItems = document.querySelectorAll('[itemscope]');
        const microdata = Array.from(microdataItems).map(item => {
            const result = {};
            const properties = item.querySelectorAll('[itemprop]');
            properties.forEach(prop => {
                const name = prop.getAttribute('itemprop');
                const value = prop.textContent || prop.getAttribute('content') || prop.src || prop.href;
                result[name] = value;
            });
            return result;
        });
        
        return {
            jsonLd: structuredData,
            microdata: microdata
        };
        
    } catch (error) {
        console.error('Error extracting structured data:', error);
        return { jsonLd: [], microdata: [] };
    }
}

/**
 * Εξάγει πληροφορίες για links στη σελίδα
 */
function extractLinkInfo() {
    try {
        const links = Array.from(document.querySelectorAll('a[href]'));
        const linkInfo = {
            totalLinks: links.length,
            externalLinks: 0,
            internalLinks: 0,
            commonDomains: {}
        };
        
        const currentDomain = window.location.hostname;
        
        links.forEach(link => {
            try {
                const url = new URL(link.href, window.location.href);
                if (url.hostname === currentDomain) {
                    linkInfo.internalLinks++;
                } else {
                    linkInfo.externalLinks++;
                    linkInfo.commonDomains[url.hostname] = (linkInfo.commonDomains[url.hostname] || 0) + 1;
                }
            } catch (e) {
                // Invalid URL, skip
            }
        });
        
        return linkInfo;
        
    } catch (error) {
        console.error('Error extracting link info:', error);
        return { totalLinks: 0, externalLinks: 0, internalLinks: 0, commonDomains: {} };
    }
}

/**
 * Κύρια function για εξαγωγή όλων των δεδομένων
 */
function extractAllPageData() {
    const content = extractPageContent();
    const structuredData = extractStructuredData();
    const linkInfo = extractLinkInfo();
    
    return {
        ...content,
        structuredData,
        linkInfo,
        extractedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        language: document.documentElement.lang || navigator.language
    };
}

// Εκτέλεση εξαγωγής όταν φορτώνει η σελίδα
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('Page loaded, content extraction ready');
    });
} else {
    console.log('Page already loaded, content extraction ready');
}

/**
 * Βρίσκει το διαθέσιμο Chrome AI Language Model API (νέα ή legacy ονομασία)
 */
function resolveLanguageModelApi() {
    const globalScope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
    return (
        globalScope?.LanguageModel ||
        globalScope?.ai?.languageModel ||
        globalScope?.aiOriginTrial?.languageModel ||
        globalScope?.window?.ai?.languageModel ||
        null
    );
}

/**
 * Βρίσκει το διαθέσιμο Chrome AI Summarizer API (νέα ή legacy ονομασία)
 */
function resolveSummarizerApi() {
    const globalScope = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis);
    return (
        globalScope?.Summarizer ||
        globalScope?.ai?.summarizer ||
        globalScope?.ai?.Summarizer ||
        globalScope?.aiOriginTrial?.summarizer ||
        globalScope?.window?.ai?.Summarizer ||
        null
    );
}

/**
 * AI Grouping function για Chrome AI APIs
 */
async function performAIGrouping(tabData) {
    try {
        console.log('Content script: Starting AI grouping...');
        const languageModelApi = resolveLanguageModelApi();
        
        if (!languageModelApi) {
            throw new Error('Language Model API not available - Chrome AI APIs not accessible');
        }
        
        console.log('Content script: Language Model API detected');
        
        // Έλεγχος διαθεσιμότητας Language Model API
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
        const prompt = `Είσαι ένας βοηθός οργάνωσης tabs. 
Δεδομένων των παρακάτω tabs με τίτλους και περιεχόμενο, δημιούργησε μια JSON λίστα με ομάδες θεμάτων (μέγιστο 6 ομάδες).
Κάθε ομάδα πρέπει να περιλαμβάνει ένα όνομα και έναν πίνακα με τα indices των tabs.

Tabs:
${tabData.map(tab => 
    `Tab ${tab.index}: "${tab.title}" (${tab.url}) - ${tab.content.substring(0, 100)}...`
).join('\n')}

Απάντησε ΜΟΝΟ με JSON σε αυτή τη μορφή:
[
  {
    "name": "Όνομα Ομάδας",
    "tabIndices": [0, 1, 2]
  }
]`;
        
        console.log('Content script: Prompt created, length:', prompt.length);
        
        // Εκτέλεση AI grouping
        console.log('Content script: Executing AI prompt...');
        const response = await session.prompt(prompt);
        console.log('Content script: AI response received:', typeof response, response?.length || 'no length');
        
        // Parse response
        console.log('Content script: Parsing AI response...');
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const groups = JSON.parse(jsonMatch[0]);
            console.log('Content script: Groups parsed successfully:', groups.length);
            return groups;
        } else {
            throw new Error('No valid JSON found in AI response');
        }
        
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

/**
 * AI Summarization function για Chrome AI APIs
 */
async function performAISummarization(groupContent) {
    try {
        console.log('Content script: Starting AI summarization...');
        
        const summarizerApi = resolveSummarizerApi();
        
        if (!summarizerApi) {
            throw new Error('Summarizer API not available');
        }
        
        console.log('Content script: Summarizer API detected');
        
        // Έλεγχος διαθεσιμότητας summarizer όπου υποστηρίζεται
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
        if (typeof summary === 'string') {
            const lines = summary.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .slice(0, 5);
            return lines.length > 0 ? lines : [summary];
        } else if (summary && summary.points) {
            return summary.points.slice(0, 5);
        } else if (summary && summary.summary) {
            return [summary.summary];
        }
        
        throw new Error('Invalid summarizer response format');
        
    } catch (error) {
        console.error('Content script: Error in AI summarization:', error);
        throw error;
    }
}

// Message handling για communication με background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Content script: Received message:', message.type);
    
    switch (message.type) {
        case 'PERFORM_AI_GROUPING':
            performAIGrouping(message.data)
                .then(result => {
                    console.log('Content script: AI grouping successful:', result);
                    sendResponse({ success: true, result: result });
                })
                .catch(error => {
                    console.error('Content script: AI grouping failed:', error);
                    sendResponse({ success: false, error: error.message });
                });
            return true; // Keep message channel open for async response
            
        case 'PERFORM_AI_SUMMARIZATION':
            performAISummarization(message.data)
                .then(result => {
                    console.log('Content script: AI summarization successful:', result);
                    sendResponse({ success: true, result: result });
                })
                .catch(error => {
                    console.error('Content script: AI summarization failed:', error);
                    sendResponse({ success: false, error: error.message });
                });
            return true; // Keep message channel open for async response
            
        default:
            console.warn('Content script: Unknown message type:', message.type);
            sendResponse({ success: false, error: 'Unknown message type' });
    }
});

// Export functions για χρήση από background script
if (typeof window !== 'undefined') {
    window.AITabCompanion = {
        extractPageContent,
        extractAllPageData,
        extractStructuredData,
        extractLinkInfo,
        performAIGrouping,
        performAISummarization
    };
}
