# dsh-plugin-recovery-snapshot — Recovery Snapshot

Snapshots de configuracion de plugins de DeepSeek Harness con manifiesto SHA-256, verificacion de integridad y restauracion segura con confirmacion.

## Tools

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `backup` | Crear snapshot |
| `list` | Listar snapshots |
| `verify` | Verificar snapshot |
| `restore` | Restaurar snapshot |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-recovery-snapshot` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-recovery-snapshot
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_RECOVERY_SNAPSHOT_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\recovery-snapshot\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
