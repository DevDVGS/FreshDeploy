#!/usr/bin/env node
import { run } from '../src/cli.js';
run(process.argv.slice(2)).catch(error => {
  console.error(`freshdeploy: ${error.message}`);
  process.exitCode = 2;
});
