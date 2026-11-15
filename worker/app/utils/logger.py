import json
import logging

class JsonFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({"level": record.levelname.lower(), "message": record.getMessage(), **getattr(record, "fields", {})})

handler = logging.StreamHandler()
handler.setFormatter(JsonFormatter())
logging.basicConfig(level=logging.INFO, handlers=[handler])
logger = logging.getLogger("minimi.worker")
