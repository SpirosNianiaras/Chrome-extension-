# AI Tab Companion
### Chrome Built-in AI Challenge 2025 Entry

## 🎯 Problem Statement

**Tab Chaos is Real!** Power users often have 50-100+ tabs open, making it impossible to find what they need. Manually organizing tabs is time-consuming and error-prone.

## 💡 Solution

**AI Tab Companion** uses Chrome's Built-in AI APIs to automatically analyze and organize your tabs into intelligent groups based on content similarity, saving hours of manual work.

## 🤖 Chrome Built-in AI APIs Used

### 1. **Prompt API (Gemini Nano)** - Primary AI Engine
- **Semantic Analysis**: Classifies each tab's content into topics
- **Entity Recognition**: Extracts key organizations, products, and concepts
- **Topic Labeling**: Generates human-readable group names
- **Smart Grouping**: Determines optimal tab clusters

### 2. **Summarizer API** - Content Understanding
- **Tab Summarization**: Extracts key points from web pages
- **Quick Overview**: Provides instant understanding of tab content
- **Summary Bullets**: Generates concise summaries for each group

### 3. **Embedding Model API** - Advanced Similarity
- **Semantic Vectors**: Creates embeddings for deep similarity analysis
- **Vector Clustering**: Enhances grouping accuracy
- **Fallback Ready**: Works without embeddings if unavailable

## ✨ Key Features

### 🔒 Privacy-First Architecture
- **100% On-Device Processing**: All AI happens locally using Gemini Nano
- **Zero Server Calls**: Your browsing data never leaves your device
- **No Data Collection**: Complete privacy guarantee

### ⚡ Fast & Responsive
- **Concurrent Processing**: Analyzes multiple tabs simultaneously
- **Smart Caching**: Remembers previous analyses
- **Optimized Prompts**: Compact, efficient AI requests

### 🎨 Intelligent Grouping
- **Hybrid Approach**: Combines AI + deterministic algorithms
- **High Accuracy**: ~85%+ grouping accuracy on test scenarios
- **Adaptive**: Works with different content types (news, research, shopping, etc.)

### 💰 Cost-Efficient
- **No API Fees**: Uses free Chrome Built-in AI
- **No Quotas**: Unlimited usage
- **No Backend**: No server costs

## 🛠️ Technical Implementation

### Architecture
```
┌─────────────────┐
│  Chrome Tabs    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Content Script  │◄──── Extracts page content
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Background      │
│  Service Worker │
└────────┬────────┘
         │
         ├──► 🤖 Prompt API (Gemini Nano)
         │     └── Topic extraction
         │     └── Classification
         │     └── Entity recognition
         │
         ├──► 📄 Summarizer API
         │     └── Content summarization
         │     └── Key points
         │
         └──► 🎯 Embedding Model API
               └── Semantic vectors
               └── Similarity comparison
```

### AI Pipeline

1. **Content Extraction** (parallel)
   - Extract text, metadata, headings from each tab
   - Handle special cases (YouTube, GitHub, etc.)

2. **Semantic Feature Generation** (Chrome AI)
   ```javascript
   // Prompt API classifies each tab
   const session = await languageModel.create();
   const features = await session.prompt(classificationPrompt);
   // Returns: topic, keywords, entities, doc_type
   ```

3. **Summarization** (Chrome AI)
   ```javascript
   // Summarizer API extracts key points
   const summarizer = await ai.summarizer.create();
   const summary = await summarizer.summarize(content);
   ```

4. **Smart Clustering** (Hybrid)
   - Combines AI features + TF-IDF + embeddings
   - Deterministic clustering with AI verification
   - LLM refinement for edge cases

5. **Group Labeling** (Chrome AI)
   - Prompt API generates descriptive names
   - Considers all tabs in group for context

## 📊 Performance Metrics

- **Speed**: ~3-5 seconds per tab with AI
- **Accuracy**: 85%+ on medical/AI/gaming test scenarios
- **AI Usage**: Uses Prompt API + Summarizer API for most tabs
- **Fallback**: Graceful degradation if AI unavailable
- **Scalability**: Tested with 50+ tabs

## 🎥 Demo Video

[Link to YouTube demo video - to be added]

