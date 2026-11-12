#!/usr/bin/env node
// dsh-plugin-recovery-snapshot — snapshots de configs de plugins con manifiesto SHA-256.
// Tools: status, backup, list, verify, restore.

import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const SNAPSHOT_ROOT = path.join(DSH_HOME, 'backups', 'recovery-snapshot');
const CACHE_DIR = path.join(DSH_HOME, 'cache', 'recovery-snapshot');
const SKIP_DIRS = new Set(['cache', 'sessions', 'storages', 'attachments', 'plugins', 'profiles', 'dsh-runtimes', 'clis', 'backups', 'backups-modelos-gratis']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const READ_ONLY = String(process.env.DSH_RECOVERY_MODE || '').toLowerCase() === 'read-only';
const log = (m) => process.stderr.write(`[recovery] ${m}\n`);

function sha256(file) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
function discoverConfigs() {
  const configs = [];
  for (const entry of (() => { try { return readdirSync(DSH_HOME, { withFileTypes: true }); } catch { return []; } })()) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name.toLowerCase())) continue;
    const file = path.join(DSH_HOME, entry.name, 'config.json');
    if (!existsSync(file)) continue;
    const stat = statSync(file);
    if (stat.size > MAX_FILE_BYTES) continue;
    configs.push({ plugin: entry.name, file, size: stat.size });
  }
  return configs.sort((a, b) => a.plugin.localeCompare(b.plugin));
}
function listSnapshots() {
  const snapshots = [];
  for (const entry of (() => { try { return readdirSync(SNAPSHOT_ROOT, { withFileTypes: true }); } catch { return []; } })()) {
    if (!entry.isDirectory()) continue;
    const manifestFile = path.join(SNAPSHOT_ROOT, entry.name, 'manifest.json');
    if (!existsSync(manifestFile)) continue;
    try { const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')); snapshots.push({ id: entry.name, ...manifest }); } catch { /* ignora */ }
  }
  return snapshots.sort((a, b) => b.id.localeCompare(a.id));
}
function findSnapshot(ref) { const id = String(ref || '').trim(); return listSnapshots().find((snapshot) => snapshot.id === id) || listSnapshots().find((snapshot) => snapshot.id.startsWith(id)); }
function textResult(text) { return { content: [{ type: 'text', text }] }; }

function buildInstructions() {
  return [
    'Recovery Snapshot: copia versionada de las configuraciones de plugins del harness.',
    '',
    `Snapshots: ${SNAPSHOT_ROOT}`,
    '',
    'Herramientas: status, backup, list, verify, restore.',
    '',
    'Reglas:',
    '- backup/restore requieren confirm:true y pedido explícito.',
    '- Las configs pueden contener tokens: los snapshots quedan solo en disco local; no los muestres.',
    '- restore no sobrescribe salvo overwrite:true; restaura solo rutas dentro de DSH_HOME.',
    '- backup guarda manifiesto SHA-256 para verificar integridad.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-recovery-snapshot', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });

  server.registerTool(
    'status',
    { title: 'Estado', description: 'Configs detectadas, snapshots disponibles y modo.', inputSchema: z.object({}) },
    async () => {
      const configs = discoverConfigs();
      const snapshots = listSnapshots();
      return textResult([`Configs detectadas: ${configs.length}`, `Snapshots: ${snapshots.length}${snapshots[0] ? ` · último ${snapshots[0].id}` : ''}`, `Raíz: ${SNAPSHOT_ROOT}`, `Modo: ${READ_ONLY ? 'read-only' : 'normal'}`].join('\n'));
    },
  );

  server.registerTool(
    'backup',
    { title: 'Crear snapshot', description: 'Copia las configs con manifiesto. Requiere confirm:true.', inputSchema: z.object({ label: z.string().max(80).optional(), confirm: z.boolean().optional() }) },
    async (args) => {
      if (READ_ONLY) throw new Error('modo read-only: backup deshabilitado');
      if (args.confirm !== true) throw new Error('backup requiere confirm:true y pedido explícito');
      const configs = discoverConfigs();
      if (configs.length === 0) return textResult(`No hay configs en ${DSH_HOME}.`);
      const id = new Date().toISOString().replace(/[:.]/g, '-');
      const dir = path.join(SNAPSHOT_ROOT, id);
      mkdirSync(dir, { recursive: true });
      const files = [];
      for (const config of configs) {
        const safeName = `${config.plugin}.config.json`;
        const target = path.join(dir, safeName);
        copyFileSync(config.file, target);
        files.push({ plugin: config.plugin, path: config.file, backupName: safeName, sha256: sha256(config.file), size: config.size });
      }
      const manifest = { id, createdAt: new Date().toISOString(), label: args.label || '', files, note: 'puede contener tokens: no compartir' };
      writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      return textResult(`Snapshot: ${id} · ${files.length} configs · ${dir}`);
    },
  );

  server.registerTool(
    'list',
    { title: 'Listar snapshots', description: 'Snapshots disponibles.', inputSchema: z.object({}) },
    async () => {
      const snapshots = listSnapshots();
      if (snapshots.length === 0) return textResult('Sin snapshots. Usa backup con confirm:true.');
      return textResult(snapshots.map((snapshot) => `${snapshot.id} · ${snapshot.files.length} configs${snapshot.label ? ` · ${snapshot.label}` : ''} · ${snapshot.createdAt}`).join('\n'));
    },
  );

  server.registerTool(
    'verify',
    { title: 'Verificar snapshot', description: 'Recalcula SHA-256 y compara con el manifiesto.', inputSchema: z.object({ id: z.string().min(1) }) },
    async (args) => {
      const snapshot = findSnapshot(args.id);
      if (!snapshot) throw new Error(`snapshot no encontrado: ${args.id}`);
      const results = [];
      for (const file of snapshot.files) {
        if (!existsSync(file.path)) { results.push(`❌ ${file.plugin}: archivo original no existe`); continue; }
        const actual = sha256(file.path);
        results.push(actual === file.sha256 ? `✅ ${file.plugin}` : `❌ ${file.plugin}: hash difiere (mismatch)`);
      }
      const errors = results.filter((line) => line.startsWith('❌')).length;
      return textResult([`Snapshot ${snapshot.id} · ${results.length} archivos · ${errors} problema(s)`, ...results].join('\n'));
    },
  );

  server.registerTool(
    'restore',
    { title: 'Restaurar snapshot', description: 'Restaura configs. Requiere confirm:true; overwrite para pisar.', inputSchema: z.object({ id: z.string().min(1), overwrite: z.boolean().optional(), confirm: z.boolean().optional() }) },
    async (args) => {
      if (READ_ONLY) throw new Error('modo read-only: restore deshabilitado');
      if (args.confirm !== true) throw new Error('restore requiere confirm:true y pedido explícito');
      const snapshot = findSnapshot(args.id);
      if (!snapshot) throw new Error(`snapshot no encontrado: ${args.id}`);
      const dir = path.join(SNAPSHOT_ROOT, snapshot.id);
      let restored = 0;
      const skipped = [];
      for (const file of snapshot.files) {
        const target = path.resolve(file.path);
        if (!target.startsWith(path.resolve(DSH_HOME) + path.sep)) { skipped.push(`${file.plugin} (fuera de DSH_HOME)`); continue; }
        if (existsSync(target) && args.overwrite !== true) { skipped.push(file.plugin); continue; }
        const source = path.join(dir, file.backupName);
        if (!existsSync(source)) { skipped.push(`${file.plugin} (falta en snapshot)`); continue; }
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(source, target);
        restored++;
      }
      return textResult([`Restaurados: ${restored}`, skipped.length ? `Omitidos: ${skipped.join(', ')}` : ''].filter(Boolean).join('\n'));
    },
  );

  return server;
}

try { if (!READ_ONLY) mkdirSync(SNAPSHOT_ROOT, { recursive: true }); mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignora */ }
log(`configs: ${DSH_HOME} · snapshots: ${SNAPSHOT_ROOT} · modo: ${READ_ONLY ? 'read-only' : 'normal'}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
