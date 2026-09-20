import os
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
import pytest

from ledger import MemoryLedger


@pytest.fixture
def ledger_url():
    url = os.environ["ZOEN_MEMORY_DATABASE_URL"]
    schema = "proof_" + uuid4().hex
    with psycopg.connect(url, autocommit=True) as db:
        db.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    options = conninfo_to_dict(url)
    options["options"] = f"-c search_path={schema},public"
    scoped_url = make_conninfo(**options)
    try:
        with psycopg.connect(scoped_url, autocommit=True) as db:
            db.execute("CREATE TABLE zoen_memories (id UUID PRIMARY KEY, vector vector(1536), payload JSONB)")
        yield scoped_url
    finally:
        with psycopg.connect(url, autocommit=True) as db:
            db.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


def test_namespace_locks_work_across_pools_and_release_on_failure(ledger_url):
    first, second = MemoryLedger(ledger_url), MemoryLedger(ledger_url)
    namespace = str(uuid4())
    attempted, entered = threading.Event(), threading.Event()

    def other_writer():
        attempted.set()
        with second.namespace(namespace):
            entered.set()

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            with pytest.raises(RuntimeError):
                with first.namespace(namespace):
                    pending = pool.submit(other_writer)
                    assert attempted.wait(2)
                    assert not entered.wait(0.1)
                    raise RuntimeError("Simulated failed writer")
            pending.result(timeout=3)
            assert entered.is_set()
    finally:
        first.close()
        second.close()
