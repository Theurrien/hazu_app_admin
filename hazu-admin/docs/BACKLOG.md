# Backlog

Technical debt and future improvements for hazu-admin.

---

## Security

### Replace xlsx with exceljs
**Priority:** Low (internal tool)
**Added:** 2026-01-09

The `xlsx` (SheetJS) package has two unpatched vulnerabilities:
- Prototype Pollution (GHSA-4r6h-8v6p-xvw6)
- ReDoS (GHSA-5pgg-2g8v-p4x9)

Risk is low since this is a desktop app opening trusted Excel files, but `exceljs` is a better maintained alternative.

**Migration scope:**
- `src/renderer/pages/BulkImportPage.tsx` - Excel parsing logic
- Any other files using xlsx

---
