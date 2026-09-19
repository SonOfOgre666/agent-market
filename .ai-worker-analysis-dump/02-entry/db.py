import os
import redis
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

_mongo_client = None
_redis_client = None


def get_db():
    global _mongo_client
    if _mongo_client is None:
        uri = os.getenv('MONGODB_URI', 'mongodb://localhost:27017/agentmarket')
        _mongo_client = MongoClient(uri)
    db_name = os.getenv('MONGODB_URI', 'agentmarket').split('/')[-1].split('?')[0]
    return _mongo_client[db_name or 'agentmarket']


def get_redis():
    global _redis_client
    if _redis_client is None:
        host = os.getenv('REDIS_HOST', 'localhost')
        port = int(os.getenv('REDIS_PORT', '6379'))
        password = os.getenv('REDIS_PASSWORD') or None
        _redis_client = redis.Redis(host=host, port=port, password=password, decode_responses=True)
    return _redis_client
