#!/usr/bin/env node
/**
 * HealthDesk Landing — FTP Deploy
 * Uploads dist/ to /public_html/ on the server (overwrite mode, no wipe).
 *
 * Usage: FTP_PASS=xxx node deploy.js
 */
const ftp = require('basic-ftp');
const path = require('path');
const fs = require('fs');

const FTP_HOST = process.env.FTP_HOST || 's9.cyber-folks.pl';
const FTP_USER = process.env.FTP_USER || 'healthdesk@healthdesk.site';
const FTP_PASS = process.env.FTP_PASS;

if (!FTP_PASS) {
  console.error('Error: FTP_PASS environment variable is required.');
  console.error('Usage: FTP_PASS=xxx node deploy.js');
  process.exit(1);
}
const REMOTE_DIR = '/public_html';
const LOCAL_DIR = path.join(__dirname, 'dist');

const MAX_RETRIES = 3;

async function deploy() {
  if (!fs.existsSync(LOCAL_DIR)) {
    console.error('Error: dist/ directory not found. Run "node build.js" first.');
    process.exit(1);
  }

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const client = new ftp.Client();
    client.ftp.verbose = false;
    client.ftp.timeout = 120000;
    client.prepareTransfer = ftp.enterPassiveModeIPv4;

    try {
      console.log(`Connecting to ${FTP_HOST}... (attempt ${attempt}/${MAX_RETRIES})`);
      await client.access({
        host: FTP_HOST,
        user: FTP_USER,
        password: FTP_PASS,
        secure: false
      });

      console.log(`Connected. Uploading dist/ → ${REMOTE_DIR}/ (overwrite mode)`);
      await client.ensureDir(REMOTE_DIR);
      await client.cd(REMOTE_DIR);
      await client.uploadFromDir(LOCAL_DIR);

      console.log('\nDeploy complete!');
      console.log(`Site: https://healthdesk.site/`);
      return; // success
    } catch (err) {
      lastError = err;
      console.error(`Deploy attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 5000;
        console.log(`Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    } finally {
      client.close();
    }
  }

  console.error(`Deploy failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
  process.exit(1);
}

deploy();
