#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const input = fs.readFileSync(0, 'utf8');
const payload = input ? JSON.parse(input) : {};
const filePath = payload.tool_input && payload.tool_input.file_path;

if (!filePath || !path.isAbsolute(filePath)) {
  process.exit(0);
}

const scriptPath = path.join(__dirname, 'check-req-confirmed.js');
const result = spawnSync(process.execPath, [scriptPath, filePath], {
  stdio: 'inherit'
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
