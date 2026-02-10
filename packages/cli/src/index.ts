#!/usr/bin/env node
import { createProgram } from './program.js';

const program = createProgram();
program.parseAsync(process.argv).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
