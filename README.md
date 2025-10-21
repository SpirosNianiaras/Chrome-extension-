# 🧠 AI Tab Companion

> Ένα Chrome Extension που χρησιμοποιεί το built-in AI του Chrome (Gemini Nano APIs) για να αναλύει τα ανοιχτά tabs, να τα ομαδοποιεί κατά θέμα, να συνοψίζει το περιεχόμενο και να προτείνει ποια να κλείσεις.

## ✨ Χαρακτηριστικά

- 🤖 **Chrome Built-in AI**: Χρησιμοποιεί τα **Prompt API** και **Summarizer API** του Chrome (Gemini Nano)
- 📊 **Smart Grouping**: Ομαδοποιεί τα tabs κατά θέμα με **window.ai.languageModel.create()**
- 📝 **AI Summarization**: Δημιουργεί συνοψίσεις με **window.ai.summarizer.summarize()**
- 🗑️ **Smart Cleanup**: Προτείνει ποια tabs να κλείσεις
- ⚡ **Real-time Processing**: Γρήγορη ανάλυση και επεξεργασία
- 🔒 **Privacy-First**: Όλη η AI επεξεργασία γίνεται τοπικά στο browser

## 🚀 Εγκατάσταση

1. Κάνε clone το repository
2. Άνοιξε το Chrome και πήγαινε στο `chrome://extensions/`
3. Ενεργοποίησε το "Developer mode"
4. Κάνε κλικ "Load unpacked" και διάλεξε τον φάκελο `extension/`
5. Το extension θα εμφανιστεί στη γραμμή εργαλείων

## 🎯 Πώς Λειτουργεί

1. **Scan Tabs**: Κάνε κλικ στο extension icon για να σκανάρεις όλα τα ανοιχτά tabs
2. **AI Analysis**: Χρησιμοποιεί τα **Chrome Built-in AI APIs**:
   - **Prompt API** (`window.ai.languageModel.create()`) για ομαδοποίηση tabs
   - **Summarizer API** (`window.ai.summarizer.summarize()`) για συνοψίσεις
3. **Smart Grouping**: Τα tabs ομαδοποιούνται κατά θέμα (π.χ. "Research", "Social Media", "Work")
4. **Summarization**: Κάθε ομάδα παίρνει μια σύντομη περίληψη από το Summarizer API
5. **Cleanup Suggestions**: Επιλέγεις ποια tabs να κλείσεις

## 🤖 Chrome Built-in AI Integration

Το extension χρησιμοποιεί **αποκλειστικά** τα Chrome Built-in AI APIs:

### Prompt API για Ομαδοποίηση
```javascript
const languageModel = await window.ai.languageModel.create();
const response = await languageModel.prompt("Group these tabs by topic...");
```

### Summarizer API για Συνοψίσεις
```javascript
const summary = await window.ai.summarizer.summarize(groupContent);
```

### Runtime Check
```javascript
if (!window.ai || !window.ai.languageModel || !window.ai.summarizer) {
    // Fallback to domain-based grouping
}
```

**Δεν χρησιμοποιεί εξωτερικά AI APIs** - όλη η επεξεργασία γίνεται τοπικά με το Gemini Nano του Chrome!

## 🛠️ Tech Stack

- **Chrome Extension Manifest v3**
- **Chrome Built-in AI APIs**:
  - `window.ai.languageModel.create()` - Prompt API για ομαδοποίηση
  - `window.ai.summarizer.summarize()` - Summarizer API για συνοψίσεις
- **Chrome APIs**: tabs, scripting, storage
- **Vanilla JavaScript** (ES6+)
- **Modern CSS** με responsive design

## 📱 Screenshots

*Θα προστεθούν screenshots μετά την ολοκλήρωση*

## 🔮 Μελλοντικές Βελτιώσεις

- 🎤 Voice commands ("Close research tabs")
- 🏷️ AI-generated labels/emojis για τις ομάδες
- 📤 Εξαγωγή συνοψίσεων σε Notion/Google Tasks
- 📊 Analytics για tab usage patterns
- 🔄 Auto-sync με cloud storage

## 📄 License

MIT License - δες το [LICENSE](LICENSE) file για περισσότερες λεπτομέρειες.

## 🤝 Contributing

Contributions είναι ευπρόσδεκτες! Παρακαλώ ανοίξτε ένα issue ή pull request.

---

**Domain**: rezervnow.gr  
**Built with ❤️ για καλύτερη διαχείριση tabs**
