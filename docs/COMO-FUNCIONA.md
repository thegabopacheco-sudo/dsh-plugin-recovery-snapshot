# Cómo funciona dsh-plugin-recovery-snapshot

Snapshots de configuracion de plugins de DeepSeek Harness con manifiesto SHA-256, verificacion de integridad y restauracion segura con confirmacion.

## Arquitectura

```
DSH ──MCP stdio──► server.mjs (bundle single-file)
                    └─ lógica local del plugin
```

## Herramientas reales

- `status`: Estado
- `backup`: Crear snapshot
- `list`: Listar snapshots
- `verify`: Verificar snapshot
- `restore`: Restaurar snapshot

## Seguridad

- Lectura por defecto; acciones con `confirm:true`.
- Modo `read-only` por variable de entorno.
- Listas blancas cuando aplique.
- Auditoría en `<DSH_HOME>\cache\recovery-snapshot\audit.jsonl`.
- Rate limit de acciones.

## Verificación

Tests end-to-end con el cliente MCP oficial (`@modelcontextprotocol/client@2.2.0`)
y artefacto empaquetado (`npm pack` → `postinstall` → servidor desplegado).
