"""Servidor WebDAV falso + gerador de arquivos SINTÉTICOS no leiaute da Receita.

Usado só nos testes automatizados. Nada aqui é dado oficial.
"""
from __future__ import annotations

import base64
import os
import threading
import zipfile
from datetime import date, datetime, timedelta, timezone
from email.utils import format_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from lead_hunter.cnpj import compute_dv
from lead_hunter.layout import REQUIRED_FILES

TOKEN = "TESTTOKEN"


def d(days_ago: int) -> str:
    return (date.today() - timedelta(days=days_ago)).strftime("%Y%m%d")


def cnpj(base8: str, ordem: str = "0001") -> tuple[str, str, str]:
    return base8, ordem, compute_dv(base8 + ordem)


def _row(values: list[str]) -> bytes:
    return (";".join(f'"{v}"' for v in values) + "\n").encode("latin-1")


def est_row(base8, ordem="0001", matriz="1", fantasia="", situacao="02", inicio=None, cnae="4781400",
            sec="", uf="SP", mun="7107", tel="", email="", dv=None):
    b, o, dvc = cnpj(base8, ordem)
    return _row([b, o, dv or dvc, matriz, fantasia, situacao, d(1), "00", "", "", inicio or d(5), cnae, sec,
                 "RUA", "DAS FLORES", "10", "", "CENTRO", "01001000", uf, mun, "11" if tel else "", tel, "", "",
                 "", "", email, "", ""])


