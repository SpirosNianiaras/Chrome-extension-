# 🚀 AI Tab Companion - Quick Test Guide

## 📋 Βήματα για να το δοκιμάσεις στο Chrome

### 1. Άνοιξε το Chrome
- Βεβαιώσου ότι έχεις Chrome version 88+ (για Manifest v3 support)

### 2. Πήγαινε στα Extensions
- Πληκτρολόγησε: `chrome://extensions/` στη γραμμή διευθύνσεων
- Ή πήγαινε στο menu: **Chrome Menu** → **More Tools** → **Extensions**

### 3. Ενεργοποίησε Developer Mode
- Κάνε κλικ στο toggle **"Developer mode"** επάνω δεξιά
- Θα δεις επιπλέον buttons

### 4. Φόρτωσε το Extension
- Κάνε κλικ στο **"Load unpacked"** button
- Πήγαινε στον φάκελο: `/Users/spirosnianiaras/chrome extension/extension/`
- Κάνε κλικ **"Select Folder"**

### 5. Επαλήθευση
- Το extension θα εμφανιστεί στη λίστα
- Θα δεις το εικονίδιο στη γραμμή εργαλείων (δεξιά από τη γραμμή διευθύνσεων)
- Βεβαιώσου ότι είναι **"Enabled"**

---

## 🧪 Γρήγορο Test

### Test 1: Basic Functionality
1. **Κάνε κλικ στο extension icon** στη γραμμή εργαλείων
2. **Expected**: Popup ανοίγει με "Σκάναρε Tabs" button
3. **Expected**: Clean UI με logo και description

### Test 2: Tab Scanning
1. **Άνοιξε 3-5 tabs** με διαφορετικό περιεχόμενο:
   - Google.com
   - Wikipedia.org
   - GitHub.com
   - YouTube.com
   - Amazon.com

2. **Κάνε κλικ στο extension icon**
3. **Κάνε κλικ "Σκάναρε Tabs"**
4. **Expected**: Loading spinner εμφανίζεται
5. **Expected**: Μετά από 10-30 δευτερόλεπτα, αποτελέσματα εμφανίζονται

### Test 3: Results
- **Αν το Chrome AI είναι διαθέσιμο**: Θα δεις intelligent grouping
- **Αν το Chrome AI δεν είναι διαθέσιμο**: Θα δεις fallback domain-based grouping

---

## 🐛 Αν κάτι πάει στραβά

### Extension δεν φορτώνει
- Ελέγξτε ότι όλα τα αρχεία είναι στον `extension/` φάκελο
- Ελέγξτε το manifest.json για syntax errors
- Κάντε reload το extension

### Popup δεν ανοίγει
- Ελέγξτε ότι το popup.html υπάρχει
- Ελέγξτε το browser console για errors (F12)

### AI δεν λειτουργεί
- Αυτό είναι normal αν το Chrome AI δεν είναι διαθέσιμο
- Το extension θα χρησιμοποιήσει fallback grouping
- Ελέγξτε το browser console για error messages

### Content extraction fails
- Ελέγξτε ότι τα tabs είναι από valid URLs (http/https)
- Ελέγξτε ότι το content.js φορτώνει σωστά

---

## 📊 Expected Results

### Με Chrome AI (αν είναι διαθέσιμο)
- **Intelligent Grouping**: Tabs ομαδοποιούνται κατά θέμα
- **AI Summaries**: Κάθε ομάδα έχει περίληψη
- **Smart Categories**: "Research", "Social Media", "Work", κλπ.

### Χωρίς Chrome AI (fallback)
- **Domain-based Grouping**: Tabs ομαδοποιούνται κατά domain
- **Basic Summaries**: Απλές περιγραφές
- **Categories**: "google.com", "wikipedia.org", κλπ.

---

## 🎯 Success Criteria

Το extension θεωρείται **successful** αν:

- [ ] Φορτώνει χωρίς errors
- [ ] Popup ανοίγει και λειτουργεί
- [ ] Tab scanning δουλεύει (AI ή fallback)
- [ ] UI interactions λειτουργούν
- [ ] Error handling είναι graceful

---

## 🔍 Debug Information

### Console Logs
- **F12** → **Console** tab
- Ψάξε για messages που αρχίζουν με "AI Tab Companion"
- Ψάξε για error messages

### Extension Details
- `chrome://extensions/` → Κάνε κλικ στο extension
- **"Inspect views: background page"** για background script
- **"Inspect views: popup"** για popup debugging

---



