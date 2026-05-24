import { runCli } from './cli.js';

runCli().catch((err) => {
  console.error('\n❌ Fatal Error:', err);
  process.exit(1);
});