def build_competence(root: Path, competence: str, *, extra_est: list[bytes] | None = None,
                     omit: set[str] | None = None, corrupt: set[str] | None = None) -> Path:
    """Cria AAAA-MM/ com todos os ZIPs exigidos."""
    folder = root / competence
    folder.mkdir(parents=True, exist_ok=True)
    est0 = [
        # matriz ativa aberta há 5 dias, com telefone e e-mail, nome com acentos (Latin-1)
        est_row("11222333", fantasia="PADARIA SÃO JOÃO", tel="912345678", email="CONTATO@PADARIA.COM.BR"),
        # filial da mesma empresa (não vira lead por padrão)
        est_row("11222333", ordem="0002", matriz="2", fantasia="FILIAL"),
        # matriz ativa com CNPJ ALFANUMÉRICO, aberta há 20 dias
        est_row("12ABC345", ordem="01DE", fantasia="ALFA DIGITAL", cnae="7319002", email="oi@alfa.com"),
        # baixada (situação 08) — não vira lead
        est_row("22333444", situacao="08"),
        # aberta há 400 dias — fora da janela, nem é importada
        est_row("33444555", inicio=d(400)),
        # empresa que será bloqueada para contato
        est_row("44555666", fantasia="BLOQUEADA"),
        # DV inválido — entra na base, mas não vira lead
        est_row("55666777", dv="00"),
        # linha com campo contendo ponto e vírgula entre aspas
        est_row("66777888", fantasia="LOJA A; B", uf="RJ", mun="6001"),
        # campo com quebra de linha entre aspas (ocorre nos arquivos reais)
        est_row("88999000", fantasia="CAFE\nDA ESQUINA", uf="MG", mun="4123"),
    ] + (extra_est or [])
    files: dict[str, bytes] = {
        "Estabelecimentos0.zip": b"".join(est0),
        "Empresas0.zip": b"".join([
            _row(["11222333", "PADARIA SÃO JOÃO LTDA", "2062", "49", "10000,00", "01", ""]),
            _row(["12ABC345", "ALFA DIGITAL LTDA", "2062", "49", "50000,50", "05", ""]),
            _row(["22333444", "BAIXADA LTDA", "2062", "49", "1,00", "01", ""]),
            _row(["44555666", "BLOQUEADA LTDA", "2062", "49", "1000,00", "03", ""]),
            _row(["55666777", "DV RUIM LTDA", "2062", "49", "1000,00", "01", ""]),
            _row(["66777888", "LOJA AB LTDA", "2135", "50", "0,00", "01", ""]),
            _row(["99999999", "SEM ESTABELECIMENTO", "2062", "49", "1,00", "01", ""]),
        ]),
        "Simples.zip": b"".join([
            _row(["11222333", "S", d(5), "00000000", "N", "00000000", "00000000"]),
            _row(["66777888", "S", d(5), "00000000", "S", d(5), "00000000"]),
        ]),
        "Cnaes.zip": b"".join([_row(["4781400", "Comércio varejista de artigos do vestuário e acessórios"]),
                               _row(["7319002", "Promoção de vendas"])]),
        "Municipios.zip": b"".join([_row(["7107", "SAO PAULO"]), _row(["6001", "RIO DE JANEIRO"])]),
        "Naturezas.zip": b"".join([_row(["2062", "Sociedade Empresária Limitada"]),
                                   _row(["2135", "Empresário (Individual)"])]),
    }
    for name in REQUIRED_FILES:
        if omit and name in omit:
            continue
        content = files.get(name, b"")
        path = folder / name
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(name.replace(".zip", "").upper() + ".D61114", content)
        if corrupt and name in corrupt:
            data = bytearray(path.read_bytes())
            data[len(data) // 2] ^= 0xFF
            path.write_bytes(bytes(data))
    return folder


class _Handler(BaseHTTPRequestHandler):
    root: Path
    fail_ranges: dict  # caminho → nº de falhas a simular

    def log_message(self, *a):  # silencioso
        pass

    def _auth(self) -> bool:
        expected = "Basic " + base64.b64encode(f"{TOKEN}:".encode()).decode()
        if self.headers.get("Authorization") != expected:
            # Consome o corpo antes de fechar: no Windows o socket com dados pendentes
            # pode ser resetado e ocultar o HTTP 401, tornando o teste intermitente.
            length = int(self.headers.get('Content-Length') or 0)
            if length:
                self.rfile.read(length)
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="share"')
            self.send_header('Content-Length', '0')
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.flush()
            self.close_connection = True
            return False
        return True

    def _path(self) -> Path:
        rel = self.path.split("/webdav", 1)[-1].strip("/")
        return self.root / rel

    def do_PROPFIND(self):  # noqa: N802
        if not self._auth():
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        p = self._path()
        if not p.exists():
            self.send_response(404)
            self.end_headers()
            return
        items = [p] + sorted(p.iterdir()) if p.is_dir() else [p]
        parts = []
        for it in items:
            rel = it.relative_to(self.root).as_posix()
            href = "/public.php/webdav/" + (rel + "/" if it.is_dir() and rel != "." else rel if rel != "." else "")
            lm = format_datetime(datetime.fromtimestamp(it.stat().st_mtime, tz=timezone.utc), usegmt=True)
            if it.is_dir():
                props = f"<d:resourcetype><d:collection/></d:resourcetype><d:getlastmodified>{lm}</d:getlastmodified>"
            else:
                props = (f"<d:resourcetype/><d:getcontentlength>{it.stat().st_size}</d:getcontentlength>"
                         f"<d:getlastmodified>{lm}</d:getlastmodified>")
            parts.append(f"<d:response><d:href>{href}</d:href><d:propstat><d:prop>{props}</d:prop>"
                         f"<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>")
        body = ('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' + "".join(parts) + "</d:multistatus>").encode()
        self.send_response(207)
        self.send_header("Content-Type", "application/xml")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):  # noqa: N802
        if not self._auth():
            return
        p = self._path()
        self.send_response(200 if p.is_file() else 404)
        if p.is_file():
            self.send_header("Content-Length", str(p.stat().st_size))
        self.end_headers()

    def do_GET(self):  # noqa: N802
        if not self._auth():
            return
        p = self._path()
        if not p.is_file():
            self.send_response(404)
            self.end_headers()
            return
        data = p.read_bytes()
        rng = self.headers.get("Range")
        if rng:
            key = str(p)
            if self.fail_ranges.get(key, 0) > 0 and rng != "bytes=0-0":
                self.fail_ranges[key] -= 1
                self.send_response(503)
                self.end_headers()
                return
            start, end = rng.replace("bytes=", "").split("-")
            start, end = int(start), min(int(end), len(data) - 1)
            chunk = data[start:end + 1]
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
            self.send_header("Content-Length", str(len(chunk)))
            self.end_headers()
            self.wfile.write(chunk)
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class FakeRF:
    def __init__(self, root: Path):
        handler = type("H", (_Handler,), {"root": root, "fail_ranges": {}})
        self.handler = handler
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_address[1]}/public.php/webdav"

    def __enter__(self):
        os.environ.setdefault("NO_PROXY", "127.0.0.1,localhost")
        self.thread.start()
        return self

    def __exit__(self, *a):
        self.server.shutdown()
