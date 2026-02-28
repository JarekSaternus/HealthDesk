#!/usr/bin/env node
/**
 * HealthDesk Landing — FTP Deploy
 * Uploads dist/ to /public_html/ on the server.
 *
 * Usage: FTP_PASS=xxx node deploy.js
 * Or: set password in .env or use hardcoded fallback.
 */
const ftp = require('basic-ftp');
const path = require('path');
const fs = require('fs');

const FTP_HOST = 's9.cyber-folks.pl';
const FTP_USER = 'healthdesk@healthdesk.site';
const FTP_PASS = process.env.FTP_PASS || '9qc-[N1TgA-U#6u*';
const REMOTE_DIR = '/public_html';
const LOCAL_DIR = path.join(__dirname, 'dist');

async function deploy() {
  if (!fs.existsSync(LOCAL_DIR)) {
    console.error('Error: dist/ directory not found. Run "node build.js" first.');
    process.exit(1);
  }

  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    console.log(`Connecting to ${FTP_HOST}...`);
    await client.access({
      host: FTP_HOST,
      user: FTP_USER,
      password: FTP_PASS,
      secure: false
    });

    console.log(`Connected. Uploading dist/ → ${REMOTE_DIR}/`);
    await client.ensureDir(REMOTE_DIR);
    await client.clearWorkingDir(); // Clean remote dir first
    await client.uploadFromDir(LOCAL_DIR, REMOTE_DIR);

    console.log('\nDeploy complete!');
    console.log(`Site: https://healthdesk.site/`);
  } catch (err) {
    console.error('Deploy failed:', err.message);
    process.exit(1);
  } finally {
    client.close();
  }
}

deploy();
