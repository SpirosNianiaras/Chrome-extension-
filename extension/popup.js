/**
 * AI Tab Companion - Popup Script
 * Χειρίζεται το UI του popup και την επικοινωνία με το background script
 */

// Global state
let currentGroups = [];
let cachedTabData = null;
let selectedTabs = new Set();
let isScanning = false;

// DOM Elements
const elements = {
    loading: document.getElementById('loading'),
    initialState: document.getElementById('initial-state'),
    results: document.getElementById('results'),
    errorState: document.getElementById('error-state'),
    scanTabsBtn: document.getElementById('scan-tabs-btn'),
    rescanBtn: document.getElementById('rescan-btn'),
    closeSelectedBtn: document.getElementById('close-selected-btn'),
    exportSummaryBtn: document.getElementById('export-summary-btn'),
    retryBtn: document.getElementById('retry-btn'),
    groupsContainer: document.getElementById('groups-container'),
    errorMessage: document.getElementById('error-message')
};

/**
 * Αρχικοποίηση του popup
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('Popup loaded');
    
    // Event listeners
    elements.scanTabsBtn.addEventListener('click', startScanning);
    elements.rescanBtn.addEventListener('click', startScanning);
    elements.closeSelectedBtn.addEventListener('click', closeSelectedTabs);
    elements.exportSummaryBtn.addEventListener('click', exportSummary);
    elements.retryBtn.addEventListener('click', startScanning);
    
    // Check for cached data
    checkForCachedData();
});

/**
 * Check for cached data from previous scan
 */
async function checkForCachedData() {
    try {
        const result = await chrome.storage.local.get(['cachedGroups', 'tabData', 'lastScan']);
        if (result.tabData) {
            cachedTabData = result.tabData;
        }
        
        if (result.cachedGroups && result.tabData && result.lastScan) {
            const timeSinceLastScan = Date.now() - result.lastScan;
            const fiveMinutes = 5 * 60 * 1000;
            
            if (timeSinceLastScan < fiveMinutes) {
                // Show cached results
                currentGroups = result.cachedGroups;
                showResults();
                return;
            }
        }
        
        // Show initial state
        showInitialState();
        
    } catch (error) {
        console.error('Error checking cached data:', error);
        // Show initial state (safe check)
        if (elements.initialState) {
            showInitialState();
        }
    }
}

/**
 * Starts the scanning process
 */
async function startScanning() {
    if (isScanning) return;
    
    try {
        const permissionResult = await requestAllHostPermissions();
        if (!permissionResult.granted) {
            showTemporaryMessage('You need to grant access to all sites to read tabs.');
            return;
        }
        
        isScanning = true;
        alert('🔍 AI Tab Companion: Starting tabs analysis...');
        
        // Send message to background script
        const response = await sendMessageToBackground('SCAN_TABS');
        
        if (response.success) {
            alert('✅ AI Tab Companion: Found ' + response.tabCount + ' tabs. Waiting for AI analysis...');
            
            // Περιμένουμε τα αποτελέσματα
            await waitForResults();
        } else {
            throw new Error(response.error || 'Unknown error during scanning');
        }
        
    } catch (error) {
        console.error('Scanning error:', error);
        alert('❌ AI Tab Companion: Error - ' + error.message);
    } finally {
        isScanning = false;
    }
}

/**
 * Requests access to all sites so the extension can read tabs
 */
function requestAllHostPermissions() {
    return new Promise((resolve) => {
        try {
            chrome.permissions.request({ origins: ['<all_urls>'] }, (granted) => {
                if (chrome.runtime.lastError) {
                    console.error('Permission request failed:', chrome.runtime.lastError);
                    resolve({
                        granted: false,
                        error: chrome.runtime.lastError.message
                    });
                    return;
                }
                
                resolve({
                    granted,
                    requested: ['<all_urls>']
                });
            });
        } catch (error) {
            console.error('Permission request threw error:', error);
            resolve({
                granted: false,
                error: error.message
            });
        }
    });
}

/**
 * Waits for results from the background script
 */
