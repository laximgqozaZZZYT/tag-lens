import WebSocket from 'ws';
import { spawn } from 'child_process';
import path from 'path';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function run() {
  const ws = new WebSocket('ws://127.0.0.1:9222/devtools/browser/...'); // will find target
  // just run a small driver
  console.log("running");
}
