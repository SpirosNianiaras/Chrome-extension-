# 🚀 Judge's Guide: AI Tab Companion

Thank you for evaluating the AI Tab Companion, an intelligent assistant that leverages Chrome's built-in AI (Gemini Nano) to turn tab chaos into organized knowledge.

This extension is not just a "grouper." It's an assistant that actively understands, labels, and synthesizes your browsing content.

## 1. ⚙️ Required Setup (Enabling AI Flags)

To ensure the on-device AI (Gemini Nano) is active, please follow these steps:

1. Navigate to `chrome://flags/`.
2. Find and set the following two (2) flags to **Enabled**:
   - `#prompt-api-for-gemini-nano`
   - `#optimization-guide-on-device-model`
3. Click **Relaunch** to restart your browser.
4. Install the extension from the `chrome://extensions` page (Developer mode > Load unpacked).

**IMPORTANT**: After relaunching, please click anywhere on any webpage. This "user activation" is required by Chrome to trigger the download of the AI model in the background.

## 2. 🌟 The "Wow" Demo Flow (2-Minute Guide)

We recommend the following flow to see the full power of the extension.

### Step 1: Create the "Chaos"
Open 10-15 tabs across a few distinct topics. We suggest including the following sets for a robust demo:

**Topic 1: Gaming (EA FC)**
- https://www.ea.com/en-gb/games/ea-sports-fc
- https://www.fut.gg/
- https://www.futbin.com/26/players

**Topic 2: Technology / AI News**
- https://openai.com/news/
- https://techcrunch.com/category/artificial-intelligence/
- https://blog.google/technology/ai/

**Topic 3: Medical Research**
- https://www.nejm.org/toc/nejm/recently-published
- https://pubmed.ncbi.nlm.nih.gov/
- https://www.who.int/health-topics/research

**Topic 4: Productivity / Work**
- https://docs.google.com/document/u/0/
- https://calendar.google.com/

### Step 2: Trigger the AI Grouping

1. Click the **AI Tab Companion** icon in your Chrome toolbar to open the popup.
2. Click the **"Rescan"** button.
3. Wait a few seconds. You will see the "Analysis Results" list populate with AI-generated groups (e.g., "Sports Fc™ Website", "AI News and Updates", etc.).

### Step 3: See the "AI Synthesis" (The Core Feature)

1. In the popup, click on one of the groups you just created (e.g., "Medical").
2. The view will expand, instantly showing a short, AI-generated summary describing the purpose of that group.
3. Click the button inside that group (e.g., "View Full Analysis").
4. A new tab will open, displaying a full, beautifully formatted **AI Synthesis Report**. This report includes the core subject, a detailed summary, and key insights extracted by comparing the tabs in the group.

## 3. 🧠 What You Just Saw: The AI Pipeline

The "magic" you witnessed is a robust, multi-stage, on-device AI pipeline:

1. **AI-First Grouping (TF-IDF)**: The extension first uses a language-agnostic TF-IDF model to create initial groups. This is fast and works for any language. (We architected it to be Embedding-first, but since the EmbeddingModel API is not yet available in Canary, it correctly falls back to TF-IDF).

2. **AI Merge Pass (Gemini Nano)**: The extension then uses the Prompt API (Gemini Nano) to intelligently merge groups that the TF-IDF model "over-split." It does this by asking the AI if two groups (e.g., "PC Gaming" and "NVIDIA GPUs") represent the same user task, using an efficient batch-processing method to remain fast.

3. **AI Labeling (Gemini Nano)**: It uses the Prompt API again to generate a short, human-readable name for each finalized group (e.g., "Medical Journal Research").

4. **AI Synthesis (Gemini Nano)**: Finally, when you click "View Full Analysis," it runs a deep synthesis prompt to compare the tabs and generate the full report.

This hybrid approach (fast heuristics + intelligent AI correction) ensures high performance, accuracy, and true, language-agnostic "general purpose" functionality.
