#!/usr/bin/env node

const fs = require('fs');

const input = fs.readFileSync(0, 'utf8');
const payload = input ? JSON.parse(input) : {};
const prompt = payload.prompt || '';

if (/(确认|合并|F[0-9]{3})/i.test(prompt)) {
  process.stdout.write('TRIGGER_SOCRATES\n');
}
