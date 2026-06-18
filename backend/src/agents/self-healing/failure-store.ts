import fs from 'fs';
import path from 'path';

export interface FailureRecord {
  timestamp: string;
  actualPlaywrightError: string;
  extractedSelector: string | null;
  failureType: string;
  confidence?: string;
  source?: string;
  step?: string;
  url?: string;
}

const STORE_DIR = path.join(process.cwd(), 'tmp', 'failure-diagnostics');
const STORE_FILE = path.join(STORE_DIR, 'latest-failure.json');

export const failureStore = {
  save(record: FailureRecord) {
    try {
      if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify(record, null, 2), 'utf-8');
    } catch (err) {
      // don't throw - best-effort persistence
      console.warn('failure-store: could not persist diagnostics', err);
    }
  },
  read(): FailureRecord | null {
    try {
      if (!fs.existsSync(STORE_FILE)) return null;
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      return JSON.parse(raw) as FailureRecord;
    } catch (err) {
      console.warn('failure-store: could not read diagnostics', err);
      return null;
    }
  }
};

export default failureStore;