async function waitForResults() {
    const maxWaitTime = 240000; // 240 seconds (first run/model may take longer)
    const checkInterval = 1000; // 1 second
    let elapsed = 0;
    
    while (elapsed < maxWaitTime) {
        try {
            const result = await chrome.storage.local.get(['cachedGroups', 'tabData', 'lastScan', 'aiError', 'error']);
            
            if (result.aiError) {
                throw new Error(result.error || 'Chrome AI is not available');
            }
            
            if (result.cachedGroups && result.tabData) {
                currentGroups = result.cachedGroups;
                showResultsWithAlert();
                return;
            }
            
            if (elapsed === 30000) {
                showTemporaryMessage('⏳ The first AI analysis may take 2–4 minutes as the model downloads. Waiting for results...');
            }
            
            if (elapsed === 120000) {
                showTemporaryMessage('⏳ Still analyzing... The first run may take up to 4 minutes. Please wait...');
            }
            
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            elapsed += checkInterval;
            
        } catch (error) {
            console.error('Error waiting for results:', error);
            break;
        }
    }
    
    throw new Error('Timeout waiting for AI analysis results (try again – first run may take up to 4 minutes)');
}

/**
 * Show loading state
 */
function showLoading() {
    hideAllStates();
    if (elements.loading) elements.loading.classList.remove('hidden');
}

/**
 * Show initial state
 */
function showInitialState() {
    hideAllStates();
    if (elements.initialState) elements.initialState.classList.remove('hidden');
}

/**
 * Show results with alert
 */
function showResultsWithAlert() {
    let message = '🎉 AI Tab Companion: Analysis Complete!\n\n';
    
    if (currentGroups && currentGroups.length > 0) {
        message += `📊 Found ${currentGroups.length} tab groups:\n\n`;
        
        currentGroups.forEach((group, index) => {
            message += `${index + 1}. ${group.name} (${group.tabIndices.length} tabs)\n`;
            if (group.summary && group.summary.length > 0) {
                message += `   📝 ${group.summary[0]}\n`;
            }
            message += '\n';
        });
        
        message += '📁 Would you like to create tab groups with AI?\n';
        message += 'Click "OK" to see the options!';
    } else {
        message += '❌ No tab groups found';
    }
    
    // Show results and then grouping options
    alert(message);
    
    // After OK, show options for grouping
    if (currentGroups && currentGroups.length > 0) {
        showGroupingOptions();
    }
}

/**
 * Show options for tab grouping
 */
async function showGroupingOptions() {
    if (!currentGroups || currentGroups.length === 0) return;
    
    let message = '📁 AI Tab Companion: Tab Grouping Options\n\n';
    message += 'I will analyze your open tabs and create groups based on their content.\n\n';
    message += 'If I find tabs with similar content, I will group them with an appropriate name.\n';
    message += 'If I do not find common topics, I will display a message.\n\n';
    message += 'Would you like to proceed with the analysis?\n';
    message += 'Click "OK" to proceed!';
    
    const proceed = confirm(message);
    
    if (proceed) {
        await createTabGroups(currentGroups);
    }
}

/**
 * Creates tab groups with AI intelligent grouping
 */
async function createTabGroups(groups) {
    try {
        // Get tab data
        const result = await chrome.storage.local.get(['tabData']);
        if (!result.tabData) {
            throw new Error('Tab data not found');
        }
        
        // Find groups with more than 1 tab
        const groupsWithMultipleTabs = groups.filter(group => group.tabIndices.length > 1);
        
        if (groupsWithMultipleTabs.length === 0) {
            alert('ℹ️ AI Tab Companion: No tabs with similar content found for grouping.\n\nAll tabs have different content and cannot be grouped.');
            return;
        }
        
        let totalGrouped = 0;
        let createdGroups = [];
        
        for (const group of groupsWithMultipleTabs) {
            // Create a group for tabs with more than 1 tab
            const tabIds = group.tabIndices.map(index => result.tabData[index].id);
            
            if (tabIds.length > 0) {
                // Create group via Chrome API
                const groupId = await chrome.tabs.group({ tabIds: tabIds });
                
                // Name the group using the AI-generated topic
                await chrome.tabGroups.update(groupId, { 
                    title: group.name,
                    color: getRandomColor()
                });
                
                totalGrouped += tabIds.length;
                createdGroups.push(group.name);
            }
        }
        
        // Show result
        let resultMessage = `✅ AI Tab Companion: Created ${createdGroups.length} groups!\n\n`;
        resultMessage += 'Grouped tabs with similar content:\n';
        createdGroups.forEach(groupName => {
            resultMessage += `• ${groupName}\n`;
        });
        resultMessage += '\n💡 Your tabs are now organized into groups!';
        
        alert(resultMessage);
        
    } catch (error) {
        console.error('Error creating tab groups:', error);
        alert('❌ AI Tab Companion: Error while creating groups - ' + error.message);
    }
}

