# Copyright (c) 2026 Dashiell Renaud
# Licensed under CC BY-NC-ND 4.0 (https://creativecommons.org/licenses/by-nc-nd/4.0/)
# SPDX-License-Identifier: CC-BY-NC-ND-4.0

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NIGHTMERCHANT_CLOUD_RUN=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt \
    && useradd --create-home --shell /bin/bash appuser

COPY LICENSE /app/LICENSE
COPY src /app/src
COPY public /app/public

RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 8080

CMD ["python3", "src/server.py"]
