#!/usr/bin/env python3
"""Backup completo consistente + restauração isolada na VPS. Não altera o banco fonte.

Executar no host da VPS com Docker. Dados e logs privados ficam no diretório informado.
A restauração usa imagem local idêntica, volume novo, sem rede/portas e limites de recursos.
Não envia arquivos para serviços externos e não remove backups anteriores.
"""
import argparse
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def verify_files(folder, manifest):
    """Recusa arquivo truncado/alterado antes de usá-lo na restauração."""
    for filename in ('database.dump', 'roles.sql', 'inventory-before.tsv'):
        path = folder / filename
        h = hashlib.sha256()
        with path.open('rb') as f:
            for block in iter(lambda: f.read(1024 * 1024), b''):
                h.update(block)
        if path.stat().st_size != manifest[filename]['bytes'] or h.hexdigest() != manifest[filename]['sha256']:
            raise RuntimeError('Integridade do backup inválida: ' + filename)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default='supabase-db')
    ap.add_argument('--destination', default='/srv/js-lead-hunter/backups/v4-validation')
    args = ap.parse_args()
    os.umask(0o077)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
    folder = Path(args.destination) / stamp
    folder.mkdir(parents=True, exist_ok=False)
    name = 'jslh-v4-restore-' + stamp
    volume = name + '-data'
    image = subprocess.check_output(['docker', 'inspect', '--format', '{{.Image}}', args.source], text=True).strip()
    prefix = ['docker', 'exec', '-i', args.source]
    session = subprocess.Popen(prefix + ['psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(folder/'snapshot-errors.log', 'w'), text=True, bufsize=1)
    started = False
    manifest = {'created_at': datetime.now(timezone.utc).isoformat(), 'image': image, 'restore_validated': False}
    inventory_sql = """select format('select %L, count(*) from %I.%I;', schemaname || '.' || tablename, schemaname, tablename)
from pg_tables where schemaname not in ('pg_catalog','information_schema') and schemaname !~ '^pg_toast' order by schemaname, tablename;
\\gexec
"""
    try:
        session.stdin.write('begin isolation level repeatable read read only;\nselect pg_export_snapshot();\n')
        session.stdin.flush()
        snapshot = session.stdout.readline().strip()
        if not snapshot or not all(c in '0123456789ABCDEFabcdef-' for c in snapshot):
            raise RuntimeError('Snapshot inválido; backup interrompido')
        session.stdin.write(inventory_sql + "select 'INVENTORY_END';\n")
        session.stdin.flush()
        counts = []
        for line in session.stdout:
            if line.strip() == 'INVENTORY_END':
                break
            counts.append(line.strip())
        else:
            raise RuntimeError('Inventário não concluído')
        (folder/'inventory-before.tsv').write_text('\n'.join(counts)+'\n')
        with open(folder/'database.dump', 'wb') as out:
            run(prefix + ['pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '-Fc', '--snapshot='+snapshot], stdout=out)
        session.stdin.write('rollback;\n\\q\n'); session.stdin.flush()
        session.wait(timeout=20)
        if session.returncode:
            raise RuntimeError('Erro na sessão de snapshot')
        with open(folder/'roles.sql', 'wb') as out:
            run(prefix + ['pg_dumpall', '-U', 'supabase_admin', '--roles-only', '--no-role-passwords'], stdout=out)
        for file in ('database.dump', 'roles.sql', 'inventory-before.tsv'):
            h = hashlib.sha256()
            with open(folder/file, 'rb') as f:
                for block in iter(lambda: f.read(1024*1024), b''): h.update(block)
            manifest[file] = {'sha256': h.hexdigest(), 'bytes': (folder/file).stat().st_size}
        (folder/'manifest.json').write_text(json.dumps(manifest, indent=2))
        verify_files(folder, manifest)
        run(['docker','volume','create', volume], stdout=subprocess.DEVNULL)
        run(['docker','run','-d','--name',name,'--network','none','--memory','1536m','--cpus','1',
             '--mount','type=volume,source='+volume+',target=/restore',
             '--mount','type=bind,source='+str(folder)+',target=/backup,readonly',
             '--entrypoint','bash',image,'-c',
             'set -eu; chown postgres:postgres /restore; gosu postgres initdb -D /restore/pg -U supabase_admin --auth=trust >/restore/init.log; exec gosu postgres postgres -D /restore/pg -c listen_addresses= -c unix_socket_directories=/tmp -c shared_preload_libraries=pg_net'], stdout=subprocess.DEVNULL)
        started = True
        # Readiness bounded by server logs; no unbounded polling or production calls.
        run(['docker','exec',name,'bash','-c',
             'for i in {1..60}; do pg_isready -h /tmp -U supabase_admin >/dev/null && exit 0; sleep 1; done; exit 1'])
        roles=(folder/'roles.sql').read_text()
        roles='\n'.join(l for l in roles.splitlines() if l != 'CREATE ROLE supabase_admin;')+'\n'
        with open(folder/'restore-roles.log','wb') as log:
            run(['docker','exec','-i',name,'psql','-X','-v','ON_ERROR_STOP=1','-h','/tmp','-U','supabase_admin','-d','postgres'],input=roles.encode(),stdout=log,stderr=subprocess.STDOUT)
        with open(folder/'restore.log','wb') as log:
            run(['docker','exec',name,'pg_restore','--exit-on-error','-h','/tmp','-U','supabase_admin','-d','postgres','/backup/database.dump'],stdout=log,stderr=subprocess.STDOUT)
        result = subprocess.check_output(['docker','exec','-i',name,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-h','/tmp','-U','supabase_admin','-d','postgres'], input=inventory_sql.encode()).decode()
        restored = sorted(line.strip() for line in result.splitlines() if line.strip())
        (folder/'inventory-restored.tsv').write_text('\n'.join(restored)+'\n')
        if restored != sorted(counts):
            raise RuntimeError('Contagens divergentes; consultar inventários privados')
        manifest['restore_validated'] = True
        manifest['tables_verified'] = len(counts)
        manifest['validated_at'] = datetime.now(timezone.utc).isoformat()
        (folder/'manifest.json').write_text(json.dumps(manifest,indent=2))
        print(json.dumps({'restore_validated':True, 'tables_verified':len(counts), 'folder':str(folder)}))
    finally:
        if session.poll() is None:
            session.stdin.close(); session.terminate(); session.wait(timeout=10)
        if started:
            # Only this script's new container; the verified backup remains on disk.
            run(['docker','rm','-f',name],stdout=subprocess.DEVNULL)
            run(['docker','volume','rm',volume],stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
