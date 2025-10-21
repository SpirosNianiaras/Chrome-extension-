# 🛠️ AI Tab Companion - Development Guide

## 📁 Project Structure

```
chrome-extension/
├── extension/                 # Main extension folder
│   ├── manifest.json         # Extension manifest (v3)
│   ├── background.js         # Service worker
│   ├── content.js           # Content script
│   ├── popup.html           # Popup UI
│   ├── popup.js             # Popup logic
│   ├── popup.css            # Popup styles
│   └── icons/               # Extension icons
│       ├── icon16.png
│       ├── icon48.png
│       ├── icon128.png
│       └── icon.svg
├── README.md                # Project documentation
├── LICENSE                  # MIT license
├── INSTALLATION.md          # Installation guide
├── DEVELOPMENT.md           # This file
├── demo-script.md           # Demo presentation script
└── package.json             # Project metadata
```

---

## 🏗️ Architecture Overview

### Core Components

#### 1. **Manifest v3** (`manifest.json`)
- Defines extension permissions and capabilities
- Specifies service worker, popup, and content scripts
- Chrome AI integration requirements

#### 2. **Service Worker** (`background.js`)
- Main extension logic and AI processing
- Tab data extraction coordination
- Chrome AI (Gemini Nano) integration
- Message handling between components

#### 3. **Content Script** (`content.js`)
- Runs in page context for content extraction
- Extracts text, metadata, and structured data
- Sends data back to service worker

#### 4. **Popup UI** (`popup.html`, `popup.js`, `popup.css`)
- User interface for extension interaction
- Displays AI analysis results
- Handles user actions (scan, close, export)

---

## 🔄 Data Flow

```
User clicks "Scan Tabs"
    ↓
Popup sends message to Service Worker
    ↓
Service Worker queries all tabs
    ↓
Content Scripts extract page content
    ↓
Service Worker collects all data
    ↓
Chrome AI (Gemini Nano) processes data
    ↓
AI returns grouped and summarized results
    ↓
Results stored in Chrome Storage
    ↓
Popup displays results to user
```

---

## 🤖 AI Integration Details

### Chrome Built-in AI APIs Usage

#### Availability Check
```javascript
if (!window.ai || !window.ai.languageModel || !window.ai.summarizer) {
    // Fallback to domain-based grouping
}
```

#### Prompt API για Ομαδοποίηση
```javascript
const languageModel = await window.ai.languageModel.create();
const response = await languageModel.prompt("Group these tabs by topic...");
```

#### Summarizer API για Συνοψίσεις
```javascript
const summary = await window.ai.summarizer.summarize(groupContent);
```

#### Prompt Engineering
- **Grouping Prompt**: Structured JSON output for tab categorization
- **Summarizer Content**: Formatted content for summarization
- **Error Handling**: Graceful fallback to heuristic grouping

#### Response Parsing
- JSON extraction from Prompt API responses
- Structured parsing from Summarizer API
- Fallback parsing for malformed responses
- Error recovery mechanisms

---

## 🗄️ Storage Strategy

### Chrome Storage API Usage

#### Session Storage
- **Purpose**: Temporary data during scan process
- **Data**: Basic tab info, scan timestamps
- **Lifecycle**: Cleared on browser restart

#### Local Storage
- **Purpose**: Cached results and user preferences
- **Data**: AI groups, tab data, last scan time
- **Lifecycle**: Persistent across browser sessions
- **TTL**: 5 minutes for cached results

### Data Structure
```javascript
// Session Storage
{
  basicTabData: [...],
  scanStartTime: timestamp
}

// Local Storage
{
  lastScan: timestamp,
  cachedGroups: [...],
  tabData: [...],
  fallbackUsed: boolean
}
```

---

## 🎨 UI/UX Design Principles

### Design System
- **Color Palette**: Google Material Design inspired
- **Typography**: System fonts for consistency
- **Spacing**: 8px grid system
- **Animations**: Subtle transitions and loading states

### Responsive Design
- **Desktop**: 400px width popup
- **Mobile**: Full-width adaptation
- **Touch**: Large touch targets (44px minimum)

### Accessibility
- **Keyboard Navigation**: Tab order and shortcuts
- **Screen Readers**: Proper ARIA labels
- **Color Contrast**: WCAG AA compliance
- **Focus Management**: Clear focus indicators

---

## 🔧 Development Workflow

### Local Development
1. **Load Extension**: Use Chrome's "Load unpacked" feature
2. **Debug**: Use Chrome DevTools for popup and background
3. **Reload**: Click "Reload" button after changes
4. **Test**: Open multiple tabs and test functionality

