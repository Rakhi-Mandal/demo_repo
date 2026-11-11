// const fs = require('fs');
// const path = require('path');
// const { TEST_DATA, SESSION_DATA, DYNAMIC_KEYS } = require('./paths');
// const { generateDynamicFields } = require('./dynamicData');

// function ensureSessionDir() {
//   fs.mkdirSync(path.dirname(SESSION_DATA), { recursive: true });
// }

// function readJson(filePath) {
//   return JSON.parse(fs.readFileSync(filePath, 'utf8'));
// }

// function writeJson(filePath, data) {
//   fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
// }

// /**
//  * Per-worker session file so parallel workers never share/write the same JSON.
//  * Falls back to data/session-data.json for global-setup / single-worker runs.
//  */
// function sessionFilePath() {
//   const idx = process.env.TEST_PARALLEL_INDEX;
//   if (idx !== undefined && idx !== '') {
//     return path.join(path.dirname(SESSION_DATA), `session-data-w${idx}.json`);
//   }
//   return SESSION_DATA;
// }

// /** Stable config only — strips any leftover dynamic keys. Read-only for runs. */
// function readStaticData() {
//   const data = readJson(TEST_DATA);
//   for (const key of DYNAMIC_KEYS) {
//     delete data[key];
//   }
//   return data;
// }

// function hasSession() {
//   const filePath = sessionFilePath();
//   if (!fs.existsSync(filePath)) {
//     return false;
//   }
//   const session = readJson(filePath);
//   return Boolean(session.nameRequired);
// }

// /**
//  * Writes key/value pairs into the worker session store (not test-data.json).
//  */
// function saveSession(data) {
//   ensureSessionDir();
//   const filePath = sessionFilePath();
//   const next = { ...loadSession(), ...data };
//   writeJson(filePath, next);
//   return next;
// }

// /**
//  * Reads session values for this worker.
//  */
// function loadSession() {
//   const filePath = sessionFilePath();
//   if (!fs.existsSync(filePath)) {
//     return {};
//   }
//   return readJson(filePath);
// }

// /**
//  * Clears this worker's session file (manual use only).
//  */
// function clearSession() {
//   const filePath = sessionFilePath();
//   if (fs.existsSync(filePath)) {
//     fs.unlinkSync(filePath);
//   }
// }

// /**
//  * No longer mirrors into test-data.json (avoids parallel write corruption).
//  * Kept for API compatibility — returns merged static + session in memory only.
//  */
// function syncSessionToTestData(sessionData = loadSession()) {
//   const staticData = readStaticData();
//   const dynamic = {};
//   for (const key of DYNAMIC_KEYS) {
//     if (sessionData[key] != null) {
//       dynamic[key] = sessionData[key];
//     }
//   }
//   return {
//     ...staticData,
//     ...dynamic,
//   };
// }

// /**
//  * Prepares session data for the run.
//  * @param {{ force?: boolean }} options
//  * - force: true  → generate new values and override session (Create Draft RFP)
//  * - force: false → reuse existing session if present; generate only when missing
//  *
//  * Dynamic values are applied in-memory via Object.assign(testData, session) in specs.
//  * test-data.json is never written during the run.
//  */
// function prepareSession({ force = false } = {}) {
//   ensureSessionDir();
//   const filePath = sessionFilePath();

//   let sessionData;
//   if (!force && hasSession()) {
//     sessionData = loadSession();
//     const generated = generateDynamicFields();
//     let updated = false;
//     for (const key of DYNAMIC_KEYS) {
//       if (sessionData[key] == null || sessionData[key] === '') {
//         sessionData[key] = generated[key];
//         updated = true;
//       }
//     }
//     if (updated) {
//       writeJson(filePath, sessionData);
//     }
//   } else {
//     sessionData = generateDynamicFields();
//     writeJson(filePath, sessionData);
//   }

//   return sessionData;
// }

// /**
//  * After a run: keep worker session file. Does not modify test-data.json.
//  */
// function endSession() {
//   // Intentionally no write to test-data.json (parallel-safe).
// }

// module.exports = {
//   saveSession,
//   loadSession,
//   clearSession,
//   hasSession,
//   prepareSession,
//   endSession,
//   syncSessionToTestData,
//   sessionFilePath,
// };
 