**Demo Highlights:**
1. Opening 20+ tabs across different topics
2. Clicking "Scan Tabs" button
3. Watching real-time AI analysis in console
4. Seeing intelligent groups created
5. Exploring AI-generated summaries

## 🚀 Installation & Usage

### Prerequisites
1. Chrome Canary/Dev (v131+)
2. Enable Chrome AI flags:
   ```
   chrome://flags/#optimization-guide-on-device-model
   chrome://flags/#prompt-api-for-gemini-nano
   chrome://flags/#summarization-api-for-gemini-nano
   ```
3. Download Gemini Nano model (automatic on first use)

### Install Extension
1. Clone this repository
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `extension` folder

### Usage
1. Open multiple tabs (recommendation: 10-30 tabs)
2. Click AI Tab Companion icon
3. Click "Scan Tabs" button
4. Watch console logs to see AI in action
5. Tabs are automatically organized into groups!

## 🧪 Testing

### Golden Test Scenarios
We've created test scenarios to demonstrate accuracy:

1. **Medical + AI Mix** (`S1_medical_ai_mix.json`)
   - Medical research tabs (PubMed, NEJM, Nature)
   - AI/tech news tabs (TechCrunch, OpenAI, Google)
   - Expected: 2 distinct groups

2. **Gaming + Shopping Trap** (`S2_gaming_shop_trap.json`)
   - FIFA gaming content
   - Shopping/commerce sites
   - Expected: Separate gaming from shopping

3. **Productivity + Portals** (`S3_productivity_portals_noise.json`)
   - Chrome development docs
   - Apple product pages
   - Generic landing pages
   - Expected: Intelligent topic separation

### Run Tests
```bash
# Load test scenarios and compare AI results
# See TEST_INSTRUCTIONS.md for details
```

## 🏆 Why This Extension is Helpful

### For Power Users
- **Save Time**: No more manual tab organization
- **Find Things**: Quickly locate tabs by topic
- **Stay Organized**: Automatic maintenance of tab order

### For Researchers
- **Topic Separation**: Keep work/personal tabs separate
- **Quick Overview**: See summaries without opening tabs
- **Privacy**: Research stays on your device

### For Developers
- **Example Implementation**: See Chrome AI APIs in action
- **Open Source**: Learn from real-world usage
- **Best Practices**: Hybrid AI + deterministic approach

## 🔧 Technical Highlights for Judges

### Innovative AI Usage
1. **Hybrid Intelligence**: Combines AI with deterministic algorithms
2. **Timeout Protection**: Graceful handling of slow AI responses
3. **Smart Caching**: Avoids redundant AI calls
4. **Adaptive Prompting**: Compact prompts for faster responses

### Code Quality
- **TypeScript-like JSDoc**: Full type annotations
- **Error Handling**: Comprehensive try-catch blocks
- **Logging**: Detailed console logs for debugging
- **Performance Monitoring**: Timing metrics throughout

### Chrome AI Challenge Compliance
- ✅ Uses **Prompt API** extensively
- ✅ Uses **Summarizer API** when available
- ✅ Uses **Embedding Model API** (optional)
- ✅ **Privacy-first**: 100% on-device processing
- ✅ **Network resilient**: Works offline after model download
- ✅ **Cost-efficient**: No server backend needed

## 📝 Feedback on Chrome AI APIs

### What Works Well ✅
- **Gemini Nano Quality**: Excellent semantic understanding
- **On-Device Speed**: Faster than expected (3-5s per tab)
- **Privacy Model**: Perfect for sensitive data
- **API Design**: Clean, promise-based interface

### Areas for Improvement 🔧
- **Timeout Handling**: Need better progress indicators
- **Model Download**: Could be more transparent
- **API Availability**: Check methods could be more reliable
- **Error Messages**: More specific error codes would help

### Feature Requests 💡
- **Batch Processing**: Process multiple prompts in one call
- **Streaming Responses**: For long-running operations
- **Embedding Dimensions**: Control over vector size
- **Model Warm-up**: Pre-initialize for faster first call

## 📜 License

MIT License - Open Source

## 🤝 Contributing

This is a hackathon entry, but contributions welcome after judging period!

## 📧 Contact

[Your contact information]

---

**Built with ❤️ using Chrome Built-in AI APIs**

**Google Chrome Built-in AI Challenge 2025**