/**
 * Finds adjacent tab groups
 */
function findAdjacentTabGroups(allTabs) {
    const groups = [];
    let currentGroup = [];
    let currentDomain = '';
    
    for (let i = 0; i < allTabs.length; i++) {
        const tab = allTabs[i];
        const domain = new URL(tab.url).hostname;
        
        // If same domain as previous tab
        if (domain === currentDomain) {
            currentGroup.push(tab.id);
        } else {
            // If we have a group with more than 1 tab, add it
            if (currentGroup.length > 1) {
                groups.push({
                    tabIds: [...currentGroup],
                    name: currentDomain,
                    domain: currentDomain
                });
            }
            
            // Start a new group
            currentGroup = [tab.id];
            currentDomain = domain;
        }
    }
    
    // Add the last group if it has more than 1 tab
    if (currentGroup.length > 1) {
        groups.push({
            tabIds: [...currentGroup],
            name: currentDomain,
            domain: currentDomain
        });
    }
    
    return groups;
}

/**
 * Returns a random color for groups
 */
function getRandomColor() {
    const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'grey'];
    return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Show results (legacy)
 */
async function showResults() {
    hideAllStates();
    elements.results.classList.remove('hidden');
    // Ensure tab data is available
    if (!cachedTabData) {
        const res = await chrome.storage.local.get(['tabData']);
        cachedTabData = res.tabData || null;
    }
    // Render groups
    renderGroups();
    
    // Update close button state
    updateCloseButtonState();
}

/**
 * Show error state
 */
function showError(message) {
    hideAllStates();
    elements.errorState.classList.remove('hidden');
    elements.errorMessage.textContent = message;
}

/**
 * Hide all states
 */
function hideAllStates() {
    if (elements.loading) elements.loading.classList.add('hidden');
    if (elements.initialState) elements.initialState.classList.add('hidden');
    if (elements.results) elements.results.classList.add('hidden');
    if (elements.errorState) elements.errorState.classList.add('hidden');
}

/**
 * Render groups in the UI
 */
function renderGroups() {
    elements.groupsContainer.innerHTML = '';
    
    if (!currentGroups || currentGroups.length === 0) {
        elements.groupsContainer.innerHTML = '<p class="no-groups">No tab groups found</p>';
        return;
    }
    
    currentGroups.forEach((group, groupIndex) => {
        const groupElement = createGroupElement(group, groupIndex);
        elements.groupsContainer.appendChild(groupElement);
    });
}

/**
 * Create element for a group
 */
function createGroupElement(group, groupIndex) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'group';
    groupDiv.dataset.groupIndex = groupIndex;
    
    // Group header
    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML = `
        <h3 class="group-title">${group.name}</h3>
        <span class="group-count">${group.tabIndices.length}</span>
    `;
    // Small favicon strip for the group (unique favicons up to 6)
    try {
        if (Array.isArray(group.tabIndices) && group.tabIndices.length && cachedTabData) {
            const favSet = new Set();
            const favs = [];
            for (const idx of group.tabIndices) {
                const t = cachedTabData[idx];
                const src = t?.favicon || t?.favIconUrl || '';
                if (src && !favSet.has(src)) {
                    favSet.add(src);
                    favs.push(src);
                    if (favs.length >= 6) break;
                }
            }
            if (favs.length) {
                const strip = document.createElement('div');
                strip.className = 'group-favicons';
                favs.forEach(src => {
                    const img = document.createElement('img');
                    img.className = 'tab-icon';
                    img.src = src;
                    img.referrerPolicy = 'no-referrer';
                    img.loading = 'lazy';
                    img.onerror = () => { img.src = 'icons/icon16.png'; };
                    strip.appendChild(img);
                });
                // Insert strip into header (before count badge)
                header.insertBefore(strip, header.lastElementChild);
            }
        }
    } catch (_) {}
    
    // Group content
    const content = document.createElement('div');
    content.className = 'group-content';
    content.dataset.groupIndex = String(groupIndex);
    
    // Summary
    if (group.summary && group.summary.length > 0) {
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'group-summary';
        summaryDiv.innerHTML = `
            <ul>
                ${group.summary.map(point => `<li>${point}</li>`).join('')}
            </ul>
        `;
        content.appendChild(summaryDiv);
    } else if (group.summaryPending) {
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'group-summary pending';
        summaryDiv.innerHTML = `<p class="summary-placeholder">🧠 Click to generate AI summary.</p>`;
        content.appendChild(summaryDiv);
    }
    
    // Tabs list
    const tabsList = document.createElement('ul');
    tabsList.className = 'tabs-list';
    
    group.tabIndices.forEach(tabIndex => {
        const tabItem = createTabItem(tabIndex);
        tabsList.appendChild(tabItem);
    });
    
    content.appendChild(tabsList);
    
    // Event listeners
    header.addEventListener('click', () => toggleGroup(groupIndex, content));
    
    groupDiv.appendChild(header);
    groupDiv.appendChild(content);
    
    return groupDiv;
}

