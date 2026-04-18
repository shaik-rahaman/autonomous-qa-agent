/**
 * Selector Store
 * Auto-learning storage for healed selectors to reuse in future executions
 */

import fs from 'fs';
import path from 'path';

export interface SelectorFixEntry {
  step: string;
  url: string;
  originalSelector: string;
  healedSelector: string;
  createdAt: number;
}

const STORE_FILE = path.join(process.cwd(), 'data', 'selector-store.json');
const MAX_ENTRIES = 100;

/**
 * Initialize store directory if needed
 */
function ensureStoreDirectory(): void {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load all entries from store
 */
function loadStore(): SelectorFixEntry[] {
  ensureStoreDirectory();
  
  if (!fs.existsSync(STORE_FILE)) {
    return [];
  }

  try {
    const data = fs.readFileSync(STORE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to load selector store:', error);
    return [];
  }
}

/**
 * Save entries to store with size limit
 */
function saveStore(entries: SelectorFixEntry[]): void {
  ensureStoreDirectory();

  // Keep only the most recent MAX_ENTRIES
  if (entries.length > MAX_ENTRIES) {
    entries = entries
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_ENTRIES);
  }

  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(entries, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save selector store:', error);
  }
}

/**
 * Save a healed selector fix
 */
export function saveSelectorFix(entry: Omit<SelectorFixEntry, 'createdAt'>): void {
  const entries = loadStore();
  
  // Add new entry
  const newEntry: SelectorFixEntry = {
    ...entry,
    createdAt: Date.now(),
  };

  entries.push(newEntry);
  saveStore(entries);

  console.log(`📚 Stored selector fix for step: "${entry.step}" on ${entry.url}`);
}

/**
 * Find a previously healed selector fix
 * Match by step and URL
 */
export function findSelectorFix(query: { step: string; url: string }): SelectorFixEntry | null {
  const entries = loadStore();

  // Find most recent matching entry
  const match = entries
    .filter(
      (entry) =>
        entry.step === query.step && entry.url === query.url
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];

  if (match) {
    console.log(`♻️  Found stored selector fix for step: "${query.step}"`);
  }

  return match || null;
}

/**
 * Get all stored fixes (for debugging/admin)
 */
export function getAllFixes(): SelectorFixEntry[] {
  return loadStore();
}

/**
 * Clear all stored fixes (for reset/testing)
 */
export function clearStore(): void {
  ensureStoreDirectory();
  try {
    fs.unlinkSync(STORE_FILE);
    console.log('✓ Selector store cleared');
  } catch (error) {
    // File may not exist, that's ok
  }
}

/**
 * Get store statistics
 */
export function getStoreStats(): { totalEntries: number; uniqueSteps: number; uniqueUrls: number } {
  const entries = loadStore();
  const uniqueSteps = new Set(entries.map((e) => e.step)).size;
  const uniqueUrls = new Set(entries.map((e) => e.url)).size;

  return {
    totalEntries: entries.length,
    uniqueSteps,
    uniqueUrls,
  };
}
