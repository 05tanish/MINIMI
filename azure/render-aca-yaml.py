#!/usr/bin/env python3
"""Render one ACA template with local settings and secret values.

The rendered file is created with mode 0600. Never commit or print it.
"""

import json
import os
import sys
from pathlib import Path


REQUIRED = {
    "<location>": "ACA_LOCATION",
    "<resource-group>": "ACA_RESOURCE_GROUP",
    "<env-resource-id>": "ACA_ENV_RESOURCE_ID",
    "<acr-login-server>": "ACR_LOGIN_SERVER",
    "<image-tag>": "IMAGE_TAG",
    "<frontend-fqdn>": "FRONTEND_FQDN",
    "<worker-api-internal-fqdn>": "WORKER_API_FQDN",
    "<api-internal-fqdn>": "API_FQDN",
    "<upstash-rest-url>": "REDIS_REST_URL",
}
SECRETS = {
    "__SECRET_DATABASE_URL__": "DATABASE_URL",
    "__SECRET_GEMINI_API_KEY__": "GEMINI_API_KEY",
    "__SECRET_TAVILY_API_KEY__": "TAVILY_API_KEY",
    "__SECRET_REDIS_REST_TOKEN__": "REDIS_REST_TOKEN",
    "__SECRET_WORKER_INTERNAL_SECRET__": "WORKER_INTERNAL_SECRET",
    "__SECRET_GNANI_API_KEY__": "GNANI_API_KEY",
    "__SECRET_UPSTASH_REDIS_TLS_URL__": "UPSTASH_REDIS_TLS_URL",
}


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: render-aca-yaml.py INPUT.yaml OUTPUT.yaml")
    source_path, output_path = map(Path, sys.argv[1:])
    source = source_path.read_text()
    rendered = source
    for marker, variable in REQUIRED.items():
        if marker in rendered:
            value = os.environ.get(variable, "")
            if not value:
                raise SystemExit(f"Missing required setting: {variable}")
            rendered = rendered.replace(marker, value)
    for marker, variable in SECRETS.items():
        if marker in rendered:
            value = os.environ.get(variable, "")
            if not value:
                raise SystemExit(f"Missing required secret: {variable}")
            rendered = rendered.replace(marker, json.dumps(value))
    if any(marker in rendered for marker in (*REQUIRED, *SECRETS)):
        raise SystemExit("Unresolved template placeholder; no output written")
    fd = os.open(output_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write(rendered)


if __name__ == "__main__":
    main()
