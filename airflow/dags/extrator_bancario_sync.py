"""
DAG de sincronização do Extrator Bancário via AWS Batch.

Submete um job AWS Batch que executa o script scripts/batch-sync.mjs dentro de
um container Docker. O job pode rodar para todas as empresas ativas ou para uma
empresa específica (útil para retries / testes).

Configuração esperada no Airflow:
- Variável EXTRATOR_BATCH_JOB_DEFINITION: nome/ARN da job definition no AWS Batch.
- Variável EXTRATOR_BATCH_JOB_QUEUE: nome/ARN da fila do AWS Batch.
- Conexão aws_default (padrão do Airflow AWS provider).

Para filtrar por empresa, passe a variável EMPRESA via containerOverrides
(exemplo: parameters={"EMPRESA": "marcon"}).
"""

from datetime import datetime, timedelta

from airflow import DAG
from airflow.providers.amazon.aws.operators.batch import BatchOperator
from airflow.models import Variable

DEFAULT_ARGS = {
    "owner": "extrator-bancario",
    "depends_on_past": False,
    "email_on_failure": True,
    "email_on_retry": False,
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
    "execution_timeout": timedelta(hours=2),
}

with DAG(
    dag_id="extrator_bancario_sync",
    default_args=DEFAULT_ARGS,
    description="Sincroniza extratos bancários (Pluggy/Klavi) para o Have Gestor via AWS Batch",
    schedule="0 7 * * *",  # 07:00 UTC = 04:00 BRT
    start_date=datetime(2026, 1, 1),
    catchup=False,
    tags=["extrator-bancario", "open-finance", "sync"],
) as dag:

    job_definition = Variable.get("EXTRATOR_BATCH_JOB_DEFINITION", default_var="extrator-bancario-sync")
    job_queue = Variable.get("EXTRATOR_BATCH_JOB_QUEUE", default_var="extrator-bancario-queue")

    # Submete o job AWS Batch. O container padrão (CMD do Dockerfile.batch)
    # executa o sync para todas as empresas ativas.
    sync_job = BatchOperator(
        task_id="sync_todas_empresas",
        job_name="extrator-bancario-sync",
        job_definition=job_definition,
        job_queue=job_queue,
        # Sobrescreve o comando do container para permitir passar argumentos no futuro.
        # O CMD padrão do Dockerfile.batch já executa batch-sync.mjs.
        overrides={
            "command": ["node", "scripts/batch-sync.mjs"],
        },
        aws_conn_id="aws_default",
        region_name="us-east-1",
    )

    sync_job
