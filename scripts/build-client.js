#!/usr/bin/env node
'use strict';

const { build } = require('esbuild');
const path = require('node:path');

const watch = process.argv.includes('--watch');
const root = path.join(__dirname, '..');

async function run() {
  const options = {
    entryPoints: [path.join(root, 'src/client/app.ts')],
    outfile: path.join(root, 'public/app.js'),
    bundle: true,
    format: 'iife',
    target: ['es2022'],
    platform: 'browser',
    sourcemap: true,
    minify: process.env.NODE_ENV === 'production',
    legalComments: 'none',
    logLevel: 'info',
  };
  if (!watch) {
    await build(options);
    return;
  }
  const { context } = require('esbuild');
  const ctx = await context(options);
  await ctx.watch();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
