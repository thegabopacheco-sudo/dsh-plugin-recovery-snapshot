// Test end-to-end de recovery-snapshot.
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
const home = path.join(tmpDir, 'dsh-home');
mkdirSync(path.join(home, 'media-studio'), { recursive: true });
mkdirSync(path.join(home, 'discord-operator'), { recursive: true });
writeFileSync(path.join(home, 'media-studio', 'config.json'), JSON.stringify({ allowedPaths: ['C:\\Users\\desco'] }), 'utf8');
writeFileSync(path.join(home, 'discord-operator', 'config.json'), JSON.stringify({ token: 'token-de-prueba', allowedChannels: [] }), 'utf8');

function makeClient(extraEnv = {}) {
  const entry = process.env.RECOVERY_SERVER ? path.resolve(process.env.RECOVERY_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: home, ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'recovery-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
const status = textOf(await client.callTool({ name: 'status', arguments: {} }));
console.log('--- status ---'); console.log(status);
console.log('detecta 2 configs:', status.includes('2'));
const noConfirm = await client.callTool({ name: 'backup', arguments: {} });
console.log('backup sin confirm isError:', noConfirm.isError === true);
const backup = await client.callTool({ name: 'backup', arguments: { label: 'prueba', confirm: true } });
const backupText = textOf(backup);
console.log('--- backup ---'); console.log(backupText);
const snapshotId = backupText.replace('Snapshot: ', '').split(' ')[0];
const list = textOf(await client.callTool({ name: 'list', arguments: {} }));
console.log('--- list ---'); console.log(list);
console.log('lista snapshot:', list.includes('prueba'));
const verify = textOf(await client.callTool({ name: 'verify', arguments: { id: snapshotId } }));
console.log('--- verify ---'); console.log(verify);
console.log('verify OK:', verify.includes('0 problema') || verify.includes('✅'));
writeFileSync(path.join(home, 'media-studio', 'config.json'), JSON.stringify({ allowedPaths: ['CAMBIO'] }), 'utf8');
const verifyBad = textOf(await client.callTool({ name: 'verify', arguments: { id: snapshotId } }));
console.log('verify detecta cambio:', verifyBad.includes('mismatch') || verifyBad.includes('difiere') || verifyBad.includes('hash'));
const restoreNo = await client.callTool({ name: 'restore', arguments: { id: snapshotId } });
console.log('restore sin confirm isError:', restoreNo.isError === true);
const restoreSkip = textOf(await client.callTool({ name: 'restore', arguments: { id: snapshotId, confirm: true } }));
console.log('--- restore sin overwrite ---'); console.log(restoreSkip);
console.log('restore skip existentes:', /omitidos/i.test(restoreSkip));
const restoreOver = textOf(await client.callTool({ name: 'restore', arguments: { id: snapshotId, overwrite: true, confirm: true } }));
console.log('--- restore overwrite ---'); console.log(restoreOver);
const restored = JSON.parse(readFileSync(path.join(home, 'media-studio', 'config.json'), 'utf8'));
console.log('restaurado contenido original:', JSON.stringify(restored).includes('C:\\\\Users\\\\desco'));
const missing = await client.callTool({ name: 'verify', arguments: { id: 'no-existe' } });
console.log('id inexistente isError:', missing.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
console.log('OK');
