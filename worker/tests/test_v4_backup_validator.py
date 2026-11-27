"""Contrato do validador de backup; Docker é simulado, sem tocar na infraestrutura."""
import importlib.util
import io
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy/vps/scripts/validate-v4-backup.py'


def load():
    spec = importlib.util.spec_from_file_location('v4_backup', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Snapshot:
    def __init__(self, *_args, **_kwargs):
        self.stdin = io.StringIO()
        self.stdout = io.StringIO('00000003-0000001A-1\npublic.leads|3\nINVENTORY_END\n')
        self.returncode = None

    def wait(self, **_kw):
        self.returncode = 0
        return 0

    def poll(self):
        return self.returncode

    def terminate(self):
        self.returncode = -15


def environment(monkeypatch, tmp_path, restored='public.leads|3\n', fail_restore=False):
    m = load()
    calls = []
    monkeypatch.setattr(m.os, 'umask', lambda _: 0)
    monkeypatch.setattr(m.subprocess, 'Popen', Snapshot)
    monkeypatch.setattr('sys.argv', ['validator', '--destination', str(tmp_path)])

    def output(args, **_kw):
        if args[1] == 'inspect':
            return 'sha256:immutable-local-image\n'
        return restored.encode()

    def run(args, **kw):
        calls.append(args)
        if 'pg_restore' in args and fail_restore:
            raise RuntimeError('restore interrompido')
        if 'pg_dump' in args:
            kw['stdout'].write(b'dump-verificavel')
        if 'pg_dumpall' in args:
            kw['stdout'].write(b'CREATE ROLE supabase_admin;\nCREATE ROLE authenticated;\n')
        return None

    monkeypatch.setattr(m.subprocess, 'check_output', output)
    monkeypatch.setattr(m, 'run', run)
    return m, calls


def test_restauracao_isolada_sem_portas_e_snapshot_consistente(monkeypatch, tmp_path):
    m, calls = environment(monkeypatch, tmp_path)
    m.main()
    report = json.loads(next(tmp_path.glob('*/manifest.json')).read_text())
    assert report['restore_validated'] is True
    assert report['tables_verified'] == 1
    dump = next(c for c in calls if 'pg_dump' in c)
    assert '--snapshot=00000003-0000001A-1' in dump
    container = next(c for c in calls if c[:2] == ['docker', 'run'])
    assert container[container.index('--network') + 1] == 'none'
    assert '--memory' in container and '--cpus' in container
    assert '-p' not in container and '--publish' not in container
    assert 'shared_preload_libraries=pg_net' in container[-1]
    assert all('supabase-db' not in c for c in calls if c[:2] == ['docker', 'rm'])
    assert next(tmp_path.glob('*/database.dump')).exists()


def test_backup_corrompido_recusado_antes_da_restauracao(tmp_path):
    m = load()
    import hashlib
    manifest = {}
    for name in ('database.dump', 'roles.sql', 'inventory-before.tsv'):
        payload = b'original'
        (tmp_path / name).write_bytes(payload)
        manifest[name] = {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
    m.verify_files(tmp_path, manifest)
    (tmp_path / 'database.dump').write_bytes(b'alterado')
    with pytest.raises(RuntimeError, match='Integridade'):
        m.verify_files(tmp_path, manifest)


@pytest.mark.parametrize('failure', ['counts', 'restore'])
def test_falha_nao_declara_sucesso_e_preserva_backup(monkeypatch, tmp_path, failure):
    m, calls = environment(monkeypatch, tmp_path,
                           restored='public.leads|2\n' if failure == 'counts' else 'public.leads|3\n',
                           fail_restore=failure == 'restore')
    with pytest.raises(RuntimeError):
        m.main()
    report = json.loads(next(tmp_path.glob('*/manifest.json')).read_text())
    assert report['restore_validated'] is False
    assert next(tmp_path.glob('*/database.dump')).exists()
    assert any(c[:3] == ['docker', 'rm', '-f'] for c in calls)
