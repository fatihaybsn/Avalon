import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createWindowsServer } from './mcp-runtime.mjs';

const { server, shutdown } = createWindowsServer();
process.once('exit', shutdown);
process.once('SIGTERM', () => { shutdown(); process.exit(0); });
const transport = new StdioServerTransport();
await server.connect(transport);
const previousClose = transport.onclose;
transport.onclose = () => { shutdown(); previousClose?.(); };
