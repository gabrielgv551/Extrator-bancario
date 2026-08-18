"""
DAG de sincronização do Extrator Bancário via SSH.

Roda o script scripts/batch-sync.mjs diretamente na EC2 onde o repositório está
clonado. Não requer AWS Batch — só precisa de uma conexão SSH configurada no
Airflow (ssh_default ou ssh_extrator_bancario).

Configuração esperada no Airflow:
- Conexão SSH: `ssh_extrator_bancario` (ou `ssh_default`)
  - host: IP ou DNS da EC2
  - login: usuário SSH (ex: ubuntu, ec2-user)
  - port: 22
  - extra: {"key_file": "/caminho/para/chave.pem"}

Variáveis do Airflow (opcionais):
- EXTRATOR_SYNC_REPO_DIR: diretório do repo na EC2 (padrão: /opt/Extrator-bancario)
- EXTRATOR_SYNC_EMPRESA: se definida, sincroniza apenas essa empresa
"""

from datetime import datetime, timedelta

from airflow import DAG
from airflow.providers.ssh.operators.ssh import SSHOperator
from airflow.models import Variable

DEFAULT_ARGS = {
    "owner": "extrator-bancario",
    "depends_on_past": False,
    "email_on_failure": True,
    "email_on_retry": False,
    "retries": 2,
    "retry_delay": timedelta(minutes=10),
    "execution_timeout": timedelta(hours=2),
}

with DAG(
    dag_id="extrator_bancario_sync_ssh",
    default_args=DEFAULT_ARGS,
    description="Sincroniza extratos bancários (Pluggy/Klavi) via SSH na EC2 dos motores",
    schedule="0 7 * * *",  # 07:00 UTC = 04:00 BRT
    start_date=datetime(2026, 1, 1),
    catchup=False,
    tags=["extrator-bancario", "open-finance", "sync", "ssh"],
) as dag:

    repo_dir = Variable.get("EXTRATOR_SYNC_REPO_DIR", default_var="/opt/Extrator-bancario")
    empresa = Variable.get("EXTRATOR_SYNC_EMPRESA", default_var="")

    # Comando a ser executado na EC2.
    # Garante que está no diretório correto e roda o sync.
    if empresa:
        command = f"cd {repo_dir} && git pull origin main && EMPRESA={empresa} node scripts/batch-sync.mjs"
    else:
        command = f"cd {repo_dir} && git pull origin main && node scripts/batch-sync.mjs"

    sync_task = SSHOperator(
        task_id="sync_via_ssh",
        ssh_conn_id="ssh_extrator_bancario",
        command=command,
        cmd_timeout=7200,  # 2h
    )

    sync_task
