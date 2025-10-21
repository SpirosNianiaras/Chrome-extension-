# 🚀 AI Tab Companion - Installation Guide

## 📋 Προαπαιτούμενα

- **Chrome Browser**: Έκδοση 88+ (για Manifest v3 support)
- **Chrome AI Support**: Έκδοση 126+ (για Gemini Nano APIs)
- **Developer Mode**: Ενεργοποιημένο στο Chrome

---

## 🔧 Εγκατάσταση Extension

### Βήμα 1: Download/Clone
```bash
# Αν έχεις git
git clone <repository-url>
cd chrome-extension

# Ή απλά download το ZIP file
```

### Βήμα 2: Άνοιγμα Chrome Extensions
1. Άνοιξε το Chrome browser
2. Πήγαινε στο `chrome://extensions/`
3. Ενεργοποίησε το **"Developer mode"** (toggle επάνω δεξιά)

### Βήμα 3: Load Extension
1. Κάνε κλικ στο **"Load unpacked"** button
2. Διάλεξε τον φάκελο `extension/` από το project
3. Κάνε κλικ **"Select Folder"**

### Βήμα 4: Verification
- Το extension θα εμφανιστεί στη λίστα
- Θα δεις το εικονίδιο στη γραμμή εργαλείων του Chrome
- Κάνε κλικ στο εικονίδιο για να ανοίξει το popup

---

## ⚙️ Permissions Explanation

Το extension ζητάει τα παρακάτω permissions:

### `tabs`
- **Γιατί**: Για να διαβάσει τα ανοιχτά tabs
- **Χρήση**: Λήψη titles, URLs, και metadata

### `scripting`
- **Γιατί**: Για να εκτελέσει content scripts
- **Χρήση**: Εξαγωγή περιεχομένου από σελίδες

### `activeTab`
- **Γιατί**: Για πρόσβαση στο τρέχον tab
- **Χρήση**: Εξαγωγή περιεχομένου από την ενεργή σελίδα

### `storage`
- **Γιατί**: Για αποθήκευση αποτελεσμάτων
- **Χρήση**: Cache AI results και tab data

### `<all_urls>`
- **Γιατί**: Για να μπορεί να αναλύσει οποιαδήποτε σελίδα
- **Χρήση**: Content extraction από όλους τους τύπους sites

---

## 🧪 Testing το Extension

### Βασικός Έλεγχος
1. Άνοιξε 5-10 διαφορετικά tabs
2. Κάνε κλικ στο extension icon
3. Κάνε κλικ "Σκάναρε Tabs"
4. Περίμενε τα αποτελέσματα

### Expected Behavior
- Loading spinner για 10-30 δευτερόλεπτα
- Ομαδοποίηση tabs σε 3-6 ομάδες
- Συνοψίσεις για κάθε ομάδα
- Checkboxes για επιλογή tabs
- Buttons για κλείσιμο και εξαγωγή

---

## 🐛 Troubleshooting

### Extension δεν φορτώνει
**Πρόβλημα**: "This extension may be corrupted"
**Λύση**: 
1. Διαγράφε το extension
2. Επαναλάβε την εγκατάσταση
3. Βεβαιωθείτε ότι όλα τα αρχεία είναι παρόντα

### AI δεν λειτουργεί
**Πρόβλημα**: "Chrome AI not available"
**Λύση**:
1. Ενημερώστε το Chrome στην τελευταία έκδοση
2. Το extension θα χρησιμοποιήσει fallback grouping
3. Ελέγξτε ότι το Chrome AI είναι ενεργοποιημένο

### Content extraction fails
**Πρόβλημα**: Κενά groups ή λάθος data
**Λύση**:
1. Ελέγξτε ότι τα tabs είναι από έγκυρα URLs (http/https)
2. Κλείστε και ανοίξτε ξανά το extension
3. Δοκιμάστε με λιγότερα tabs

### Performance issues
**Πρόβλημα**: Αργή επεξεργασία
**Λύση**:
1. Κλείστε tabs που δεν χρειάζεστε
2. Περιμένετε λίγο περισσότερο (AI processing)
3. Ελέγξτε τη μνήμη του Chrome

---

## 🔒 Security & Privacy

### Τι Δεδομένα Συλλέγονται
- **Tab Titles**: Μόνο για AI analysis
- **Page Content**: Πρώτα 2000 χαρακτήρες
- **URLs**: Για grouping και display
- **Metadata**: Meta descriptions, keywords

### Πού Αποθηκεύονται
- **Chrome Storage**: Τοπικά στο browser σας
- **Session Storage**: Προσωρινά για current scan
- **Local Storage**: Cache για 5 λεπτά

### AI Processing
- **Chrome AI**: Επεξεργασία τοπικά (Gemini Nano)
- **No External APIs**: Δεν στέλνει data σε εξωτερικούς servers
- **Privacy First**: Όλα τα δεδομένα μένουν στο browser σας

---

## 📱 Mobile Support

### Chrome Mobile
- Το extension λειτουργεί σε Chrome Mobile
- UI προσαρμόζεται για μικρές οθόνες
- Touch-friendly controls

### Limitations
- Λιγότερα tabs συνήθως ανοιχτά
- AI processing μπορεί να είναι πιο αργό
- Μικρότερο popup window

---

## 🔄 Updates

### Manual Update
1. Κάνε pull τα νέα changes
2. Κάνε κλικ "Reload" στο extension
3. Ή διαγράφε και εγκατάστησε ξανά

### Auto Update
- Το extension θα ενημερώνεται αυτόματα
- Ελέγξτε το `chrome://extensions/` για updates

---

## 📞 Support

### Common Issues
- **Extension crashes**: Reload το extension
- **AI not working**: Ενημέρωση Chrome
- **Slow performance**: Κλείσε περιττά tabs

### Getting Help
1. Ελέγξτε αυτό το guide
2. Δες το README.md
3. Ανοίξτε issue στο GitHub repository

---

## ✅ Post-Installation Checklist

- [ ] Extension εμφανίζεται στη γραμμή εργαλείων
- [ ] Popup ανοίγει όταν κάνω κλικ
- [ ] "Σκάναρε Tabs" button λειτουργεί
- [ ] AI analysis παράγει groups
- [ ] Checkboxes επιτρέπουν επιλογή
- [ ] "Κλείσε Επιλεγμένα" λειτουργεί
- [ ] "Εξαγωγή Περίληψης" δημιουργεί file

---

**🎉 Congratulations! Το AI Tab Companion είναι έτοιμο για χρήση!**