### Debugging Tools
- **Popup**: Right-click extension icon → "Inspect popup"
- **Background**: Go to `chrome://extensions/` → "Inspect views: background page"
- **Content Scripts**: Use page DevTools → Sources tab
- **Storage**: Chrome DevTools → Application → Storage

### Common Debug Commands
```javascript
// Check extension state
chrome.storage.local.get(console.log);

// Test AI availability
console.log(window.ai);

// Check tabs
chrome.tabs.query({}, console.log);
```

---

## 🧪 Testing Strategy

### Manual Testing Checklist
- [ ] Extension loads without errors
- [ ] Popup opens and displays correctly
- [ ] Tab scanning works with various sites
- [ ] AI grouping produces logical results
- [ ] Fallback grouping works when AI unavailable
- [ ] Tab closing functionality works
- [ ] Export feature generates valid JSON
- [ ] Error handling displays appropriate messages

### Test Scenarios
1. **Empty State**: No tabs open
2. **Single Tab**: One tab open
3. **Mixed Content**: Various types of websites
4. **AI Unavailable**: Test fallback behavior
5. **Large Number**: 20+ tabs open
6. **Error Conditions**: Invalid URLs, blocked content

### Performance Testing
- **Memory Usage**: Monitor extension memory consumption
- **Processing Time**: Measure AI analysis duration
- **Storage Usage**: Check storage quota usage
- **Network Impact**: Verify no external requests

---

## 🚀 Deployment Process

### Pre-deployment Checklist
- [ ] All features tested and working
- [ ] Error handling implemented
- [ ] Performance optimized
- [ ] Documentation updated
- [ ] Icons and assets finalized
- [ ] Manifest version updated

### Packaging
```bash
# Create distribution package
cd extension
zip -r ../ai-tab-companion-v1.0.0.zip .
```

### Chrome Web Store Submission
1. **Prepare Assets**: Icons, screenshots, descriptions
2. **Privacy Policy**: Required for extensions with permissions
3. **Store Listing**: Title, description, category
4. **Review Process**: Wait for Google approval

---

## 🔒 Security Considerations

### Permission Minimization
- Only request necessary permissions
- Use `activeTab` instead of `<all_urls>` when possible
- Implement permission checks before API calls

### Data Protection
- No external data transmission
- Local processing only
- Clear sensitive data after use
- Implement data retention policies

### Content Security
- Validate all user inputs
- Sanitize extracted content
- Prevent XSS in popup UI
- Use secure communication channels

---

## 📈 Performance Optimization

### Memory Management
- Clear unused data from storage
- Limit content extraction size
- Implement efficient data structures
- Monitor memory usage patterns

### Processing Optimization
- Batch operations when possible
- Use async/await for non-blocking operations
- Implement progress indicators
- Cache frequently accessed data

### UI Performance
- Lazy load group content
- Virtualize long lists
- Debounce user interactions
- Optimize CSS animations

---

## 🔮 Future Enhancements

### Planned Features
- **Voice Commands**: "Close research tabs"
- **Smart Scheduling**: Auto-scan at intervals
- **Integration APIs**: Notion, Google Tasks export
- **Advanced Analytics**: Tab usage patterns
- **Custom Grouping**: User-defined categories

### Technical Improvements
- **WebAssembly**: Faster content processing
- **Service Worker Optimization**: Better caching
- **AI Model Updates**: Newer Gemini versions
- **Cross-browser Support**: Firefox, Edge compatibility

---

## 🤝 Contributing Guidelines

### Code Style
- **JavaScript**: ES6+ with async/await
- **CSS**: BEM methodology
- **HTML**: Semantic markup
- **Comments**: JSDoc for functions

### Git Workflow
1. Create feature branch
2. Implement changes
3. Test thoroughly
4. Update documentation
5. Submit pull request

### Code Review Process
- **Functionality**: Does it work as expected?
- **Performance**: Any performance implications?
- **Security**: Any security concerns?
- **Documentation**: Is it properly documented?

---

## 📚 Resources

### Chrome Extension Development
- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest v3 Migration Guide](https://developer.chrome.com/docs/extensions/migrating/)
- [Chrome AI APIs](https://developer.chrome.com/docs/extensions/reference/ai/)

### AI and Machine Learning
- [Gemini Nano Documentation](https://ai.google.dev/)
- [Prompt Engineering Guide](https://www.promptingguide.ai/)
- [Chrome AI Best Practices](https://developer.chrome.com/docs/extensions/ai/)

### Design and UX
- [Material Design](https://material.io/design)
- [Chrome Extension Design Guidelines](https://developer.chrome.com/docs/extensions/design/)
- [Accessibility Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)

---

**Happy coding! 🚀**
