import argparse
import asyncio
from backend.main import serve

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, required=True)
parser.add_argument('--parent-pid', type=int)
args = parser.parse_args()
asyncio.run(serve(args.port, args.parent_pid))
