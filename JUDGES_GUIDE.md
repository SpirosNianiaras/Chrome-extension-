# Judge's Guide: AI Tab Companion

## The Problem

Modern browsing is defined by "tab overload." A user researching a new product, planning a trip, or working on a project quickly accumulates dozens of tabs. This isn't just clutter; it's a barrier to productivity. The browser becomes a list of fragmented data, making it impossible to see connections or synthesize information.

## The Solution: Using Chrome's Built-in AI

The AI Tab Companion solves this problem by using Chrome's new built-in AI APIs (Gemini Nano) to perform a powerful, **on-device** analysis of the user's open tabs. Because it runs locally, it's 100% private and incredibly fast.

Instead of just grouping tabs by domain, my extension uses a hybrid AI pipeline to understand the *content* and *purpose* of each tab.

1.  **Intelligent Grouping:** It uses a language-agnostic TF-IDF model to perform a high-speed initial clustering. It then uses the `ai.languageModel` (Prompt API) to intelligently merge groups that are semantically related (e.g., merging a "PC Gaming" group with a "NVIDIA GPUs" group).
2.  **AI Labeling:** It uses the `Prompt API` to generate a short, clear, human-readable name for each finalized group (e.g., "Medical Journal Research" or "AI News").
3.  **AI Synthesis (The Core Feature):** This is where the magic happens. The user can click **"View Full Analysis"** on any group, and the `Prompt API` will instantly read all tabs in that group, compare them, and generate a full synthesis report. This turns a dozen fragmented tabs into a single, scannable piece of knowledge.

---

## 1. Required Setup (Enabling AI Flags)

To ensure the on-device AI (Gemini Nano) is active, please follow these steps:

1.  Navigate to `chrome://flags/`.
2.  Find and set the following two (2) flags to **Enabled**:
    * `#prompt-api-for-gemini-nano`
    * `#optimization-guide-on-device-model`
3.  Click **Relaunch** to restart your browser.
4.  Install the extension from the `chrome://extensions` page (Developer mode > Load unpacked).

**IMPORTANT**: After relaunching, please click anywhere on any webpage. This "user activation" is required by Chrome to trigger the download of the AI model in the background.

## 2. Recommended Demo Flow

I recommend the following flow to see the full power of the extension.

### Step 1: Create the "Chaos"

Open 10-15 tabs across a few distinct topics. I suggest including the following sets for a robust demo:

**Topic 1: Gaming (EA FC)**
* `https://www.ea.com/en-gb/games/ea-sports-fc`
* `https://www.fut.gg/`
* `https://www.futbin.com/26/players`

**Topic 2: Technology / AI News**
* `https://openai.com/news/`
* `https://techcrunch.com/category/artificial-intelligence/`
* `https://blog.google/technology/ai/`

**Topic 3: Medical Research**
* `https://www.nejm.org/toc/nejm/recently-published`
* `https://pubmed.ncbi.nlm.nih.gov/`
* `https://www.who.int/health-topics/research`

**Topic 4: Productivity / Work**
* `https://docs.google.com/document/u/0/`
* `https://calendar.google.com/`

### Step 2: Trigger the AI Grouping

1.  Click the **AI Tab Companion** icon in your Chrome toolbar to open the popup.
2.  Click the **"Rescan"** button.
3.  Wait a few seconds. You will see the "Analysis Results" list populate with AI-generated groups (e.g., "Sports Fc™ Website", "AI News and Updates", etc.).

### Step 3: See the AI Synthesis (The Core Feature)

1.  In the popup, click on one of the groups you just created (e.g., "Medical Research").
2.  The view will expand, instantly showing a short, AI-generated summary describing the purpose of that group.
3.  Click the button inside that group, **"View Full Analysis"**.
4.  A **new tab will open**, displaying a full, beautifully formatted **AI Synthesis Report**. This report includes the core subject, a detailed summary, and key insights extracted by comparing the tabs in the group.

## 3. How It Works: The AI Architecture

The functionality you witnessed is a robust, multi-stage, on-device AI pipeline.

#### 1. `ai.languageModel` (The Prompt API / Gemini Nano)

This is my "intelligent workhorse" for all core understanding and generation tasks. I use it in four distinct ways:

* **AI Labeling:** To generate the short, human-readable names for every group.
* **AI Synthesis:** To power the **"View Full Analysis"** feature. It takes keywords from all tabs in a group and synthesizes them into a full report with key insights.
* **AI Merge Pass:** After an initial fast grouping (TF-IDF), I use the `languageModel` in an **efficient batch process** to find and merge groups that are semantically identical.
* **AI Refinement:** To intelligently attach "orphan" tabs (singletons) to their correct existing groups, using the AI as the primary **decider** on the best fit.

#### 2. `ai.summarizer` (The Summarizer API)

I use this API *selectively* to enhance data quality without overloading the system.

* **Intelligent Blurbs:** It generates the short summary "blurb" you see when you first expand a group in the popup.
* **Data Enrichment:** It is only triggered for tabs where the text content is weak or missing. This ensures my core grouping engine always has high-quality, relevant text to analyze.

This hybrid architecture (fast TF-IDF + smart Gemini Nano correction) makes the extension robust, fast, and ensures it functions "generally" for any topic or language, even if one of the AI models fails.