/**
 * Create element for a tab
 */
function createTabItem(tabIndex) {
    const li = document.createElement('li');
    li.className = 'tab-item';
    
    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'tab-checkbox';
    checkbox.dataset.tabIndex = tabIndex;
    
    // Optional favicon
    const icon = document.createElement('img');
    icon.className = 'tab-icon';
    icon.src = 'icons/icon16.png';
    icon.referrerPolicy = 'no-referrer';
    // Tab info
    const tabInfo = document.createElement('div');
    tabInfo.className = 'tab-info';
    
    // We will need the tab data from storage
    const applyTabData = (tab) => {
        if (!tab) return;
        tabInfo.innerHTML = `
            <div class="tab-title">${tab.title}</div>
            <div class="tab-url">${tab.url}</div>
        `;
        if (tab.favicon || tab.favIconUrl) {
            icon.src = tab.favicon || tab.favIconUrl;
        }
        icon.onerror = () => { icon.src = 'icons/icon16.png'; };
    };
    if (cachedTabData && cachedTabData[tabIndex]) {
        applyTabData(cachedTabData[tabIndex]);
    } else {
        chrome.storage.local.get(['tabData']).then(result => {
            const tab = result.tabData && result.tabData[tabIndex];
            if (tab) {
                applyTabData(tab);
                cachedTabData = result.tabData;
            }
        });
    }
    
    // Event listener for checkbox
    checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            selectedTabs.add(tabIndex);
        } else {
            selectedTabs.delete(tabIndex);
        }
        updateCloseButtonState();
    });
    
    li.appendChild(checkbox);
    li.appendChild(icon);
    li.appendChild(tabInfo);
    
    return li;
}

/**
 * Toggle group expansion
 */
function toggleGroup(groupIndex, contentElement) {
    const isExpanded = contentElement.classList.toggle('expanded');
    if (isExpanded) {
        ensureGroupActions(contentElement, groupIndex);
        requestGroupSummary(groupIndex, contentElement);
    }
}

function ensureGroupActions(contentElement, groupIndex) {
    let actions = contentElement.querySelector('.group-actions');
    if (!actions) {
        actions = document.createElement('div');
        actions.className = 'group-actions';
        actions.style.margin = '6px 0 10px 0';
        actions.style.display = 'flex';
        actions.style.gap = '8px';

        const synthBtn = document.createElement('button');
        synthBtn.className = 'action-btn';
        synthBtn.textContent = '✨ Generate Full AI Synthesis Report';
        synthBtn.style.padding = '6px 10px';
        synthBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                showTemporaryMessage('🧠 Opening AI synthesis...');
                const resp = await chrome.runtime.sendMessage({ type: 'SYNTHESIZE_GROUP', groupIndex });
                if (!resp || !resp.success) {
                    const err = resp?.error || 'Failed to start synthesis';
                    showTemporaryMessage(`⚠️ ${err}`);
                }
            } catch (err) {
                showTemporaryMessage(`⚠️ ${err.message}`);
            }
        });

        actions.appendChild(synthBtn);
        contentElement.insertBefore(actions, contentElement.firstChild);
    }
}

