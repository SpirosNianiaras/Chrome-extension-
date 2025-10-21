# 🧪 AI Tab Companion - Test Instructions

## 🚀 Quick Test Setup

### 1. Φόρτωση Extension στο Chrome

1. **Άνοιξε το Chrome**
2. **Πήγαινε στο**: `chrome://extensions/`
3. **Ενεργοποίησε**: "Developer mode" (toggle επάνω δεξιά)
4. **Κάνε κλικ**: "Load unpacked"
5. **Διάλεξε**: τον φάκελο `extension/` από το project
6. **Κάνε κλικ**: "Select Folder"

### 2. Verification Checklist

- [ ] Extension εμφανίζεται στη λίστα
- [ ] Εικονίδιο εμφανίζεται στη γραμμή εργαλείων
- [ ] Δεν υπάρχουν error messages
- [ ] Extension είναι "Enabled"

### 3. Basic Functionality Test

#### Test 1: Popup Opening
1. Κάνε κλικ στο extension icon
2. **Expected**: Popup ανοίγει με "Σκάναρε Tabs" button
3. **Expected**: Clean UI με logo και description

#### Test 2: Tab Scanning (Basic)
1. Άνοιξε 3-5 διαφορετικά tabs (π.χ. Google, Wikipedia, GitHub)
2. Κάνε κλικ στο extension icon
3. Κάνε κλικ "Σκάναρε Tabs"
4. **Expected**: Loading spinner εμφανίζεται
5. **Expected**: Μετά από 10-30 δευτερόλεπτα, αποτελέσματα εμφανίζονται

#### Test 3: AI Integration Test
1. **Αν το Chrome AI είναι διαθέσιμο**:
   - Θα δεις intelligent grouping
   - Θα δεις AI-generated summaries
2. **Αν το Chrome AI δεν είναι διαθέσιμο**:
   - Θα δεις fallback domain-based grouping
   - Θα δεις basic summaries

#### Test 4: UI Interactions
1. Κάνε κλικ σε group headers για να τα ανοίξεις/κλείσεις
2. Επιλέγεις tabs με checkboxes
3. Κάνε κλικ "Κλείσε Επιλεγμένα" (αν έχεις επιλέξει tabs)
4. Κάνε κλικ "Εξαγωγή Περίληψης"

### 4. Error Handling Test

#### Test 5: No Tabs Scenario
1. Κλείσε όλα τα tabs εκτός από ένα
2. Δοκίμασε το extension
3. **Expected**: Appropriate message ή fallback behavior

#### Test 6: Invalid URLs
1. Άνοιξε tabs με `chrome://` URLs
2. Δοκίμασε το extension
3. **Expected**: Extension αγνοεί invalid URLs

### 5. Performance Test

#### Test 7: Many Tabs
1. Άνοιξε 10-15 tabs με διαφορετικό περιεχόμενο
2. Δοκίμασε το extension
3. **Expected**: Extension χειρίζεται πολλά tabs
4. **Expected**: Processing time < 60 δευτερόλεπτα

---

## 🐛 Common Issues & Solutions

### Issue: Extension δεν φορτώνει
**Solution**: 
- Ελέγξτε ότι όλα τα αρχεία είναι στον `extension/` φάκελο
- Ελέγξτε το manifest.json για syntax errors
- Reload το extension

### Issue: Popup δεν ανοίγει
**Solution**:
- Ελέγξτε ότι το popup.html υπάρχει
- Ελέγξτε το manifest.json για popup configuration
- Ελέγξτε το browser console για errors

### Issue: AI δεν λειτουργεί
**Solution**:
- Αυτό είναι normal αν το Chrome AI δεν είναι διαθέσιμο
- Το extension θα χρησιμοποιήσει fallback grouping
- Ελέγξτε το browser console για error messages

### Issue: Content extraction fails
**Solution**:
- Ελέγξτε ότι τα tabs είναι από valid URLs (http/https)
- Ελέγξτε ότι το content.js φορτώνει σωστά
- Ελέγξτε το browser console για errors

---

## 📊 Test Results Template

```
Test Date: ___________
Chrome Version: ___________
Extension Version: 1.0.0

✅ Basic Loading: PASS/FAIL
✅ Popup Opening: PASS/FAIL
✅ Tab Scanning: PASS/FAIL
✅ AI Integration: PASS/FAIL (or FALLBACK)
✅ UI Interactions: PASS/FAIL
✅ Error Handling: PASS/FAIL
✅ Performance: PASS/FAIL

Notes:
- AI Available: YES/NO
- Fallback Used: YES/NO
- Processing Time: _____ seconds
- Number of Tabs Tested: _____

Issues Found:
1. ________________
2. ________________
3. ________________
```

---

## 🎯 Success Criteria

Το extension θεωρείται **successful** αν:

- [ ] Φορτώνει χωρίς errors
- [ ] Popup ανοίγει και λειτουργεί
- [ ] Tab scanning δουλεύει (AI ή fallback)
- [ ] UI interactions λειτουργούν
- [ ] Error handling είναι graceful
- [ ] Performance είναι acceptable (< 60s για 15 tabs)

---

**Ready to test! 🚀**