async function requestGroupSummary(groupIndex, contentElement) {
    const group = currentGroups?.[groupIndex];
    if (!group) return;
    if ((Array.isArray(group.summary) && group.summary.length > 0 && group.summaryPending === false) || group._summaryRequestInFlight) {
        return;
    }
    
    group._summaryRequestInFlight = true;
    
    let summaryDiv = contentElement.querySelector('.group-summary');
    if (!summaryDiv) {
        summaryDiv = document.createElement('div');
        summaryDiv.className = 'group-summary';
        contentElement.insertBefore(summaryDiv, contentElement.firstChild);
    }
    
    summaryDiv.classList.remove('pending');
    summaryDiv.innerHTML = `<p class="summary-placeholder">🧠 Generating AI summary...</p>`;
    
    try {
        const response = await chrome.runtime.sendMessage({ type: 'REQUEST_GROUP_SUMMARY', groupIndex });
        if (response && response.success && Array.isArray(response.summary)) {
            group.summary = response.summary;
            group.summaryPending = false;
            summaryDiv.innerHTML = `
                <ul>
                    ${group.summary.map(point => `<li>${point}</li>`).join('')}
                </ul>
            `;
        } else {
            const errorText = response?.error || 'Unknown error';
            summaryDiv.innerHTML = `<p class="summary-error">Unable to create summary: ${errorText}</p>`;
        }
    } catch (error) {
        summaryDiv.innerHTML = `<p class="summary-error">Error during summary: ${error.message}</p>`;
    } finally {
        group._summaryRequestInFlight = false;
    }
}

/**
 * Update state of the close button
 */
function updateCloseButtonState() {
    const hasSelection = selectedTabs.size > 0;
    elements.closeSelectedBtn.disabled = !hasSelection;
    
    if (hasSelection) {
        elements.closeSelectedBtn.textContent = `🗑️ Close Selected (${selectedTabs.size})`;
    } else {
        elements.closeSelectedBtn.textContent = '🗑️ Close Selected';
    }
}

/**
 * Closes selected tabs
 */
async function closeSelectedTabs() {
    if (selectedTabs.size === 0) return;
    
    try {
        // Get tab data to find IDs
        const result = await chrome.storage.local.get(['tabData']);
        if (!result.tabData) {
            throw new Error('Tab data not found');
        }
        
        const tabIds = Array.from(selectedTabs).map(index => result.tabData[index].id);
        
        // Send message to background script
        const response = await sendMessageToBackground('CLOSE_SELECTED_TABS', { tabIds });
        
        if (response.success) {
            // Update UI
            selectedTabs.clear();
            updateCloseButtonState();
            
            // Update groups (remove closed tabs)
            updateGroupsAfterClosing(tabIds);
            
            // Show success message
            showTemporaryMessage(response.message || 'Tabs closed successfully');
            
        } else {
            throw new Error(response.error || 'Failed to close tabs');
        }
        
    } catch (error) {
        console.error('Error closing tabs:', error);
        showTemporaryMessage(`Error: ${error.message}`);
    }
}

/**
 * Update groups after closing tabs
 */
function updateGroupsAfterClosing(closedTabIds) {
    // Remove closed tabs from groups
    currentGroups.forEach(group => {
        group.tabIndices = group.tabIndices.filter(index => {
            const result = chrome.storage.local.get(['tabData']).then(data => {
                if (data.tabData && data.tabData[index]) {
                    return !closedTabIds.includes(data.tabData[index].id);
                }
                return true;
            });
            return result;
        });
    });
    
    // Remove empty groups
    currentGroups = currentGroups.filter(group => group.tabIndices.length > 0);
    
    // Re-render
    renderGroups();
}

/**
 * Export results summary
 */
async function exportSummary() {
    try {
        const response = await sendMessageToBackground('EXPORT_SUMMARY');
        
        if (response.success) {
            showTemporaryMessage(response.message || 'Summary exported successfully');
        } else {
            throw new Error(response.error || 'Failed to export summary');
        }
        
    } catch (error) {
        console.error('Error exporting summary:', error);
        showTemporaryMessage(`Error: ${error.message}`);
    }
}

/**
 * Show temporary message
 */
function showTemporaryMessage(message) {
    // Create temporary message element
    const messageDiv = document.createElement('div');
    messageDiv.className = 'temporary-message';
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #4285F4;
        color: white;
        padding: 12px 24px;
        border-radius: 6px;
        font-size: 14px;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    `;
    
    document.body.appendChild(messageDiv);
    
    // Remove after 3 seconds
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.parentNode.removeChild(messageDiv);
        }
    }, 3000);
}

/**
 * Αποστολή μηνύματος στο background script
 */
function sendMessageToBackground(type, data = {}) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type, ...data }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });
}

/**
 * Keyboard shortcuts
 */
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Enter για scan
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!isScanning) {
            startScanning();
        }
    }
    
    // Escape για κλείσιμο popup
    if (e.key === 'Escape') {
        window.close();
    }
});

// Export για testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        startScanning,
        closeSelectedTabs,
        exportSummary,
        renderGroups,
        createGroupElement,
        createTabItem
    };
}
